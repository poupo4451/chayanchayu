/**
 * 渲染输入构建（纯函数）
 * =====================================================================
 * 把「气泡时间轴对齐 → 裁前奏 → 掐尾巴 → 平移帧号 → 组装 inputProps」
 * 这一整条流水线收敛到一个纯函数里，供两个调用方共用：
 *
 *   1. src/render.ts        → 云端 renderMedia（生产出片）
 *   2. dev-preview/         → 浏览器 Player（动画调试）
 *
 * 【为什么必须共用】
 * 这段逻辑之前只存在于 render.ts 内部。dev-preview 只透传 bubbles/beats/genre，
 * 等于跳过了整个音频时间窗阶段，导致：
 *   - durationInFrames 不同 → buildGroups / Hero 判定 / 尾组行为全部不同
 *   - startFrame 没有做 frameOffset 平移 → 气泡与音乐的相对关系错位
 *   - beats 是按字数合成的近似值 → 律动能量曲线不同
 *   - 没有音频 → 无法判断卡点
 * 结果是「预览里调好的动画，上云观感完全不同」。收敛到同一个函数后，
 * 两边差异只剩下浏览器实时播放 vs 逐帧渲染、以及字体这两项物理差异。
 *
 * 【纯度约束】
 * 本模块不得引入 fs / axios / child_process / @cloudbase 等 Node 专属依赖，
 * 否则 dev-preview（Vite 浏览器环境）无法 import。ffprobe 校正时长、
 * 下载音频、解析 cloud:// 这些副作用留在 render.ts。
 */
import { BubbleData } from './remotion/ChatBubble';
import { BRAND } from './remotion/animation-config';
import {
  computeBubbleTimings,
  AlignReport,
  LineMapEntry,
  LyricLine,
  LyricWord,
  MIN_GAP_FRAMES,
} from './lyricsAlign';

/** 默认渲染帧率；与 Root.tsx 的 FPS 必须一致 */
export const RENDER_FPS = 30;

// ── 音频时间窗常量 ────────────────────────────────────────────────────
/** 前奏超过这么久才值得裁 */
const INTRO_TRIM_THRESHOLD = 1.0;
/** 裁前奏时在起唱点前留出的呼吸量 */
const INTRO_LEAD_IN = 0.3;
/** 裁前奏后的淡入时长（落在 lead-in 内，不碰人声） */
const INTRO_FADE_IN_S = 0.3;
/** 唱完后原音量定格时长 */
const TAIL_HOLD_S = 0.3;
/** 尾部淡出时长 */
const TAIL_FADE_DURATION = 2.0;
/** 动画结束点之后保留的总缓冲 */
const TAIL_BUFFER = TAIL_HOLD_S + TAIL_FADE_DURATION;
/** 掐尾至少要省下这么多秒才值得做 */
const TAIL_MIN_SAVED = 0.3;

/** ChatMVComposition 的完整 props 契约 */
export interface ChatMVInputProps {
  bubbles: BubbleData[];
  audioPath: string;
  audioDuration: number;
  audioTrimBefore: number;
  audioFadeInFrames: number;
  audioFadeOutFrames: number;
  beats: number[];
  genre: string;
  /**
   * Remotion 4.x 的 selectComposition / renderMedia 要求 inputProps 满足
   * Record<string, unknown>。加索引签名而不是在调用处 as any，
   * 这样字段名写错仍然会被类型检查抓到。
   */
  [key: string]: unknown;
}

/** 构建输入所需的 task 字段子集（只读，不含副作用字段） */
export interface RenderInputTask {
  lyrics?: string;
  lyricsLineMap?: LineMapEntry[];
  lyricsTimeline?: LyricLine[];
  lyricsWords?: LyricWord[];
  style?: { musicGenre?: string } | null;
}

export interface BuildRenderInputsParams {
  task: RenderInputTask;
  /** 气泡原始数据（贴纸/头像已解析完毕） */
  bubbles: BubbleData[];
  /** 已经过 ffprobe 校正的音频真实时长（秒） */
  audioDuration: number;
  /** 交给 Remotion 的音频地址；空字符串表示无音频（预览默片） */
  audioPath?: string;
  fps?: number;
  /** 日志出口：云端传 console.log，预览可传 undefined 静默 */
  log?: (msg: string) => void;
}

