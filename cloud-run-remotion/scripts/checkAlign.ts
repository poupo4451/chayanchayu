/**
 * 歌词对齐自检脚本（不入镜像，仅本地验证）
 *   npx ts-node scripts/checkAlign.ts
 *
 * 用「旧实现一定会算错」的典型数据跑一遍，确认：
 *   1. [Verse] 标记行 / 空行造成的行号偏移已被消除
 *   2. 没有映射到歌词的气泡不再同帧堆叠
 *   3. Suno 改词后仍能靠模糊匹配对上
 */
import { computeBubbleTimings, buildTextLineTimeMap } from '../src/lyricsAlign';
import { BubbleData } from '../src/remotion/ChatBubble';

const FPS = 30;

// 歌词文本：注意 [Verse 1] 与空行 —— 它们会占掉 split('\n') 的行号，
// 但绝不会出现在 Suno 的 alignedWords 里。这正是旧实现错位的来源。
const lyrics = [
  '[Verse 1]', // 0
  '深夜十二点你还没回消息', // 1
  '我盯着屏幕数了三百下呼吸', // 2
  '', // 3
  '[Chorus]', // 4
  '你说在忙其实在打游戏', // 5
  '截图已经发到我手机', // 6
].join('\n');

// Suno 只给「唱出来的行」，序号从 0 开始连续，且第 4 句被改了两个字
const timeline = [
  { lineIndex: 0, text: '深夜十二点你还没回消息', startS: 2.0, endS: 5.0 },
  { lineIndex: 1, text: '我盯着屏幕数了三百下呼吸', startS: 5.2, endS: 8.4 },
  { lineIndex: 2, text: '你说在忙其实在打游戏', startS: 8.8, endS: 11.6 },
  { lineIndex: 3, text: '截图早就发到我手机', startS: 12.0, endS: 15.0 }, // 改词
];

// LLM 给的 lineMap 用的是「歌词文本行号」
const lineMap = [
  { lineIndex: 1, dialogueIndex: 0 },
  { lineIndex: 2, dialogueIndex: 1 },
  { lineIndex: 5, dialogueIndex: 2 },
  { lineIndex: 6, dialogueIndex: 4 }, // 注意跳过了 3，模拟 LLM 漏映射
];

const mk = (index: number, text: string, role: 'left' | 'right'): BubbleData => ({
  index,
  role,
  name: role === 'right' ? '我' : '她',
  type: 'text',
  text,
  params: {},
});

const bubbles: BubbleData[] = [
  mk(0, '在吗', 'right'),
  mk(1, '...', 'right'),
  mk(2, '在忙', 'left'),
  mk(3, '真的', 'left'), // 无映射，旧实现会让它和 index2 同帧
  mk(4, '这是什么', 'right'),
];

console.log('=== 歌词文本行号 → 演唱时间 ===');
const { map, strategy, singable, matched } = buildTextLineTimeMap(lyrics, timeline);
console.log(`strategy=${strategy} singable=${singable} matched=${matched}`);
Array.from(map.entries())
  .sort((a, b) => a[0] - b[0])
  .forEach(([line, span]) => {
    console.log(`  文本行 ${line} → ${span.startS.toFixed(2)}s  「${lyrics.split('\n')[line]}」`);
  });

console.log('\n=== 气泡出现时机 ===');
const res = computeBubbleTimings({
  bubbles,
  lineMap,
  timeline,
  lyrics,
  totalFrames: Math.ceil(18 * FPS),
  fps: FPS,
});
console.log('report:', res.report);
res.bubbles.forEach((b) => {
  console.log(
    `  #${b.index} 「${b.text}」 start=${((b.startFrame ?? 0) / FPS).toFixed(2)}s  end=${(
      (b.endFrame ?? 0) / FPS
    ).toFixed(2)}s`,
  );
});

console.log('\n=== 断言 ===');
const starts = res.bubbles.map((b) => b.startFrame ?? 0);
const ok = {
  '首条对齐到 2.0s（而非 [Verse] 行的 0s）': Math.abs(starts[0] / FPS - 2.0) < 0.05,
  '第二条对齐到 5.2s': Math.abs(starts[1] / FPS - 5.2) < 0.05,
  '第三条对齐到 8.8s': Math.abs(starts[2] / FPS - 8.8) < 0.05,
  '改词行仍匹配到 12.0s': Math.abs(starts[4] / FPS - 12.0) < 0.05,
  '无映射气泡未与前一条同帧': starts[3] > starts[2],
  '出现时间严格递增': starts.every((v, i) => i === 0 || v > starts[i - 1]),
  '节拍点数量 = 演唱行数': res.beats.length === timeline.length,
};
let pass = true;
Object.entries(ok).forEach(([k, v]) => {
  if (!v) pass = false;
  console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
});
process.exit(pass ? 0 : 1);
