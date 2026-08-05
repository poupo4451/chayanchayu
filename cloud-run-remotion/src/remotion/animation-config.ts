/**
 * 动画配置 — 统一的参数定义文件
 *
 * 所有动画变体、视觉参数、节奏参数都在此定义。
 * 生产代码（gsapMotion.ts / wxTheme.ts）和开发预览工具（dev-preview/）均以此文件为唯一数据源。
 *
 * ============================================================================
 * 使用方式：
 *   - 生产代码中直接 import 所需字段
 *   - dev-preview 中 import 后通过 state 覆盖，实时预览 → 导出 JSON
 * ============================================================================
 */

// ============================================================
// 1. 动画变体类型 & 池
// ============================================================

/**
 * 入场动画变体名
 * 与 gsapMotion.ts 中的 EnterVariant 类型严格对应。
 */
export type EnterVariant =
  | 'pop'
  | 'slide'
  | 'flip'
  | 'blurUp'
  | 'elastic'
  | 'swing'
  | 'zoomIn'
  | 'typewriter'
  | 'shake'
  | 'shine'
  // ── 方向多样化的新变体 ──
  | 'slideUp'     // 从屏幕下方滑入
  | 'bounce'      // 弹跳入场（bounceOut）
  | 'zoomOut'     // 后→前：极小缩放 + 透视深度
  | 'punchIn'     // 前→后：极强缩放压制
  | 'flipX'       // 三维 X 轴翻转
  | 'spinZ'       // Z 轴 360° 旋转 + 缩放
  // ── Hero 独占时刻专用（更猛更炸）──
  | 'flyIn'
  | 'tumble3d'
  | 'warp'
  | 'flash';

/** 默认轮换动画池（VARIANT_CYCLE） */
export const VARIANT_CYCLE: EnterVariant[] = [
  'pop',
  'slide',
  'elastic',
  'blurUp',
  'flip',
  'zoomIn',
  'swing',
  'typewriter',
  'shake',
  'shine',
  'slideUp',
  'bounce',
  'zoomOut',
  'punchIn',
  'flipX',
  'spinZ',
];

/**
 * 按音乐流派分组的动画池
 */
export const GENRE_VARIANT_POOLS: Record<string, EnterVariant[]> = {
  嘻哈: ['pop', 'shake', 'zoomIn', 'typewriter', 'swing', 'shine', 'punchIn', 'spinZ'],
  抖音风: ['shake', 'pop', 'shine', 'zoomIn', 'typewriter', 'flip', 'bounce', 'zoomOut'],
  粤语说唱: ['pop', 'shake', 'slide', 'swing', 'zoomIn', 'slideUp', 'flipX'],
  流行: ['slide', 'blurUp', 'zoomIn', 'shine', 'elastic', 'swing', 'bounce', 'flipX'],
  'R&B': ['blurUp', 'slide', 'elastic', 'flip', 'zoomIn', 'slideUp', 'zoomOut'],
  随机: VARIANT_CYCLE,
};

/** Hero 独占时刻专用动画池 */
export const HERO_VARIANT_POOL: EnterVariant[] = ['flyIn', 'tumble3d', 'warp', 'flash'];

// ============================================================
// 2. 动画时序参数
// ============================================================

/** 动态入场时长（帧）映射函数参数 */
export const ENTER_FRAMES = {
  /** gapFrames 的最小 clamp 值 */
  gapMin: 4,
  /** 基准公式：round(min(22, max(8, 6 + gap * k))) */
  k: 0.9,
  /** 结果上限 */
  maxFrames: 22,
  /** 结果下限 */
  minFrames: 8,
  /** 截距 */
  intercept: 6,
} as const;

/** 动态退场时长（帧）映射函数参数 */
export const EXIT_FRAMES = {
  gapMin: 4,
  k: 0.6,
  maxFrames: 16,
  minFrames: 6,
  intercept: 4,
} as const;

// ============================================================
// 3. 动画强度 / 幅度参数
// ============================================================

/** 能量映射：amp = energyOffset + energy * energyK */
export const ENERGY_MAP = {
  offset: 0.75,
  k: 0.5,
} as const;

/** 透明度衰减速：fade = power2Out(min(t * fadeSpeed, 1)) */
export const FADE_SPEED = 1.45;

