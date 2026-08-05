import React from 'react';
import { Img, staticFile } from 'remotion';
import { FONT_FAMILY, WX_COLOR, WX_SIZE, WX_LINE_HEIGHT } from './wxTheme';

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
 * 单条微信消息（头像 + 昵称 + 气泡）。
 *
 * 所有尺寸/颜色都来自 wxTheme 的 pt 规范，本文件不出现任何魔法数字，
 * 这样「字体与气泡图形的大小比例」始终等于 iOS 微信真机。
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

/** 整行：头像 + 内容列；自己的消息整行反向 */
function rowStyle(isSelf: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: isSelf ? 'row-reverse' : 'row',
    alignItems: 'flex-start',
    gap: WX_SIZE.avatarGap,
    fontFamily: FONT_FAMILY,
  };
}

/** 内容列（昵称在气泡外，微信群聊风格） */
const ContentColumn: React.FC<{
  isSelf: boolean;
  name: string;
  maxWidth: number;
  children: React.ReactNode;
}> = ({ isSelf, name, maxWidth, children }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isSelf ? 'flex-end' : 'flex-start',
      maxWidth,
      flex: '0 1 auto',
      minWidth: 0,
    }}
  >
    <span
      style={{
        fontSize: WX_SIZE.nameSize,
        color: WX_COLOR.textName,
        lineHeight: 1.2,
        marginBottom: WX_SIZE.nameGap,
        padding: `0 ${Math.round(WX_SIZE.nameGap / 2)}px`,
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
    {children}
  </div>
);

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
  /**
   * 气泡最大宽度相对 WX_SIZE.bubbleMaxWidth 的缩放系数（默认 1）。
   * Hero 独占时刻会整组再放大 ~1.2 倍，若气泡本身已贴着安全宽度上限，
   * 放大后必然冲出 1080px 画布——这里让 Hero 模式传入 <1 的系数提前收窄，
   * 为放大动画预留安全边距。
   */
  maxWidthScale?: number;
}> = ({ data, maxWidthScale = 1 }) => {
  const isSelf = (data.role || 'left') === 'right';
  const bubbleColor = isSelf ? WX_COLOR.bubbleSelf : WX_COLOR.bubbleOther;
  const maxWidth = WX_SIZE.bubbleMaxWidth * maxWidthScale;

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
      <div style={{ padding: 32, backgroundColor: '#EDEDED' }}>
        <div style={rowStyle(isSelf)}>
          <Avatar name={data.name} avatarId={data.avatarId} />
          <img
            src={data.params.imageUrl || ''}
            style={{
              width: WX_SIZE.imageSide,
              height: WX_SIZE.imageSide,
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
      <div style={{ padding: 32, backgroundColor: '#EDEDED' }}>
        <div style={rowStyle(isSelf)}>
          <Avatar name={data.name} avatarId={data.avatarId} />
          <PayCard payType="redpacket" role={data.role || 'left'} />
        </div>
      </div>
    );
  }

  // ── 转账 ────────────────────────────────────────
  if (data.type === 'transfer') {
    return (
      <div style={{ padding: 32, backgroundColor: '#EDEDED' }}>
        <div style={rowStyle(isSelf)}>
          <Avatar name={data.name} avatarId={data.avatarId} />
          <PayCard payType="transfer" role={data.role || 'left'} />
        </div>
      </div>
    );
  }

  // ── 文字（默认） ────────────────────────────────
  return (
    <div style={{ padding: 32, backgroundColor: '#EDEDED' }}>
      <div style={rowStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <div
          style={{
            position: 'relative',
            minWidth: WX_SIZE.bubbleMinWidth,
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
              maxWidth: '14em',
              display: 'inline-block',
            }}
          >
            {data.text}
          </span>
        </div>
      </div>
    </div>
  );
};

