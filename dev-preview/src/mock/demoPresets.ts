import type { BubbleData } from '@remotion-components/ChatBubble';

export const FPS = 30;
/** 预览时长（秒） */
export const DURATION_SEC = 30;
export const DURATION_FRAMES = FPS * DURATION_SEC;

/** 秒 → 帧 */
const f = (sec: number) => Math.round(sec * FPS);

// ======================================================================
// 预设 1：转账拉扯（嘻哈风）
// ======================================================================
const preset1Bubbles: BubbleData[] = [
  { index: 0, role: 'left', name: '小雨', type: 'text', text: '在忙吗？', params: {}, avatarId: 'female-green-tea-1', uid: '0', startFrame: f(0.4) },
  { index: 1, role: 'right', name: '我', type: 'text', text: '刚下班，怎么了', params: {}, avatarId: 'male-1', uid: '1', startFrame: f(1.8) },
  { index: 2, role: 'left', name: '小雨', type: 'text', text: '就是突然有点想找人说说话', params: {}, avatarId: 'female-green-tea-1', uid: '2', startFrame: f(3.2) },
  { index: 3, role: 'left', name: '小雨', type: 'text', text: '你以前不是这样的', params: {}, avatarId: 'female-green-tea-1', uid: '3', startFrame: f(6.5) },
  { index: 4, role: 'right', name: '我', type: 'text', text: '我哪样了', params: {}, avatarId: 'male-1', uid: '4', startFrame: f(9.6) },
  { index: 5, role: 'left', name: '小雨', type: 'text', text: '算了，说了你也不懂', params: {}, avatarId: 'female-green-tea-1', uid: '5', startFrame: f(11.0) },
  { index: 6, role: 'right', name: '我', type: 'text', text: '那你到底想说什么', params: {}, avatarId: 'male-1', uid: '6', startFrame: f(14.2) },
  { index: 7, role: 'left', name: '小雨', type: 'text', text: '我最近手头有点紧', params: {}, avatarId: 'female-green-tea-1', uid: '7', startFrame: f(17.4) },
  { index: 8, role: 'left', name: '小雨', type: 'text', text: '能不能先借我一点', params: {}, avatarId: 'female-green-tea-1', uid: '8', startFrame: f(18.9) },
  { index: 9, role: 'right', name: '我', type: 'transfer', text: '转账', params: { amount: '520.00' }, avatarId: 'male-1', uid: '9', startFrame: f(20.6) },
  { index: 10, role: 'left', name: '小雨', type: 'text', text: '你真好😘', params: {}, avatarId: 'female-green-tea-1', uid: '10', startFrame: f(24.0) },
  { index: 11, role: 'right', name: '我', type: 'text', text: '记得还', params: {}, avatarId: 'male-1', uid: '11', startFrame: f(27.0) },
  { index: 12, role: 'left', name: '小雨', type: 'text', text: '？', params: {}, avatarId: 'female-green-tea-1', uid: '12', startFrame: f(28.4) },
];

// ======================================================================
// 预设 2：深夜暧昧（R&B 风）—— 短句多，间隔密
// ======================================================================
const preset2Bubbles: BubbleData[] = [
  { index: 0, role: 'left', name: '小雅', type: 'text', text: '睡了吗', params: {}, avatarId: 'female-green-tea-3', uid: '0', startFrame: f(0.3) },
  { index: 1, role: 'right', name: '我', type: 'text', text: '还没', params: {}, avatarId: 'male-2', uid: '1', startFrame: f(1.5) },
  { index: 2, role: 'left', name: '小雅', type: 'text', text: '我也睡不着', params: {}, avatarId: 'female-green-tea-3', uid: '2', startFrame: f(2.8) },
  { index: 3, role: 'left', name: '小雅', type: 'text', text: '想起你了', params: {}, avatarId: 'female-green-tea-3', uid: '3', startFrame: f(4.2) },
  { index: 4, role: 'right', name: '我', type: 'text', text: '想我什么', params: {}, avatarId: 'male-2', uid: '4', startFrame: f(5.8) },
  { index: 5, role: 'left', name: '小雅', type: 'text', text: '就是……很多很多', params: {}, avatarId: 'female-green-tea-3', uid: '5', startFrame: f(7.5) },
  { index: 6, role: 'left', name: '小雅', type: 'text', text: '你懂那种感觉吗', params: {}, avatarId: 'female-green-tea-3', uid: '6', startFrame: f(10.2) },
  { index: 7, role: 'right', name: '我', type: 'text', text: '不太懂', params: {}, avatarId: 'male-2', uid: '7', startFrame: f(12.8) },
  { index: 8, role: 'left', name: '小雅', type: 'text', text: '笨蛋', params: {}, avatarId: 'female-green-tea-3', uid: '8', startFrame: f(15.2) },
  { index: 9, role: 'left', name: '小雅', type: 'text', text: '就是你对我来说，很特别', params: {}, avatarId: 'female-green-tea-3', uid: '9', startFrame: f(16.8) },
  { index: 10, role: 'right', name: '我', type: 'text', text: '怎么个特别法', params: {}, avatarId: 'male-2', uid: '10', startFrame: f(20.0) },
  { index: 11, role: 'left', name: '小雅', type: 'redpacket', text: '红包', params: { amount: '131.40' }, avatarId: 'female-green-tea-3', uid: '11', startFrame: f(23.0) },
  { index: 12, role: 'right', name: '我', type: 'text', text: '这什么', params: {}, avatarId: 'male-2', uid: '12', startFrame: f(25.5) },
  { index: 13, role: 'left', name: '小雅', type: 'text', text: '自己领会🌙', params: {}, avatarId: 'female-green-tea-3', uid: '13', startFrame: f(27.8) },
];

