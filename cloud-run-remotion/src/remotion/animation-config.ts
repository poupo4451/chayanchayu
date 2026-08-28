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
 *
 * ============================================================================
 * 【硬性规则 — 歌词-气泡时序约束】
 *
 * 规则 1（不提前出场）：
 *   每条气泡的 startFrame 必须 ≥ 其关联歌词行的 startS × fps。
 *   即：歌词没唱到的部分，对应气泡绝不提前出现在画面中。
 *   实现层：lyricsAlign.ts 的 computeBubbleTimings() 在插值完成后，
 *   对每条已锚定歌词行的气泡强制 clamp startFrame ≥ minFrame。
 *
 * 规则 2（唱完不退场过早）：
 *   气泡的 endFrame 必须 ≥ 其关联歌词行的 endS × fps。
 *   即：歌词还在唱的时候，气泡不能提前消失。
 *
 * 规则 3（子气泡顺序对齐）：
 *   长对话拆成的多条子气泡按 splitStart/splitEnd 比例切分时间跨度，
 *   保证「唱到哪个字，对应的那截气泡才亮起」。
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
  | 'slideDown'   // 从屏幕上方滑入
  | 'scaleX'      // X 轴挤压→释放
  | 'dropIn'      // 上方坠落弹跳 settle
  | 'glowIn'      // 光晕脉冲入场
  | 'spin3d'      // X+Y 双轴旋转
  | 'paperFlip'   // 纸角翻转入场
  | 'squeezeIn'   // Y 轴挤压→弹开
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
  'slideDown',
  'scaleX',
  'dropIn',
  'glowIn',
  'spin3d',
  'paperFlip',
  'squeezeIn',
  'pop',
  'slide',
  'flip',
];

/**
 * 按音乐流派分组的动画池
 */
export const GENRE_VARIANT_POOLS: Record<string, EnterVariant[]> = {
  嘻哈: ['pop', 'shake', 'zoomIn', 'typewriter', 'swing', 'shine', 'punchIn', 'spinZ', 'scaleX', 'dropIn', 'spin3d'],
  抖音风: ['shake', 'pop', 'shine', 'zoomIn', 'typewriter', 'flip', 'bounce', 'zoomOut', 'slideDown', 'paperFlip', 'squeezeIn'],
  粤语说唱: ['pop', 'shake', 'slide', 'swing', 'zoomIn', 'slideUp', 'flipX', 'glowIn', 'scaleX', 'spinZ'],
  流行: ['slide', 'blurUp', 'zoomIn', 'shine', 'elastic', 'swing', 'bounce', 'flipX', 'dropIn', 'paperFlip', 'glowIn'],
  'R&B': ['blurUp', 'slide', 'elastic', 'flip', 'zoomIn', 'slideUp', 'zoomOut', 'squeezeIn', 'spin3d', 'glowIn', 'slideDown'],
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
  /** 基准公式：round(min(9, max(3, 3 + gap * k))) */
  k: 0.375,
  /** 结果上限 */
  maxFrames: 9,
  /** 结果下限 */
  minFrames: 3,
  /** 截距 */
  intercept: 3,
} as const;

/** 动态退场时长（帧）映射函数参数 */
export const EXIT_FRAMES = {
  gapMin: 4,
  k: 0.25,
  maxFrames: 6,
  minFrames: 3,
  intercept: 2,
} as const;

/**
 * 常驻律动参数 —— 消灭「入场播完到退场开始之间」的冻帧。
 *
 * 【为什么需要这一层】
 * 入场动画结束后 enterRaw 被 clamp 到 1，退场又要等到组末尾才开始，
 * 中间这段时间画面逐帧完全相同。组跨度最长可达数秒，静止占比可以到 80%+，
 * 观感就是「视频播到一半就没动画了」。
 *
 * 这一层让任何时刻画面都在动，由四个互不相关的分量叠加：
 *   1. beatPunch  —— 随鼓点瞬时弹跳（有 beats 数据时）
 *   2. breathe    —— 自呼吸正弦（没有 beats 数据时的兜底生命感）
 *   3. creep      —— Ken-Burns 慢推，长镜头也在持续变化
 *   4. drift      —— X/Y 异频慢漂，避免线性平移的机械感
 */
