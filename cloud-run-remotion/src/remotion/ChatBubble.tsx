import React from 'react';

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
  // 该气泡出现的帧号（由歌词时间戳对齐算出；缺省时由 Composition 均匀分配）
  startFrame?: number;
}

/**
 * 微信风格气泡视觉规范（已固化）
 * -------------------------------------------------------------
 * 画布基准：1080 × 1920（竖屏，对应 iPhone 375pt × 2.88 缩放）
 * 设计 Token 参考 wechat-dialog-generator，已写死为本项目规范。
 * 修改这些常量 = 修改全局气泡外观，请保持单一职责。
 */
const WX = {
  // ── 颜色 ─────────────────────────────────────────────
  bubbleSelf: '#95EC69', // 自己气泡：微信绿
  bubbleOther: '#FFFFFF', // 对方气泡：纯白
  textDark: '#1A1A1A', // 气泡内正文：近黑（微信实际 #181818）
  textName: '#999999', // 昵称：中灰
  textTime: '#B0B0B0', // 时间分隔文字
  bgTimePill: 'rgba(0,0,0,0.08)', // 时间药丸背景
  redpacket: '#FA9D3B', // 红包/转账：橙
  avatarBg: '#D8D8D8', // 头像占位底色
  avatarText: '#666666', // 头像首字母色

  // ── 尺寸（均已 ×2.88 缩放到 1080 画布） ───────────────
  bubbleRadius: 24, // 气泡圆角 ≈ 8pt × 2.88
  bubblePaddingV: 26, // 气泡垂直内边距 ≈ 9pt × 2.88
  bubblePaddingH: 38, // 气泡水平内边距 ≈ 13pt × 2.88
  bubbleMaxWidth: 600, // 气泡最大宽度（限制单条最长，超出换行）
  bubbleMinWidth: 80, // 气泡最小宽度（避免单字过窄）

  arrowSize: 24, // 气泡尖尖方块边长 ≈ 8pt × 2.88
  arrowTop: 30, // 箭头距气泡顶部的垂直位置（与第一行文字中线对齐）
  arrowInset: 12, // 箭头嵌入气泡的量（-arrowSize/2 让一半外露）

  avatarSize: 115, // 头像尺寸 ≈ 40pt × 2.88
  avatarRadius: 17, // 头像圆角 ≈ 6pt × 2.88
  avatarGap: 35, // 头像与气泡间距 ≈ 12pt × 2.88

  fontSizeBody: 46, // 正文字号 ≈ 16pt × 2.88
  fontSizeName: 35, // 昵称字号 ≈ 12pt × 2.88
  fontSizeTime: 32, // 时间字号
  lineHeight: 1.4, // 正文行高（微信默认）

  rowPaddingX: 46, // 聊天区左右内边距 ≈ 16pt × 2.88
} as const;