// ======================================================================
// 预设 3：假意关心（伤感风）—— 长句+停顿，Hero 感强
// ======================================================================
const preset3Bubbles: BubbleData[] = [
  { index: 0, role: 'left', name: '阿琳', type: 'text', text: '好久没联系了', params: {}, avatarId: 'female-green-tea-2', uid: '0', startFrame: f(0.5) },
  { index: 1, role: 'right', name: '我', type: 'text', text: '确实是', params: {}, avatarId: 'male-1', uid: '1', startFrame: f(2.4) },
  { index: 2, role: 'left', name: '阿琳', type: 'text', text: '看到你朋友圈了，最近过得不错吧', params: {}, avatarId: 'female-green-tea-2', uid: '2', startFrame: f(4.5) },
  { index: 3, role: 'left', name: '阿琳', type: 'text', text: '她对你好吗', params: {}, avatarId: 'female-green-tea-2', uid: '3', startFrame: f(8.2) },
  { index: 4, role: 'right', name: '我', type: 'text', text: '挺好的', params: {}, avatarId: 'male-1', uid: '4', startFrame: f(11.0) },
  { index: 5, role: 'left', name: '阿琳', type: 'text', text: '那就好', params: {}, avatarId: 'female-green-tea-2', uid: '5', startFrame: f(14.0) },
  { index: 6, role: 'left', name: '阿琳', type: 'text', text: '其实我一直想跟你说……', params: {}, avatarId: 'female-green-tea-2', uid: '6', startFrame: f(17.5) },
  { index: 7, role: 'right', name: '我', type: 'text', text: '说什么', params: {}, avatarId: 'male-1', uid: '7', startFrame: f(21.0) },
  { index: 8, role: 'left', name: '阿琳', type: 'text', text: '没什么，算了', params: {}, avatarId: 'female-green-tea-2', uid: '8', startFrame: f(24.5) },
  { index: 9, role: 'left', name: '阿琳', type: 'transfer', text: '转账', params: { amount: '999.00' }, avatarId: 'female-green-tea-2', uid: '9', startFrame: f(27.0) },
];

// ======================================================================
// 预设 4：甜蜜拉扯（轻快甜风）—— 短快多
// ======================================================================
const preset4Bubbles: BubbleData[] = [
  { index: 0, role: 'right', name: '我', type: 'text', text: '早安☀️', params: {}, avatarId: 'male-2', uid: '0', startFrame: f(0.3) },
  { index: 1, role: 'left', name: '可可', type: 'text', text: '这么早就醒了', params: {}, avatarId: 'female-green-tea-3', uid: '1', startFrame: f(1.6) },
  { index: 2, role: 'right', name: '我', type: 'text', text: '因为梦见你了', params: {}, avatarId: 'male-2', uid: '2', startFrame: f(3.2) },
  { index: 3, role: 'left', name: '可可', type: 'text', text: '油嘴滑舌🙄', params: {}, avatarId: 'female-green-tea-3', uid: '3', startFrame: f(4.8) },
  { index: 4, role: 'left', name: '可可', type: 'text', text: '梦到我什么了', params: {}, avatarId: 'female-green-tea-3', uid: '4', startFrame: f(6.4) },
  { index: 5, role: 'right', name: '我', type: 'text', text: '梦到你请我吃饭', params: {}, avatarId: 'male-2', uid: '5', startFrame: f(8.0) },
  { index: 6, role: 'left', name: '可可', type: 'text', text: '？', params: {}, avatarId: 'female-green-tea-3', uid: '6', startFrame: f(10.2) },
  { index: 7, role: 'right', name: '我', type: 'text', text: '所以今天中午有空吗', params: {}, avatarId: 'male-2', uid: '7', startFrame: f(11.8) },
  { index: 8, role: 'left', name: '可可', type: 'text', text: '你请客！', params: {}, avatarId: 'female-green-tea-3', uid: '8', startFrame: f(14.2) },
  { index: 9, role: 'right', name: '我', type: 'text', text: '行行行', params: {}, avatarId: 'male-2', uid: '9', startFrame: f(16.4) },
  { index: 10, role: 'left', name: '可可', type: 'text', text: '那我想吃日料', params: {}, avatarId: 'female-green-tea-3', uid: '10', startFrame: f(18.2) },
  { index: 11, role: 'right', name: '我', type: 'redpacket', text: '红包', params: { amount: '200.00' }, avatarId: 'male-2', uid: '11', startFrame: f(20.0) },
  { index: 12, role: 'left', name: '可可', type: 'text', text: '😍爱了', params: {}, avatarId: 'female-green-tea-3', uid: '12', startFrame: f(22.8) },
  { index: 13, role: 'right', name: '我', type: 'text', text: '12点老地方见', params: {}, avatarId: 'male-2', uid: '13', startFrame: f(25.2) },
  { index: 14, role: 'left', name: '可可', type: 'text', text: '等我化妆💄', params: {}, avatarId: 'female-green-tea-3', uid: '14', startFrame: f(27.8) },
];

