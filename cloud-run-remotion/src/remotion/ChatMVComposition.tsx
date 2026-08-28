import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';
import { ChatBubble, BubbleData } from './ChatBubble';
import { BrandEnding } from './BrandEnding';
import { CANVAS_HEIGHT, FONT_FAMILY, WX_COLOR, CONTAINER_WIDTH } from './wxTheme';
import {
  beatEnergy,
  enterMotion,
  pickVariantForGenre,
  comboEnterMotion,
  pickHeroCombo,
  exitMotionVariant,
  pickExitVariant,
  pickHeroExitVariant,
  dynamicEnterFrames,
  dynamicExitFrames,
  stageIdleMotion,
  reAccentMotion,
  type EnterVariant,
  type MotionState,
} from './gsapMotion';
import {
  CANVAS_WIDTH,
  GROUP_SCALE_RANGE,
  STAGE_SAFE_AREA_RATIO,
  STAGE_DYNAMIC_HEADROOM,
  NORMAL_PEAK_WIDTH_RATIO,
  HERO_PEAK_WIDTH_RATIO,
  BRAND,
} from './animation-config';

/**
 * ═══ 舞台缩放的安全区约束 ═══════════════════════════════════════════
 *
 * 需求：气泡容器入场后的稳定状态不得超出画面边缘，且至少保留 5% 留白。
 *
 * CONTAINER_WIDTH 是容器在 scale=1 时的固定宽度（948px @ 720px 画布），
 * 本身就比画布宽，所以「容器视觉宽度 = CONTAINER_WIDTH × 总缩放」，
 * 约束「视觉宽度 ≤ CANVAS_WIDTH × ratio」等价于
 * 「总缩放 ≤ CANVAS_WIDTH × ratio / CONTAINER_WIDTH」。
 *
 * 总缩放由两类分量相乘：
 *   静态：sceneScale（每组抽定一次，产生推拉镜头感）× Hero 加成
 *   动态：idle.scale（呼吸 × 鼓点 × Ken-Burns 慢推）× reAccent 二次脉冲
 *
 * 因此按「峰值宽度」反推静态基准：
 *   静态基准 = 目标峰值缩放 ÷ STAGE_DYNAMIC_HEADROOM
 * 这样动态分量推到峰值时刚好贴住目标宽度，而不是被上限钳出一段平台。
 */

/** 把「目标宽度占画布的比例」换算成允许的总缩放上限 */
const scaleForWidthRatio = (ratio: number): number =>
  (CANVAS_WIDTH * ratio) / CONTAINER_WIDTH;

/** 绝对不可逾越的总缩放上限（对应 STAGE_SAFE_AREA_RATIO） */
const MAX_STAGE_SCALE = scaleForWidthRatio(STAGE_SAFE_AREA_RATIO);

/** 普通组 / Hero 组的静态基准缩放 */
const NORMAL_BASE_SCALE = scaleForWidthRatio(NORMAL_PEAK_WIDTH_RATIO) / STAGE_DYNAMIC_HEADROOM;
const HERO_BASE_SCALE = scaleForWidthRatio(HERO_PEAK_WIDTH_RATIO) / STAGE_DYNAMIC_HEADROOM;

/**
 * sceneScale 归一化系数。
 *
 * GROUP_SCALE_RANGE 的语义是「组间推拉镜头感」的**相对**差异，不是绝对缩放。
 * 除以区间上限后映射到 (0.86, 1]：最大的那一档正好等于基准缩放（即目标峰值宽度），
 * 其余组按比例略小。这样既保留了推拉感，又保证没有任何一组会超出安全区。
 *
 * 旧实现把 sceneScale 直接当绝对缩放乘上去，再乘 fitScale / Hero 加成，
 * 最终宽度完全失控 —— 这是气泡超出边缘的根本原因。
 */
const sceneScaleNorm = (sceneScale: number): number => sceneScale / GROUP_SCALE_RANGE.max;

/**
 * 末端兜底：把「静态基准 × 全部动态分量」的结果钳进安全区。
 *
 * 正常情况下 STAGE_DYNAMIC_HEADROOM 已预留够，这里不会真的生效。
 * 它只防止将来调大 IDLE_MOTION / RE_ACCENT 幅度却忘了同步 headroom。
 */
const clampStageScale = (scale: number): number => Math.min(scale, MAX_STAGE_SCALE);

interface ChatMVProps {
  bubbles: BubbleData[];
  audioPath?: string;
  audioDuration?: number;
  /** 每句歌词的起唱帧，用于驱动节奏律动 */
  beats?: number[];
  /** 音乐流派，用于挑选气泡入场动画池（嘻哈更 punchy，抒情类更柔和） */
  genre?: string;
  /** 音频左侧裁剪帧数（裁掉前奏），与气泡帧号偏移量一致 */
  audioTrimBefore?: number;
  /** 开头淡入帧数，0 表示不淡入（仅在裁了前奏时启用） */
  audioFadeInFrames?: number;
  /** 结尾淡出帧数，0 表示不淡出 */
  audioFadeOutFrames?: number;
}