/** 诊断报告：AlignReport 之外再带上时间窗决策结果，便于定位观感问题 */
export type RenderAlignReport = AlignReport & {
  bubbleInstances: number;
  /** 相邻气泡入场事件的最大间隔（秒）＝「最长多久没有动画」 */
  maxStaticGapS: number;
  /** 对齐阶段使用的帧数（按原始音频时长算） */
  totalFrames: number;
  /** 最终合成帧数（裁前奏掐尾后） */
  finalFrames: number;
  introTrimS: number;
  tailCutoffS: number;
  frameOffset: number;
  beatCount: number;
};

export interface BuildRenderInputsResult {
  inputProps: ChatMVInputProps;
  /** 与 Root.tsx calculateMetadata 的推导保持一致：ceil(audioDuration * fps) */
  durationInFrames: number;
  report: RenderAlignReport;
}

/**
 * 逐级降级获取第一句歌词的起唱时间（秒）。
 * 🥇 lyricsTimeline 中第一条 startS > 0 且有实际歌词文本的行 — Suno 行级时间戳
 *    （跳过 [Intro]/[Instrumental]/空行等前奏标记行）
 * 🥈 lyricsWords[0].s — Suno 词级时间戳
 * 🥉 第一个气泡 startFrame 反推 — 仅当气泡时间来自真实对齐时可用
 * 🏅 相邻气泡间距推测 — 首尾两条间隔 > 2s 时认为有纯音乐前奏
 * 返回 null 表示没有可用的起唱时间数据。
 *
 * @param allowBubbleInference uniform 降级时必须传 false。
 *   均匀分配的气泡帧号是「编排」出来的（含人造的 intro 留白），
 *   不代表任何真实演唱时刻；拿它反推前奏会把开头的人声当前奏裁掉。
 */
function getFirstLyricStartSeconds(
  fps: number,
  log: (msg: string) => void,
  timeline?: LyricLine[],
  words?: LyricWord[],
  bubblesTimed?: BubbleData[],
  allowBubbleInference = true,
): number | null {
  if (timeline && timeline.length > 0) {
    for (const line of timeline) {
      if (typeof line.startS === 'number' && line.startS > 0 && line.text.trim().length > 0) {
        log(`🎵 firstLyricStart: timeline[${line.lineIndex}] "${line.text}" at ${line.startS}s`);
        return line.startS;
      }
    }
    log(`🎵 firstLyricStart: timeline has ${timeline.length} lines, none with startS>0 and text`);
  }
  if (words && words.length > 0 && typeof words[0].s === 'number' && words[0].s > 0) {
    log(`🎵 firstLyricStart: words[0] "${words[0].w}" at ${words[0].s}s`);
    return words[0].s;
  }
  if (!allowBubbleInference) {
    log('🎵 firstLyricStart: uniform strategy → skip bubble inference (frames are synthetic)');
    return null;
  }
  if (
    bubblesTimed
    && bubblesTimed.length > 0
    && typeof bubblesTimed[0].startFrame === 'number'
    && bubblesTimed[0].startFrame > 0
  ) {
    const secs = bubblesTimed[0].startFrame / fps;
    log(`🎵 firstLyricStart: fallback bubble[0].startFrame/${fps} = ${secs.toFixed(1)}s`);
    return secs;
  }
  if (bubblesTimed && bubblesTimed.length >= 2) {
    const f1 = bubblesTimed[0].startFrame ?? 0;
    const f2 = bubblesTimed[1].startFrame ?? 0;
    if (f2 > f1 + fps * 2) {
      const secs = f1 / fps;
      log(`🎵 firstLyricStart: inferred from bubble gap > 2s → ${secs.toFixed(1)}s`);
      return secs;
    }
  }
  log('🎵 firstLyricStart: no usable data');
  return null;
}

/**
 * 从 timeline 获取最后一句歌词的结束时间（秒）。
 * 遍历所有行取最大 endS，跳过前奏/空行。
 */
function getLastLyricEndSeconds(
  log: (msg: string) => void,
  timeline?: LyricLine[],
): number | null {
  if (!timeline || timeline.length === 0) return null;
  let maxEnd = 0;
  for (const line of timeline) {
    if (typeof line.endS === 'number' && line.endS > maxEnd && line.text.trim().length > 0) {
      maxEnd = line.endS;
    }
  }
  if (maxEnd > 0) {
    log(`🎵 lastLyricEnd: ${maxEnd}s`);
    return maxEnd;
  }
  log('🎵 lastLyricEnd: no valid endS in timeline');
  return null;
}