// ======================================================================
// 预设 5：直接要钱（抖音风）—— 极简短句，节奏快
// ======================================================================
const preset5Bubbles: BubbleData[] = [
  { index: 0, role: 'left', name: '娜娜', type: 'text', text: '在？', params: {}, avatarId: 'female-green-tea-1', uid: '0', startFrame: f(0.2) },
  { index: 1, role: 'right', name: '我', type: 'text', text: '嗯', params: {}, avatarId: 'male-1', uid: '1', startFrame: f(0.8) },
  { index: 2, role: 'left', name: '娜娜', type: 'text', text: '借点钱', params: {}, avatarId: 'female-green-tea-1', uid: '2', startFrame: f(1.6) },
  { index: 3, role: 'right', name: '我', type: 'text', text: '多少', params: {}, avatarId: 'male-1', uid: '3', startFrame: f(2.6) },
  { index: 4, role: 'left', name: '娜娜', type: 'text', text: '500', params: {}, avatarId: 'female-green-tea-1', uid: '4', startFrame: f(3.6) },
  { index: 5, role: 'left', name: '娜娜', type: 'text', text: '急用', params: {}, avatarId: 'female-green-tea-1', uid: '5', startFrame: f(4.4) },
  { index: 6, role: 'right', name: '我', type: 'text', text: '上次的还没还', params: {}, avatarId: 'male-1', uid: '6', startFrame: f(5.8) },
  { index: 7, role: 'left', name: '娜娜', type: 'text', text: '这次一定还', params: {}, avatarId: 'female-green-tea-1', uid: '7', startFrame: f(7.8) },
  { index: 8, role: 'left', name: '娜娜', type: 'text', text: '你忍心看我为难吗', params: {}, avatarId: 'female-green-tea-1', uid: '8', startFrame: f(9.2) },
  { index: 9, role: 'right', name: '我', type: 'transfer', text: '转账', params: { amount: '500.00' }, avatarId: 'male-1', uid: '9', startFrame: f(11.2) },
  { index: 10, role: 'left', name: '娜娜', type: 'text', text: '谢谢宝宝😘', params: {}, avatarId: 'female-green-tea-1', uid: '10', startFrame: f(13.8) },
  { index: 11, role: 'right', name: '我', type: 'text', text: '注意查收', params: {}, avatarId: 'male-1', uid: '11', startFrame: f(16.0) },
  { index: 12, role: 'left', name: '娜娜', type: 'text', text: '明天请你吃饭', params: {}, avatarId: 'female-green-tea-1', uid: '12', startFrame: f(18.5) },
  { index: 13, role: 'right', name: '我', type: 'text', text: '明天？', params: {}, avatarId: 'male-1', uid: '13', startFrame: f(21.0) },
  { index: 14, role: 'left', name: '娜娜', type: 'text', text: '嗯呢💅', params: {}, avatarId: 'female-green-tea-1', uid: '14', startFrame: f(23.5) },
  { index: 15, role: 'right', name: '我', type: 'text', text: '你上次也是这么说的', params: {}, avatarId: 'male-1', uid: '15', startFrame: f(26.0) },
  { index: 16, role: 'left', name: '娜娜', type: 'text', text: '这次是真的', params: {}, avatarId: 'female-green-tea-1', uid: '16', startFrame: f(28.5) },
];