/**
 * 聊天 MV 主合成
 * =====================================================================
 * 【设计要点：不画完整聊天界面】
 * 这里**不再渲染**顶部导航栏、底部输入栏和无限滚动的消息列表。
 * 画面在任意时刻只呈现「一组 1~3 条气泡 + 头像」，整组居中，
 * 唱完这一组就整组退场，下一组接上。这样每条气泡都是视觉主体。
 *
 * 【布局为什么不会跳动】
 * 一组内的所有气泡从组一开始就全部参与布局（占据高度），只是尚未到时间的
 * 那几条 opacity 为 0。因此组内不会因为「新增一条」而发生整体位移，
 * 气泡是在固定构图上被 stagger 逐条"点亮"的 —— 这正是 GSAP stagger 的做法。
 *
 * 【节奏】
 * beats（每句歌词起唱帧）驱动两处律动：舞台整体的呼吸缩放，以及背景光晕。
 * 气泡入场幅度也会跟着当拍能量放大，鼓点越密动作越有劲。
 */

const GROUP_MAX_SPAN_S = 5;
/** 组内相邻两条最大间隔（秒），超过就分组 */
const GROUP_MAX_GAP_S = 1.8;
/** Hero 独占时刻最低占比，低于此值触发节奏兜底强制抽条 */
const HERO_MIN_RATIO = 0.15;
/**
 * Hero 占比上限。
 * uniform 降级（拿不到 Suno 时间戳）时气泡按 totalFrames/n 均分，间隔常常
 * 大于 GROUP_MAX_GAP_S，于是每条气泡各自成组 → cur.length === 1 → 全片都是
 * Hero 独占，每个 Hero 入场几帧后冻结数秒。这是「视频播一半就没动画」的
 * 主要来源之一，必须反向合并回对话组。
 */
const HERO_MAX_RATIO = 0.35;
/** Hero 合并回对话组时，单组最多容纳多少条 */
const MAX_MERGE_ITEMS = 3;
/** 节奏兜底：每多少个非 Hero 组强制把末条抽成独立 Hero */
const FORCE_HERO_EVERY = 3;
/** 触发并行波次的密集阈值（秒）：相邻歌词间隔小于此值，允许同波次出场 */
const WAVE_DENSE_GAP_S = 0.42;
/** 单个波次允许覆盖的最大歌词跨度（秒），避免未来内容提前太多 */
const WAVE_MAX_SPAN_S = 0.55;
/** 单波次最多同时编排多少条容器 */
const WAVE_MAX_ITEMS = 4;
/** 同波次内部的轻微错峰（秒），既像同时出现又不至于机械整齐 */
const WAVE_MICRO_STAGGER_S = 0.025;
/** 密集波次入场最短/最长时长（秒）- 短促有力，爆炸感 */
const WAVE_ENTER_MIN_S = 0.15;
const WAVE_ENTER_MAX_S = 0.30;
/** 宽松单条入场最短/最长时长（秒）- 舒展呼吸，叙事感 */
const SINGLE_ENTER_MIN_S = 0.24;
const SINGLE_ENTER_MAX_S = 0.55;
/** 密集波次能量增强系数：让每个变体的位移/旋转更夸张 */
const DENSE_WAVE_ENERGY_BOOST = 1.4;
/** 单条气泡允许的最大绝对提前量（秒），超过此值强制按歌词时间出场 */
const MAX_INDIVIDUAL_ADVANCE_S = 0.12;
/**
 * 组停留超过这么久（秒）就周期性「重新入场」，杜绝长镜头冻帧。
 *
 * 【为什么需要这一层】
 * Fix 1（lyricsAlign 的副歌重演）只能治「歌词重复但没有气泡事件」这一种成因。
 * 纯器乐 Bridge、Suno 自行加长的间奏、以及 uniform 降级下气泡本就稀疏
 * （20 条台词撑 120 秒 = 平均 6 秒一条）这些场景，组停留依然会长达十几秒。
 * 那段时间只有 idle 呼吸（≈1.2% 缩放）和 reAccent（3% 缩放），在 720p 上
 * 几乎不可察觉，观感就是「动画消失了」。
 *
 * 这里与时间戳数据完全无关：只要一组停留超过一个周期，就以当前周期起点为
 * 新锚点把整组入场动画重播一次，视觉上等于切了个镜头。
 * restageIndex === 0 时行为与未启用该逻辑时完全一致。
 *
 * 【为什么是 9 秒而不是 5 秒】restage 是「重新入场」，冲击力很强。
 * 5 秒一次意味着 17 秒的长镜头里要炸 3 次，观感是原地抽搐而非节奏感。
 * 9 秒配合 settleEnvelope（入场后先静止再小幅度）形成正确的节奏：
 * 冲击 → 静止 → 小幅呼吸 → 再冲击。
 */