/**
 * 最后一个气泡「入场动画播完」的时间（秒）。
 * 入场时长最长约 22 帧，anticipation 约 15 帧，故动画结束 ≈ startFrame + 0.3s。
 * 这里只算入场：退场时长仅 3~6 帧（0.1~0.2s），相对 TAIL_BUFFER 的 2.3s 可忽略。
 */
function getLastBubbleAnimEndSeconds(
  fps: number,
  log: (msg: string) => void,
  bubbles: BubbleData[],
): number | null {
  let maxFrame = 0;
  for (const b of bubbles) {
    const f = b.startFrame ?? 0;
    if (f > maxFrame) maxFrame = f;
  }
  if (maxFrame <= 0) return null;
  const secs = maxFrame / fps + 0.3;
  log(`🎵 lastBubbleAnimEnd: ${secs.toFixed(1)}s`);
  return secs;
}

/**
 * 构建 ChatMVComposition 的完整输入。
 *
 * ⚠️ 会就地修改传入 bubbles 数组元素的 startFrame / endFrame。
 *    computeBubbleTimings 返回的是新对象，所以不会污染调用方的原始 screenshots。
 */
export function buildRenderInputs(params: BuildRenderInputsParams): BuildRenderInputsResult {
  const {
    task,
    bubbles,
    audioDuration: originalDuration,
    audioPath = '',
    fps = RENDER_FPS,
  } = params;
  const log = params.log ?? (() => { /* 预览默认静默 */ });

  // 1) 歌词时间戳对齐。
  //    注意 lyricsLineMap.lineIndex（歌词文本行号，含 [Verse]/空行）与
  //    lyricsTimeline.lineIndex（实际演唱行序号）不是同一套坐标系，
  //    必须经 lyricsAlign 做文本模糊对齐，否则气泡会整体错位若干句。
  const totalFrames = Math.ceil(originalDuration * fps);
  const timed = computeBubbleTimings({
    bubbles,
    lineMap: task.lyricsLineMap,
    timeline: task.lyricsTimeline,
    lyrics: task.lyrics,
    lyricsWords: task.lyricsWords,
    totalFrames,
    fps,
  });
  const bubblesTimed = timed.bubbles;
  log(`lyrics alignment: ${JSON.stringify(timed.report)}`);

  log(
    `🎵 diagnostics: timeline=${task.lyricsTimeline?.length ?? 0} lines, `
    + `words=${task.lyricsWords?.length ?? 0}, bubbles=${bubblesTimed.length}, `
    + `audioDuration=${originalDuration.toFixed(1)}s, totalFrames=${totalFrames}`,
  );

  // uniform 降级时气泡帧号是「编排」出来的，不代表真实演唱时刻，
  // 不能用它反推前奏/尾奏，否则会把开头人声当前奏裁掉、或提前掐断结尾。
  const isUniform = timed.report.strategy === 'uniform';

  // 2) 前奏起点
  let introTrimS = 0;
  const firstLyricStartS = getFirstLyricStartSeconds(
    fps,
    log,
    task.lyricsTimeline,
    task.lyricsWords,
    bubblesTimed,
    !isUniform,
  );
  if (firstLyricStartS != null && firstLyricStartS >= INTRO_TRIM_THRESHOLD) {
    introTrimS = Math.max(0, firstLyricStartS - INTRO_LEAD_IN);
  } else {
    log(
      `🎵 intro trim skipped: firstLyricStart=${firstLyricStartS ?? 'null'} `
      + `(threshold ${INTRO_TRIM_THRESHOLD}s)`,
    );
  }

  // 3) 尾巴终点：淡出锚点 = max(最后一句唱完, 最后气泡入场动画播完)
  //    只取气泡会切断最后那句歌词，只取歌词在无 timeline 时拿不到值，必须取 max。
  let tailCutoffS = originalDuration;
  const lyricEndS = getLastLyricEndSeconds(log, task.lyricsTimeline);
  const bubbleAnimEndS = isUniform ? null : getLastBubbleAnimEndSeconds(fps, log, bubblesTimed);
  const animEndS = lyricEndS != null && bubbleAnimEndS != null
    ? Math.max(lyricEndS, bubbleAnimEndS)
    : (lyricEndS ?? bubbleAnimEndS);

  if (animEndS != null) {
    const cut = Math.min(originalDuration, animEndS + TAIL_BUFFER);
    if (cut < originalDuration - TAIL_MIN_SAVED && cut > introTrimS + 2) {
      tailCutoffS = cut;
      log(
        `🎵 tail trim: animEnd=${animEndS.toFixed(1)}s, cut=${cut.toFixed(1)}s `
        + `(saved ${(originalDuration - cut).toFixed(1)}s)`,
      );
    } else {
      log(
        `🎵 tail trim skipped: cut=${cut.toFixed(1)}s vs duration=${originalDuration.toFixed(1)}s`,
      );
    }
  } else {
    log('🎵 tail trim skipped: no animation end data');
  }

  // 4) 落地成帧
  const frameOffset = Math.round(introTrimS * fps);
  const finalDuration = Math.max(1, tailCutoffS - introTrimS);
  const finalFrames = Math.ceil(finalDuration * fps);

  let beats = timed.beats || [];
  if (frameOffset > 0) {
    // ⚠️ 不能用 Math.max(0, shifted) 压平：所有 startFrame < frameOffset 的气泡
    // 会全被压到 0，单调递增和最小间隔同时失效，首组多条气泡同帧堆叠，
    // 且因为 anticipation 已经跑完而完全没有入场动画。这里改为保序推开。
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
    beats = beats.map((f) => f - frameOffset).filter((f) => f >= 0);
  }
  beats = beats.filter((f) => f <= finalFrames);

  const audioTrimBefore = frameOffset;
  // 淡入只在真的裁了前奏时才需要（消硬切爆音）；从 0 开始播的原始音频不需要
  const audioFadeInFrames = introTrimS > 0
    ? Math.min(Math.round(INTRO_FADE_IN_S * fps), Math.floor(finalFrames / 4))
    : 0;
  const audioFadeOutFrames = tailCutoffS < originalDuration - 0.01
    ? Math.min(Math.round(TAIL_FADE_DURATION * fps), Math.floor(finalFrames / 2))
    : 0;

  log(
    `🎵 audio window: [${introTrimS.toFixed(1)}s → ${tailCutoffS.toFixed(1)}s] `
    + `of ${originalDuration.toFixed(1)}s | duration=${finalDuration.toFixed(1)}s `
    + `frames=${finalFrames} trimBefore=${audioTrimBefore}f `
    + `fadeIn=${audioFadeInFrames}f fadeOut=${audioFadeOutFrames}f `
    + `| firstBubble=${bubblesTimed[0]?.startFrame} beats=${beats.length}`,
  );

  // 5) 诊断指标：maxStaticGapS 是「最长多久没有动画」的直接量化值。
  //    必须在帧平移之后统计，才反映最终成片的真实节奏。
  const sortedStarts = bubblesTimed.map((b) => b.startFrame ?? 0).sort((a, b) => a - b);
  let maxGapFrames = 0;
  for (let i = 1; i < sortedStarts.length; i += 1) {
    const gap = sortedStarts[i] - sortedStarts[i - 1];
    if (gap > maxGapFrames) maxGapFrames = gap;
  }

  const report: RenderAlignReport = {
    ...timed.report,
    bubbleInstances: bubblesTimed.length,
    maxStaticGapS: Number((maxGapFrames / fps).toFixed(2)),
    totalFrames,
    finalFrames,
    introTrimS: Number(introTrimS.toFixed(2)),
    tailCutoffS: Number(tailCutoffS.toFixed(2)),
    frameOffset,
    beatCount: beats.length,
  };
  log(`render align report: ${JSON.stringify(report)}`);

  return {
    inputProps: {
      bubbles: bubblesTimed,
      audioPath,
      audioDuration: finalDuration,
      audioTrimBefore,
      audioFadeInFrames,
      audioFadeOutFrames,
      beats,
      // 流派用于挑选气泡入场动画池（嘻哈更 punchy，抒情类更柔和）
      genre: task.style?.musicGenre || '',
    },
    // 与 Root.tsx calculateMetadata 完全一致的推导（含品牌片尾段），
    // 避免两边算出不同帧数导致「预览调好、上云观感不同」
    durationInFrames: Math.ceil(finalDuration * fps) + Math.round(BRAND.tailS * fps),
    report,
  };
}
