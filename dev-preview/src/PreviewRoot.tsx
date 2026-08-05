import React from 'react';
import { ChatMVComposition } from '@remotion-components/ChatMVComposition';
import type { BubbleData } from '@remotion-components/ChatBubble';

/**
 * `@remotion/player` 的 `Player` 要求 component 的 props 满足
 * `Record<string, unknown>`（需要索引签名），而 `ChatMVProps` 是普通 interface。
 * 这里加一层带索引签名的薄包装，避免在调用处用类型断言绕过检查。
 */
export interface PreviewProps extends Record<string, unknown> {
  bubbles: BubbleData[];
  beats: number[];
  genre: string;
}

export const PreviewRoot: React.FC<PreviewProps> = ({ bubbles, beats, genre }) => (
  <ChatMVComposition bubbles={bubbles} beats={beats} genre={genre} />
);
