import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import * as tcb from '@cloudbase/node-sdk';
import { BubbleData } from './remotion/ChatBubble';

const ENV_ID = process.env.TCB_ENV_ID || 'chayanchayu-d4g0fpnxq738c7662';
const BROWSER_EXECUTABLE = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;

// 云托管环境的 @cloudbase/node-sdk 调用云数据库需要显式传入腾讯云 API 凭证
// （云函数会自动注入，云托管不会）。凭证通过环境变量配置，避免硬编码。
const tcbInitConfig: { env: string; secretId?: string; secretKey?: string } = {
  env: ENV_ID,
};
if (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY) {
  tcbInitConfig.secretId = process.env.TENCENTCLOUD_SECRETID;
  tcbInitConfig.secretKey = process.env.TENCENTCLOUD_SECRETKEY;
}

const app = tcb.init(tcbInitConfig as never);
const db = app.database();

const ENTRY_POINT = path.resolve(process.cwd(), 'src/remotion/index.ts');
const OUTPUT_PATH = '/tmp/chat-mv-output.mp4';
const AUDIO_PATH = '/tmp/chat-mv-audio.mp3';

let cachedBundleLocation: string | null = null;

interface LyricLine {
  lineIndex: number;
  text: string;
  startS: number;
  endS: number;
}
interface LineMapEntry {
  lineIndex: number;
  dialogueIndex: number;
}

interface TaskData {
  screenshots: BubbleData[];
  audioUrl: string;
  audioId: string;
  audioDuration: number;
  musicProviderTaskId: string;
  lyrics: string;
  lyricsLineMap: LineMapEntry[];
  lyricsTimeline: LyricLine[];
  userId: string;
  topic: string;
  style: { dialogueTone: string; musicGenre: string };
}

async function getBundleLocation(): Promise<string> {
  if (cachedBundleLocation) return cachedBundleLocation;
  console.log('bundling remotion project...');
  cachedBundleLocation = await bundle({ entryPoint: ENTRY_POINT });
  console.log('bundle complete:', cachedBundleLocation);
  return cachedBundleLocation;
}

