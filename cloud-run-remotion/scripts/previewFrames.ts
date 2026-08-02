/**
 * 视觉自检：离线渲染若干关键帧成 PNG（不入镜像，仅本地验证）
 *   npx ts-node scripts/previewFrames.ts
 * 输出到 .preview/frame-XXX.png
 */
import path from 'path';
import fs from 'fs';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill } from '@remotion/renderer';
import { computeBubbleTimings } from '../src/lyricsAlign';
import { BubbleData } from '../src/remotion/ChatBubble';

const FPS = 30;
const OUT_DIR = path.resolve(process.cwd(), '.preview');

const lyrics = [
  '[Verse 1]',
  '深夜十二点你还没回消息',
  '我盯着屏幕数了三百下呼吸',
  '',
  '[Chorus]',
  '你说在忙其实在打游戏',
  '截图已经发到我手机',
  '你发个红包想把这事糊弄过去',
  '兄弟这次真的对不起',
].join('\n');

const timeline = [
  { lineIndex: 0, text: '深夜十二点你还没回消息', startS: 1.0, endS: 4.0 },
  { lineIndex: 1, text: '我盯着屏幕数了三百下呼吸', startS: 4.2, endS: 7.0 },
  { lineIndex: 2, text: '你说在忙其实在打游戏', startS: 7.4, endS: 10.0 },
  { lineIndex: 3, text: '截图早就发到我手机', startS: 10.4, endS: 13.0 },
  { lineIndex: 4, text: '你发个红包想把这事糊弄过去', startS: 13.4, endS: 16.5 },
  { lineIndex: 5, text: '兄弟这次真的对不起', startS: 16.8, endS: 20.0 },
];

const lineMap = [
  { lineIndex: 1, dialogueIndex: 0 },
  { lineIndex: 2, dialogueIndex: 1 },
  { lineIndex: 5, dialogueIndex: 2 },
  { lineIndex: 6, dialogueIndex: 3 },
  { lineIndex: 7, dialogueIndex: 4 },
  { lineIndex: 8, dialogueIndex: 5 },
];

const mk = (
  index: number,
  role: 'left' | 'right',
  name: string,
  type: BubbleData['type'],
  text: string,
  params: BubbleData['params'] = {},
): BubbleData => ({ index, role, name, type, text, params });

const bubbles: BubbleData[] = [
  mk(0, 'right', '我', 'text', '在吗？都十二点了'),
  mk(1, 'left', '阿泽', 'text', '在的在的，刚才手机静音了没看见'),
  mk(2, 'right', '我', 'text', '你战绩页面我都刷新八遍了'),
  mk(3, 'left', '阿泽', 'text', '……'),
  mk(4, 'left', '阿泽', 'redpacket', '给大哥赔个不是', { amount: '5.20' }),
  mk(5, 'right', '我', 'text', '这次先记着，下不为例'),
];

async function main() {
  const totalFrames = Math.ceil(20 * FPS);
  const timed = computeBubbleTimings({
    bubbles,
    lineMap,
    timeline,
    lyrics,
    totalFrames,
    fps: FPS,
  });
  console.log('alignment:', timed.report);
  timed.bubbles.forEach((b) =>
    console.log(`  #${b.index} ${((b.startFrame ?? 0) / FPS).toFixed(2)}s 「${b.text}」`),
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('bundling...');
  const serveUrl = await bundle({ entryPoint: path.resolve(process.cwd(), 'src/remotion/index.ts') });

  const inputProps = {
    bubbles: timed.bubbles,
    audioPath: '',
    audioDuration: 20,
    beats: timed.beats,
  };

  const composition = await selectComposition({ serveUrl, id: 'chat-mv', inputProps });
  console.log('duration:', composition.durationInFrames);

  // 覆盖：组内 1 条 / 2 条 / 3 条 / 入场中 / 退场中
  const targets = [30, 40, 130, 225, 250, 320, 405, 510, 560];
  for (const f of targets) {
    const frame = Math.min(f, composition.durationInFrames - 1);
    const output = path.join(OUT_DIR, `frame-${String(frame).padStart(4, '0')}.png`);
    await renderStill({ composition, serveUrl, output, frame, inputProps, overwrite: true });
    console.log('wrote', output);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
