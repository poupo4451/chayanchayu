import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  // 动画变体池
  VARIANT_CYCLE,
  GENRE_VARIANT_POOLS,
  HERO_VARIANT_POOL,
  HERO_COMBO_POOL,
  type EnterVariant,
  type HeroCombo,
  // 退出变体
  EXIT_VARIANT_CYCLE,
  HERO_EXIT_VARIANT_POOL,
  EXIT_VARIANT_PARAMS,
  HERO_EXIT_VARIANT_PARAMS,
  type ExitVariant,
  // 时序参数
  ENTER_FRAMES,
  EXIT_FRAMES,
  // 能量映射
  ENERGY_MAP,
  FADE_SPEED,
  // 变体数值参数
  VARIANT_PARAMS,
  HERO_VARIANT_PARAMS,
  // 退出参数
  EXIT_PARAMS,
  HERO_EXIT_PARAMS,
  FLASH_EXIT_PARAMS,
  // 节拍衰减
  BEAT_DECAY,
} from './animation-config';

// ─────────────────────────────────────────────────────────────────
// 重新导出类型和池，向后兼容
// ─────────────────────────────────────────────────────────────────
export type { EnterVariant, ExitVariant, HeroCombo };
export { VARIANT_CYCLE, GENRE_VARIANT_POOLS, HERO_VARIANT_POOL, HERO_COMBO_POOL, EXIT_VARIANT_CYCLE, HERO_EXIT_VARIANT_POOL };

/**
 * GSAP 风格动效引擎（纯函数，无运行时依赖）
 * =====================================================================
 * Remotion 是「每帧独立纯渲染」，不能直接跑 GSAP 的时间线（它依赖 rAF 与
 * 可变状态）。所以这里把 gsap.com 里 EasePack / CustomEase 的**数学定义**
 * 移植成纯函数 `(t: 0..1) => number`，再由 Remotion 按帧求值。
 *
 * 效果与 gsap.to(el, {ease: 'back.out(1.7)'}) 完全一致，但可被逐帧回放、
 * 可被 seek、渲染结果确定性可复现。
 *
 * 提供两层：
 *   1. Ease   —— 缓动曲线（power / back / elastic / expo / circ / bounce）
 *   2. ENTER_VARIANTS —— 用这些曲线组合出的气泡入场动画预设
 *
 * 所有动画参数从 animation-config.ts 统一读取，通过 dev-preview 可实时调参。
 */

export type EaseFn = (t: number) => number;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * 伪弹性工具函数
 * 用于模拟 GSAP back/elastic/overshoot 效果的纯函数
 */
export const PseudoElastic = {
  /**
   * X 轴弹性挤压：从 `from` 出发 → 1.0，再按 overshoot 过冲到 >1
   * 效果等同于 gsap 的 backOut 对 scaleX
   */
  scaleXPress: (p: number, from: number, overshoot: number): number => {
    const c1 = overshoot + 1;
    const c3 = c1 + 1;
    const v = (1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2));
    return from + (1 - from) * v;
  },

  /**
   * 角度的弹性 settle：从 from 出发 → 0，带过冲（会短暂超过 0）
   * 效果等同于 gsap 的 backOut 对 rotate
   */
  angleSettle: (p: number, from: number, overshoot: number): number => {
    const c1 = overshoot + 1;
    const c3 = c1 + 1;
    const v = (1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2));
    return from * (1 - v);
  },
};

