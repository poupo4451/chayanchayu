import React from 'react';
import { Composition } from 'remotion';
import { ChatMVComposition } from './ChatMVComposition';
import { BubbleData } from './ChatBubble';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './wxTheme';

export const FPS = 30;

// Remotion 4.x 强制要求 props 类型为 Record<string, unknown>，这里用 as never 绕过泛型约束
export const Root: React.FC = () => {
  return (
    <Composition
      id="chat-mv"
      component={ChatMVComposition as never}
      durationInFrames={FPS * 10}
      fps={FPS}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      defaultProps={{
        bubbles: [] as BubbleData[],
        audioPath: '',
        audioDuration: 30,
        beats: [] as number[],
        genre: '',
      }}
      calculateMetadata={
        (async ({ props }: { props: Record<string, unknown> }) => {
          const audioDuration = Number(props.audioDuration) || 30;
          return { durationInFrames: Math.ceil(audioDuration * FPS) };
        }) as never
      }
    />
  );
};