/** 各变体的具体数值参数 */
export const VARIANT_PARAMS = {
  pop: {
    scaleFrom: 0.3,
    backOvershoot: 0.5,
  },
  slide: {
    distanceX: 160, // px
    scaleFrom: 0.94,
  },
  flip: {
    rotateY: 72, // deg
    scaleFrom: 0.9,
    backOvershoot: 1.02,
  },
  blurUp: {
    distanceY: 70, // px
    blurMax: 14, // px
    blurSpeed: 1.6,
  },
  elastic: {
    distanceY: -90, // px
    scaleYFrom: 0.82,
    elasticAmplitude: 0.7,
    elasticPeriod: 0.55,
    scaleSpeed: 2,
  },
  swing: {
    rotateDeg: 14,
    scaleFrom: 0.8,
    backOvershoot: 0.5, // 微小 settle，峰值仅 ~1.75%，不再跳
  },
  zoomIn: {
    scaleFrom: 1.32,
  },
  typewriter: {
    /** 无额外参数，clipPath 裁切由进度驱动 */
  },
  shake: {
    scaleFrom: 0.4,
    oscillationPeriods: 2,
    wiggleAmplitude: 5,
    backOvershoot: 0.5,
  },
  shine: {
    scaleFrom: 0.88,
    glowMax: 16,
  },
  slideUp: {
    distanceY: 200, // px, 从底部进入
    blurMax: 10, // px
  },
  bounce: {
    distanceY: -220, // px, 从上方弹跳下落
    scaleFrom: 0.55,
  },
  zoomOut: {
    scaleFrom: 0.12, // 极小起步 → 正常，后→前透视感
    perspective: 800,
  },
  punchIn: {
    scaleFrom: 1.9, // 极大起步 → 正常，前→后压制感
  },
  flipX: {
    rotateX: 78, // deg, X 轴上下翻转
    scaleFrom: 0.82,
    backOvershoot: 1.02,
  },
  spinZ: {
    rotateZ: 60, // deg, 轻旋，有方向感但不浮夸
    scaleFrom: 0.55,
  },
} as const;

/** Hero 变体参数 */
export const HERO_VARIANT_PARAMS = {
  flyIn: {
    offsetExtraX: 220,
    offsetExtraY: 220,
    scaleFrom: 1.12,
  },
  tumble3d: {
    rotateX: 120,
    rotateY: 90,
    rotateZ: 28,
    scaleFrom: 0.4,
    perspective: 1200,
  },
  warp: {
    oscillationPeriods: 5,
    skewAmplitude: 24,
    scaleFrom: 0.6,
  },
  flash: {
    scaleFrom: 1.5,
  },
} as const;

/** 退出动画参数 */
export const EXIT_PARAMS = {
  translateY: 64, // px
  scaleDecay: 0.07,
  blurMax: 8,
  blurThreshold: 0.05,
} as const;

/** Hero 退出动画参数 */
export const HERO_EXIT_PARAMS = {
  peakRatio: 0.4, // 在进度 0.4 处达到峰值
  peakScale: 1.18,
  fadeHalfPoint: 0.5, // 透明度在进度 0.5 后开始衰减
} as const;

/** 快闪退场参数（bubbleFlashExit） */
export const FLASH_EXIT_PARAMS = {
  peakRatio: 0.35,
  peakScale: 1.18,
  fadeHalfPoint: 0.4,
} as const;

/** 节拍脉冲衰减速度 */
export const BEAT_DECAY = 6;

// ============================================================
// 4. 布局与组参数
// ============================================================

/** 每屏幕最大气泡数 */
export const MAX_PER_GROUP = 3;

/** 组内最大跨度（秒） */
export const GROUP_MAX_SPAN_S = 4.5;

/** 组间最大间隔（秒） */
export const GROUP_MAX_GAP_S = 1.2;

// ============================================================
// 5. Hero 气泡参数
// ============================================================

export const HERO_MIN_RATIO = 0.18;
export const FORCE_HERO_EVERY = 7;

export const HERO_SCALE = {
  base: 1.15,
  breath: 0.08,
} as const;

export const FLASH_AMOUNT = {
  hero: 0.3,
  normal: 0.1,
} as const;

// ============================================================
// 6. 视觉 / 主题参数
// ============================================================

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

const IPHONE_LOGICAL_WIDTH = 375;
const ZOOM = 1.15;

export const PX_PER_PT = (CANVAS_WIDTH / IPHONE_LOGICAL_WIDTH) * ZOOM;

/** pt → px */
export const pt = (v: number): number => Math.round(v * PX_PER_PT);

export const FONT_FAMILY =
  "'PingFang SC', 'PingFang HK', 'PingFang TC', -apple-system, BlinkMacSystemFont, " +
  "'Noto Sans CJK SC', 'Source Han Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export const WX_COLORS = {
  canvas: '#000000',
  bubbleSelf: '#95EC69',
  bubbleOther: '#FFFFFF',
  textBody: '#191919',
  textName: '#B2B2B2',
  timeText: '#9A9A9A',
  timePillBg: 'rgba(0,0,0,0.06)',
  pay: '#FA9D3B',
  payDeep: '#E8912F',
  avatarBg: '#C6C7CB',
  avatarText: '#FFFFFF',
  bubbleShadow: '0 2px 10px rgba(0,0,0,0.06)',
} as const;