/** GSAP EasePack 移植 */
export const Ease = {
  linear: (t: number) => clamp01(t),

  // power1..4 = quad / cubic / quart / quint
  power1Out: (t: number) => 1 - Math.pow(1 - clamp01(t), 2),
  power2Out: (t: number) => 1 - Math.pow(1 - clamp01(t), 3),
  power3Out: (t: number) => 1 - Math.pow(1 - clamp01(t), 4),
  power4Out: (t: number) => 1 - Math.pow(1 - clamp01(t), 5),
  power2In: (t: number) => Math.pow(clamp01(t), 3),
  power2InOut: (t: number) => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },

  /** expo.out —— GSAP 里冲得最猛、收得最快的曲线 */
  expoOut: (t: number) => {
    const x = clamp01(t);
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  },

  circOut: (t: number) => Math.sqrt(1 - Math.pow(clamp01(t) - 1, 2)),

  /** back.out(overshoot) —— 冲过头再回弹 */
  backOut:
    (overshoot = 1.70158): EaseFn =>
    (t: number) => {
      const x = clamp01(t) - 1;
      const c = overshoot + 1;
      return 1 + c * x * x * x + overshoot * x * x;
    },

  /** elastic.out(amplitude, period) —— 橡皮筋来回衰减 */
  elasticOut:
    (amplitude = 1, period = 0.3): EaseFn =>
    (t: number) => {
      const x = clamp01(t);
      if (x === 0 || x === 1) return x;
      const a = Math.max(amplitude, 1);
      const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
      return a * Math.pow(2, -10 * x) * Math.sin(((x - s) * (2 * Math.PI)) / period) + 1;
    },

  /** bounce.out —— 落地弹跳 */
  bounceOut: (t: number) => {
    let x = clamp01(t);
    const n1 = 7.5625;
    const d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  },
};

/** gsap.utils.interpolate 的等价物 */
export const lerp = (from: number, to: number, p: number): number => from + (to - from) * p;

// ── 气泡入场动画预设 ────────────────────────────────────────────────

export interface MotionState {
  opacity: number;
  transform: string;
  filter?: string;
  transformOrigin?: string;
  /** 打字机变体用裁切模拟文字逐字浮现，不用位移/透明度 */
  clipPath?: string;
}

/** 按气泡序号轮换动画，同一组内相邻两条不会重样 */
export function pickVariant(seed: number): EnterVariant {
  const i = ((seed % VARIANT_CYCLE.length) + VARIANT_CYCLE.length) % VARIANT_CYCLE.length;
  return VARIANT_CYCLE[i];
}

/** 按流派挑选动画池后再按 seed 轮换；未知流派回退到默认池 */
export function pickVariantForGenre(seed: number, genre?: string): EnterVariant {
  const pool = (genre && GENRE_VARIANT_POOLS[genre]) || VARIANT_CYCLE;
  const i = ((seed % pool.length) + pool.length) % pool.length;
  return pool[i];
}

/** Hero 独占时刻专用动画池 */
export function pickHeroVariant(seed: number): EnterVariant {
  const i =
    ((seed % HERO_VARIANT_POOL.length) + HERO_VARIANT_POOL.length) % HERO_VARIANT_POOL.length;
  return HERO_VARIANT_POOL[i];
}

// ── Hero 组合动画 ────────────────────────────────────────────

/** 按组序号抽取 Hero Combo（2-3 个变体同时叠加） */
export function pickHeroCombo(seed: number): HeroCombo {
  const i = ((seed % HERO_COMBO_POOL.length) + HERO_COMBO_POOL.length) % HERO_COMBO_POOL.length;
  return [...HERO_COMBO_POOL[i]];
}

/**
 * Hero 组合入场动画：将 2-3 个变体的 transform 同时叠加
 * 每个变体独立计算其 transform/filter，最后合并：
 * - opacity 取乘积（符合多层半透明叠加的直觉）
 * - transform 用空格拼接（CSS transform 支持多值空格分隔叠加）
 * - filter 用空格拼接（多个 filter 函数叠加）
 */
export function comboEnterMotion(
  variants: HeroCombo,
  raw: number,
  side: 'left' | 'right' = 'right',
): MotionState {
  let opacity = 1;
  const transforms: string[] = [];
  const filters: string[] = [];

  for (const v of variants) {
    const m = enterMotion(v, raw, side);
    opacity *= m.opacity;
    if (m.transform) transforms.push(m.transform);
    if (m.filter) filters.push(m.filter);
  }

  const result: MotionState = { opacity, transform: 'none' };
  if (transforms.length > 0) result.transform = transforms.join(' ');
  if (filters.length > 0) result.filter = filters.join(' ');

  return result;
}

// ── 退出动画变体选择 ──────────────────────────────────────────────

