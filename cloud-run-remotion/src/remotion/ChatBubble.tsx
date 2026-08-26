import React from 'react';
import { Img, staticFile } from 'remotion';
import { FONT_FAMILY, WX_COLOR, WX_SIZE, WX_LINE_HEIGHT, CONTAINER_WIDTH, CONTAINER_NEAR_PAD } from './wxTheme';

export interface BubbleData {
  index: number;
  role: 'left' | 'right';
  name: string;
  type: 'text' | 'time' | 'image' | 'redpacket' | 'transfer';
  text: string;
  params: {
    amount?: string;
    stickerId?: string;
    imageUrl?: string;
  };
  /** 默认头像标识，如 "male-2"；对应 public/avatars/male-2.png，缺失时自动回退首字母色块 */
  avatarId?: string;
  /**
   * 长对话被按标点/长度拆成多条子气泡时（见 renderChatScreenshots），
   * 用于 React key 与动画随机种子的唯一标识，如 "3-1"（第3条对话的第2个子气泡）
   */
  uid?: string;
  /** 该子气泡在同一条原始对话消息里的序号（0 开始） */
  subIndex?: number;
  /** 该条原始对话消息一共被拆成多少条子气泡 */
  subTotal?: number;
  /** 该子气泡在原始对话演唱时间跨度中的起始比例（0~1），供 lyricsAlign 按字数比例切分时间戳 */
  splitStart?: number;
  /** 该子气泡在原始对话演唱时间跨度中的结束比例（0~1） */
  splitEnd?: number;
  /** 该气泡出现的帧号（由歌词时间戳对齐算出，见 src/lyricsAlign.ts） */
  startFrame?: number;
  /** 该气泡对应歌词唱完的帧号 */
  endFrame?: number;
}

/**
 * 单条微信消息（头像 + 气泡）。
 *
 * 容器内部所有尺寸固定（类似 iOS pt 体系），外部通过缩放适配视频画面。
 * 容器自带灰底（#EDEDED），容器组不再渲染底色。
 */

/** 头像：圆角为边长的 0.2 倍；有 avatarId 且素材存在则显示图片，否则回退首字母色块。 */
const Avatar: React.FC<{ name: string; avatarId?: string }> = ({ name, avatarId }) => (
  <div
    style={{
      width: WX_SIZE.avatar,
      height: WX_SIZE.avatar,
      borderRadius: WX_SIZE.avatarRadius,
      background: WX_COLOR.avatarBg,
      color: WX_COLOR.avatarText,
      fontFamily: FONT_FAMILY,
      fontSize: WX_SIZE.avatarFont,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
    }}
  >
    {avatarId ? (
      <Img
        src={staticFile(`avatars/${avatarId}.png`)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    ) : (
      name ? name[0] : '茶'
    )}
  </div>
);

/**
 * 气泡尖角。
 * 微信的尖角是一个贴在气泡上沿附近的小三角（宽 6pt × 高 11pt），
 * 用 SVG 画比 rotate(45deg) 的方块更接近真机形状。
 */
const BubbleTail: React.FC<{ side: 'left' | 'right'; color: string }> = ({ side, color }) => {
  const w = WX_SIZE.tailW;
  const h = WX_SIZE.tailH;
  // 直角边贴气泡，斜边朝外，尖端略低于顶部（与首行文字中线齐平）
  const d =
    side === 'left'
      ? `M ${w} 0 L ${w} ${h} L 0 ${h * 0.46} Z`
      : `M 0 0 L 0 ${h} L ${w} ${h * 0.46} Z`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        position: 'absolute',
        top: WX_SIZE.tailTop,
        ...(side === 'left' ? { left: -w + 1 } : { right: -w + 1 }),
      }}
    >
      <path d={d} fill={color} strokeLinejoin="round" strokeWidth={1} stroke={color} />
    </svg>
  );
};

/** 容器行：固定宽度，头像 + 气泡内容，自带灰底 */
function containerStyle(isSelf: boolean): React.CSSProperties {
  return {
    width: CONTAINER_WIDTH,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: isSelf ? 'row-reverse' : 'row',
    alignItems: 'flex-start',
    gap: WX_SIZE.avatarGap,
    fontFamily: FONT_FAMILY,
    paddingLeft: CONTAINER_NEAR_PAD,
    paddingRight: CONTAINER_NEAR_PAD,
    paddingTop: 40,
    paddingBottom: 40,
    backgroundColor: '#EDEDED',
    borderRadius: 4,
  };
}

