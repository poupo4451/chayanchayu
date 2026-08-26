import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import * as tcb from '@cloudbase/node-sdk';
import { BubbleData } from './remotion/ChatBubble';
import { computeBubbleTimings, LineMapEntry, LyricLine, LyricWord, MIN_GAP_FRAMES } from './lyricsAlign';

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
 * 逐级降级获取第一句歌词的起唱时间（秒）。
 * 🥇 lyricsTimeline 中第一条 startS > 0 且有实际歌词文本的行 — Suno 行级时间戳
 *    （跳过 [Intro]/[Instrumental]/空行等前奏标记行）
 * 🥈 lyricsWords[0].s — Suno 词级时间戳
 * 🥉 第一个气泡 startFrame 反推 — 仅当气泡时间来自真实对齐时可用
 * 返回 null 表示没有可用的起唱时间数据。
 *
 * @param allowBubbleInference uniform 降级时必须传 false。
 *   均匀分配的气泡帧号是「编排」出来的（含人造的 intro 留白），
 *   不代表任何真实演唱时刻；拿它反推前奏会把开头的人声当前奏裁掉。
 */
function getFirstLyricStartSeconds(
  timeline?: LyricLine[],
  words?: LyricWord[],
  bubblesTimed?: BubbleData[],
  allowBubbleInference = true,
): number | null {
  if (timeline && timeline.length > 0) {
    // 跳过前奏标记行（startS 为 0 或文本为空），找第一条真正起唱的行
    for (const line of timeline) {
      if (typeof line.startS === 'number' && line.startS > 0 && line.text.trim().length > 0) {
        console.log(`🎵 getFirstLyricStartSeconds: found in timeline[${line.lineIndex}] "${line.text}" at ${line.startS}s`);
        return line.startS;
      }
    }
    console.log(`🎵 getFirstLyricStartSeconds: timeline has ${timeline.length} lines, none with startS>0 and text`);
  }
  if (words && words.length > 0 && typeof words[0].s === 'number' && words[0].s > 0) {
    console.log(`🎵 getFirstLyricStartSeconds: found in words[0] "${words[0].w}" at ${words[0].s}s`);
    return words[0].s;
  }
  if (!allowBubbleInference) {
    console.log('🎵 getFirstLyricStartSeconds: uniform strategy → skip bubble inference (frames are synthetic)');
    return null;
  }
  if (bubblesTimed && bubblesTimed.length > 0 && typeof bubblesTimed[0].startFrame === 'number' && bubblesTimed[0].startFrame > 0) {
    const secs = bubblesTimed[0].startFrame / RENDER_FPS;
    console.log(`🎵 getFirstLyricStartSeconds: fallback to bubble[0].startFrame/${RENDER_FPS} = ${secs.toFixed(1)}s`);
    return secs;
  }
  // 🏅 策略4：即使气泡无 timeline 均匀分布，从气泡间距也能推测前奏
  // 当多条气泡且第一条与第二条间隔 > 2 秒时，可能有纯音乐前奏
  if (bubblesTimed && bubblesTimed.length >= 2) {
    const f1 = bubblesTimed[0].startFrame ?? 0;
    const f2 = bubblesTimed[1].startFrame ?? 0;
    if (f2 > f1 + RENDER_FPS * 2) {
      const secs = f1 / RENDER_FPS;
      console.log(`🎵 getFirstLyricStartSeconds: inferred from bubble[0]=${f1}f bubble[1]=${f2}f gap > 2s, returning ${secs.toFixed(1)}s`);
      return secs;
    }
  }
  console.log('🎵 getFirstLyricStartSeconds: no usable data, returning null');
  return null;
}

/**
 * 从 timeline 获取最后一句歌词的结束时间（秒）。
 * 遍历所有行取最大 endS，跳过前奏/空行。
 */
function getLastLyricEndSeconds(timeline?: LyricLine[]): number | null {
  if (!timeline || timeline.length === 0) return null;
  let maxEnd = 0;
  for (const line of timeline) {
    if (typeof line.endS === 'number' && line.endS > maxEnd && line.text.trim().length > 0) {
      maxEnd = line.endS;
    }
  }
  if (maxEnd > 0) {
    console.log(`🎵 getLastLyricEndSeconds: max endS = ${maxEnd}s`);
    return maxEnd;
  }
  console.log('🎵 getLastLyricEndSeconds: no valid endS found in timeline');
  return null;
}