export const IDLE_MOTION = {
  /** 节拍能量衰减系数，越小余韵越长 */
  beatDecay: 2.2,
  /**
   * 鼓点瞬时弹跳幅度（缩放比例增量）。
   * 从 0.024 降到 0.012：稳态下它会与 breathe 同相叠加，
   * 实测旧值峰值可达 1.96% 缩放，观感偏抖；现在峰值约 1%。
   */
  beatPunch: 0.012,
  /** 自呼吸角频率（rad/s）。1.55 rad/s ≈ 4 秒一个呼吸周期 */
  breatheHz: 1.55,
  /**
   * 自呼吸幅度（缩放比例增量）。
   * 0.007 → 0.005：与 beatPunch 同相叠加时旧值会把稳态峰值推到 1.2%，
   * 仍偏抖。现在整体稳态缩放峰值控制在 1% 以内。
   */
  breatheAmp: 0.005,
  /** Ken-Burns 每秒推进比例 */
  creepPerSecond: 0.0065,
  /** Ken-Burns 累计上限，防止长驻组被推得过大 */
  creepMax: 0.05,
  /** 慢漂角频率（rad/s），X/Y 取不同值避免同相位；约 15s / 19s 一个周期 */
  driftXHz: 0.42,
  driftYHz: 0.33,
  /** 慢漂幅度（px） */
  driftXPx: 7,
  driftYPx: 9,
  /**
   * 长停留自适应增强。
   *
   * 【为什么保留但大幅调低】气泡稀疏时组停留可达 8~17 秒，完全不动会显得卡帧，
   * 所以仍让停得久的组略微多动一点。但旧值 1.7 倍会把呼吸和慢漂放大到
   * 明显可察觉的程度，叠加 beatPunch 与 reAccent 后整体观感就是「一直在抖」。
   * 现在压到 1.15，长镜头的额外运动只作为「不至于死板」的兜底，
   * 真正的节奏感交给入场动画和 restage（整组重新入场）来提供。
   */
  /** 超过这个停留秒数开始增强 */
  boostAfterS: 3,
  /** 增强到满档所需的额外秒数 */
  boostRampS: 9,
  /** 满档时的强度倍数（作用于呼吸幅度与慢漂幅度） */
  boostMaxMultiplier: 1.15,
} as const;

/**
 * 入场后沉降包络（settle envelope）。
 *
 * 【设计意图】动效节奏应该是「入场有冲击 → 沉下来让人看清内容 → 之后只做小幅度呼吸」，
 * 而不是从头到尾持续抖动。旧实现没有这一层，气泡一入场就立刻叠加
 * beatPunch / breathe / drift / reAccent 四层律动，且停留越久幅度越大。
 *
 * 包络输出一个 [0, maxMultiplier] 的幅度系数，作用于 beatPunch、breathe、drift：
 *   1. 入场后 stillS 秒内输出 0 —— 完全静止，视觉焦点留给内容本身
 *   2. 随后用 smoothstep 在 rampS 秒内平滑升到 maxMultiplier
 *   3. maxMultiplier < 1，保证稳态永远是「小幅度」而非原始幅度
 *
 * 注意 Ken-Burns（creep）不受包络约束：它是单调慢推，不产生抖动感，
 * 反而是长镜头里最安全的「画面仍在变化」的保证。
 */
export const SETTLE = {
  /** 入场后完全静止的时长（秒） */
  stillS: 1.5,
  /** 从静止平滑过渡到稳态小幅律动所需秒数 */
  rampS: 3.0,
  /** 稳态幅度系数上限，必须 < 1 才能保证「小幅度」 */
  maxMultiplier: 0.55,
} as const;