// ======================================================================
// 预设 6：欲擒故纵（流行风）—— 适度节奏
// ======================================================================
const preset6Bubbles: BubbleData[] = [
  { index: 0, role: 'left', name: '晴晴', type: 'text', text: '昨天跟朋友聊到你', params: {}, avatarId: 'female-green-tea-2', uid: '0', startFrame: f(0.5) },
  { index: 1, role: 'right', name: '我', type: 'text', text: '聊我什么', params: {}, avatarId: 'male-2', uid: '1', startFrame: f(2.8) },
  { index: 2, role: 'left', name: '晴晴', type: 'text', text: '说你这人很好玩', params: {}, avatarId: 'female-green-tea-2', uid: '2', startFrame: f(4.5) },
  { index: 3, role: 'right', name: '我', type: 'text', text: '好玩的点在哪', params: {}, avatarId: 'male-2', uid: '3', startFrame: f(6.8) },
  { index: 4, role: 'left', name: '晴晴', type: 'text', text: '说不上来', params: {}, avatarId: 'female-green-tea-2', uid: '4', startFrame: f(9.2) },
  { index: 5, role: 'left', name: '晴晴', type: 'text', text: '就是让人想靠近', params: {}, avatarId: 'female-green-tea-2', uid: '5', startFrame: f(10.8) },
  { index: 6, role: 'right', name: '我', type: 'text', text: '那你现在不是靠近了吗', params: {}, avatarId: 'male-2', uid: '6', startFrame: f(13.5) },
  { index: 7, role: 'left', name: '晴晴', type: 'text', text: '还行吧', params: {}, avatarId: 'female-green-tea-2', uid: '7', startFrame: f(16.0) },
  { index: 8, role: 'left', name: '晴晴', type: 'text', text: '不过我觉得还不够', params: {}, avatarId: 'female-green-tea-2', uid: '8', startFrame: f(18.2) },
  { index: 9, role: 'right', name: '我', type: 'text', text: '那怎么样才够', params: {}, avatarId: 'male-2', uid: '9', startFrame: f(20.5) },
  { index: 10, role: 'left', name: '晴晴', type: 'text', text: '你猜', params: {}, avatarId: 'female-green-tea-2', uid: '10', startFrame: f(23.0) },
  { index: 11, role: 'right', name: '我', type: 'redpacket', text: '红包', params: { amount: '66.66' }, avatarId: 'male-2', uid: '11', startFrame: f(25.2) },
  { index: 12, role: 'left', name: '晴晴', type: 'text', text: '不错嘛，上道了😏', params: {}, avatarId: 'female-green-tea-2', uid: '12', startFrame: f(27.8) },
];

// ======================================================================
// 预设定义
// ======================================================================
export interface DemoPreset {
  id: string;
  label: string;
  /** 简介说明 */
  desc: string;
  bubbles: BubbleData[];
  beats: number[];
  genre: string;
}

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: 'hiphop',
    label: '转账拉扯',
    desc: '嘻哈 · 红包+转账',
    bubbles: preset1Bubbles,
    beats: preset1Bubbles.map((b) => b.startFrame ?? 0).sort((a, b) => a - b),
    genre: '嘻哈',
  },
  {
    id: 'rnb',
    label: '深夜暧昧',
    desc: 'R&B · 红包试探',
    bubbles: preset2Bubbles,
    beats: preset2Bubbles.map((b) => b.startFrame ?? 0).sort((a, b) => a - b),
    genre: 'R&B',
  },
  {
    id: 'sad',
    label: '假意关心',
    desc: '伤感 · 欲言又止',
    bubbles: preset3Bubbles,
    beats: preset3Bubbles.map((b) => b.startFrame ?? 0).sort((a, b) => a - b),
    genre: '流行',
  },
  {
    id: 'sweet',
    label: '甜蜜拉扯',
    desc: '轻快 · 暧昧互动',
    bubbles: preset4Bubbles,
    beats: preset4Bubbles.map((b) => b.startFrame ?? 0).sort((a, b) => a - b),
    genre: '流行',
  },
  {
    id: 'douyin',
    label: '直接要钱',
    desc: '抖音 · 快节奏短句',
    bubbles: preset5Bubbles,
    beats: preset5Bubbles.map((b) => b.startFrame ?? 0).sort((a, b) => a - b),
    genre: '抖音风',
  },
  {
    id: 'pop',
    label: '欲擒故纵',
    desc: '流行 · 进退试探',
    bubbles: preset6Bubbles,
    beats: preset6Bubbles.map((b) => b.startFrame ?? 0).sort((a, b) => a - b),
    genre: '流行',
  },
];