/**
 * 最后一个气泡「入场动画播完」的时间（秒）。
 * ChatMVComposition：start = startFrame - anticipation(0.5s)，
 * 入场时长最长 ENTER_FRAMES.maxFrames = 22 帧，
 * 故动画结束 ≈ startFrame + (22-15) 帧 ≈ startFrame + 0.25s，取 0.3s 兜底。
 * 注意最后一组的 group.end = totalFrames + TAIL_MARGIN，退场动画不会播，
 * 这里只考虑入场。
 */
function getLastBubbleAnimEndSeconds(bubbles: BubbleData[]): number | null {
  let maxFrame = 0;
  for (const b of bubbles) {
    const f = b.startFrame ?? 0;
    if (f > maxFrame) maxFrame = f;
  }
  if (maxFrame <= 0) return null;
  const secs = maxFrame / RENDER_FPS + 0.3;
  console.log(`🎵 getLastBubbleAnimEndSeconds: ${secs.toFixed(1)}s`);
  return secs;
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

    // ── 🎵 音频时间窗计算：裁前奏 + 掐尾巴 ──────────────────────────
    // 只算出 [introTrimS, tailCutoffS) 这个窗口，不碰音频文件本身，
    // 由 <Audio trimBefore> + composition durationInFrames 落地。
    const INTRO_TRIM_THRESHOLD = 1.0;
    const INTRO_LEAD_IN = 0.3;
    const INTRO_FADE_IN_S = 0.3;     // 裁前奏后的淡入（落在 lead-in 内，不碰人声）
    const TAIL_HOLD_S = 0.3;         // 唱完后原音量定格 0.3 秒
    const TAIL_FADE_DURATION = 2.0;
    const TAIL_BUFFER = TAIL_HOLD_S + TAIL_FADE_DURATION; // 2.3s
    const TAIL_MIN_SAVED = 0.3;

    const originalDuration = audioDuration;

    console.log(
      `🎵 diagnostics: timeline=${task.lyricsTimeline?.length ?? 0} lines, ` +
      `words=${task.lyricsWords?.length ?? 0}, bubbles=${bubblesTimed.length}, ` +
      `audioDuration=${originalDuration.toFixed(1)}s, totalFrames=${totalFrames}`,
    );
    if (task.lyricsTimeline?.length) {
      console.log('🎵 diagnostics: head =',
        task.lyricsTimeline.slice(0, 2).map((l) => `[${l.lineIndex}]"${l.text}" ${l.startS}~${l.endS}`));
      console.log('🎵 diagnostics: tail =',
        task.lyricsTimeline.slice(-2).map((l) => `[${l.lineIndex}]"${l.text}" ${l.startS}~${l.endS}`));
    }

    // uniform 降级时气泡帧号是「编排」出来的，不代表真实演唱时刻，
    // 不能用它反推前奏/尾奏，否则会把开头人声当前奏裁掉、或提前掐断结尾。
    const isUniform = timed.report.strategy === 'uniform';

    // 1) 前奏起点
    let introTrimS = 0;
    const firstLyricStartS = getFirstLyricStartSeconds(
      task.lyricsTimeline,
      task.lyricsWords,
      bubblesTimed,
      !isUniform,
    );
    if (firstLyricStartS != null && firstLyricStartS >= INTRO_TRIM_THRESHOLD) {
      introTrimS = Math.max(0, firstLyricStartS - INTRO_LEAD_IN);
    } else {
      console.log(
        `🎵 intro trim skipped: firstLyricStart=${firstLyricStartS ?? 'null'} ` +
        `(threshold ${INTRO_TRIM_THRESHOLD}s)`,
      );
    }

    // 2) 尾巴终点：淡出锚点 = max(最后一句唱完, 最后气泡入场动画播完)
    //    只取气泡会切断最后那句歌词，只取歌词在无 timeline 时拿不到值，必须取 max。
    let tailCutoffS = originalDuration;
    const lyricEndS = getLastLyricEndSeconds(task.lyricsTimeline);
    // uniform 下气泡尾帧是编排值（含人造 outro 留白），不能作为掐尾依据
    const bubbleAnimEndS = isUniform ? null : getLastBubbleAnimEndSeconds(bubblesTimed);
    const animEndS = lyricEndS != null && bubbleAnimEndS != null
      ? Math.max(lyricEndS, bubbleAnimEndS)
      : (lyricEndS ?? bubbleAnimEndS);

    if (animEndS != null) {
      const cut = Math.min(originalDuration, animEndS + TAIL_BUFFER);
      if (cut < originalDuration - TAIL_MIN_SAVED && cut > introTrimS + 2) {
        tailCutoffS = cut;
        console.log(
          `🎵 tail trim: lyricEnd=${lyricEndS?.toFixed(1) ?? 'null'}s, ` +
          `bubbleAnimEnd=${bubbleAnimEndS?.toFixed(1) ?? 'null'}s → ` +
          `animEnd=${animEndS.toFixed(1)}s, cut=${cut.toFixed(1)}s ` +
          `(saved ${(originalDuration - cut).toFixed(1)}s, hold ${TAIL_HOLD_S}s + fade ${TAIL_FADE_DURATION}s)`,
        );
      } else {
        console.log(
          `🎵 tail trim skipped: cut=${cut.toFixed(1)}s vs ` +
          `duration=${originalDuration.toFixed(1)}s (saved=${(originalDuration - cut).toFixed(1)}s, min=${TAIL_MIN_SAVED}s)`,
        );
      }
    } else {
      console.log('🎵 tail trim skipped: no animation end data');
    }

    // 3) 落地成帧
    const frameOffset = Math.round(introTrimS * RENDER_FPS);
    audioDuration = Math.max(1, tailCutoffS - introTrimS);
    const finalFrames = Math.ceil(audioDuration * RENDER_FPS);

    if (frameOffset > 0) {
      // ⚠️ 旧实现用 Math.max(0, shifted) 压平：所有 startFrame < frameOffset 的
      // 气泡全被压到 0，单调递增和最小间隔同时失效，首组多条气泡同帧堆叠且
      // 因为 anticipation 已经跑完而完全没有入场动画。这里改为保序推开。
      let prev = -Infinity;
      for (const b of bubblesTimed) {
        const shifted = (b.startFrame ?? 0) - frameOffset;
        b.startFrame = Math.max(shifted, prev + MIN_GAP_FRAMES, 0);
        prev = b.startFrame;
        b.endFrame = Math.min(
          finalFrames,
          Math.max(b.startFrame + 1, (b.endFrame ?? 0) - frameOffset),
        );
      }
      // beats 必须 filter 掉负值，不能 clamp 成 0，否则开头会堆一坨节拍
      timed.beats = (timed.beats || [])
        .map((f) => f - frameOffset)
        .filter((f) => f >= 0);
    }
    timed.beats = (timed.beats || []).filter((f) => f <= finalFrames);

    const audioTrimBefore = frameOffset;
    // 淡入只在真的裁了前奏时才需要（消硬切爆音）；从 0 开始播的原始音频不需要
    const audioFadeInFrames = introTrimS > 0
      ? Math.min(Math.round(INTRO_FADE_IN_S * RENDER_FPS), Math.floor(finalFrames / 4))
      : 0;
    const audioFadeOutFrames = tailCutoffS < originalDuration - 0.01
      ? Math.min(Math.round(TAIL_FADE_DURATION * RENDER_FPS), Math.floor(finalFrames / 2))
      : 0;

    console.log(
      `🎵 audio window: [${introTrimS.toFixed(1)}s → ${tailCutoffS.toFixed(1)}s] ` +
      `of ${originalDuration.toFixed(1)}s | duration=${audioDuration.toFixed(1)}s ` +
      `frames=${finalFrames} trimBefore=${audioTrimBefore}f ` +
      `fadeIn=${audioFadeInFrames}f fadeOut=${audioFadeOutFrames}f ` +
      `| firstBubble=${bubblesTimed[0]?.startFrame} beats=${timed.beats.length}`,
    );

    // ── 音频：始终把 URL 直接交给 Remotion，绝不传容器本地路径 ──────────
    // Remotion 只能加载 http(s) URL 或 public/ 下的文件（staticFile），
    // /tmp/xxx.mp3 会被解析成 bundle 根目录的相对路径而 404。
    let audioPath: string | null = null;
    if (audioUrl) {
      audioPath = audioUrl.startsWith('http') ? audioUrl : await downloadAudio(audioUrl);
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
      audioTrimBefore,
      audioFadeInFrames,
      audioFadeOutFrames,
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

    // 去重：同一个 taskId 只写一条 works 记录，防止重复渲染
    const existRes = await db.collection('works').where({ taskId }).limit(1).get();
    const alreadyExists = (existRes.data || []).length > 0;
    if (!alreadyExists) {
      await db.collection('works').add({
        taskId,
        userId: task.userId,
        title: task.topic,
        videoUrl: fileId,
        duration: audioDuration,
        style: task.style,
        createdAt: Date.now(),
      });
    } else {
      console.log(`works record already exists for task ${taskId}, skipping duplicate`);
    }

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
