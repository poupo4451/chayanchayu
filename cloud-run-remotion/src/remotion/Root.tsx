import React from 'react';
import { Composition, CalculateMetadataFunction } from 'remotion';
import { ChatMVComposition } from './ChatMVComposition';
import { BubbleData } from './ChatBubble';

// Remotion 4.x 强制要求 props 类型为 Record<string, unknown>，使用泛型版本 Composition
export const Root: React.FC = () => {
  return (
    <Composition
      id="chat-mv"
      component={ChatMVComposition as never}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        bubbles: [] as BubbleData[],
        audioPath: '',
        audioDuration: 30,
      }}
      calculateMetadata={
        (async ({ props }: { props: Record<string, unknown> }) => {
          const audioDuration = Number(props.audioDuration) || 30;
          return { durationInFrames: Math.ceil(audioDuration * 30) };
        }) as never
      }
    />
  );
};