export const WX_SIZES = {
  avatar: pt(40),
  avatarRadius: Math.round(pt(40) * 0.2),
  avatarGap: pt(10),
  avatarFont: pt(17),
  edgeX: pt(16),
  rowGap: pt(14),
  bubbleRadius: pt(5),
  bubblePadV: pt(9.5),
  bubblePadH: pt(12),
  bubbleMaxWidth: pt(208),
  bubbleMinWidth: pt(22),
  tailW: pt(6),
  tailH: pt(11),
  tailTop: pt(15),
  nameSize: pt(12),
  nameGap: pt(4),
  bodySize: pt(17),
  timeSize: pt(12),
  imageSide: pt(120),
  imageRadius: pt(5),
  payCardWidth: pt(190),
} as const;

export const WX_LINE_HEIGHT = 1.35;

export const WX_FONT_SIZES = {
  body: 17,
  time: 12,
  name: 13,
} as const;

export const BUBBLE_PADDING = { x: 14, y: 10 } as const;
export const AVATAR_SIZE = 40;
export const BUBBLE_BORDER_RADIUS = 8;

// ============================================================
// 7. 向后兼容 — 重新导出旧命名（方便渐进迁移）
// ============================================================

export const WX_COLOR = WX_COLORS;
export const WX_SIZE = WX_SIZES;

// ============================================================
// 8. 导出完整配置类型（用于 dev-preview 状态管理）
// ============================================================

export interface AnimationConfig {
  variantCycle: string[];
  genreVariantPools: Record<string, string[]>;
  heroVariantPool: string[];
  enterFrames: typeof ENTER_FRAMES;
  exitFrames: typeof EXIT_FRAMES;
  energyMap: typeof ENERGY_MAP;
  fadeSpeed: number;
  variantParams: Record<string, Record<string, number>>;
  heroVariantParams: Record<string, Record<string, number>>;
  exitParams: typeof EXIT_PARAMS;
  heroExitParams: typeof HERO_EXIT_PARAMS;
  flashExitParams: typeof FLASH_EXIT_PARAMS;
  beatDecay: number;
  maxPerGroup: number;
  groupMaxSpanS: number;
  groupMaxGapS: number;
  heroMinRatio: number;
  forceHeroEvery: number;
  heroScale: typeof HERO_SCALE;
  flashAmount: typeof FLASH_AMOUNT;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  wxColors: Record<string, string>;
  wxSizes: Record<string, number>;
  wxFontSizes: typeof WX_FONT_SIZES;
  bubblePadding: typeof BUBBLE_PADDING;
  avatarSize: number;
  bubbleBorderRadius: number;
  wxLineHeight: number;
  fontFamily: string;
}

export function getDefaultConfig(): AnimationConfig {
  return {
    variantCycle: [...VARIANT_CYCLE],
    genreVariantPools: JSON.parse(JSON.stringify(GENRE_VARIANT_POOLS)),
    heroVariantPool: [...HERO_VARIANT_POOL],
    enterFrames: { ...ENTER_FRAMES },
    exitFrames: { ...EXIT_FRAMES },
    energyMap: { ...ENERGY_MAP },
    fadeSpeed: FADE_SPEED,
    variantParams: JSON.parse(JSON.stringify(VARIANT_PARAMS)),
    heroVariantParams: JSON.parse(JSON.stringify(HERO_VARIANT_PARAMS)),
    exitParams: { ...EXIT_PARAMS },
    heroExitParams: { ...HERO_EXIT_PARAMS },
    flashExitParams: { ...FLASH_EXIT_PARAMS },
    beatDecay: BEAT_DECAY,
    maxPerGroup: MAX_PER_GROUP,
    groupMaxSpanS: GROUP_MAX_SPAN_S,
    groupMaxGapS: GROUP_MAX_GAP_S,
    heroMinRatio: HERO_MIN_RATIO,
    forceHeroEvery: FORCE_HERO_EVERY,
    heroScale: { ...HERO_SCALE },
    flashAmount: { ...FLASH_AMOUNT },
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    zoom: ZOOM,
    wxColors: { ...WX_COLORS },
    wxSizes: { ...WX_SIZES },
    wxFontSizes: { ...WX_FONT_SIZES },
    bubblePadding: { ...BUBBLE_PADDING },
    avatarSize: AVATAR_SIZE,
    bubbleBorderRadius: BUBBLE_BORDER_RADIUS,
    wxLineHeight: WX_LINE_HEIGHT,
    fontFamily: FONT_FAMILY,
  };
}