const RESTAGE_PERIOD_S = 9.0;
/** 重演起点距退场窗口的最小安全余量（秒），避免重演和退场同时进行互相打架 */
const RESTAGE_EXIT_GUARD_S = 0.4;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 基于组索引生成伪随机但确定性的场景缩放（取 animation-config GROUP_SCALE_RANGE 区间） */
function computeSceneScale(index: number): number {
  const hash = (((index + 1) * 2654435761) >>> 0) % 1000;
  return GROUP_SCALE_RANGE.min + (hash / 1000) * (GROUP_SCALE_RANGE.max - GROUP_SCALE_RANGE.min);
}

interface Group {
  items: BubbleData[];
  /** 组进场帧 = 组内第一条的 startFrame */
  start: number;
  /** 组退场结束帧 = 下一组的 start（或视频结束） */
  end: number;
  /** 是否为 Hero 独占组（单条气泡炸屏） */
  hero: boolean;
  /** 本组场景缩放系数，不同组取不同值产生推拉镜头感 */
  sceneScale: number;
}

interface Wave {
  items: BubbleData[];
  /** 波次锚点 = 波内第一条气泡的 startFrame */
  start: number;
  /** 下一波到来前可用于完成本波动画的预算 */
  end: number;
}

const DENSE_WAVE_COMBO_BLOCKLIST = new Set<EnterVariant>(['typewriter']);

function getWaveSpanFrames(wave: Wave): number {
  if (wave.items.length <= 1) return 0;
  const first = wave.items[0].startFrame ?? wave.start;
  const last = wave.items[wave.items.length - 1].startFrame ?? wave.start;
  return Math.max(0, last - first);
}

function buildWaves(items: BubbleData[], groupStart: number, groupEnd: number, fps: number): Wave[] {
  if (items.length === 0) return [];

  const denseGapFrames = Math.max(6, Math.round(WAVE_DENSE_GAP_S * fps));
  const maxSpanFrames = Math.max(denseGapFrames + 2, Math.round(WAVE_MAX_SPAN_S * fps));
  const waves: Wave[] = [];
  let cur: BubbleData[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    waves.push({
      items: cur,
      start: cur[0].startFrame ?? groupStart,
      end: groupEnd,
    });
    cur = [];
  };

  for (const item of items) {
    if (cur.length === 0) {
      cur = [item];
      continue;
    }

    const first = cur[0].startFrame ?? groupStart;
    const prev = cur[cur.length - 1].startFrame ?? first;
    const self = item.startFrame ?? prev;
    const prevGap = self - prev;
    const span = self - first;
    const shouldJoinDenseWave =
      cur.length < WAVE_MAX_ITEMS && prevGap <= denseGapFrames && span <= maxSpanFrames;

    if (shouldJoinDenseWave) {
      cur.push(item);
    } else {
      flush();
      cur = [item];
    }
  }
  flush();

  for (let i = 0; i < waves.length; i += 1) {
    waves[i].end = i + 1 < waves.length ? waves[i + 1].start : groupEnd;
  }

  return waves;
}

function getWaveMicroStaggerFrames(wave: Wave, fps: number): number {
  if (wave.items.length <= 1) return 0;
  return Math.max(1, Math.round(WAVE_MICRO_STAGGER_S * fps));
}

function getWaveEnterFrames(wave: Wave, fps: number): number {
  const baseBudget = Math.max(wave.end - wave.start, Math.round(SINGLE_ENTER_MIN_S * fps));
  const baseFrames = dynamicEnterFrames(baseBudget);

  if (wave.items.length <= 1) {
    // 宽松模式：单条气泡有充分时间舒展，上限拉到 0.88s
    return clamp(
      baseFrames,
      Math.round(SINGLE_ENTER_MIN_S * fps),
      Math.round(SINGLE_ENTER_MAX_S * fps),
    );
  }

  // 炸裂模式：多气泡同波次，短促有力
  const minFrames = Math.round(WAVE_ENTER_MIN_S * fps);
  const maxFrames = Math.round(WAVE_ENTER_MAX_S * fps);
  const spanBonus = Math.min(Math.round(getWaveSpanFrames(wave) * 0.25), Math.round(fps * 0.08));
  const sizeBonus = Math.round((wave.items.length - 1) * Math.max(1, fps * 0.02));

  return clamp(baseFrames + spanBonus + sizeBonus, minFrames, maxFrames);
}

function pickWaveEnterVariants(seed: number, genre: string | undefined, waveSize: number): EnterVariant[] {
  const primary = pickVariantForGenre(seed, genre);
  if (waveSize <= 1) return [primary];

  // 炸裂模式：3 条及以上追求 3 变体叠加，2 条追求 2 变体
  const targetCount = waveSize >= 3 ? 3 : 2;
  const variants: EnterVariant[] = [];

  if (!DENSE_WAVE_COMBO_BLOCKLIST.has(primary)) {
    variants.push(primary);
  }

  for (let offset = 5; offset <= 45 && variants.length < targetCount; offset += 5) {
    const next = pickVariantForGenre(seed + offset, genre);
    if (!DENSE_WAVE_COMBO_BLOCKLIST.has(next) && !variants.includes(next)) {
      variants.push(next);
    }
  }

  if (variants.length === 0) {
    variants.push('slide');
  }

  return variants;
}

