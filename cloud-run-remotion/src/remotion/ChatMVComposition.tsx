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
const TOP_BAR_HEIGHT = 130; // 顶部导航栏高度
const BOTTOM_INPUT_HEIGHT = 130; // 底部输入栏高度
const BUBBLE_GAP = 43; // 气泡行间距（与 ChatBubble 的 WX 规范一致）
const BUBBLE_ROW_HEIGHT = 160; // 单行预估高度（含昵称 + 气泡）

export const ChatMVComposition: React.FC<ChatMVProps> = ({ bubbles, audioPath }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 解析每个气泡的 startFrame：
  // - 非 time 气泡用自身 startFrame（缺省用前一个已对齐的时间）
  // - time 分隔条借用「下一个非 time 气泡」的时间，让它随对应对话一起出现
  const resolved = bubbles.map((b) => ({ ...b }));
  let lastNonTimeFrame = 0;
  for (const b of resolved) {
    if (b.type === 'time') continue;
    if (b.startFrame == null) b.startFrame = lastNonTimeFrame;
    else lastNonTimeFrame = b.startFrame;
  }
  for (let i = 0; i < resolved.length; i += 1) {
    if (resolved[i].type !== 'time') continue;
    let sf = i > 0 ? resolved[i - 1].startFrame ?? 0 : 0;
    for (let j = i + 1; j < resolved.length; j += 1) {
      if (resolved[j].type !== 'time') {
        sf = resolved[j].startFrame ?? sf;
        break;
      }
    }
    resolved[i].startFrame = sf;
  }

  const visibleBubbles = resolved.filter((b) => b.type !== 'time');
  const total = visibleBubbles.length;

  // 当前应显示的气泡数量：startFrame 已到的
  const currentCount = visibleBubbles.filter(
    (b) => (b.startFrame ?? 0) <= frame,
  ).length;

  // 滚动：当气泡数超过可视区域时，整体向上推
  const visibleAreaHeight = 1920 - TOP_BAR_HEIGHT - BOTTOM_INPUT_HEIGHT;
  const maxVisible = Math.floor(visibleAreaHeight / BUBBLE_ROW_HEIGHT);
  const scrollY = Math.max(0, (currentCount - maxVisible) * BUBBLE_ROW_HEIGHT);

  // 需要渲染的气泡（含已出现的 + time 分隔条），保持对话原始顺序
  const shownBubbles = resolved.filter((b) => (b.startFrame ?? 0) <= frame);

  return (
    <AbsoluteFill style={{ backgroundColor: '#EDEDED' }}>
      {/* 微信聊天背景：浅灰底 */}
      <AbsoluteFill style={{ backgroundColor: '#EDEDED' }} />

      {/* 背景音频 */}
      {audioPath ? <Audio src={audioPath} /> : null}

      {/* 顶部导航栏（微信风格：白底 + 返回 + 标题 + 更多） */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: TOP_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 36px',
          background: '#EDEDED',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        {/* 左：返回箭头 */}
        <div style={{ fontSize: 44, color: '#1A1A1A', fontWeight: 300, lineHeight: 1 }}>
          ‹
        </div>
        {/* 中：标题 */}
        <span style={{ fontSize: 42, color: '#1A1A1A', fontWeight: 600 }}>茶言茶曲</span>
        {/* 右：更多 */}
        <div style={{ fontSize: 44, color: '#1A1A1A', fontWeight: 700, lineHeight: 1, letterSpacing: 4 }}>
          ···
        </div>
      </div>

      {/* 聊天气泡区域 */}
      <div
        style={{
          position: 'absolute',
          top: TOP_BAR_HEIGHT,
          left: 0,
          right: 0,
          bottom: BOTTOM_INPUT_HEIGHT,
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
            const startFrame = bubble.startFrame ?? 0;
            const localFrame = frame - startFrame;

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

      {/* 底部输入栏（微信风格：语音 + 输入框 + 表情 + 加号） */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: BOTTOM_INPUT_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '0 36px',
          background: '#F7F7F7',
          borderTop: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        {/* 语音按钮 */}
        <div style={{ fontSize: 48, color: '#1A1A1A', lineHeight: 1 }}>🔊</div>
        {/* 输入框 */}
        <div
          style={{
            flex: 1,
            height: 84,
            borderRadius: 14,
            background: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 28,
            color: '#999999',
            fontSize: 36,
          }}
        >
          按住说话
        </div>
        {/* 表情 */}
        <div style={{ fontSize: 48, color: '#1A1A1A', lineHeight: 1 }}>😊</div>
        {/* 加号 */}
        <div style={{ fontSize: 48, color: '#1A1A1A', lineHeight: 1 }}>⊕</div>
      </div>
    </AbsoluteFill>
  );
};