/**
 * PayCard（红包/转账橙色卡片）
 * 使用标准 SVG 素材，内置尖角、icon 与文字比例。
 * SVG 的 viewBox 与 WX_SIZE.payCardWidth 宽度对齐，高度等比缩放。
 */
const PAY_FILES: Record<string, Record<string, string>> = {
  redpacket: { left: 'redpacket-left.svg', right: 'redpacket-right.svg' },
  transfer: { left: 'transfer-left.svg', right: 'transfer-right.svg' },
};

const PayCard: React.FC<{ payType: 'redpacket' | 'transfer'; role: 'left' | 'right' }> = ({
  payType,
  role,
}) => (
  <Img
    src={staticFile(PAY_FILES[payType][role])}
    style={{
      width: Math.round(WX_SIZE.payCardWidth * 1.1),
      height: 'auto',
      display: 'block',
    }}
  />
);

export const ChatBubble: React.FC<{
  data: BubbleData;
}> = ({ data }) => {
  const isSelf = (data.role || 'left') === 'right';
  const bubbleColor = isSelf ? WX_COLOR.bubbleSelf : WX_COLOR.bubbleOther;

  // ── 时间分隔药丸 ────────────────────────────────
  if (data.type === 'time') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', fontFamily: FONT_FAMILY }}>
        <span
          style={{
            fontSize: WX_SIZE.timeSize,
            color: WX_COLOR.timeText,
            background: WX_COLOR.timePillBg,
            padding: `${Math.round(WX_SIZE.bubblePadV * 0.4)}px ${WX_SIZE.bubblePadH}px`,
            borderRadius: WX_SIZE.bubbleRadius,
          }}
        >
          {data.text}
        </span>
      </div>
    );
  }

  // ── 表情包 / 图片（微信图片消息无气泡底、无尖角） ──
  if (data.type === 'image') {
    return (
      <div style={containerStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <div style={{ maxWidth: WX_SIZE.imageSide, flex: '0 1 auto', minWidth: 0 }}>
          <img
            src={data.params.imageUrl || ''}
            style={{
              width: '100%',
              maxWidth: WX_SIZE.imageSide,
              height: 'auto',
              aspectRatio: '1',
              borderRadius: WX_SIZE.imageRadius,
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      </div>
    );
  }

  // ── 红包 ────────────────────────────────────────
  if (data.type === 'redpacket') {
    return (
      <div style={containerStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <div style={{ maxWidth: Math.round(WX_SIZE.payCardWidth * 1.1), flex: '0 0 auto', minWidth: 0 }}>
          <PayCard payType="redpacket" role={data.role || 'left'} />
        </div>
      </div>
    );
  }

  // ── 转账 ────────────────────────────────────────
  if (data.type === 'transfer') {
    return (
      <div style={containerStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <div style={{ maxWidth: Math.round(WX_SIZE.payCardWidth * 1.1), flex: '0 0 auto', minWidth: 0 }}>
          <PayCard payType="transfer" role={data.role || 'left'} />
        </div>
      </div>
    );
  }

  // ── 文字（默认） ────────────────────────────────
  return (
    <div style={containerStyle(isSelf)}>
      <Avatar name={data.name} avatarId={data.avatarId} />
      <div
        style={{
          position: 'relative',
          minWidth: WX_SIZE.bubbleMinWidth,
          maxWidth: WX_SIZE.bubbleMaxWidth,
          padding: `${WX_SIZE.bubblePadV}px ${WX_SIZE.bubblePadH}px`,
          borderRadius: WX_SIZE.bubbleRadius,
          background: bubbleColor,
          boxShadow: WX_COLOR.bubbleShadow,
          display: 'inline-flex',
          flex: '0 1 auto',
        }}
      >
        <BubbleTail side={isSelf ? 'right' : 'left'} color={bubbleColor} />
        <span
          style={{
            fontSize: WX_SIZE.bodySize,
            color: WX_COLOR.textBody,
            lineHeight: WX_LINE_HEIGHT,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxWidth: '22em',
            display: 'inline-block',
          }}
        >
          {data.text}
        </span>
      </div>
    </div>
  );
};