/** 按组序号轮换退出动画，组间错开不单调 */
export function pickExitVariant(seed: number): ExitVariant {
  const i = ((seed % EXIT_VARIANT_CYCLE.length) + EXIT_VARIANT_CYCLE.length) % EXIT_VARIANT_CYCLE.length;
  return EXIT_VARIANT_CYCLE[i];
}

/** Hero 退出动画池 */
export function pickHeroExitVariant(seed: number): ExitVariant {
  const i = ((seed % HERO_EXIT_VARIANT_POOL.length) + HERO_EXIT_VARIANT_POOL.length) % HERO_EXIT_VARIANT_POOL.length;
  return HERO_EXIT_VARIANT_POOL[i];
}

// ── 缓动函数实例（从配置读取参数） ────────────────────────────────────

const backSoft = Ease.backOut(VARIANT_PARAMS.flip.backOvershoot);
const backHard = Ease.backOut(VARIANT_PARAMS.swing.backOvershoot);
const elastic = Ease.elasticOut(
  VARIANT_PARAMS.elastic.elasticAmplitude,
  VARIANT_PARAMS.elastic.elasticPeriod,
);

/**
 * 计算入场瞬时状态。
 * @param variant 动画预设
 * @param raw     线性进度 0..1（= (frame - startFrame) / duration）
 * @param side    'left' = 对方气泡（从左侧进），'right' = 自己气泡（从右侧进）
 * @param energy  节奏强度 0..1，越大位移/旋转幅度越夸张（由音乐节拍驱动）
 */