async function downloadAudio(audioUrl: string): Promise<string | null> {
  try {
    if (audioUrl.startsWith('cloud://')) {
      const result = await app.downloadFile({ fileID: audioUrl });
      const content = (result as { fileContent: Buffer }).fileContent;
      fs.writeFileSync(AUDIO_PATH, content);
      return AUDIO_PATH;
    }
    if (audioUrl.startsWith('http')) {
      const response = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      fs.writeFileSync(AUDIO_PATH, response.data);
      return AUDIO_PATH;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('audio download failed, rendering without audio:', msg);
  }
  return null;
}

async function resolveStickerUrls(bubbles: BubbleData[]): Promise<void> {
  const cloudFileIds = bubbles
    .filter((b) => b.type === 'image' && b.params.imageUrl?.startsWith('cloud://'))
    .map((b) => b.params.imageUrl as string);

  if (cloudFileIds.length === 0) return;

  try {
    const result = await app.getTempFileURL({ fileList: cloudFileIds });
    const fileList = (result as { fileList: Array<{ fileID: string; tempFileURL: string }> }).fileList;
    const urlMap = new Map(fileList.map((f) => [f.fileID, f.tempFileURL]));

    for (const b of bubbles) {
      if (b.type === 'image' && b.params.imageUrl && urlMap.has(b.params.imageUrl)) {
        b.params.imageUrl = urlMap.get(b.params.imageUrl);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('getTempFileURL failed for stickers:', msg);
  }
}

async function uploadVideo(filePath: string, taskId: string): Promise<string> {
  const fileContent = fs.readFileSync(filePath);
  const result = await app.uploadFile({
    cloudPath: `mv/${taskId}.mp4`,
    fileContent,
  });
  return (result as { fileID: string }).fileID;
}

async function setStage(taskId: string, stage: string, progress?: number): Promise<void> {
  try {
    const data: { renderStage: string; updatedAt: number; progress?: number } = {
      renderStage: stage,
      updatedAt: Date.now(),
    };
    if (typeof progress === 'number') data.progress = progress;
    await db.collection('tasks').doc(taskId).update(data);
  } catch {
    // 阶段标记失败不影响主流程
  }
}

const RENDER_FPS = 30;

/**
 * 用歌词行级时间戳(lyricsTimeline) + 歌词行→对话映射(lyricsLineMap)
 * 计算每个对话气泡应该出现的帧号。
 *
 * 映射链：dialogueIndex → lineMap 里所有该对话的歌词行 → 取最早 startS → ×fps 得 startFrame
 *
 * 降级：
 * - 无 timeline/lineMap 或映射为空 → 全部均匀分配
 * - 部分气泡无映射 → 用前一个已对齐气泡的时间
 */
function computeBubbleStartFrames(
  bubbles: BubbleData[],
  lineMap: LineMapEntry[] | undefined,
  timeline: LyricLine[] | undefined,
  totalFrames: number,
): BubbleData[] {
  const hasTimeline = Array.isArray(timeline) && timeline.length > 0;
  const hasMap = Array.isArray(lineMap) && lineMap.length > 0;

  // 完全没有对齐数据：均匀分配（含 time 分隔条一起均分，保持相对顺序）
  if (!hasTimeline || !hasMap) {
    const n = bubbles.length;
    const per = Math.floor(totalFrames / Math.max(n, 1));
    return bubbles.map((b, i) => ({ ...b, startFrame: Math.min(i * per, totalFrames - 1) }));
  }

  // 歌词行号 → 开始秒
  const lineToStart = new Map<number, number>();
  for (const t of timeline as LyricLine[]) {
    if (!lineToStart.has(t.lineIndex)) lineToStart.set(t.lineIndex, t.startS);
  }

  // 对话idx → 该对话所有歌词行里最早的开始秒
  const dialogueStart = new Map<number, number>();
  for (const m of lineMap as LineMapEntry[]) {
    if (m.dialogueIndex < 0) continue;
    const s = lineToStart.get(m.lineIndex);
    if (s == null) continue;
    const cur = dialogueStart.get(m.dialogueIndex);
    if (cur == null || s < cur) dialogueStart.set(m.dialogueIndex, s);
  }

  // 给每个气泡赋 startFrame；未映射到的用前一个的时间
  let lastFrame = 0;
  return bubbles.map((b) => {
    const s = dialogueStart.get(b.index);
    let frame: number;
    if (s != null) {
      frame = Math.max(0, Math.min(Math.round(s * RENDER_FPS), totalFrames - 1));
      lastFrame = frame;
    } else {
      frame = lastFrame;
    }
    return { ...b, startFrame: frame };
  });
}

export async function debugRenderSteps(taskId: string): Promise<Record<string, unknown>> {
  const steps: Record<string, unknown> = {};
  const mark = (k: string, v: unknown) => {
    steps[k] = v;
  };
  const errOf = (e: unknown) => (e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));

  // 1. 读任务
  try {
    const t0 = Date.now();
    const taskRes = await db.collection('tasks').doc(taskId).get();
    const raw = taskRes.data;
    const task = (Array.isArray(raw) ? raw[0] : raw) as TaskData | undefined;
    mark('readTask', {
      ok: true,
      ms: Date.now() - t0,
      hasTask: !!task,
      bubbleCount: task?.screenshots?.length ?? 0,
    });
    if (!task) return steps;
  } catch (e) {
    mark('readTask', { ok: false, error: errOf(e) });
    return steps;
  }

  // 2. 写库（验证 setStage 是否真的能写）
  try {
    const t0 = Date.now();
    await db.collection('tasks').doc(taskId).update({
      renderStage: 'debug_probe',
      updatedAt: Date.now(),
    });
    mark('writeStage', { ok: true, ms: Date.now() - t0 });
  } catch (e) {
    mark('writeStage', { ok: false, error: errOf(e) });
    return steps;
  }

  // 3. bundle
  let serveUrl = '';
  try {
    const t0 = Date.now();
    serveUrl = await getBundleLocation();
    mark('bundle', { ok: true, ms: Date.now() - t0, serveUrl });
  } catch (e) {
    mark('bundle', { ok: false, error: errOf(e) });
    return steps;
  }

  // 4. selectComposition（会真正启动 Chromium）
  try {
    const t0 = Date.now();
    const composition = await selectComposition({
      serveUrl,
      id: 'chat-mv',
      inputProps: { bubbles: [], audioPath: '', audioDuration: 30 },
      ...(BROWSER_EXECUTABLE ? { browserExecutable: BROWSER_EXECUTABLE } : {}),
    });
    mark('selectComposition', {
      ok: true,
      ms: Date.now() - t0,
      durationInFrames: composition.durationInFrames,
      browserExecutable: BROWSER_EXECUTABLE || '(default)',
    });
  } catch (e) {
    mark('selectComposition', {
      ok: false,
      error: errOf(e),
      browserExecutable: BROWSER_EXECUTABLE || '(default)',
    });
    return steps;
  }

  return steps;
}

export async function getTempVideoUrl(fileId: string): Promise<string> {
  const result = await app.getTempFileURL({ fileList: [fileId] });
  const fileList = (result as { fileList: Array<{ fileID: string; tempFileURL: string }> }).fileList;
  return fileList[0]?.tempFileURL ?? '';
}

export async function getTaskVideoUrl(taskId: string): Promise<{ fileId: string; url: string } | null> {
  const taskRes = await db.collection('tasks').doc(taskId).get();
  const raw = taskRes.data;
  const task = (Array.isArray(raw) ? raw[0] : raw) as { resultVideoUrl?: string } | undefined;
  const fileId = task?.resultVideoUrl;
  if (!fileId) return null;
  const url = await getTempVideoUrl(fileId);
  return { fileId, url };
}

export async function renderTask(taskId: string): Promise<void> {
  console.log(`starting render for task ${taskId}`);
  await setStage(taskId, 'starting', 80);

  try {
    const taskRes = await db.collection('tasks').doc(taskId).get();
    // node-sdk 的 doc().get() 返回 data 为数组，需取第一项
    const raw = taskRes.data;
    const task = (Array.isArray(raw) ? raw[0] : raw) as TaskData | undefined;

    if (!task) throw new Error('task not found');

    const bubbles: BubbleData[] = task.screenshots || [];
    const audioUrl: string = task.audioUrl || '';
    const audioDuration: number = task.audioDuration || 30;

    if (bubbles.length === 0) {
      throw new Error('no screenshots data found');
    }

    await resolveStickerUrls(bubbles);
    await setStage(taskId, 'stickers_resolved');

    // 用歌词时间戳对齐气泡出现时间（无时间戳则降级均匀分配）
    const totalFrames = Math.ceil(audioDuration * RENDER_FPS);
    const bubblesTimed = computeBubbleStartFrames(
      bubbles,
      task.lyricsLineMap,
      task.lyricsTimeline,
      totalFrames,
    );

    // Remotion 的 <Audio> 组件支持直接使用可访问的 http(s) URL，
    // 渲染器会下载并混入音轨。之前把音频下载到容器 /tmp 后传入本地绝对路径，
    // 会被 Remotion 的静态服务当成相对路径请求 localhost:3001/tmp/... 导致 404。
    let audioPath: string | null = null;
    if (audioUrl) {
      if (audioUrl.startsWith('http')) {
        audioPath = audioUrl;
      } else {
        // cloud:// 等非 http 资源仍需下载到本地
        audioPath = await downloadAudio(audioUrl);
      }
    }
    await setStage(taskId, 'audio_ready');

    await setStage(taskId, 'bundling');
    const serveUrl = await getBundleLocation();
    await setStage(taskId, 'bundled');
    console.log('bundle location:', serveUrl);

    const inputProps = {
      bubbles: bubblesTimed,
      audioPath: audioPath || '',
      audioDuration,
    };

    const composition = await selectComposition({
      serveUrl,
      id: 'chat-mv',
      inputProps,
      ...(BROWSER_EXECUTABLE ? { browserExecutable: BROWSER_EXECUTABLE } : {}),
    });

    console.log(
      `composing done: ${composition.durationInFrames} frames at 30fps, starting renderMedia...`,
    );
    await setStage(taskId, 'rendering_frames');

    let lastReportedPct = -1;
    // 进度写入是异步的，必须收集起来在最终写 completed 之前 await 完，
    // 否则晚到的进度写入会把 progress:100 覆盖成中间值（如 86 / rendering_35）
    const progressWrites: Promise<void>[] = [];
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: OUTPUT_PATH,
      ...(BROWSER_EXECUTABLE ? { browserExecutable: BROWSER_EXECUTABLE } : {}),
      onProgress: ({ progress }: { progress: number }) => {
        const pct = Math.floor(progress * 100);
        if (pct > lastReportedPct && pct % 5 === 0) {
          lastReportedPct = pct;
          console.log(`render progress: ${pct}%`);
          // 渲染阶段进度映射到 80-99（最终 100 在上传后）
          progressWrites.push(setStage(taskId, `rendering_${pct}`, 80 + Math.floor(pct * 0.19)));
        }
      },
    });

    await Promise.allSettled(progressWrites);
    await setStage(taskId, 'uploading');

    const fileId = await uploadVideo(OUTPUT_PATH, taskId);
    console.log(`uploaded to ${fileId}`);

    await db.collection('tasks').doc(taskId).update({
      resultVideoUrl: fileId,
      status: 'completed',
      progress: 100,
      renderStage: 'completed',
      // 清理上一次失败残留，避免前端把已完成任务误判为失败
      errorStage: '',
      errorMsg: '',
      updatedAt: Date.now(),
    });

    await db.collection('works').add({
      taskId,
      userId: task.userId,
      title: task.topic,
      videoUrl: fileId,
      duration: audioDuration,
      style: task.style,
      createdAt: Date.now(),
    });

    console.log(`render complete for task ${taskId}`);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`render failed for task ${taskId}:`, msg);
    try {
      await db.collection('tasks').doc(taskId).update({
        status: 'failed',
        errorStage: 'rendering_video',
        errorMsg: msg,
        renderStage: 'failed',
        updatedAt: Date.now(),
      });
    } catch (updateErr) {
      console.error('failed to update task error status:', updateErr);
    }
  } finally {
    try {
      if (fs.existsSync(OUTPUT_PATH)) fs.unlinkSync(OUTPUT_PATH);
      if (fs.existsSync(AUDIO_PATH)) fs.unlinkSync(AUDIO_PATH);
    } catch {
      // ignore cleanup errors
    }
  }
}