function composeWaveEnterMotion(
  variants: EnterVariant[],
  raw: number,
  side: 'left' | 'right',
  energy: number,
): MotionState {
  if (variants.length <= 1) {
    return enterMotion(variants[0], raw, side, energy);
  }

  let opacity = 1;
  const transforms: string[] = [];
  const filters: string[] = [];
  let transformOrigin: string | undefined;

  for (const variant of variants) {
    const motion = enterMotion(variant, raw, side, energy);
    opacity *= motion.opacity;
    if (motion.transform && motion.transform !== 'none') transforms.push(motion.transform);
    if (motion.filter) filters.push(motion.filter);
    if (!transformOrigin && motion.transformOrigin) transformOrigin = motion.transformOrigin;
  }

  return {
    opacity,
    transform: transforms.join(' ') || 'none',
    filter: filters.join(' ') || undefined,
    transformOrigin,
  };
}

/**
 * 把带时间戳的气泡切成每组 1~4 条。
 *
 * Hero 判定：分组后天然只有 1 条气泡的组（孤立句，前后有留白，本就没有对话感）
 * 直接标记为 Hero —— 渲染时独占全屏放大，套用更猛的入场/退场和全屏光效。
 * 其余 length≥2 的组保持「多条同屏对话感」。
 *
 * 节奏兜底：若全曲 Hero 占比过低（< HERO_MIN_RATIO），按固定间隔把某些多气泡组
 * 的最后一条「抽」成独立 Hero 组，保证快闪高光时刻按节奏出现，不完全依赖歌词疏密。
 */
/**
 * @param contentEndFrames 内容段结束帧。气泡动画只存在于 [0, contentEndFrames)，
 *   最后一组必须在此帧之前把退场动画完整播完；其后的片尾段由 BrandEnding 接管。
 */
function buildGroups(bubbles: BubbleData[], fps: number, contentEndFrames: number): Group[] {
  if (bubbles.length === 0) return [];

  const maxSpan = GROUP_MAX_SPAN_S * fps;
  const maxGap = GROUP_MAX_GAP_S * fps;

  const groups: Group[] = [];
  let cur: BubbleData[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    groups.push({
      items: cur,
      start: cur[0].startFrame ?? 0,
      end: contentEndFrames,
      hero: cur.length === 1,
      sceneScale: 0, // 兜底，结尾统一赋值
    });
    cur = [];
  };

  for (const b of bubbles) {
    if (cur.length === 0) {
      cur = [b];
      continue;
    }
    const first = cur[0].startFrame ?? 0;
    const prev = cur[cur.length - 1].startFrame ?? 0;
    const self = b.startFrame ?? 0;
    if (self - first > maxSpan || self - prev > maxGap) {
      flush();
      cur = [b];
    } else {
      cur.push(b);
    }
  }
  flush();

  // 反向兜底：Hero 占比过高（典型场景是 uniform 降级导致每条气泡各自成组）时，
  // 把相邻的 Hero 合并回多气泡对话组。全片 Hero 会让每个镜头都是
  // 「入场几帧 + 冻结数秒」，观感就是没有动画。
  const heroRatioNow = groups.filter((g) => g.hero).length / Math.max(groups.length, 1);
  if (heroRatioNow > HERO_MAX_RATIO && groups.length > 1) {
    const merged: Group[] = [];
    for (const g of groups) {
      const prev = merged[merged.length - 1];
      if (g.hero && prev && prev.hero && prev.items.length < MAX_MERGE_ITEMS) {
        prev.items.push(...g.items);
        prev.hero = false;
      } else {
        merged.push({ ...g, items: [...g.items] });
      }
    }
    groups.length = 0;
    groups.push(...merged);
  }

  // 节奏兜底：Hero 占比过低时，每 FORCE_HERO_EVERY 个非 Hero 组强制抽末条为独立 Hero
  const heroCount = groups.filter((g) => g.hero).length;
  const ratio = groups.length > 0 ? heroCount / groups.length : 0;
  if (ratio < HERO_MIN_RATIO && groups.length > 0) {
    const out: Group[] = [];
    let sinceHero = 0;
    for (const g of groups) {
      if (!g.hero && g.items.length >= 2 && sinceHero >= FORCE_HERO_EVERY - 1) {
        // 把最后一条抽成独立 Hero 组，前面剩余的作为普通组
        const last = g.items[g.items.length - 1];
        const main = g.items.slice(0, -1);
        out.push({
          items: main,
          start: main[0].startFrame ?? g.start,
          end: contentEndFrames,
          hero: false,
          sceneScale: 0, // 兜底，结尾统一赋值
        });
        out.push({
          items: [last],
          start: last.startFrame ?? g.start,
          end: contentEndFrames,
          hero: true,
          sceneScale: 0, // 兜底，结尾统一赋值
        });
        sinceHero = 0;
      } else {
        out.push({ ...g });
        sinceHero = g.hero ? 0 : sinceHero + 1;
      }
    }
    groups.length = 0;
    groups.push(...out);
  }

  // 每组一直留到下一组进场为止；最后一组在内容段末尾收尾，完整播完退场。
  //
  // 【为什么不能再给最后一组追加余量】旧实现用 TAIL_MARGIN_S 把最后一组的
  // group.end 推到视频总时长之外，退场起点（group.end - exitFrames）随之被
  // 推出画面，最后一组一帧退场都播不到，画面直接定格到结束。
  // 现在「音频实际超长」的缓冲由片尾段承担，气泡必须在 contentEndFrames 前消失完。
  for (let i = 0; i < groups.length; i += 1) {
    groups[i].end = i + 1 < groups.length ? groups[i + 1].start : contentEndFrames;
    groups[i].sceneScale = computeSceneScale(i);
  }
  return groups;
}

