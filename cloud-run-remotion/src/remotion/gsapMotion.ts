import { CANVAS_WIDTH, CANVAS_HEIGHT } from './wxTheme';

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
 */

export type EaseFn = (t: number) => number;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

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

  /** back.out(overshoot) —— 冲过头再回弹，GSAP 默认 overshoot = 1.70158 */
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

/** 入场变体名。side 决定水平方向（对方气泡从左、自己气泡从右）。 */
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
  // ── Hero 独占时刻专用（更猛更炸）──
  | 'flyIn'
  | 'tumble3d'
  | 'warp'
  | 'flash';

/** 按气泡序号轮换动画，同一组内相邻两条不会重样（默认池，未指定流派时使用） */
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
];

/**
 * 按音乐流派分组的动画池：嘻哈/抖音风偏"抓耳"的强调型效果（震动/弹跳/打字机），
 * R&B/流行偏柔和的滑入/模糊/弹性效果，粤语说唱介于两者之间。
 */
export const GENRE_VARIANT_POOLS: Record<string, EnterVariant[]> = {
  嘻哈: ['pop', 'shake', 'zoomIn', 'typewriter', 'swing', 'shine'],
  抖音风: ['shake', 'pop', 'shine', 'zoomIn', 'typewriter', 'flip'],
  粤语说唱: ['pop', 'shake', 'slide', 'swing', 'zoomIn'],
  流行: ['slide', 'blurUp', 'zoomIn', 'shine', 'elastic', 'swing'],
  'R&B': ['blurUp', 'slide', 'elastic', 'flip', 'zoomIn'],
  随机: VARIANT_CYCLE,
};

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

/**
 * Hero 独占时刻专用动画池：flyIn/tumble3d/warp/flash，
 * 比普通池更夸张，专用于「单条气泡炸屏」的高光时刻。
 */
export const HERO_VARIANT_POOL: EnterVariant[] = ['flyIn', 'tumble3d', 'warp', 'flash'];

export function pickHeroVariant(seed: number): EnterVariant {
  const i = ((seed % HERO_VARIANT_POOL.length) + HERO_VARIANT_POOL.length) % HERO_VARIANT_POOL.length;
  return HERO_VARIANT_POOL[i];
}

