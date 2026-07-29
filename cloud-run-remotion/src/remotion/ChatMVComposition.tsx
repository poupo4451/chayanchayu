import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ChatBubble, BubbleData } from './ChatBubble';

interface ChatMVProps {
  bubbles: BubbleData[];
  audioPath?: string;
  audioDuration?: number;
}

const FPS = 30;
const TOP_BAR_HEIGHT = 130;
const BOTTOM_PADDING = 100;
const BUBBLE_GAP = 18;
const BUBBLE_ROW_HEIGHT = 130;

export const ChatMVComposition: React.FC<ChatMVProps> = ({ bubbles, audioPath }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 过滤掉 time 分隔条单独处理（也参与出现序列但不占滚动高度）
  const allBubbles = bubbles;
  const visibleBubbles = allBubbles.filter((b) => b.type !== 'time');

  const total = visibleBubbles.length;
  const durationInFrames = total > 0 ? Math.max(total * 3, 1) : 1; // 占位，实际由 selectComposition 决定
  const framesPerBubble = Math.floor(durationInFrames / Math.max(total, 1));

  // 当前应显示的气泡数量
  const currentCount = Math.min(
    Math.floor(frame / framesPerBubble) + 1,
    total
  );

  // 滚动：当气泡数超过可视区域时，整体向上推
  const visibleAreaHeight = 1920 - TOP_BAR_HEIGHT - BOTTOM_PADDING;
  const maxVisible = Math.floor(visibleAreaHeight / BUBBLE_ROW_HEIGHT);
  const scrollY = Math.max(0, (currentCount - maxVisible) * BUBBLE_ROW_HEIGHT);

  // 需要渲染的气泡（含已出现的 + time 分隔条）
  const shownBubbles: BubbleData[] = [];
  let visibleIdx = 0;
  for (const b of allBubbles) {
    if (b.type === 'time') {
      // time 分隔条跟随前一个气泡出现
      if (visibleIdx > 0 && visibleIdx <= currentCount) {
        shownBubbles.push(b);
      }
      continue;
    }
    if (visibleIdx < currentCount) {
      shownBubbles.push(b);
    }
    visibleIdx += 1;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f0f1e' }}>
      {/* 暗色渐变背景 */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(160deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
        }}
      />

      {/* 背景音频 */}
      {audioPath ? <Audio src={audioPath} /> : null}

      {/* 顶部状态栏 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: TOP_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span style={{ fontSize: 28, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
          茶言茶曲
        </span>
      </div>

      {/* 聊天气泡区域 */}
      <div
        style={{
          position: 'absolute',
          top: TOP_BAR_HEIGHT,
          left: 0,
          right: 0,
          bottom: BOTTOM_PADDING,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            transform: `translateY(${-scrollY}px)`,
            display: 'flex',
            flexDirection: 'column',
            gap: BUBBLE_GAP,
            paddingTop: 20,
          }}
        >
          {shownBubbles.map((bubble, i) => {
            // 计算这个气泡出现时的局部帧
            // time 分隔条使用前一个可见气泡的帧
            const bubbleVisibleIdx = bubble.type === 'time' ? visibleIdx - 1 : i;
            const startFrame = bubbleVisibleIdx * framesPerBubble;
            const localFrame = frame - startFrame;

            // spring 出现动画
            const appearProgress = spring({
              frame: Math.max(localFrame, 0),
              fps,
              config: { damping: 14, stiffness: 120 },
            });

            const opacity = interpolate(appearProgress, [0, 1], [0, 1]);
            const translateY = interpolate(appearProgress, [0, 1], [50, 0]);

            return (
              <div
                key={i}
                style={{
                  opacity,
                  transform: `translateY(${translateY}px)`,
                }}
              >
                <ChatBubble data={bubble} />
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部渐变淡出 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: BOTTOM_PADDING,
          background: 'linear-gradient(to bottom, transparent, #0f0f1e)',
        }}
      />
    </AbsoluteFill>
  );
};