/**
 * 长驻气泡的二次脉冲（re-accent）参数。
 *
 * 【为什么大幅调弱】旧值在停留 1.5 秒后就让每个鼓点都触发 3% 缩放 + 0.85° 旋转。
 * 旋转在视觉上极其敏感，逐气泡交替方向后整屏就是持续的细密抖动 ——
 * 这是「一直在抖」最主要的来源。
 * 现在只在停留超过 5 秒（即真正的长镜头）后才启用，且幅度砍到原来的一半以下，
 * 定位从「维持节奏感」改为「避免长镜头彻底死掉」。
 */
export const RE_ACCENT = {
  /** 停留超过多少秒后启用二次脉冲 */
  afterSeconds: 5,
  /** 节拍能量衰减系数（比 idle 更陡，脉冲更短促） */
  beatDecay: 5.5,
  /** 脉冲缩放幅度 */
  scale: 0.014,
  /** 脉冲旋转幅度（度），相邻气泡方向相反 */
  rotate: 0.22,
} as const;

// ============================================================
// 3. 动画强度 / 幅度参数
// ============================================================

/**
 * 能量映射：amp = energyOffset + energy * energyK
 *
 * 区间从旧的 0.75~1.25 加宽到 0.62~1.57：旧区间几乎恒定，
 * 位移/旋转幅度看不出能量差异，鼓点再密动作也一个样。
 */
export const ENERGY_MAP = {
  offset: 0.62,
  k: 0.95,
} as const;

/** 透明度衰减速：fade = power2Out(min(t * fadeSpeed, 1)) */
export const FADE_SPEED = 2.5;