export function enterMotion(
  variant: EnterVariant,
  raw: number,
  side: 'left' | 'right',
  energy = 0.5,
): MotionState {
  const t = clamp01(raw);
  const dir = side === 'right' ? 1 : -1;
  const origin = side === 'right' ? 'right top' : 'left top';
  const amp = ENERGY_MAP.offset + energy * ENERGY_MAP.k;
  const fade = Ease.power2Out(Math.min(t * FADE_SPEED, 1));

  switch (variant) {
    case 'pop': {
      const p = backHard(t);
      const scale = lerp(VARIANT_PARAMS.pop.scaleFrom, 1, p);
      return { opacity: fade, transform: `scale(${scale.toFixed(4)})`, transformOrigin: origin };
    }

    case 'slide': {
      const p = Ease.expoOut(t);
      const x = lerp(dir * VARIANT_PARAMS.slide.distanceX * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.slide.scaleFrom, 1, backSoft(t));
      return {
        opacity: fade,
        transform: `translate3d(${x.toFixed(2)}px,0,0) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'flip': {
      const p = backSoft(t);
      const ry = lerp(dir * -VARIANT_PARAMS.flip.rotateY * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.flip.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `perspective(1400px) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'blurUp': {
      const p = Ease.power3Out(t);
      const y = lerp(VARIANT_PARAMS.blurUp.distanceY * amp, 0, p);
      const blur = lerp(VARIANT_PARAMS.blurUp.blurMax, 0, Ease.power2Out(Math.min(t * VARIANT_PARAMS.blurUp.blurSpeed, 1)));
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0)`,
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
        transformOrigin: origin,
      };
    }

    case 'elastic': {
      const rawP = elastic(t);
      // 压缩过冲：elasticOut 峰值约 1.12，超过 1 的部分压到 10%
      const p = rawP > 1 ? 1 + (rawP - 1) * 0.1 : rawP;
      const y = lerp(VARIANT_PARAMS.elastic.distanceY * amp, 0, p);
      const scaleY = lerp(VARIANT_PARAMS.elastic.scaleYFrom, 1, Ease.power2Out(Math.min(t * VARIANT_PARAMS.elastic.scaleSpeed, 1)));
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scaleY(${scaleY.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'swing': {
      const p = backHard(t);
      const rot = lerp(dir * -VARIANT_PARAMS.swing.rotateDeg * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.swing.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'typewriter': {
      // 打字机浮现：不用位移/透明度过渡，直接用裁切模拟文字逐字露出
      const p = Ease.linear(t);
      const reveal = (1 - p) * 100;
      return {
        opacity: 1,
        transform: 'none',
        clipPath: `inset(0 ${reveal.toFixed(2)}% 0 0)`,
        transformOrigin: origin,
      };
    }

    case 'shake': {
      // 冲进来 + 几次快速衰减的左右震动，平方衰减让后段尽快收敛
      const p = backHard(t);
      const scale = lerp(VARIANT_PARAMS.shake.scaleFrom, 1, p);
      const decay = (1 - t) * (1 - t);
      const wiggle = Math.sin(t * Math.PI * VARIANT_PARAMS.shake.oscillationPeriods) * decay * VARIANT_PARAMS.shake.wiggleAmplitude * amp;
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)}) rotate(${wiggle.toFixed(2)}deg)`,
        transformOrigin: origin,
      };
    }

    case 'shine': {
      // 入场瞬间扫光闪烁 + 轻微缩放
      const p = Ease.power2Out(t);
      const scale = lerp(VARIANT_PARAMS.shine.scaleFrom, 1, p);
      const flash = Math.sin(Math.min(t, 1) * Math.PI);
      const glow = flash * VARIANT_PARAMS.shine.glowMax;
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)})`,
        filter: glow > 0.5 ? `drop-shadow(0 0 ${glow.toFixed(1)}px rgba(255,255,255,0.55))` : undefined,
        transformOrigin: origin,
      };
    }

    case 'zoomIn':
    default: {
      // gsap.from({scale: 1.32, ease: 'circ.out'}) —— 从外向内压进来
      const p = Ease.circOut(t);
      const scale = lerp(VARIANT_PARAMS.zoomIn.scaleFrom, 1, p);
      return { opacity: fade, transform: `scale(${scale.toFixed(4)})`, transformOrigin: origin };
    }

    // ═══════ 方向多样化新变体 ═══════════════════════════════════════════

    case 'slideUp': {
      // 从屏幕下方滑入，带初始模糊
      const p = Ease.power3Out(t);
      const y = lerp(VARIANT_PARAMS.slideUp.distanceY * amp, 0, p);
      const blur = lerp(VARIANT_PARAMS.slideUp.blurMax, 0, Ease.power2Out(Math.min(t * 1.8, 1)));
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0)`,
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
        transformOrigin: 'center center',
      };
    }

    case 'bounce': {
      // 从上方弹跳下落，bounceOut 缓动模拟落地弹跳
      const p = Ease.bounceOut(t);
      const y = lerp(VARIANT_PARAMS.bounce.distanceY * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.bounce.scaleFrom, 1, Ease.power2Out(t));
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: 'center center',
      };
    }

    case 'zoomOut': {
      // 后→前：从极小（远）缩放到正常，perspective 增加深度感
      const p = Ease.expoOut(t);
      const scale = lerp(VARIANT_PARAMS.zoomOut.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `perspective(${VARIANT_PARAMS.zoomOut.perspective}px) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    case 'punchIn': {
      // 前→后：从极大（贴脸）压制到正常，expoOut 急停
      const p = Ease.expoOut(t);
      const scale = lerp(VARIANT_PARAMS.punchIn.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    case 'flipX': {
      // X 轴三维翻转：顶部翻开落下，backOut 轻微过冲增加弹性
      const p = backSoft(t);
      const rx = lerp(-VARIANT_PARAMS.flipX.rotateX * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.flipX.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `perspective(1400px) rotateX(${rx.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: 'center top',
      };
    }

    case 'spinZ': {
      // Z 轴旋转 > 一圈 + 缩放，power3Out 让旋转先快后慢
      const p = Ease.power3Out(t);
      const rot = lerp(VARIANT_PARAMS.spinZ.rotateZ * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.spinZ.scaleFrom, 1, backSoft(t));
      return {
        opacity: fade,
        transform: `rotateZ(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    // ── slideDown: 从屏幕上方滑入（power2.out + 模糊消散）────────────
    case 'slideDown': {
      const p = Ease.power2Out(t);
      const y = lerp(-VARIANT_PARAMS.slideDown.distanceY * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.slideDown.scaleFrom, 1, p);
      const blurPx = t < 0.6 ? lerp(VARIANT_PARAMS.slideDown.blurMax * amp, 0, p) : 0;
      const f = blurPx > 0.3 ? `blur(${blurPx.toFixed(2)}px)` : undefined;
      return {
        opacity: fade,
        filter: f,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── scaleX: X 轴横向挤压→弹性释放 ────────────────────────────
    case 'scaleX': {
      const p = backSoft(t);
      const sx = PseudoElastic.scaleXPress(p, VARIANT_PARAMS.scaleX.scaleXFrom, VARIANT_PARAMS.scaleX.backOvershoot);
      const scale = lerp(0.85, 1, p);
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)}) scaleX(${sx.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── dropIn: 上方坠落 + bounce 弹跳 settle ────────────────────
    case 'dropIn': {
      const p = Ease.power2Out(t);
      const y = lerp(-VARIANT_PARAMS.dropIn.distanceY * amp, 0, Ease.bounceOut(p));
      const scale = lerp(VARIANT_PARAMS.dropIn.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── glowIn: 光晕脉冲入场 ──────────────────────────────────────
    case 'glowIn': {
      const p = backSoft(t);
      const scale = lerp(VARIANT_PARAMS.glowIn.scaleFrom, 1, p);
      const glow = t < 0.7 ? lerp(VARIANT_PARAMS.glowIn.glowMax * amp, 0, Ease.power2Out(p)) : 0;
      const f = glow > 0.5
        ? `drop-shadow(0 0 ${glow.toFixed(1)}px rgba(255,255,255,0.7))`
        : undefined;
      return {
        opacity: fade,
        filter: f,
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── spin3d: X+Y 双轴立体旋转入场 ──────────────────────────────
    case 'spin3d': {
      const p = backHard(t);
      const rx = lerp(VARIANT_PARAMS.spin3d.rotateX * amp, 0, p);
      const ry = lerp(dir * VARIANT_PARAMS.spin3d.rotateY * amp, 0, p);
      const scale = lerp(VARIANT_PARAMS.spin3d.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform:
          `perspective(${VARIANT_PARAMS.spin3d.perspective}px) ` +
          `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) ` +
          `scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── paperFlip: 纸角翻转入场（Y 轴 90° → 0°）────────────────────
    case 'paperFlip': {
      const p = backSoft(t);
      const ry = PseudoElastic.angleSettle(
        p,
        VARIANT_PARAMS.paperFlip.rotateY,
        VARIANT_PARAMS.paperFlip.backOvershoot,
      );
      const scale = lerp(VARIANT_PARAMS.paperFlip.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── squeezeIn: Y 轴压扁→弹开释放 ───────────────────────────────
    case 'squeezeIn': {
      const p = backSoft(t);
      const sy = PseudoElastic.scaleXPress(
        p,
        VARIANT_PARAMS.squeezeIn.scaleYFrom,
        VARIANT_PARAMS.squeezeIn.backOvershoot,
      );
      const scale = lerp(0.9, 1, p);
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)}) scaleY(${sy.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ═══════ Hero 独占时刻专用变体（更猛更炸）══════════════════════════

    case 'flyIn': {
      // 从屏幕外真实坐标高速甩入，expo.out 急停
      const p = Ease.expoOut(t);
      const offX = lerp(dir * (CANVAS_WIDTH / 2 + HERO_VARIANT_PARAMS.flyIn.offsetExtraX), 0, p);
      const offY = lerp(-CANVAS_HEIGHT / 2 - HERO_VARIANT_PARAMS.flyIn.offsetExtraY, 0, p);
      const scale = lerp(HERO_VARIANT_PARAMS.flyIn.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `translate3d(${offX.toFixed(2)}px,${offY.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    case 'tumble3d': {
      // perspective + rotateX/Y/Z 复合旋转，从小到大立体翻滚
      const p = backHard(t);
      const rx = lerp(-HERO_VARIANT_PARAMS.tumble3d.rotateX * amp, 0, p);
      const ry = lerp(dir * -HERO_VARIANT_PARAMS.tumble3d.rotateY * amp, 0, p);
      const rz = lerp(HERO_VARIANT_PARAMS.tumble3d.rotateZ * amp, 0, p);
      const scale = lerp(HERO_VARIANT_PARAMS.tumble3d.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `perspective(${HERO_VARIANT_PARAMS.tumble3d.perspective}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    case 'warp': {
      // 入场瞬间 skew 按衰减正弦振荡
      const p = Ease.expoOut(t);
      const decay = 1 - p;
      const osc = Math.sin(t * Math.PI * HERO_VARIANT_PARAMS.warp.oscillationPeriods) * decay * HERO_VARIANT_PARAMS.warp.skewAmplitude * amp;
      const scale = lerp(HERO_VARIANT_PARAMS.warp.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `skew(${osc.toFixed(2)}deg,${(osc * 0.4).toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'flash': {
      // 爆缩放硬切入位
      const p = Ease.expoOut(t);
      const scale = lerp(HERO_VARIANT_PARAMS.flash.scaleFrom, 1, p);
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 退出动画变体 — 九种风格轮换，退场不再单调
// ═══════════════════════════════════════════════════════════════════

/**
 * 通用退出动画调度器
 * @param variant 退出变体名
 * @param raw     退场进度 0..1
 * @param side    'left'=对方气泡, 'right'=自己气泡（影响滑动方向）
 * @param w       画布宽（用于滑出屏幕边缘的距离计算）
 * @param h       画布高
 * @param isHero  是否为 Hero 组（用更猛参数）
 */
export function exitMotionVariant(
  variant: ExitVariant,
  raw: number,
  side: 'left' | 'right' = 'right',
  w: number = CANVAS_WIDTH,
  h: number = CANVAS_HEIGHT,
  isHero = false,
): MotionState {
  const t = clamp01(raw);

  // 选择参数集
  const heroKey = variant as keyof typeof HERO_EXIT_VARIANT_PARAMS;
  const baseKey = variant as keyof typeof EXIT_VARIANT_PARAMS;
  const hasHeroParams = isHero && (heroKey in HERO_EXIT_VARIANT_PARAMS);
  const base = EXIT_VARIANT_PARAMS[baseKey];

  switch (variant) {
    // ── flash: 快闪缩放 (现有逻辑) ──────────────────────────────
    case 'flash': {
      const params = hasHeroParams
        ? { ...FLASH_EXIT_PARAMS, ...HERO_EXIT_VARIANT_PARAMS.flash }
        : FLASH_EXIT_PARAMS;
      const peakRatio = params.peakRatio;
      const peakScale = params.peakScale;
      const halfPoint = params.fadeHalfPoint;
      const scale =
        t < peakRatio
          ? lerp(1, peakScale, t / peakRatio)
          : lerp(peakScale, 0, (t - peakRatio) / (1 - peakRatio));
      const opacity =
        t < halfPoint
          ? 1
          : 1 - Ease.power2In((t - halfPoint) / (1 - halfPoint));
      return { opacity, transform: `scale(${scale.toFixed(4)})` };
    }

    // ── zoomOut: 镜头拉远（perspective 推拉镜头感）────────────────
    case 'zoomOut': {
      const p = hasHeroParams
        ? { scaleTo: (HERO_EXIT_VARIANT_PARAMS.zoomOut as { scaleTo: number }).scaleTo, perspective: (HERO_EXIT_VARIANT_PARAMS.zoomOut as { perspective: number }).perspective }
        : { scaleTo: (base as typeof EXIT_VARIANT_PARAMS.zoomOut).scaleTo, perspective: (base as typeof EXIT_VARIANT_PARAMS.zoomOut).perspective };
      const scale = lerp(1, p.scaleTo, Ease.power2In(t));
      const opacity = 1 - Ease.power2In(t);
      return {
        opacity,
        transform: `perspective(${p.perspective}px) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── slideLeft: 向左飞出屏幕边缘 ─────────────────────────────
    case 'slideLeft': {
      const params = base as typeof EXIT_VARIANT_PARAMS.slideLeft;
      const dir = side === 'left' ? -1 : 1;
      const dist = dir * w * params.distanceX;
      const x = lerp(0, dist, Ease.power2In(t));
      const scale = 1 - params.scaleDecay * Ease.power2In(t);
      const opacity = 1 - Ease.power1Out(t);
      return {
        opacity,
        transform: `translate3d(${x.toFixed(2)}px,0,0) scale(${scale.toFixed(4)})`,
      };
    }

    // ── slideRight: 向右飞出屏幕边缘 ─────────────────────────────
    case 'slideRight': {
      const params = base as typeof EXIT_VARIANT_PARAMS.slideRight;
      const dir = side === 'left' ? -1 : 1;
      const dist = dir * w * params.distanceX;
      const x = lerp(0, dist, Ease.power2In(t));
      const scale = 1 - params.scaleDecay * Ease.power2In(t);
      const opacity = 1 - Ease.power1Out(t);
      return {
        opacity,
        transform: `translate3d(${x.toFixed(2)}px,0,0) scale(${scale.toFixed(4)})`,
      };
    }

    // ── slideUp: 向上飘出屏幕 ────────────────────────────────────
    case 'slideUp': {
      const params = base as typeof EXIT_VARIANT_PARAMS.slideUp;
      const y = lerp(0, -h * params.distanceY, Ease.power2In(t));
      const scale = 1 - params.scaleDecay * Ease.power2In(t);
      const opacity = 1 - Ease.power1Out(t);
      return {
        opacity,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── slideDown: 向下坠落出屏幕 ────────────────────────────────
    case 'slideDown': {
      const params = base as typeof EXIT_VARIANT_PARAMS.slideDown;
      const y = lerp(0, h * params.distanceY, Ease.power2In(t));
      const scale = 1 - params.scaleDecay * Ease.power2In(t);
      const opacity = 1 - Ease.power1Out(t);
      return {
        opacity,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── spin: 旋转 + 缩小 + 淡出 ─────────────────────────────────
    case 'spin': {
      const params = hasHeroParams
        ? { rotateZ: (HERO_EXIT_VARIANT_PARAMS.spin as { rotateZ: number }).rotateZ, scaleTo: (HERO_EXIT_VARIANT_PARAMS.spin as { scaleTo: number }).scaleTo }
        : { rotateZ: (base as typeof EXIT_VARIANT_PARAMS.spin).rotateZ, scaleTo: (base as typeof EXIT_VARIANT_PARAMS.spin).scaleTo };
      const p = Ease.power2In(t);
      const rot = lerp(0, params.rotateZ, p);
      const scale = lerp(1, params.scaleTo, p);
      const opacity = 1 - Ease.power2In(t);
      return {
        opacity,
        transform: `rotateZ(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── flip3d: Y 轴三维翻转退场 ─────────────────────────────────
    case 'flip3d': {
      const params = hasHeroParams
        ? { rotateY: (HERO_EXIT_VARIANT_PARAMS.flip3d as { rotateY: number }).rotateY, perspective: (HERO_EXIT_VARIANT_PARAMS.flip3d as { perspective: number }).perspective, scaleTo: (HERO_EXIT_VARIANT_PARAMS.flip3d as { scaleTo: number }).scaleTo }
        : { rotateY: (base as typeof EXIT_VARIANT_PARAMS.flip3d).rotateY, perspective: (base as typeof EXIT_VARIANT_PARAMS.flip3d).perspective, scaleTo: (base as typeof EXIT_VARIANT_PARAMS.flip3d).scaleTo };
      const p = Ease.power2In(t);
      const ry = lerp(0, params.rotateY, p);
      const scale = lerp(1, params.scaleTo, p);
      // 翻转过半时淡出
      const opacity = t < 0.5 ? 1 : 1 - Ease.power2In((t - 0.5) / 0.5);
      return {
        opacity,
        transform: `perspective(${params.perspective}px) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    // ── blurOut: 重度模糊 + 轻微缩小（溶解感）────────────────────
    case 'blurOut': {
      const params = base as typeof EXIT_VARIANT_PARAMS.blurOut;
      const p = Ease.power2In(t);
      const blur = lerp(0, params.blurMax, p);
      const scale = lerp(1, params.scaleTo, p);
      const opacity = 1 - Ease.power2In(t);
      return {
        opacity,
        transform: `scale(${scale.toFixed(4)})`,
        filter: t > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
        transformOrigin: '50% 50%',
      };
    }

    default:
      return { opacity: 0, transform: 'scale(0)' };
  }
}

/**
 * 旧版整组退场（保持向后兼容）：淡出 + 上移 + 模糊
 */
export function exitMotion(raw: number): MotionState {
  const t = clamp01(raw);
  const p = Ease.power2In(t);
  return {
    opacity: 1 - Ease.power1Out(t),
    transform: `translate3d(0,${(-EXIT_PARAMS.translateY * p).toFixed(2)}px,0) scale(${(1 - EXIT_PARAMS.scaleDecay * p).toFixed(4)})`,
    filter: t > EXIT_PARAMS.blurThreshold ? `blur(${(EXIT_PARAMS.blurMax * p).toFixed(2)}px)` : undefined,
  };
}

/**
 * Hero 退场（向后兼容）：scale 冲高再归零
 */
export function heroExitMotion(raw: number): MotionState {
  const t = clamp01(raw);
  const peakRatio = HERO_EXIT_PARAMS.peakRatio;
  const peakScale = HERO_EXIT_PARAMS.peakScale;
  const halfPoint = HERO_EXIT_PARAMS.fadeHalfPoint;
  const scale = t < peakRatio ? lerp(1, peakScale, t / peakRatio) : lerp(peakScale, 0, (t - peakRatio) / (1 - peakRatio));
  const opacity = t < halfPoint ? 1 : 1 - Ease.power2In((t - halfPoint) / (1 - halfPoint));
  return {
    opacity,
    transform: `scale(${scale.toFixed(4)})`,
  };
}

/**
 * 组内个体「快闪退场」（向后兼容）：scale 冲高再瞬间归零
 */
export function bubbleFlashExit(raw: number): MotionState {
  const t = clamp01(raw);
  const peakRatio = FLASH_EXIT_PARAMS.peakRatio;
  const peakScale = FLASH_EXIT_PARAMS.peakScale;
  const halfPoint = FLASH_EXIT_PARAMS.fadeHalfPoint;
  const scale = t < peakRatio ? lerp(1, peakScale, t / peakRatio) : lerp(peakScale, 0, (t - peakRatio) / (1 - peakRatio));
  const opacity = t < halfPoint ? 1 : 1 - Ease.power2In((t - halfPoint) / (1 - halfPoint));
  return { opacity, transform: `scale(${scale.toFixed(4)})` };
}

/**
 * 动态入场时长（帧）：按到下一条气泡的间隔算。
 * 句子密集（gap 小）→ 更快更炸；间隔长 → 给足动作做完整的时间。
 */
export function dynamicEnterFrames(gapFrames: number): number {
  const g = Math.max(ENTER_FRAMES.gapMin, gapFrames);
  return Math.round(
    Math.min(
      ENTER_FRAMES.maxFrames,
      Math.max(ENTER_FRAMES.minFrames, ENTER_FRAMES.intercept + g * ENTER_FRAMES.k),
    ),
  );
}

/** 动态退场时长（帧） */
export function dynamicExitFrames(gapFrames: number): number {
  const g = Math.max(EXIT_FRAMES.gapMin, gapFrames);
  return Math.round(
    Math.min(
      EXIT_FRAMES.maxFrames,
      Math.max(EXIT_FRAMES.minFrames, EXIT_FRAMES.intercept + g * EXIT_FRAMES.k),
    ),
  );
}

/**
 * 节拍脉冲：返回距离最近一个已过去节拍的衰减能量 0..1。
 * 用来给画面做「随鼓点呼吸」的律动。
 */
export function beatEnergy(frame: number, beats: number[], fps: number, decay = BEAT_DECAY): number {
  if (!beats.length) return 0;
  // 二分找最后一个 <= frame 的节拍
  let lo = 0;
  let hi = beats.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= frame) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return 0;
  const dt = (frame - beats[idx]) / fps;
  return Math.exp(-dt * decay);
}
