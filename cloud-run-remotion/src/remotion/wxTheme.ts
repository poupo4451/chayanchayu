/**
 * 微信聊天气泡视觉规范（全局唯一数据源）
 * =====================================================================
 * 【录入原则】
 * 所有尺寸先以 iOS 微信真机的 **pt** 记录，再统一乘同一个换算系数变成像素。
 * 这样「圆角 : 内边距 : 字号 : 头像 : 间距」之间的比例永远等于微信本体，
 * 想整体放大只需改 ZOOM，比例不会走样。
 *
 *   画布宽 1080px  ⟷  iPhone 逻辑宽 375pt   ⇒  基准 1080/375 = 2.88 px/pt
 *   本 MV 画面里只呈现 1~3 条气泡（不画完整聊天界面），主体需要更醒目，
 *   所以再乘一个 ZOOM。ZOOM 只放大整体，不改变任何比例关系。
 *
 * 【pt 数值来源】iOS 微信 8.x 默认字号（"标准"档）实测：
 *   正文 17pt / 群昵称 12pt / 头像 40pt / 气泡圆角 5pt
 *   气泡内边距 12pt(横) × 9.5pt(纵) / 头像与气泡间距 10pt / 屏幕左右边距 16pt
 *   相邻消息行间距 14pt / 气泡最大宽度 ≈ 225pt
 */

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

const IPHONE_LOGICAL_WIDTH = 375;
/** 只放大整体，不改变比例 */
const ZOOM = 1.15;

export const PX_PER_PT = (CANVAS_WIDTH / IPHONE_LOGICAL_WIDTH) * ZOOM;

/** pt → px */
export const pt = (v: number): number => Math.round(v * PX_PER_PT);

/**
 * 苹方字体栈。
 * - macOS / iOS：命中真正的 PingFang SC。
 * - Linux 容器：容器内不可能装 Apple 私有字体，Dockerfile 里通过
 *   fontconfig 别名（fonts/local.conf）把 "PingFang SC" 解析到
 *   Noto Sans CJK SC（思源黑体，字形与字重最接近苹方），保证渲染一致。
 */
export const FONT_FAMILY =
  "'PingFang SC', 'PingFang HK', 'PingFang TC', -apple-system, BlinkMacSystemFont, " +
  "'Noto Sans CJK SC', 'Source Han Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export const WX_COLOR = {
  /** 微信聊天背景灰 */
  canvas: '#EDEDED',
  /** 自己的气泡：微信绿 */
  bubbleSelf: '#95EC69',
  /** 对方的气泡：纯白 */
  bubbleOther: '#FFFFFF',
  /** 气泡正文 */
  textBody: '#191919',
  /** 群聊昵称 */
  textName: '#B2B2B2',
  /** 时间药丸 */
  timeText: '#9A9A9A',
  timePillBg: 'rgba(0,0,0,0.06)',
  /** 红包 / 转账橙 */
  pay: '#FA9D3B',
  payDeep: '#E8912F',
  /** 头像占位 */
  avatarBg: '#C6C7CB',
  avatarText: '#FFFFFF',
  /** 气泡投影（微信本体无投影，这里极轻，仅用于脱离背景） */
  bubbleShadow: '0 2px 10px rgba(0,0,0,0.06)',
} as const;

export const WX_SIZE = {
  // 头像（微信为完全圆形）
  avatar: pt(40),
  avatarRadius: '50%',
  avatarGap: pt(10),
  avatarFont: pt(17),

  // 布局
  edgeX: pt(16),
  rowGap: pt(14),

  // 气泡
  bubbleRadius: pt(5),
  bubblePadV: pt(9.5),
  bubblePadH: pt(12),
  // 原 225pt：常规呼吸缩放叠加后气泡最宽已接近 1080px 画布边缘，安全余量几乎为零；
  // 收紧到 208pt，多留一点边距（Hero 独占时刻另外通过 maxWidthScale 再收窄一次）
  bubbleMaxWidth: pt(208),
  bubbleMinWidth: pt(22),

  // 气泡尖角
  tailW: pt(6),
  tailH: pt(11),
  tailTop: pt(9),

  // 文字
  nameSize: pt(12),
  nameGap: pt(4),
  bodySize: pt(17),
  timeSize: pt(12),

  // 富媒体
  imageSide: pt(120),
  imageRadius: pt(5),
  payCardWidth: pt(190),
} as const;

/** 微信正文行距 ≈ 23pt / 17pt */
export const WX_LINE_HEIGHT = 1.35;
