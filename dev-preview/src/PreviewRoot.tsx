import React from 'react';
import { ChatMVComposition } from '@remotion-components/ChatMVComposition';
import type { BubbleData } from '@remotion-components/ChatBubble';

/**
 * `@remotion/player` 的 `Player` 要求 component 的 props 满足
 * `Record<string, unknown>`（需要索引签名），而 `ChatMVProps` 是普通 interface。
 * 这里加一层带索引签名的薄包装，避免在调用处用类型断言绕过检查。
 *
 * ⚠️ 必须与 buildRenderInputs 的 ChatMVInputProps 保持字段一致。
 * 之前这里只透传 bubbles/beats/genre，等于让预览走了「无音频 + 无裁剪」
 * 的另一条分支，是「预览调好、上云观感不同」的主要原因之一。
 */
export interface PreviewProps extends Record<string, unknown> {
  bubbles: BubbleData[];
  beats: number[];
  genre: string;
  audioPath?: string;
  audioDuration?: number;
  audioTrimBefore?: number;
  audioFadeInFrames?: number;
  audioFadeOutFrames?: number;
}

export const PreviewRoot: React.FC<PreviewProps> = ({
  bubbles,
  beats,
  genre,
  audioPath,
  audioDuration,
  audioTrimBefore,
  audioFadeInFrames,
  audioFadeOutFrames,
}) => (
  <ChatMVComposition
    bubbles={bubbles}
    beats={beats}
    genre={genre}
    audioPath={audioPath}
    audioDuration={audioDuration}
    audioTrimBefore={audioTrimBefore}
    audioFadeInFrames={audioFadeInFrames}
    audioFadeOutFrames={audioFadeOutFrames}
  />
);
