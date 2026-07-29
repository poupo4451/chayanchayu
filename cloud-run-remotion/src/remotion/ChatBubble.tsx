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
}

const COLORS = {
  bgLeft: 'rgba(255,255,255,0.10)',
  bgRight: 'rgba(124,77,255,0.45)',
  text: '#ffffff',
  name: 'rgba(255,255,255,0.55)',
  redpacket: '#f79c46',
  avatarLeft: 'rgba(255,255,255,0.12)',
  avatarRight: 'rgba(124,77,255,0.6)',
};

const BUBBLE_MAX_WIDTH = 600;
const BUBBLE_PADDING = '20px 26px';
const BUBBLE_RADIUS = 16;
const AVATAR_SIZE = 80;
const AVATAR_RADIUS = 12;
const FONT_SIZE_BODY = 30;
const FONT_SIZE_NAME = 22;

function Avatar({ name, role }: { name: string; role: string }) {
  const initial = name ? name[0] : '茶';
  return (
    <div
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_RADIUS,
        background: role === 'right' ? COLORS.avatarRight : COLORS.avatarLeft,
        color: '#fff',
        fontSize: 34,
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

function rowStyle(role: string): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: role === 'right' ? 'row-reverse' : 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: '0 32px',
  };
}

export const ChatBubble: React.FC<{ data: BubbleData }> = ({ data }) => {
  const role = data.role || 'left';

  if (data.type === 'time') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
        <span
          style={{
            fontSize: 22,
            color: 'rgba(255,255,255,0.4)',
            background: 'rgba(255,255,255,0.06)',
            padding: '4px 20px',
            borderRadius: 8,
          }}
        >
          {data.text}
        </span>
      </div>
    );
  }

  if (data.type === 'image') {
    return (
      <div style={rowStyle(role)}>
        <Avatar name={data.name} role={role} />
        <img
          src={data.params.imageUrl || ''}
          style={{
            width: 200,
            height: 200,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.06)',
            objectFit: 'contain',
          }}
        />
      </div>
    );
  }

  if (data.type === 'redpacket') {
    return (
      <div style={rowStyle(role)}>
        <Avatar name={data.name} role={role} />
        <div
          style={{
            maxWidth: 440,
            minWidth: 340,
            borderRadius: BUBBLE_RADIUS,
            background: COLORS.redpacket,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: '24px 20px' }}>
            <div style={{ fontSize: 40, marginRight: 16, width: 64, textAlign: 'center' }}>🧧</div>
            <span style={{ fontSize: 28, color: '#fff', fontWeight: 500 }}>
              {data.text || '恭喜发财'}
            </span>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.3)', margin: '0 20px' }} />
          <span style={{ display: 'block', fontSize: 22, color: 'rgba(255,255,255,0.85)', padding: '10px 20px 16px' }}>
            微信红包
          </span>
        </div>
      </div>
    );
  }

  if (data.type === 'transfer') {
    return (
      <div style={rowStyle(role)}>
        <Avatar name={data.name} role={role} />
        <div
          style={{
            maxWidth: 440,
            minWidth: 340,
            borderRadius: BUBBLE_RADIUS,
            background: COLORS.redpacket,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: '24px 20px' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.25)',
                color: '#fff',
                fontSize: 30,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginRight: 16,
              }}
            >
              ￥
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 32, color: '#fff', fontWeight: 600 }}>
                ￥{data.params.amount}
              </span>
              <span style={{ fontSize: 22, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
                {data.text || '转账'}
              </span>
            </div>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.3)', margin: '0 20px' }} />
          <span style={{ display: 'block', fontSize: 22, color: 'rgba(255,255,255,0.85)', padding: '10px 20px 16px' }}>
            微信转账
          </span>
        </div>
      </div>
    );
  }

  // text（默认）
  return (
    <div style={rowStyle(role)}>
      <Avatar name={data.name} role={role} />
      <div
        style={{
          maxWidth: BUBBLE_MAX_WIDTH,
          padding: BUBBLE_PADDING,
          borderRadius: BUBBLE_RADIUS,
          background: role === 'right' ? COLORS.bgRight : COLORS.bgLeft,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span style={{ fontSize: FONT_SIZE_NAME, color: COLORS.name }}>{data.name}</span>
        <span style={{ fontSize: FONT_SIZE_BODY, color: COLORS.text, lineHeight: 1.5 }}>
          {data.text}
        </span>
      </div>
    </div>
  );
};