/** 一组气泡（含各自入场 + 退场）。Hero 组独占全屏放大炸屏，普通组多条同屏对话。 */
const BubbleGroup: React.FC<{
  group: Group;
  groupIndex: number;
  frame: number;
  fps: number;
  beats: number[];
  genre?: string;
}> = ({ group, groupIndex, frame, fps, beats, genre }) => {
  // 动态退场时长：组停留越久退场动作越舒展，密集时更利落
  const groupSpan = Math.max(group.end - group.start, 1);
  const exitFrames = dynamicExitFrames(Math.min(groupSpan, fps * 0.88));
  const exitStart = group.end - exitFrames;
  /**
   * 退场起点的硬上限。
   * 退场必须在组被摘掉（frame >= group.end）之前完整播完，
   * 所以起点最晚只能是 group.end - exitFrames。缺了这道钳制，
   * endFrame 一旦顶到组边界，退场进度就恒为 0，动画一帧都不播。
   */
  const latestExitStart = Math.max(group.start, group.end - exitFrames);
  const waves = group.hero ? [] : buildWaves(group.items, group.start, group.end, fps);

  // ── 长停留重演：每 RESTAGE_PERIOD_S 秒把整组入场重播一次 ──────────────
  // restageIndex === 0（首个周期）时下面所有值都退化为原有行为。
  const restagePeriod = Math.max(1, Math.round(RESTAGE_PERIOD_S * fps));
  const restageIndex = Math.floor(Math.max(0, frame - group.start) / restagePeriod);
  const restageBase = group.start + restageIndex * restagePeriod;
  // 重演必须完整播完且不能撞进退场窗口，否则入场与退场会同时作用于同一条气泡
  const restageActive =
    restageIndex > 0 && restageBase < exitStart - Math.round(fps * RESTAGE_EXIT_GUARD_S);
  // 每次重演换一档场景缩放，配合入场重播产生推拉镜头感
  const stageScale = restageActive
    ? computeSceneScale(groupIndex * 31 + restageIndex)
    : group.sceneScale;

  // 常驻律动：入场播完到退场开始之间，靠这一层保证画面不静止。
  // 传入本组预计停留时长，停得越久律动略明显一点（兜住超长停留不至于死板）。
  //
  // ⚠️ 计时锚点必须用 restageBase 而不是 group.start：
  //    stageIdleMotion 内部的 settleEnvelope 依赖「入场后已过多久」来决定
  //    先静止再小幅度。重演相当于重新入场，包络也必须跟着重置，
  //    否则重演瞬间气泡一边播炸屏入场、一边已在做稳态呼吸，两者叠加又变成抖动。
  const idleAnchor = restageActive ? restageBase : group.start;
  const holdSeconds = restageActive
    ? RESTAGE_PERIOD_S
    : groupSpan / fps;
  const idle = stageIdleMotion(frame, idleAnchor, groupIndex, beats, fps, holdSeconds);

  // ── Hero 独占组：单条气泡炸屏 ──────────────────────────────────────
  if (group.hero) {
    const item = group.items[0];
    const enterFrames = dynamicEnterFrames(Math.max(groupSpan, fps * 0.31));
    // anticipation 不能吃掉超过一半入场进度，否则气泡直接以终态出现（零动画）
    const anticipation = Math.min(Math.round(fps * 0.19), Math.floor(enterFrames / 2));
    // 重演时以当前周期起点为锚，把炸屏入场重新播一遍
    const start = restageActive
      ? restageBase
      : (item.startFrame ?? group.start) - anticipation;
    const local = frame - start;

    const raw = Math.min(Math.max(local, 0) / enterFrames, 1);
    const side: 'left' | 'right' = item.role === 'right' ? 'right' : 'left';
    // Hero 高潮时刻：2-3 个入场动画组合叠加，炸屏更猛。
    // 重演时偏移种子，换一套 combo，避免看着像卡帧重播。
    const heroCombo = pickHeroCombo(groupIndex + restageIndex * 3);
    const comboMotion = comboEnterMotion(heroCombo, raw, side);

    // Hero 长驻时的二次脉冲：入场结束后随鼓点继续 pop。
    // 锚点同样要跟随 restage 重置，否则重演时脉冲已在全幅状态。
    const heroAccent = reAccentMotion(
      frame,
      restageActive ? restageBase : (item.startFrame ?? group.start),
      beats,
      fps,
      groupIndex,
    );
    /**
     * Hero 放大：静态基准 × sceneScale 归一 × 常驻律动 × 二次脉冲。
     *
     * heroAccent.scale 必须一起参与：它虽然只有 +1.4%，但 Hero 本就贴在
     * 安全区边界上，这 1.4% 正是「超出边缘」的最后一脚。
     */
    const effectiveScale = clampStageScale(
      HERO_BASE_SCALE * sceneScaleNorm(stageScale) * idle.scale * heroAccent.scale,
    );
    const heroExitVariant = pickHeroExitVariant(groupIndex);
    // 退场窗口：不早于歌词唱完（endFrame），也不晚于 latestExitStart
    const heroBubbleEnd = item.endFrame ?? group.end;
    const heroExitStart = Math.min(Math.max(heroBubbleEnd, exitStart), latestExitStart);
    const heroExitRaw = frame > heroExitStart
      ? clamp((frame - heroExitStart) / exitFrames, 0, 1)
      : 0;
    const exit = exitMotionVariant(heroExitVariant, heroExitRaw, side, CANVAS_WIDTH, CANVAS_HEIGHT, true);

    const combinedOpacity = comboMotion.opacity * exit.opacity;
    const motionTransform = comboMotion.transform || '';
    const combinedTransform =
      `translate3d(${idle.x.toFixed(2)}px,${idle.y.toFixed(2)}px,0) ` +
      `${motionTransform} ` +
      `scale(${effectiveScale.toFixed(4)}) ` +
      `rotate(${heroAccent.rotate.toFixed(2)}deg) ` +
      `${exit.transform}`;
    const combinedFilter = [comboMotion.filter, exit.filter].filter(Boolean).join(' ') || undefined;

    return (
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          opacity: combinedOpacity,
          transform: combinedTransform,
          transformOrigin: 'center center',
          filter: combinedFilter,
          willChange: 'transform, opacity, filter',
        }}
      >
        <ChatBubble data={item} />
      </AbsoluteFill>
    );
  }

  // ── 普通组：宽松段单条出场，密集段自动切成同波次并行出场 ────────────
  /**
   * 整组舞台缩放 = 静态基准 × sceneScale 归一 × 常驻律动。
   *
   * 逐气泡的 reAccent 脉冲不在这一层（加在每条气泡自己的 transform 上），
   * 它的 +1.4% 已计入 STAGE_DYNAMIC_HEADROOM 的预留。
   */
  const stageFinalScale = clampStageScale(
    NORMAL_BASE_SCALE * sceneScaleNorm(stageScale) * idle.scale,
  );
  const baseAnticipation = Math.round(fps * 0.19);
  const maxAdvanceFrames = Math.round(MAX_INDIVIDUAL_ADVANCE_S * fps);
  const lastItem = group.items[group.items.length - 1];

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        // 常驻律动叠加在整组舞台上：慢漂 + 呼吸缩放，长镜头也不会是静帧
        transform:
          `translate3d(${idle.x.toFixed(2)}px,${idle.y.toFixed(2)}px,0) ` +
          `scale(${stageFinalScale.toFixed(4)})`,
        transformOrigin: 'center center',
        willChange: 'transform',
      }}
    >
      {waves.map((wave, waveIndex) => {
        const isDense = wave.items.length > 1;
        const waveEnterFrames = getWaveEnterFrames(wave, fps);
        const microStaggerFrames = getWaveMicroStaggerFrames(wave, fps);
        const waveSeed = groupIndex * 17 + waveIndex * 11 + restageIndex * 23;
        const sharedWaveVariants = pickWaveEnterVariants(waveSeed, genre, wave.items.length);
        // 密集波次提前量略减，优先歌词对齐；宽松单条可提前更多留呼吸。
        // 但绝不能超过入场时长的一半 —— 否则第 0 帧 enterRaw 就已经是 1，
        // 气泡直接以终态出现，开头整段没有动画。
        const rawAnticipation = isDense ? Math.round(fps * 0.11) : baseAnticipation;
        const waveAnticipation = Math.min(rawAnticipation, Math.floor(waveEnterFrames / 2));

        return wave.items.map((item, idx) => {
          const isLast = item === lastItem;
          const side: 'left' | 'right' = item.role === 'right' ? 'right' : 'left';
          const seed = item.index * 7 + (item.subIndex || 0);

          // 歌词对齐硬约束：每条气泡不能提前超过 MAX_INDIVIDUAL_ADVANCE_S。
          // 重演时该约束不适用（气泡早已出场过，不存在「提前泄露未唱内容」问题），
          // 改为以当前重演周期起点为锚，组内按微错峰依次重新点亮。
          const idealStart = wave.start - waveAnticipation + idx * microStaggerFrames;
          const hardFloor = (item.startFrame ?? wave.start) - maxAdvanceFrames;
          const itemStart = restageActive
            ? restageBase + idx * Math.max(1, microStaggerFrames)
            : Math.max(idealStart, hardFloor);

          const enterLocal = frame - itemStart;
          const enterRaw = clamp(enterLocal / waveEnterFrames, 0, 1);
          // 重演阶段整组都算已入场：这条气泡在首个周期就出现过了，
          // 不能因为新锚点尚未到达而把它藏起来（会造成闪烁消失）。
          const entered = restageActive || enterLocal >= 0;

          // 多气泡同波次时共享一套主动画节奏，但每条轮换不同组合顺序，避免完全同动作复制。
          // 单条同样叠加 restageIndex 偏移，保证重演换一个变体。
          const perItemVariants = !isDense
            ? [pickVariantForGenre(seed + restageIndex * 29, genre)]
            : sharedWaveVariants
                .map((_, offset) => sharedWaveVariants[(idx + offset) % sharedWaveVariants.length])
                .slice(0, Math.min(sharedWaveVariants.length, wave.items.length >= 3 ? 3 : 2));

          // 能量增强：密集波次每个变体的位移/旋转更夸张。
          // 用当前帧求值（而非固定 startFrame），入场过程中幅度随鼓点实时变化。
          const baseEnergy = beatEnergy(frame, beats, fps, 4);
          const energy = isDense ? baseEnergy * DENSE_WAVE_ENERGY_BOOST : baseEnergy;
          const motion = composeWaveEnterMotion(perItemVariants, enterRaw, side, energy);

          // 退出逐条独立，保证歌词结束点和离场姿态都更丰富。
          // 起点夹在 [歌词唱完, latestExitStart] 之间：不能早于唱完，
          // 也不能晚到来不及在组消失前播完。
          const bubbleEnd = item.endFrame ?? group.end;
          const bubbleExitStart = Math.min(Math.max(bubbleEnd, exitStart), latestExitStart);
          const bubbleExitRaw = frame > bubbleExitStart
            ? clamp((frame - bubbleExitStart) / exitFrames, 0, 1)
            : 0;
          const exitVariant = pickExitVariant(item.index * 3 + waveIndex * 5 + (item.subIndex || 0));
          const exitMotion = exitMotionVariant(exitVariant, bubbleExitRaw, side, CANVAS_WIDTH, CANVAS_HEIGHT, false);

          // 长驻气泡的二次脉冲：停留够久后随鼓点自己 pop，救活长镜头
          const accent = reAccentMotion(frame, itemStart, beats, fps, seed);

          if (!entered) {
            return (
              <div key={item.uid ?? item.index} style={{ opacity: 0, visibility: 'hidden', marginBottom: isLast ? 0 : -40 }}>
                <ChatBubble data={item} />
              </div>
            );
          }

          const combinedOpacity = motion.opacity * exitMotion.opacity;
          // 二次脉冲放在最前面（外层），不干扰入场/退场各自的 transformOrigin 语义
          const accentTransform =
            accent.scale !== 1 || accent.rotate !== 0
              ? `scale(${accent.scale.toFixed(4)}) rotate(${accent.rotate.toFixed(2)}deg)`
              : null;
          const combinedTransform = [accentTransform, motion.transform, exitMotion.transform]
            .filter((t): t is string => typeof t === 'string' && t !== 'none')
            .join(' ') || undefined;
          const combinedFilter = [motion.filter, exitMotion.filter]
            .filter((f): f is string => typeof f === 'string' && f.length > 0)
            .join(' ') || undefined;

          return (
            <div
              key={item.uid ?? item.index}
              style={{
                opacity: combinedOpacity,
                transform: combinedTransform,
                transformOrigin: motion.transformOrigin,
                filter: combinedFilter,
                clipPath: motion.clipPath,
                marginBottom: isLast ? 0 : -40,
                willChange: 'transform, opacity, filter, clip-path',
              }}
            >
              <ChatBubble data={item} />
            </div>
          );
        });
      })}
    </AbsoluteFill>
  );
};

