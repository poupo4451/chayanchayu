import type { BubbleData } from '@remotion-components/ChatBubble';

export const FPS = 30;
/** 预览时长（秒） */
export const DURATION_SEC = 30;
export const DURATION_FRAMES = FPS * DURATION_SEC;

/**秒 → 帧 */
const f = (sec: number) => Math.round(sec * FPS);

/**
 * 示例对话数据
 * ---------------------------------------------------------------
 * 结构与 cloudfunctions/renderChatScreenshots 产出的 bubbles 一致，
 * 时间戳按「歌词起唱帧」布置，覆盖多气泡同屏组 + Hero 独占组两种形态。
 */
export const demoBubbles: BubbleData[] = [
  // ── 组1：三条同屏对话 ──────────────────────────
  {
    index: 0,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '在忙吗？',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '0',
    startFrame: f(0.4),
  },
  {
    index: 1,
    role: 'right',
    name: '我',
    type: 'text',
    text: '刚下班，怎么了',
    params: {},
    avatarId: 'male-1',
    uid: '1',
    startFrame: f(1.8),
  },
  {
    index: 2,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '就是突然有点想找人说说话',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '2',
    startFrame: f(3.2),
  },

  // ── 组 2：Hero 独占（孤立句，前后留白 > 2.4s）──
  {
    index: 3,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '你以前不是这样的',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '3',
    startFrame: f(6.5),
  },

  // ── 组 3：两条同屏 ──────────────────────────────
  {
    index: 4,
    role: 'right',
    name: '我',
    type: 'text',
    text: '我哪样了',
    params: {},
    avatarId: 'male-1',
    uid: '4',
    startFrame: f(9.6),
  },
  {
    index: 5,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '算了，说了你也不懂',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '5',
    startFrame: f(11.0),
  },

  // ── 组 4：Hero 独占 ─────────────────────────────
  {
    index: 6,
    role: 'right',
    name: '我',
    type: 'text',
    text: '那你到底想说什么',
    params: {},
    avatarId: 'male-1',
    uid: '6',
    startFrame: f(14.2),
  },

  // ── 组 5：三条同屏，含转账 ───────────────────────
  {
    index: 7,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '我最近手头有点紧',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '7',
    startFrame: f(17.4),
  },
  {
    index: 8,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '能不能先借我一点',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '8',
    startFrame: f(18.9),
  },
  {
    index: 9,
    role: 'right',
    name: '我',
    type: 'transfer',
    text: '转账',
    params: { amount: '520.00' },
    avatarId: 'male-1',
    uid: '9',
    startFrame: f(20.6),
  },

  // ── 组 6：Hero 独占收尾 ─────────────────────────
  {
    index: 10,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '你真好😘',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '10',
    startFrame: f(24.0),
  },

  // ── 组 7：两条同屏收尾 ──────────────────────────
  {
    index: 11,
    role: 'right',
    name: '我',
    type: 'text',
    text: '记得还',
    params: {},
    avatarId: 'male-1',
    uid: '11',
    startFrame: f(27.0),
  },
  {
    index: 12,
    role: 'left',
    name: '小雨',
    type: 'text',
    text: '？',
    params: {},
    avatarId: 'female-green-tea-1',
    uid: '12',
    startFrame: f(28.4),
  },
];

/** 每句歌词起唱帧，驱动节奏律动（= 各气泡 startFrame） */
export const demoBeats: number[] = demoBubbles
  .map((b) => b.startFrame ?? 0)
  .sort((a, b) => a - b);
