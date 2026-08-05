import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';
import { ChatBubble, BubbleData } from './ChatBubble';
import { CANVAS_HEIGHT, FONT_FAMILY, WX_COLOR, WX_SIZE } from './wxTheme';
import {
  beatEnergy,
  enterMotion,
  pickVariantForGenre,
  pickHeroVariant,
  heroExitMotion,
  bubbleFlashExit,
  dynamicEnterFrames,
  dynamicExitFrames,
} from './gsapMotion';

interface ChatMVProps {
  bubbles: BubbleData[];
  audioPath?: string;
  audioDuration?: number;
  /** 每句歌词的起唱帧，用于驱动节奏律动 */
  beats?: number[];
  /** 音乐流派，用于挑选气泡入场动画池（嘻哈更 punchy，抒情类更柔和） */
  genre?: string;
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

const MAX_PER_GROUP = 3;
/** 组内首尾最大跨度（秒），超过就分组 */
const GROUP_MAX_SPAN_S = 7;
/** 组内相邻两条最大间隔（秒），超过就分组 */
const GROUP_MAX_GAP_S = 2.4;
/** Hero 独占时刻最低占比，低于此值触发节奏兜底强制抽条 */
const HERO_MIN_RATIO = 0.15;
/** 节奏兜底：每多少个非 Hero 组强制把末条抽成独立 Hero */
const FORCE_HERO_EVERY = 5;

interface Group {
  items: BubbleData[];
  /** 组进场帧 = 组内第一条的 startFrame */
  start: number;
  /** 组退场结束帧 = 下一组的 start（或视频结束） */
  end: number;
  /** 是否为 Hero 独占组（单条气泡炸屏） */
  hero: boolean;
}

/**
 * 把带时间戳的气泡切成每组 1~3 条。
 *
 * Hero 判定：分组后天然只有 1 条气泡的组（孤立句，前后有留白，本就没有对话感）
 * 直接标记为 Hero —— 渲染时独占全屏放大，套用更猛的入场/退场和全屏光效。
 * 其余 length≥2 的组保持「多条同屏对话感」。
 *
 * 节奏兜底：若全曲 Hero 占比过低（< HERO_MIN_RATIO），按固定间隔把某些多气泡组
 * 的最后一条「抽」成独立 Hero 组，保证快闪高光时刻按节奏出现，不完全依赖歌词疏密。
 */
function buildGroups(bubbles: BubbleData[], fps: number, totalFrames: number): Group[] {
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
      end: totalFrames,
      hero: cur.length === 1,
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
    const full = cur.length >= MAX_PER_GROUP;
    const tooLong = self - first > maxSpan;
    const tooFar = self - prev > maxGap;
    if (full || tooLong || tooFar) {
      flush();
      cur = [b];
    } else {
      cur.push(b);
    }
  }
  flush();

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
          end: totalFrames,
          hero: false,
        });
        out.push({
          items: [last],
          start: last.startFrame ?? g.start,
          end: totalFrames,
          hero: true,
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

  // 每组一直留到下一组进场为止
  for (let i = 0; i < groups.length; i += 1) {
    groups[i].end = i + 1 < groups.length ? groups[i + 1].start : totalFrames;
  }
  return groups;
}

/** 一组气泡（含各自入场 + 退场）。Hero 组独占全屏放大炸屏，普通组多条同屏对话。 */
const BubbleGroup: React.FC<{
  group: Group;
  frame: number;
  fps: number;
  beats: number[];
  genre?: string;
}> = ({ group, frame, fps, beats, genre }) => {
  // 动态退场时长：组停留越久退场动作越舒展，密集时更利落
  const groupSpan = Math.max(group.end - group.start, 1);
  const exitFrames = dynamicExitFrames(Math.min(groupSpan, fps * 1.4));
  const exitStart = group.end - exitFrames;
  const exitRaw = frame > exitStart ? (frame - exitStart) / exitFrames : 0;

  // ── Hero 独占组：单条气泡炸屏 ──────────────────────────────────────
  if (group.hero) {
    const item = group.items[0];
    const anticipation = Math.round(fps * 0.5);
    const start = (item.startFrame ?? group.start) - anticipation;
    const local = frame - start;

    const enterFrames = dynamicEnterFrames(Math.max(groupSpan, fps * 0.5));
    const raw = Math.min(Math.max(local, 0) / enterFrames, 1);
    const energy = beatEnergy(start, beats, fps, 4);
    const seed = item.index * 7 + (item.subIndex || 0);
    const side: 'left' | 'right' = item.role === 'right' ? 'right' : 'left';
    const motion = enterMotion(pickHeroVariant(seed), raw, side, energy);

    // Hero 放大倍数：原1.35 配合退场峰值 1.6，叠加后气泡+头像必然冲出1080px 画布边缘，
    // 这里降到 1.18，并配合下方 alignItems:'center' + 气泡收窄，把安全余量留出来
    const heroScale = 1.18;
    const exit = heroExitMotion(exitRaw);

    const combinedOpacity = motion.opacity * exit.opacity;
    // 入场完成后保持静止：不叠加逐帧的节拍呼吸，避免气泡出现后又被 beat 顶得跳一下
    const combinedTransform = `${motion.transform} scale(${heroScale.toFixed(4)}) ${exit.transform}`;

    return (
      <AbsoluteFill>
        <AbsoluteFill
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 80px',
            opacity: combinedOpacity,
            transform: combinedTransform,
            transformOrigin: 'center center',
            filter: [motion.filter, exit.filter].filter(Boolean).join(' ') || undefined,
            willChange: 'transform, opacity, filter',
          }}
        >
          {/* Hero 模式气泡整体会被再放大 ~1.18 倍，提前把气泡最大宽度收窄到 75%，
              为放大动画预留安全边距，避免贴着 1080px 画布边缘的气泡被推出屏幕 */}
          <ChatBubble data={item} maxWidthScale={0.75} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // ── 普通组：多条同屏对话 + 个体快闪退场 ────────────────────────────
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        willChange: 'transform, opacity, filter',
      }}
    >
      {group.items.map((item, idx) => {
        const anticipation = Math.round(fps * 0.5);
        const start = (item.startFrame ?? group.start) - anticipation;
        const local = frame - start;

        // 未到时间：保留布局占位，只是不可见 —— 保证组内构图稳定
        if (local < 0) {
          return (
            <div key={item.uid ?? item.index} style={{ opacity: 0, visibility: 'hidden', marginTop: -1 }}>
              <ChatBubble data={item} />
            </div>
          );
        }

        // 动态入场时长：按到下一条气泡的原始间隔算，不受 anticipation 影响
        const originalStart = item.startFrame ?? group.start;
        const nextStart = idx + 1 < group.items.length
          ? (group.items[idx + 1].startFrame ?? group.end)
          : group.end;
        const enterFrames = dynamicEnterFrames(Math.max(nextStart - originalStart, 4));
        const raw = Math.min(local / enterFrames, 1);

        const energy = beatEnergy(start, beats, fps, 4);
        const seed = item.index * 7 + (item.subIndex || 0);
        const side: 'left' | 'right' = item.role === 'right' ? 'right' : 'left';
        const motion = enterMotion(pickVariantForGenre(seed, genre), raw, side, energy);

        // 入场结束后保持静止：这里曾叠加逐帧的 beatEnergy 呼吸缩放，但配合
        // 0.5s 提前入场后，气泡早已静止，歌词起唱时的 beat 会孤立地把它顶得跳一下。
        // 个体快闪退场：整组退场窗口内同步触发，制造卡点快切
        const indivExit = bubbleFlashExit(exitRaw);

        const combinedOpacity = motion.opacity * indivExit.opacity;
        const combinedTransform = `${motion.transform} ${indivExit.transform}`;

        return (
          <div
            key={item.uid ?? item.index}
            style={{
              marginTop: -1,
              opacity: combinedOpacity,
              transform: combinedTransform,
              transformOrigin: motion.transformOrigin,
              filter: motion.filter,
              clipPath: motion.clipPath,
              willChange: 'transform, opacity, filter, clip-path',
            }}
          >
            <ChatBubble data={item} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const ChatMVComposition: React.FC<ChatMVProps> = ({ bubbles, audioPath, beats, genre }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const beatFrames = React.useMemo(() => (beats || []).slice().sort((a, b) => a - b), [beats]);

  // 只保留真正的「气泡 + 头像」，时间分隔条不属于要展示的组合
  const items = React.useMemo(() => {
    const list = (bubbles || []).filter((b) => b.type !== 'time');
    // 兜底：缺 startFrame 时按序均分，保证一定能播
    let last = 0;
    return list.map((b, i) => {
      let sf = b.startFrame;
      if (sf == null) {
        sf = Math.round((durationInFrames * i) / Math.max(list.length, 1));
      }
      if (sf < last) sf = last;
      last = sf;
      return { ...b, startFrame: sf };
    });
  }, [bubbles, durationInFrames]);

  const groups = React.useMemo(
    () => buildGroups(items, fps, durationInFrames),
    [items, fps, durationInFrames],
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

  const rendered = groups
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

      {audioPath ? <Audio src={audioPath} /> : null}

      {/* 舞台：固定缩放，不随节拍呼吸（避免气泡入场完成后被beat 顶得整体跳动） */}
      <AbsoluteFill
        style={{
          padding: '38px 60px',
          transform: 'scale(0.8)',
          transformOrigin: '50% 50%',
        }}
      >
        {rendered.map(({ g, i }) => (
          <BubbleGroup key={i} group={g} frame={frame} fps={fps} beats={beatFrames} genre={genre} />
        ))}
      </AbsoluteFill>

      {/* 安全区留白：保证气泡组不会贴边（1080×1920 竖屏） */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          height: CANVAS_HEIGHT,
        }}
      />
    </AbsoluteFill>
  );
};