/** 等功率淡入淡出曲线：t∈[0,1] → 增益[0,1]，听感比线性斜坡均匀得多 */
const equalPower = (t: number) => Math.sin(Math.max(0, Math.min(1, t)) * Math.PI * 0.5);

export const ChatMVComposition: React.FC<ChatMVProps> = ({
  bubbles, audioPath, beats, genre,
  audioTrimBefore = 0,
  audioFadeInFrames = 0,
  audioFadeOutFrames = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  /** 品牌尾帧帧数：视频尾部 tailS 秒是片尾段，只展示 logo + slogan */
  const brandTailFrames = Math.round(BRAND.tailS * fps);
  /**
   * 内容段结束帧：气泡动画只存在于 [0, contentEndFrames)，
   * 其后 [contentEndFrames, durationInFrames) 由 BrandEnding 接管。
   */
  const contentEndFrames = Math.max(1, durationInFrames - brandTailFrames);

  const audioVolume = React.useCallback(
    (f: number) => {
      let v = 1;
      if (audioFadeInFrames > 0) {
        v *= equalPower(f / audioFadeInFrames);
      }
      if (audioFadeOutFrames > 0) {
        // ⚠️ 锚点必须是内容段结束帧，不能用 durationInFrames：
        // 视频尾部已被片尾段拉长 tailS 秒，若按总时长算淡出，
        // 音频在内容段最后一帧音量仍有 ≈0.98 就被硬切，尾音会爆。
        const last = contentEndFrames - 1;
        v *= equalPower((last - f) / audioFadeOutFrames);
      }
      return v;
    },
    [audioFadeInFrames, audioFadeOutFrames, contentEndFrames],
  );

  const beatFrames = React.useMemo(() => (beats || []).slice().sort((a, b) => a - b), [beats]);

  // 只保留真正的「气泡 + 头像」，时间分隔条不属于要展示的组合
  const items = React.useMemo(() => {
    const list = (bubbles || []).filter((b) => b.type !== 'time');
    // 兜底：缺 startFrame 时按序均分，保证一定能播
    let last = 0;
    const mapped = list.map((b, i) => {
      let sf = b.startFrame;
      if (sf == null) {
        // 按内容段均分，片尾段不排气泡
        sf = Math.round((contentEndFrames * i) / Math.max(list.length, 1));
      }
      if (sf < last) sf = last;
      last = sf;
      return { ...b, startFrame: sf };
    });

    // 剔除越界气泡：它们自己永远不会被渲染，但会作为「下一组」把上一个可见组的
    // group.end 推到视频时长之外，导致那一组的退场永远等不到 → 尾段静止定格。
    const cutoff = Math.max(contentEndFrames - Math.round(fps * 0.2), 1);
    const visible = mapped.filter((b) => (b.startFrame ?? 0) < cutoff);
    return visible.length > 0 ? visible : mapped.slice(0, 1);
  }, [bubbles, contentEndFrames, fps]);

  const groups = React.useMemo(
    () => buildGroups(items, fps, contentEndFrames),
    [items, fps, contentEndFrames],
  );

  // 当前组 + 正在退场的上一组
  const activeIdx = React.useMemo(() => {
    let idx = -1;
    for (let i = 0; i < groups.length; i += 1) {
      if (groups[i].start <= frame) idx = i;
      else break;
    }
    return idx;
  }, [groups, frame]);

  // 片尾段不渲染任何气泡组：最后一组的退场已在 contentEndFrames 播完，
  // 这里直接清空，杜绝残留气泡压在片尾图上。
  const rendered = frame >= contentEndFrames
    ? []
    : groups
      .map((g, i) => ({ g, i }))
      .filter(({ g, i }) => i === activeIdx || (i === activeIdx - 1 && frame < g.end));

  return (
    <AbsoluteFill style={{ backgroundColor: WX_COLOR.canvas, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      {/* 极淡的顶底渐隐，让气泡组浮在画面中央 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.045) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 82%, rgba(0,0,0,0.045) 100%)',
        }}
      />

      {audioPath ? (
        <Audio
          src={audioPath}
          {...(audioTrimBefore > 0 ? { trimBefore: audioTrimBefore } : {})}
          volume={audioFadeInFrames > 0 || audioFadeOutFrames > 0 ? audioVolume : 1}
        />
      ) : null}

      {/* 舞台：不再使用固定全局缩放，各组按自己的 sceneScale 独立渲染，切换时产生推拉镜头感 */}
      <AbsoluteFill
        style={{
          padding: '30px 8px',
        }}
      >
        {rendered.map(({ g, i }) => (
          <BubbleGroup key={i} groupIndex={i} group={g} frame={frame} fps={fps} beats={beatFrames} genre={genre} />
        ))}
      </AbsoluteFill>

      {/* 品牌片尾：气泡全部退场后居中渐现 logo + slogan，保持到视频结束 */}
      <BrandEnding startFrame={contentEndFrames} tailFrames={brandTailFrames} />

      {/* 安全区留白：保证气泡组不会贴边（720×1280 竖屏） */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          height: CANVAS_HEIGHT,
        }}
      />
    </AbsoluteFill>
  );
};
