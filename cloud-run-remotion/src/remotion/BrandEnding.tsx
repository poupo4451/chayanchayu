import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BRAND } from './animation-config';

/**
 * 品牌片尾：气泡全部退场后，把一张已含 logo + slogan 的成品图居中渐现。
 *
 * 仅在 [startFrame, startFrame + tailFrames) 内渲染：
 * 进入后 fadeInS 秒渐现（配合轻微上浮），之后保持到视频结束。
 *
 * 素材按 2x 导出（824×756），这里按 1/2（412×378）显示。
 * 自带透明通道，直接叠在深色画布上即可，不需要背板或圆角。
 */
export const BrandEnding: React.FC<{
  /** 片尾起始帧（= 内容段结束帧） */
  startFrame: number;
  /** 片尾总帧数 */
  tailFrames: number;
}> = ({ startFrame, tailFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const local = frame - startFrame;
  if (local < 0 || tailFrames <= 0) return null;

  const fadeFrames = Math.max(1, Math.round(BRAND.fadeInS * fps));
  const t = Math.min(local / fadeFrames, 1);
  // easeOutCubic：起步快、收尾稳，比线性渐现更有「落定」感
  const eased = 1 - Math.pow(1 - t, 3);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: eased,
        transform: `translateY(${((1 - eased) * 16).toFixed(2)}px)`,
      }}
    >
      <Img
        src={staticFile(BRAND.endingFile)}
        style={{
          width: BRAND.endingWidth,
          height: BRAND.endingHeight,
          display: 'block',
        }}
      />
    </AbsoluteFill>
  );
};