/** 头像：中性占位（首字母 + 浅灰底） */
function Avatar({ name }: { name: string }) {
  const initial = name ? name[0] : '茶';
  return (
    <div
      style={{
        width: WX.avatarSize,
        height: WX.avatarSize,
        borderRadius: WX.avatarRadius,
        background: WX.avatarBg,
        color: WX.avatarText,
        fontSize: 46,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

/**
 * 气泡尖尖（箭头）
 * 实现：与气泡同色的小方块，rotate(45deg)，一半嵌入气泡边缘、一半外露。
 * side='left' 时贴气泡左边缘（对方气泡）；side='right' 时贴右边缘（自己气泡）。
 */
function BubbleTail({ side, color }: { side: 'left' | 'right'; color: string }) {
  const sideOffset: React.CSSProperties =
    side === 'left' ? { left: -WX.arrowInset } : { right: -WX.arrowInset };
  return (
    <div
      style={{
        position: 'absolute',
        top: WX.arrowTop,
        width: WX.arrowSize,
        height: WX.arrowSize,
        background: color,
        transform: 'rotate(45deg)',
        borderRadius: 3,
        ...sideOffset,
      }}
    />
  );
}

/** 整行布局：头像 + 气泡列，right 侧反转 */
function rowStyle(role: string): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: role === 'right' ? 'row-reverse' : 'row',
    alignItems: 'flex-start',
    gap: WX.avatarGap,
    padding: `0 ${WX.rowPaddingX}px`,
  };
}

/**
 * 气泡宽度自适应逻辑：
 * - 容器用 inline-flex，宽度随内容增长，maxWidth 到达后换行
 * - 文字 white-space: pre-wrap 保留换行符，word-break 防英文溢出
 * - minWidth 防止单字气泡过窄
 */
export const ChatBubble: React.FC<{ data: BubbleData }> = ({ data }) => {
  const role = data.role || 'left';
  const isSelf = role === 'right';
  const bubbleColor = isSelf ? WX.bubbleSelf : WX.bubbleOther;

  // ── 时间分隔 ──────────────────────────────────────
  if (data.type === 'time') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
        <span
          style={{
            fontSize: WX.fontSizeTime,
            color: WX.textTime,
            background: WX.bgTimePill,
            padding: '8px 24px',
            borderRadius: 12,
          }}
        >
          {data.text}
        </span>
      </div>
    );
  }

  // ── 图片 ──────────────────────────────────────────
  if (data.type === 'image') {
    return (
      <div style={rowStyle(role)}>
        <Avatar name={data.name} />
        <img
          src={data.params.imageUrl || ''}
          style={{
            width: 360,
            height: 360,
            borderRadius: WX.bubbleRadius,
            objectFit: 'cover',
          }}
        />
      </div>
    );
  }

  // ── 红包 ──────────────────────────────────────────
  if (data.type === 'redpacket') {
    return (
      <div style={rowStyle(role)}>
        <Avatar name={data.name} />
        <div
          style={{
            position: 'relative',
            width: 440,
            borderRadius: WX.bubbleRadius,
            background: WX.redpacket,
            overflow: 'hidden',
          }}
        >
          <BubbleTail side={isSelf ? 'right' : 'left'} color={WX.redpacket} />
          <div style={{ display: 'flex', alignItems: 'center', padding: '28px 24px' }}>
            <div style={{ fontSize: 56, marginRight: 20, width: 80, textAlign: 'center' }}>🧧</div>
            <span style={{ fontSize: 36, color: '#fff', fontWeight: 500 }}>
              {data.text || '恭喜发财'}
            </span>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.3)', margin: '0 24px' }} />
          <span
            style={{
              display: 'block',
              fontSize: 28,
              color: 'rgba(255,255,255,0.85)',
              padding: '12px 24px 18px',
            }}
          >
            微信红包
          </span>
        </div>
      </div>
    );
  }

  // ── 转账 ──────────────────────────────────────────
  if (data.type === 'transfer') {
    return (
      <div style={rowStyle(role)}>
        <Avatar name={data.name} />
        <div
          style={{
            position: 'relative',
            width: 440,
            borderRadius: WX.bubbleRadius,
            background: WX.redpacket,
            overflow: 'hidden',
          }}
        >
          <BubbleTail side={isSelf ? 'right' : 'left'} color={WX.redpacket} />
          <div style={{ display: 'flex', alignItems: 'center', padding: '28px 24px' }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.25)',
                color: '#fff',
                fontSize: 40,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginRight: 20,
              }}
            >
              ￥
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 40, color: '#fff', fontWeight: 600 }}>
                ￥{data.params.amount}
              </span>
              <span style={{ fontSize: 28, color: 'rgba(255,255,255,0.85)', marginTop: 6 }}>
                {data.text || '转账'}
              </span>
            </div>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.3)', margin: '0 24px' }} />
          <span
            style={{
              display: 'block',
              fontSize: 28,
              color: 'rgba(255,255,255,0.85)',
              padding: '12px 24px 18px',
            }}
          >
            微信转账
          </span>
        </div>
      </div>
    );
  }

  // ── 文字（默认） ──────────────────────────────────
  // 昵称置于气泡外（微信群聊风格），气泡内仅正文
  return (
    <div style={rowStyle(role)}>
      <Avatar name={data.name} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: WX.bubbleMaxWidth,
          flex: '0 1 auto',
          alignItems: isSelf ? 'flex-end' : 'flex-start',
        }}
      >
        {/* 昵称（气泡外） */}
        <span
          style={{
            fontSize: WX.fontSizeName,
            color: WX.textName,
            paddingLeft: 6,
            paddingRight: 6,
            marginBottom: 8,
          }}
        >
          {data.name}
        </span>
        {/* 气泡本体：宽度随内容自适应，达 maxWidth 换行 */}
        <div
          style={{
            position: 'relative',
            maxWidth: WX.bubbleMaxWidth,
            minWidth: WX.bubbleMinWidth,
            padding: `${WX.bubblePaddingV}px ${WX.bubblePaddingH}px`,
            borderRadius: WX.bubbleRadius,
            background: bubbleColor,
            display: 'inline-flex',
            flex: '0 1 auto',
          }}
        >
          <BubbleTail side={isSelf ? 'right' : 'left'} color={bubbleColor} />
          <span
            style={{
              fontSize: WX.fontSizeBody,
              color: WX.textDark,
              lineHeight: WX.lineHeight,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {data.text}
          </span>
        </div>
      </div>
    </div>
  );
};
