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

/** 头像：微信为完全圆形（borderRadius 50%）。有 avatarId 且素材存在则显示图片，否则回退首字母色块 */
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
    padding: `0 ${WX_SIZE.edgeX}px`,
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

/** 红包 / 转账共用的橙色卡片 */
const PayCard: React.FC<{
  isSelf: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  footer: string;
}> = ({ isSelf, icon, title, subtitle, footer }) => (
  <div
    style={{
      position: 'relative',
      width: WX_SIZE.payCardWidth,
      borderRadius: WX_SIZE.bubbleRadius,
      background: WX_COLOR.pay,
      boxShadow: WX_COLOR.bubbleShadow,
    }}
  >
    <BubbleTail side={isSelf ? 'right' : 'left'} color={WX_COLOR.pay} />
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: WX_SIZE.bubblePadH,
        padding: `${WX_SIZE.bubblePadV * 1.4}px ${WX_SIZE.bubblePadH}px`,
      }}
    >
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span
          style={{
            fontSize: WX_SIZE.bodySize,
            color: '#FFFFFF',
            fontWeight: 500,
            lineHeight: WX_LINE_HEIGHT,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            style={{
              fontSize: WX_SIZE.timeSize,
              color: 'rgba(255,255,255,0.85)',
              marginTop: WX_SIZE.nameGap,
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
    <div style={{ height: 1, background: 'rgba(255,255,255,0.28)' }} />
    <span
      style={{
        display: 'block',
        fontSize: WX_SIZE.timeSize,
        color: 'rgba(255,255,255,0.85)',
        padding: `${Math.round(WX_SIZE.bubblePadV * 0.7)}px ${WX_SIZE.bubblePadH}px`,
      }}
    >
      {footer}
    </span>
  </div>
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
      <div style={rowStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <ContentColumn isSelf={isSelf} name={data.name} maxWidth={maxWidth}>
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
        </ContentColumn>
      </div>
    );
  }

  // ── 红包 ────────────────────────────────────────
  if (data.type === 'redpacket') {
    return (
      <div style={rowStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <ContentColumn isSelf={isSelf} name={data.name} maxWidth={maxWidth}>
          <PayCard
            isSelf={isSelf}
            icon={
              <span style={{ fontSize: WX_SIZE.bodySize * 1.6, lineHeight: 1 }}>🧧</span>
            }
            title={data.text || '恭喜发财，大吉大利'}
            footer="微信红包"
          />
        </ContentColumn>
      </div>
    );
  }

  // ── 转账 ────────────────────────────────────────
  if (data.type === 'transfer') {
    return (
      <div style={rowStyle(isSelf)}>
        <Avatar name={data.name} avatarId={data.avatarId} />
        <ContentColumn isSelf={isSelf} name={data.name} maxWidth={maxWidth}>
          <PayCard
            isSelf={isSelf}
            icon={
              <span
                style={{
                  width: WX_SIZE.bodySize * 1.8,
                  height: WX_SIZE.bodySize * 1.8,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.24)',
                  color: '#FFFFFF',
                  fontSize: WX_SIZE.bodySize,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                ￥
              </span>
            }
            title={`￥${data.params.amount || '0.00'}`}
            subtitle={data.text || '转账'}
            footer="微信转账"
          />
        </ContentColumn>
      </div>
    );
  }

  // ── 文字（默认） ────────────────────────────────
  return (
    <div style={rowStyle(isSelf)}>
      <Avatar name={data.name} avatarId={data.avatarId} />
      <ContentColumn isSelf={isSelf} name={data.name} maxWidth={maxWidth}>
        <div
          style={{
            position: 'relative',
            maxWidth,
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
            }}
          >
            {data.text}
          </span>
        </div>
      </ContentColumn>
    </div>
  );
};
