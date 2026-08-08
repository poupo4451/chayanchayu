import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import * as tcb from '@cloudbase/node-sdk';
import { BubbleData } from './remotion/ChatBubble';
import { computeBubbleTimings, LineMapEntry, LyricLine, LyricWord } from './lyricsAlign';

// 渲染服务必须与小程序、云函数和 Cloud Run 部署目标使用同一个环境。
const ENV_ID = 'cloud1-d7ggdqfhgc4ee2796';
const BROWSER_EXECUTABLE = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;

// 云托管环境的 @cloudbase/node-sdk 调用云数据库需要显式传入腾讯云 API 凭证
// （云函数会自动注入，云托管不会）。凭证通过环境变量配置，避免硬编码。
const tcbInitConfig: { env: string; secretId?: string; secretKey?: string; accessKey?: string } = {
  env: ENV_ID,
};
if (process.env.CLOUDBASE_APIKEY) {
  tcbInitConfig.accessKey = process.env.CLOUDBASE_APIKEY;
}
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

interface TaskData {
  screenshots: BubbleData[];
  audioUrl: string;
  audioId: string;
  audioDuration: number;
  musicProviderTaskId: string;
  lyrics: string;
  lyricsLineMap: LineMapEntry[];
  lyricsTimeline: LyricLine[];
  /** 词级时间戳（Suno alignedWords 精简版），供字级对齐主策略使用 */
  lyricsWords?: LyricWord[];
  userId: string;
  topic: string;
  style: { dialogueTone: string; musicGenre: string; vocalMode?: string };
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

const AVATAR_PUBLIC_DIR = path.resolve(process.cwd(), 'public', 'avatars');

/**
 * 检查每个气泡的 avatarId 对应的头像素材是否真的存在于本服务的 public/avatars 目录。
 * 由于头像图片走本地静态资源（不经网络传输），如果用户还没把对应的
 * male-*.png / female-*.png 放进 cloud-run-remotion/public/avatars/，
 * 这里会主动清空 avatarId，让 Avatar 组件回退到首字母色块，避免 Remotion 渲染时
 * 因为静态资源 404 而报错/卡住。
 */
function resolveAvatars(bubbles: BubbleData[]): void {
  const existsCache = new Map<string, boolean>();
  for (const b of bubbles) {
    if (!b.avatarId) continue;
    let exists = existsCache.get(b.avatarId);
    if (exists === undefined) {
      exists = fs.existsSync(path.join(AVATAR_PUBLIC_DIR, `${b.avatarId}.png`));
      existsCache.set(b.avatarId, exists);
    }
    if (!exists) {
      b.avatarId = undefined;
    }
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

/**
 * 用 ffprobe 获取音频文件的实际时长（秒）。
 * 应对 Suno API 上报的 duration 可能不准确的问题：
 *   - 实际音频比上报的更长 → 气泡动画提前结束
 *   - 实际音频比上报的更短 → 动画拉到结尾有空白
 * 返回实际时长；ffprobe 不可用时返回 null。
 */
async function getActualAudioDuration(audioPath: string): Promise<number | null> {
  try {
    // http URL 需要先下载到临时文件
    let filePath = audioPath;
    let shouldCleanup = false;
    if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
      const tmp = path.join('/tmp', `audio_${Date.now()}.mp3`);
      const resp = await axios.get(audioPath, { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(tmp, Buffer.from(resp.data));
      filePath = tmp;
      shouldCleanup = true;
    }
    const stdout = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 30000 },
    );
    if (shouldCleanup) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
    const dur = parseFloat(stdout.toString().trim());
    return Number.isFinite(dur) && dur > 0 ? dur : null;
  } catch {
    return null;
  }
}

/**
 * 三级降级策略获取第一句歌词的起唱时间（秒）。
 * 🥇 lyricsTimeline[0].startS — Suno 行级时间戳
 * 🥈 lyricsWords[0].s — Suno 词级时间戳
 * 🥉 第一个气泡 startFrame 反推 — 最后兜底
 * 返回 null 表示没有可用的起唱时间数据。
 */
function getFirstLyricStartSeconds(
  timeline?: LyricLine[],
  words?: LyricWord[],
  bubblesTimed?: BubbleData[],
): number | null {
  if (timeline && timeline.length > 0 && typeof timeline[0].startS === 'number' && timeline[0].startS > 0) {
    return timeline[0].startS;
  }
  if (words && words.length > 0 && typeof words[0].s === 'number' && words[0].s > 0) {
    return words[0].s;
  }
  if (bubblesTimed && bubblesTimed.length > 0 && typeof bubblesTimed[0].startFrame === 'number' && bubblesTimed[0].startFrame > 0) {
    return bubblesTimed[0].startFrame / RENDER_FPS;
  }
  return null;
}

/**
 * 用 ffmpeg 裁剪音频前奏，从 trimPoint 秒处截取到结束。
 * 返回裁剪后的文件路径；失败返回 null，调用方应回退到原音频。
 */
function trimAudioIntro(audioPath: string, trimPoint: number): string | null {
  try {
    const trimmed = path.join('/tmp', `audio_trimmed_${Date.now()}.mp3`);
    // -ss 在 -i 前面做 input seeking，速度快；-c copy 不重新编码
    execSync(
      `ffmpeg -y -ss ${trimPoint} -i "${audioPath}" -c copy "${trimmed}"`,
      { timeout: 60000, stdio: 'pipe' },
    );
    console.log(`🎵 ffmpeg trim done: ${trimmed}`);
    return trimmed;
  } catch (e) {
    console.warn('trimAudioIntro failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function renderTask(taskId: string): Promise<void> {
  console.log(`starting render for task ${taskId}`);
  await setStage(taskId, 'starting', 80);

  let trimmedAudioPath: string | null = null;

  try {
    const taskRes = await db.collection('tasks').doc(taskId).get();
    // node-sdk 的 doc().get() 返回 data 为数组，需取第一项
    const raw = taskRes.data;
    const task = (Array.isArray(raw) ? raw[0] : raw) as TaskData | undefined;

    if (!task) throw new Error('task not found');

    const bubbles: BubbleData[] = task.screenshots || [];
    const audioUrl: string = task.audioUrl || '';
    const storedDuration: number = task.audioDuration || 30;

    // 🔑 核心修复：Suno API 上报的 duration 可能不准确，
    // 用 ffprobe 获取音频文件的实际时长，防止动画提前停止。
    let audioDuration = storedDuration;
    if (audioUrl) {
      const actual = await getActualAudioDuration(audioUrl);
      if (actual != null && Math.abs(actual - storedDuration) > 1.5) {
        console.log(
          `⚠️ audio duration mismatch: task says ${storedDuration}s, ffprobe says ${actual}s — using actual`,
        );
        audioDuration = actual;
        // 回写到 task 表，下次渲染直接用对的时长
        await db.collection('tasks').doc(taskId).update({
          audioDuration: actual,
          audioDurationCorrected: true,
        });
      } else if (actual != null) {
        console.log(`✓ audio duration verified: ${actual}s (stored: ${storedDuration}s)`);
      } else {
        console.log(`⚠️ ffprobe failed, falling back to stored duration: ${storedDuration}s`);
      }
    } else {
      console.log(`⚠️ no audioUrl, using stored duration: ${storedDuration}s`);
    }

    if (bubbles.length === 0) {
      throw new Error('no screenshots data found');
    }

    await resolveStickerUrls(bubbles);
    resolveAvatars(bubbles);
    await setStage(taskId, 'stickers_resolved');

    // 用歌词时间戳对齐气泡出现时间。
    // 注意 lyricsLineMap.lineIndex（歌词文本行号，含 [Verse]/空行）与
    // lyricsTimeline.lineIndex（实际演唱行序号）不是同一套坐标系，
    // 必须经 lyricsAlign 做文本模糊对齐，否则气泡会整体错位若干句。
    const totalFrames = Math.ceil(audioDuration * RENDER_FPS);
    const timed = computeBubbleTimings({
      bubbles,
      lineMap: task.lyricsLineMap,
      timeline: task.lyricsTimeline,
      lyrics: task.lyrics,
      lyricsWords: task.lyricsWords,
      totalFrames,
      fps: RENDER_FPS,
    });
    const bubblesTimed = timed.bubbles;
    console.log('lyrics alignment:', JSON.stringify(timed.report));

    // ── 🎵 前奏裁剪：第一句歌词起唱太晚时，自动裁剪音频前奏 ─────────
    const INTRO_TRIM_THRESHOLD = 2.0;   // 第一句歌词 ≥2s 才触发裁剪
    const INTRO_ANIMATION_BUFFER = 0.5; // 入场动画缓冲
    const INTRO_BREATHING_BUFFER = 0.3; // 呼吸感缓冲

    const firstLyricStartS = getFirstLyricStartSeconds(
      task.lyricsTimeline,
      task.lyricsWords,
      bubblesTimed,
    );

    let audioTrimApplied = false;

    if (firstLyricStartS != null && firstLyricStartS >= INTRO_TRIM_THRESHOLD) {
      const trimPoint = Math.max(0, firstLyricStartS - INTRO_ANIMATION_BUFFER - INTRO_BREATHING_BUFFER);
      const frameOffset = Math.round(trimPoint * RENDER_FPS);

      console.log(
        `🎵 trimming intro: first lyric at ${firstLyricStartS.toFixed(1)}s, ` +
        `trim point at ${trimPoint.toFixed(1)}s, offset ${frameOffset} frames`,
      );

      // 偏移所有气泡帧号
      for (const b of bubblesTimed) {
        b.startFrame = Math.max(0, (b.startFrame ?? 0) - frameOffset);
        b.endFrame = Math.max((b.startFrame ?? 0) + 1, (b.endFrame ?? 0) - frameOffset);
      }
      // 偏移 beats（歌词起唱帧）
      if (timed.beats && timed.beats.length > 0) {
        timed.beats = timed.beats.map((f) => Math.max(0, f - frameOffset));
      }

      // 更新音频时长
      audioDuration = Math.max(1, audioDuration - trimPoint);
      audioTrimApplied = true;

      console.log(
        `🎵 after trim: audioDuration=${audioDuration.toFixed(1)}s, ` +
        `first bubble startFrame=${bubblesTimed[0]?.startFrame}`,
      );
    }

    // Remotion 的 <Audio> 组件支持直接使用可访问的 http(s) URL，
    // 渲染器会下载并混入音轨。之前把音频下载到容器 /tmp 后传入本地绝对路径，
    // 会被 Remotion 的静态服务当成相对路径请求 localhost:3001/tmp/... 导致 404。
    let audioPath: string | null = null;
    if (audioUrl) {
      if (audioUrl.startsWith('http')) {
        // 需要裁剪前奏时，必须先下载到本地才能用 ffmpeg 裁剪
        audioPath = audioTrimApplied ? await downloadAudio(audioUrl) : audioUrl;
      } else {
        // cloud:// 等非 http 资源仍需下载到本地
        audioPath = await downloadAudio(audioUrl);
      }

      // 执行前奏裁剪
      if (audioTrimApplied && audioPath && !audioPath.startsWith('http') && firstLyricStartS != null) {
        const trimPoint = Math.max(0, firstLyricStartS - INTRO_ANIMATION_BUFFER - INTRO_BREATHING_BUFFER);
        const trimmed = trimAudioIntro(audioPath, trimPoint);
        if (trimmed) {
          audioPath = trimmed;
          trimmedAudioPath = trimmed;
          console.log(`🎵 audio intro trimmed at ${trimPoint.toFixed(1)}s`);
        } else {
          console.warn('⚠️ audio trim failed, using original audio (intro will contain silence)');
        }
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
      // 每句歌词的起唱帧，供画面做节奏律动
      beats: timed.beats,
      // 流派用于挑选气泡入场动画池（嘻哈更 punchy，抒情类更柔和）
      genre: (task.style && task.style.musicGenre) || '',
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
      if (trimmedAudioPath && fs.existsSync(trimmedAudioPath)) fs.unlinkSync(trimmedAudioPath);
    } catch {
      // ignore cleanup errors
    }
  }
}