const backSoft = Ease.backOut(1.7);
const backHard = Ease.backOut(2.6);
const elastic = Ease.elasticOut(1, 0.42);

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
  const amp = 0.75 + energy * 0.5; // 节奏越强，幅度越大
  // 透明度总是比位移先收敛，避免"淡入拖尾"
  const fade = Ease.power2Out(Math.min(t * 1.45, 1));

  switch (variant) {
    case 'pop': {
      // gsap.from({scale: .3, ease: 'back.out(2.6)'})
      const p = backHard(t);
      const scale = lerp(0.3, 1, p);
      return { opacity: fade, transform: `scale(${scale.toFixed(4)})`, transformOrigin: origin };
    }

    case 'slide': {
      // gsap.from({x: ±160, ease: 'expo.out'})
      const p = Ease.expoOut(t);
      const x = lerp(dir * 160 * amp, 0, p);
      const scale = lerp(0.94, 1, backSoft(t));
      return {
        opacity: fade,
        transform: `translate3d(${x.toFixed(2)}px,0,0) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'flip': {
      // gsap.from({rotationY: ±72, ease: 'back.out(1.7)'})
      const p = backSoft(t);
      const ry = lerp(dir * -72 * amp, 0, p);
      const scale = lerp(0.9, 1, p);
      return {
        opacity: fade,
        transform: `perspective(1400px) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'blurUp': {
      // gsap.from({y: 70, filter: 'blur(14px)', ease: 'power3.out'})
      const p = Ease.power3Out(t);
      const y = lerp(70 * amp, 0, p);
      const blur = lerp(14, 0, Ease.power2Out(Math.min(t * 1.6, 1)));
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0)`,
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
        transformOrigin: origin,
      };
    }

    case 'elastic': {
      // gsap.from({y: -90, ease: 'elastic.out(1, .42)'})
      const p = elastic(t);
      const y = lerp(-90 * amp, 0, p);
      const scaleY = lerp(0.82, 1, Ease.power2Out(Math.min(t * 2, 1)));
      return {
        opacity: fade,
        transform: `translate3d(0,${y.toFixed(2)}px,0) scaleY(${scaleY.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'swing': {
      // gsap.from({rotation: ∓14, scale: .8, ease: 'back.out(2.6)'})
      const p = backHard(t);
      const rot = lerp(dir * -14 * amp, 0, p);
      const scale = lerp(0.8, 1, p);
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
      // 冲进来 + 几次衰减的左右震动，剪映风格的"强调"效果
      const p = backHard(t);
      const scale = lerp(0.4, 1, p);
      const wiggle = Math.sin(t * Math.PI * 6) * (1 - t) * 9 * amp;
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)}) rotate(${wiggle.toFixed(2)}deg)`,
        transformOrigin: origin,
      };
    }

    case 'shine': {
      // 入场瞬间来一道"扫光"高光闪烁 + 轻微缩放，强调新气泡刚刚出现
      const p = Ease.power2Out(t);
      const scale = lerp(0.88, 1, p);
      const flash = Math.sin(Math.min(t, 1) * Math.PI);
      const brightness = 1 + flash * 0.55;
      const saturate = 1 + flash * 0.25;
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)})`,
        filter: `brightness(${brightness.toFixed(3)}) saturate(${saturate.toFixed(3)})`,
        transformOrigin: origin,
      };
    }

    case 'zoomIn':
    default: {
      // gsap.from({scale: 1.35, ease: 'circ.out'}) —— 从外向内压进来
      const p = Ease.circOut(t);
      const scale = lerp(1.32, 1, p);
      return { opacity: fade, transform: `scale(${scale.toFixed(4)})`, transformOrigin: origin };
    }

    // ═══════ Hero 独占时刻专用变体（更猛更炸）══════════════════════════

    case 'flyIn': {
      // 从屏幕外真实坐标高速甩入，expo.out 急停
      const p = Ease.expoOut(t);
      const offX = lerp(dir * (CANVAS_WIDTH / 2 + 220), 0, p);
      const offY = lerp(-CANVAS_HEIGHT / 2 - 220, 0, p);
      const scale = lerp(1.12, 1, p);
      return {
        opacity: fade,
        transform: `translate3d(${offX.toFixed(2)}px,${offY.toFixed(2)}px,0) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    case 'tumble3d': {
      // perspective + rotateX/Y/Z 复合旋转，从小到大立体翻滚
      const p = backHard(t);
      const rx = lerp(-120 * amp, 0, p);
      const ry = lerp(dir * -90 * amp, 0, p);
      const rz = lerp(28 * amp, 0, p);
      const scale = lerp(0.4, 1, p);
      return {
        opacity: fade,
        transform: `perspective(1200px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: '50% 50%',
      };
    }

    case 'warp': {
      // 入场瞬间 skew 按衰减正弦振荡，幅度随 energy 放大，卡点越强扭曲越猛
      const p = Ease.expoOut(t);
      const decay = 1 - p;
      const osc = Math.sin(t * Math.PI * 5) * decay * 24 * amp;
      const scale = lerp(0.6, 1, p);
      return {
        opacity: fade,
        transform: `skew(${osc.toFixed(2)}deg,${(osc * 0.4).toFixed(2)}deg) scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
      };
    }

    case 'flash': {
      // 极短帧数内白色高光爆闪 + 硬切入位，比 shine 更快更猛
      const p = Ease.expoOut(t);
      const scale = lerp(1.5, 1, p);
      const flash = Math.max(0, 1 - t * 4); // 前 1/4 进度内爆闪
      const brightness = 1 + flash * 1.3;
      return {
        opacity: fade,
        transform: `scale(${scale.toFixed(4)})`,
        filter: `brightness(${brightness.toFixed(3)})`,
        transformOrigin: origin,
      };
    }
  }
}

/** 整组退场：淡出 + 上移 + 轻微缩小 + 模糊，power2.in 收尾干净 */
export function exitMotion(raw: number): MotionState {
  const t = clamp01(raw);
  const p = Ease.power2In(t);
  return {
    opacity: 1 - Ease.power1Out(t),
    transform: `translate3d(0,${(-64 * p).toFixed(2)}px,0) scale(${(1 - 0.07 * p).toFixed(4)})`,
    filter: t > 0.05 ? `blur(${(8 * p).toFixed(2)}px)` : undefined,
  };
}

/**
 * Hero 独占气泡退场：scale 1→1.18→0 的「快闪缩放」+ 全屏白闪感，
 * 与入场的 flash/tumble3d 呼应，制造重拍强调的收束。
 * 峰值原为 1.6，叠加 ChatMVComposition 里的 heroScale(1.18)/呼吸缩放后
 * 极易把气泡冲出 1080px 画布边缘，这里降到 1.18，保留"炸一下"的节奏感但不溢出。
 */
export function heroExitMotion(raw: number): MotionState {
  const t = clamp01(raw);
  const scale = t < 0.4 ? lerp(1, 1.18, t / 0.4) : lerp(1.18, 0, (t - 0.4) / 0.6);
  const opacity = t < 0.5 ? 1 : 1 - Ease.power2In((t - 0.5) / 0.5);
  const flash = t < 0.12 ? 1 - t / 0.12 : 0;
  return {
    opacity,
    transform: `scale(${scale.toFixed(4)})`,
    filter: flash > 0 ? `brightness(${(1 + flash * 1.5).toFixed(3)})` : undefined,
  };
}

/**
 * 组内个体「快闪退场」：scale 冲高再瞬间归零 + 轻微色闪，
 * 替代整组统一的温柔退场，制造剪映风格的「卡点快切」感。
 * t=0 时无影响（opacity:1, scale:1），t=1 时完全消失。
 */
export function bubbleFlashExit(raw: number): MotionState {
  const t = clamp01(raw);
  const scale = t < 0.35 ? lerp(1, 1.18, t / 0.35) : lerp(1.18, 0, (t - 0.35) / 0.65);
  const opacity = t < 0.4 ? 1 : 1 - Ease.power2In((t - 0.4) / 0.6);
  return { opacity, transform: `scale(${scale.toFixed(4)})` };
}

/**
 * 动态入场时长（帧）：按到下一条气泡的间隔算。
 * 句子密集（gap 小）→ 更快更炸；间隔长 → 给足动作做完整的时间。
 */
export function dynamicEnterFrames(gapFrames: number): number {
  const g = Math.max(4, gapFrames);
  return Math.round(Math.min(22, Math.max(8, 6 + g * 0.9)));
}

/** 动态退场时长（帧） */
export function dynamicExitFrames(gapFrames: number): number {
  const g = Math.max(4, gapFrames);
  return Math.round(Math.min(16, Math.max(6, 4 + g * 0.6)));
}

/**
 * 节拍脉冲：返回距离最近一个已过去节拍的衰减能量 0..1。
 * 用来给画面做「随鼓点呼吸」的律动（GSAP 里常写成 gsap.to(..., {yoyo:true})）。
 *
 * @param beats 已排序的节拍帧号数组（这里用每句歌词的起唱帧）
 * @param decay 衰减速度，越大回落越快
 */
export function beatEnergy(frame: number, beats: number[], fps: number, decay = 6): number {
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