/** 各变体的具体数值参数 */
export const VARIANT_PARAMS = {
  pop: {
    scaleFrom: 0.3,
    backOvershoot: 0.5,
  },
  slide: {
    distanceX: 107, // px (160 * 720/1080)
    scaleFrom: 0.94,
  },
  flip: {
    rotateY: 72, // deg
    scaleFrom: 0.9,
    backOvershoot: 1.02,
  },
  blurUp: {
    distanceY: 47, // px (70 * 720/1080)
    blurMax: 14, // px
    blurSpeed: 1.6,
  },
  elastic: {
    distanceY: -60, // px (-90 * 720/1080)
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
    distanceY: 133, // px (200 * 720/1080), 从底部进入
    blurMax: 10, // px
  },
  bounce: {
    distanceY: -147, // px (-220 * 720/1080), 从上方弹跳下落
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
  slideDown: {
    distanceY: -133, // px (-200 * 720/1080), 从上方滑入
    scaleFrom: 0.88,
    blurMax: 8, // px
  },
  scaleX: {
    scaleXFrom: 0.35, // X 轴挤压起步，弹性释放
    backOvershoot: 0.45,
  },
  dropIn: {
    distanceY: -200, // px (-300 * 720/1080), 从高处坠落
    scaleFrom: 0.5,
  },
  glowIn: {
    scaleFrom: 0.7,
    glowMax: 22, // 光晕强度
  },
  spin3d: {
    rotateX: 45, // deg
    rotateY: 30, // deg
    scaleFrom: 0.35,
    perspective: 700,
  },
  paperFlip: {
    rotateY: 90, // deg, 从 Y 轴 90° 翻到 0°
    scaleFrom: 0.75,
    backOvershoot: 1.03,
  },
  squeezeIn: {
    scaleYFrom: 0.3, // Y 轴压扁→弹开
    backOvershoot: 0.5,
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

// ============================================================
// 退出动画变体 — 丰富退场表现力
// ============================================================

/**
 * 退出动画变体名
 * - flash:    现有快闪缩放 (scale 冲高→归零)
 * - zoomOut:  镜头拉远 (perspective + scale 1→0.15，推拉镜头感)
 * - slideLeft:   向左飞出屏幕边缘
 * - slideRight:  向右飞出屏幕边缘
 * - slideUp:     向上飘出屏幕
 * - slideDown:   向下坠落出屏幕
 * - spin:    旋转 + 缩小 + 淡出
 * - flip3d:  三维翻转退场
 * - blurOut: 重度模糊 + 淡出（溶解感）
 */
export type ExitVariant =
  | 'flash'
  | 'zoomOut'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'spin'
  | 'flip3d'
  | 'blurOut';

/** 普通组退出动画轮换池（按组序号抽选） */
export const EXIT_VARIANT_CYCLE: ExitVariant[] = [
  'flash',
  'zoomOut',
  'slideLeft',
  'spin',
  'blurOut',
  'flip3d',
  'slideRight',
  'zoomOut',
  'slideUp',
  'flash',
  'slideDown',
  'spin',
];

/** Hero 组退出动画池（更炸裂的退场） */
export const HERO_EXIT_VARIANT_POOL: ExitVariant[] = [
  'zoomOut',   // 镜头猛拉远
  'flip3d',    // 3D 翻转
  'spin',      // 旋转飞走
  'flash',     // 快闪
];

/** 各退出变体的参数 */
export const EXIT_VARIANT_PARAMS = {
  flash: {
    peakRatio: 0.35,
    peakScale: 1.18,
    fadeHalfPoint: 0.4,
  },
  zoomOut: {
    /** 最终缩放目标（越小=拉得越远） */
    scaleTo: 0.15,
    /** 透视距离 */
    perspective: 800,
  },
  slideLeft: {
    /** X 轴飞出距离（canvas 宽度倍数） */
    distanceX: 1.5,
    /** 是否同时缩小 */
    scaleDecay: 0.15,
  },
  slideRight: {
    distanceX: 1.5,
    scaleDecay: 0.15,
  },
  slideUp: {
    distanceY: 1.5,
    scaleDecay: 0.1,
  },
  slideDown: {
    distanceY: 1.5,
    scaleDecay: 0.1,
  },
  spin: {
    /** 旋转角度 */
    rotateZ: 35,
    /** 最终缩放 */
    scaleTo: 0,
  },
  flip3d: {
    /** 绕 Y 轴旋转角度 */
    rotateY: 85,
    /** 透视距离 */
    perspective: 600,
    /** 最终缩放 */
    scaleTo: 0.3,
  },
  blurOut: {
    /** 最大模糊像素 */
    blurMax: 24,
    /** 最终缩放 */
    scaleTo: 0.85,
  },
} as const;

/** Hero 退出变体参数（可覆盖普通版，更猛） */
export const HERO_EXIT_VARIANT_PARAMS = {
  zoomOut: {
    scaleTo: 0.08,
    perspective: 600,
  },
  flip3d: {
    rotateY: 120,
    perspective: 500,
    scaleTo: 0,
  },
  spin: {
    rotateZ: 60,
    scaleTo: 0,
  },
  flash: {
    peakRatio: 0.3,
    peakScale: 1.25,
    fadeHalfPoint: 0.35,
  },
} as const;

/** 节拍脉冲衰减速度 */
export const BEAT_DECAY = 6;

/**
 * 节拍能量的 attack（起振）时长，单位秒。
 *
 * 【为什么必须有这一层】
 * `beatEnergy` 原本是纯衰减函数：`exp(-dt × decay)`。在 `frame === beat`
 * 那一帧 `dt = 0`，能量从上一拍衰减剩下的残值（通常 0.1~0.3）**瞬间跳回 1.0**，
 * 下一帧才开始平滑衰减。也就是说每个鼓点处能量曲线都有一个数学上的**阶跃**。
 *
 * 这个阶跃会同时传导到三处：
 *   - IDLE_MOTION.beatPunch  → 整组舞台缩放一帧突变
 *   - RE_ACCENT.scale/rotate → 逐条气泡缩放 + 旋转一帧突变
 *   - ENERGY_MAP             → 入场动画位移/旋转幅度一帧突变
 * 观感就是「入场后时不时抖一下」——注意是「抖」（位置瞬移）而不是「弹」（有起振过程）。
 * 真实数据的 beats 来自 Suno 词级时间戳（约 0.2~0.4 秒一个），所以是持续性的间歇抖动。
 *
 * 这不是幅度问题，调小 beatPunch / RE_ACCENT.scale 只能让抖动变小、不能消除，
 * 因为阶跃的**存在性**与幅度无关。必须给能量曲线一个上升段，
 * 让每个鼓点变成「起振 → 达峰 → 衰减」的完整包络。
 *
 * 0.05s @30fps ≈ 1.5 帧。取值权衡：
 *   - 太短（<1 帧）等于没有 attack，阶跃依旧
 *   - 太长会吃掉打击感，鼓点变成绵软的推拉，且相邻密集鼓点会互相吞掉
 *
 * 【实测效果】稳态期（入场沉降结束后）气泡角点的单帧位移：
 *   attack=0（改前）→ 峰值 4.47px/帧，峰均比 4.0
 *   attack=0.05     → 峰值 2.25px/帧，峰均比 2.5
 *   attack=0.15     → 峰值 1.88px/帧，峰均比 2.2（收益已明显衰减）
 * 「峰均比」是抖动感的直接量化：均值代表整体运动量，峰值代表突跳，
 * 比值越接近 1 越像连续运动、越大越像间歇抽动。
 *
 * ⚠️ 注意 attack 只能消除**阶跃**，消不掉**幅度**。实测把 RE_ACCENT 整层关掉
 *    可让峰值进一步降到 0.73px/帧 —— 剩余抖动的主导项是 reAccent 的
 *    缩放 + 反向旋转，那属于幅度取舍，需要单独决定是否保留该层。
 */
export const BEAT_ATTACK_S = 0.05;

// ============================================================
// Hero 高潮组合动画 — 多动画叠加，炸屏更猛
// ============================================================

/** Hero 组合动画：每个 combo 包含 2-3 个变体名，同时叠加执行 */
export type HeroCombo = EnterVariant[];

export const HERO_COMBO_POOL: HeroCombo[] = [
  ['flyIn', 'flash'],
  ['tumble3d', 'warp'],
  ['flyIn', 'warp', 'flash'],
  ['tumble3d', 'flash'],
  ['warp', 'flyIn'],
  ['flyIn', 'tumble3d', 'flash'],
  ['flyIn', 'warp'],
  ['tumble3d', 'flyIn', 'warp'],
];

// ============================================================
// 4. 布局与组参数
// ============================================================

/** 每屏幕最大气泡数 */
export const MAX_PER_GROUP = 4;

/** 组内最大跨度（秒） */
export const GROUP_MAX_SPAN_S = 8;

/** 组间最大间隔（秒） */
export const GROUP_MAX_GAP_S = 3.5;

/** 每组场景缩放范围（伪随机取值，切换组时产生推拉镜头感） */
export const GROUP_SCALE_RANGE = { min: 0.82, max: 0.95 } as const;

/**
 * 舞台安全区占比 —— 气泡容器视觉宽度的**硬上限**。
 *
 * 约束：容器在任何时刻的实际宽度 ≤ CANVAS_WIDTH × 此值。
 * 0.90 表示左右各留 5% 留白（720px 画布 → 容器最宽 648px，两侧各 36px）。
 *
 * 【为什么原来会溢出】
 * 舞台缩放是多层相乘的结果，旧实现只有一个
 * `fitScale = min(1, CANVAS_WIDTH * 0.98 / CONTAINER_WIDTH)` 作为独立因子。
 * 它只保证「容器本身不比画布宽」，完全没有约束后面还要乘上来的：
 *   sceneScale(0.82~0.95) × idle.scale(呼吸 × 鼓点 × Ken-Burns 慢推 ≤1.062)
 *   × Hero 的 1.18 倍加成 × reAccent 二次脉冲(≤1.014)
 * 实测 CONTAINER_WIDTH = 948px、画布 720px：
 *   - 普通组峰值宽度 721px（100.2% 画布，已经贴边溢出）
 *   - Hero 组峰值宽度 851px（118.2% 画布，两边直接被切掉）
 * 所以必须按「峰值宽度」反推缩放，而不是给每一层单独限幅。
 */
export const STAGE_SAFE_AREA_RATIO = 0.9;

/**
 * 普通对话组的目标峰值宽度占比（含全部动态律动后的最大宽度）。
 * 0.88 → 实测峰值 631px，单侧留白 6.2%。比 Hero 略小，保留体量区分度。
 */
export const NORMAL_PEAK_WIDTH_RATIO = 0.88;

/**
 * Hero 独占组的目标峰值宽度占比 —— 吃满安全区，Hero 就该是全片最大那一档。
 * 0.90 → 实测峰值 646px，单侧留白 5.2%，刚好满足「至少 5% 留白」。
 *
 * ⚠️ 不得大于 STAGE_SAFE_AREA_RATIO。
 */
export const HERO_PEAK_WIDTH_RATIO = 0.9;

/**
 * 动态缩放预留余量 —— 留给「入场结束之后仍会继续变化」的那几层。
 *
 * 静态基准缩放先除掉这个系数，让动态分量把尺寸推到峰值时刚好落在目标宽度上。
 * 若不预留而只靠末端硬钳，Ken-Burns 慢推会一路顶到上限然后被钳死，
 * 缩放曲线出现平台，观感是「画面推着推着突然不动了」。
 *
 * 取值依据（IDLE_MOTION / RE_ACCENT 的峰值相乘）：
 *   breathe(1 + 0.005 × 0.55 × 1.15 ≈ 1.003)
 *   × beatPunch(1 + 0.012 × 0.55 × 1.15 ≈ 1.008)
 *   × creep(1 + creepMax = 1.05)
 *   × reAccent(1 + 0.014 = 1.014)
 *   ≈ 1.077 → 取 1.08 留一点富余。
 *
 * ⚠️ 调大 IDLE_MOTION.creepMax / beatPunch / breatheAmp 或 RE_ACCENT.scale 时，
 *    必须同步复核这个值，否则末端硬钳会开始生效（缩放出现平台）。
 */
export const STAGE_DYNAMIC_HEADROOM = 1.08;

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

export const CANVAS_WIDTH = 720;
export const CANVAS_HEIGHT = 960;

const IPHONE_LOGICAL_WIDTH = 375;
const ZOOM = 1.35;

export const PX_PER_PT = (CANVAS_WIDTH / IPHONE_LOGICAL_WIDTH) * ZOOM;

/** pt → px */
export const pt = (v: number): number => Math.round(v * PX_PER_PT);

export const FONT_FAMILY =
  "'PingFang SC', 'PingFang HK', 'PingFang TC', -apple-system, BlinkMacSystemFont, " +
  "'Noto Sans CJK SC', 'Source Han Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export const WX_COLORS = {
  canvas: '#222222',
  bubbleSelf: '#95EC69',
  bubbleOther: '#F3F3F3',
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
  edgeX: pt(28),
  rowGap: pt(14),
  bubbleRadius: pt(5),
  bubblePadV: pt(9.5),
  bubblePadH: pt(12),
  bubbleMaxWidth: pt(230),
  bubbleMinWidth: pt(22),
  tailW: pt(6),
  tailH: pt(11),
  tailTop: pt(15),
  bodySize: pt(17),
  timeSize: pt(12),
  imageSide: pt(120),
  imageRadius: pt(5),
  payCardWidth: pt(190),
} as const;

/**
 * 单条气泡容器固定宽度（scale=1时的默认宽度，单位px）。
 * 计算方式：avatar + avatarGap + bubbleMaxWidth + 近头像侧padding + 远头像侧padding
 * 远头像侧padding沿用 chatBg 旧规则：(avatar + avatarGap + nearPad) × 1.2
 * CONTAINER_NEAR_PAD 需与 ChatBubble.containerStyle 的 paddingLeft/Right 保持一致。
 */
export const CONTAINER_NEAR_PAD = 30;
export const CONTAINER_WIDTH =
  WX_SIZES.avatar +
  WX_SIZES.avatarGap +
  WX_SIZES.bubbleMaxWidth +
  CONTAINER_NEAR_PAD +
  Math.round((WX_SIZES.avatar + WX_SIZES.avatarGap + CONTAINER_NEAR_PAD) * 1.2);

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
  idleMotion: typeof IDLE_MOTION;
  reAccent: typeof RE_ACCENT;
  energyMap: typeof ENERGY_MAP;
  fadeSpeed: number;
  variantParams: Record<string, Record<string, number>>;
  heroVariantParams: Record<string, Record<string, number>>;
  exitParams: typeof EXIT_PARAMS;
  heroExitParams: typeof HERO_EXIT_PARAMS;
  flashExitParams: typeof FLASH_EXIT_PARAMS;
  exitVariantCycle: string[];
  heroExitVariantPool: string[];
  exitVariantParams: Record<string, Record<string, number>>;
  heroExitVariantParams: Record<string, Record<string, number>>;
  beatDecay: number;
  maxPerGroup: number;
  groupMaxSpanS: number;
  groupMaxGapS: number;
  heroMinRatio: number;
  forceHeroEvery: number;
  heroScale: typeof HERO_SCALE;
  flashAmount: typeof FLASH_AMOUNT;
  heroComboPool: string[][];
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
    idleMotion: { ...IDLE_MOTION },
    reAccent: { ...RE_ACCENT },
    energyMap: { ...ENERGY_MAP },
    fadeSpeed: FADE_SPEED,
    variantParams: JSON.parse(JSON.stringify(VARIANT_PARAMS)),
    heroVariantParams: JSON.parse(JSON.stringify(HERO_VARIANT_PARAMS)),
    exitParams: { ...EXIT_PARAMS },
    heroExitParams: { ...HERO_EXIT_PARAMS },
    flashExitParams: { ...FLASH_EXIT_PARAMS },
    exitVariantCycle: [...EXIT_VARIANT_CYCLE],
    heroExitVariantPool: [...HERO_EXIT_VARIANT_POOL],
    exitVariantParams: JSON.parse(JSON.stringify(EXIT_VARIANT_PARAMS)),
    heroExitVariantParams: JSON.parse(JSON.stringify(HERO_EXIT_VARIANT_PARAMS)),
    beatDecay: BEAT_DECAY,
    maxPerGroup: MAX_PER_GROUP,
    groupMaxSpanS: GROUP_MAX_SPAN_S,
    groupMaxGapS: GROUP_MAX_GAP_S,
    heroMinRatio: HERO_MIN_RATIO,
    forceHeroEvery: FORCE_HERO_EVERY,
    heroScale: { ...HERO_SCALE },
    flashAmount: { ...FLASH_AMOUNT },
    heroComboPool: HERO_COMBO_POOL.map((c) => [...c]),
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

// ============================================================
// 9. 品牌片尾
// ============================================================

/**
 * 品牌片尾：一张已包含 logo + slogan 的成品图，居中渐现。
 *
 * 【时间线】气泡全部退场之后，再追加 tailS 秒片尾：
 *   内容段 [0, contentEnd)                       —— 气泡动画，最后一组在此退场消失
 *   片尾段 [contentEnd, contentEnd + tailS×fps)  —— 前 fadeInS 秒渐现，之后保持到结束
 *
 * 视频总时长 = ceil(audioDuration × fps) + round(tailS × fps)。
 * 片尾段内音频已播完（静音），故音频淡出锚点必须仍是内容段结束帧。
 *
 * 素材自带透明通道，在深色画布上直接融合，无需额外背板/圆角处理。
 */
export const BRAND = {
  /** 片尾总时长（秒） */
  tailS: 2.0,
  /** 片尾素材渐现时长（秒） */
  fadeInS: 0.3,
  /** 片尾素材路径（相对 public/） */
  endingFile: 'brand/ending.png',
  /**
   * 素材导出倍率：设计稿按 2x 导出（实际 824×756），
   * 渲染时缩放到 1/2（412×378）显示，保证清晰不发虚。
   */
  assetScale: 2,
  /** 素材在 1x 下的显示尺寸（= 824/2 × 756/2） */
  endingWidth: 412,
  endingHeight: 378,
} as const;
