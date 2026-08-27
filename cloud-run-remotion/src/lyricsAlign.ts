/**
 * 歌词时间戳 ⇄ 对话气泡 对齐层
 * =====================================================================
 * 【为什么必须有这一层：气泡时机对不上歌词的根因】
 *
 * 系统里同时存在两套**互不兼容**的「歌词行号」坐标系：
 *
 *   A. task.lyricsLineMap[].lineIndex
 *      来源：generateLyrics 里 LLM 输出的 lineMap。
 *      语义：歌词纯文本 `split('\n')` 的行号，**包含** `[Verse 1]` 之类的
 *            段落标记行和空行。
 *
 *   B. task.lyricsTimeline[].lineIndex
 *      来源：fetchLyricsTimestamps 把 Suno alignedWords 聚合成行。
 *      语义：**实际被唱出来的行**的序号。Suno 不会唱 `[Verse 1]`，空行也不
 *            产生词，所以这些行根本不存在于 B；而且 Suno 常常改词、重复
 *            副歌、吞字，行数与 A 也不一定相等。
 *
 * 旧实现直接用 A 的 lineIndex 去 B 里查 startS，等于拿两把不同刻度的尺子
 * 量同一段距离 —— 结果是整体错位 N 行，表现为「唱到第 3 句了，气泡还停在
 * 第 1 句」或者一堆气泡挤在同一时刻蹦出来。
 *
 * 本模块做三件事（逐级降级，永不抛错）：
 *   1. fuzzy   ：用文本模糊匹配把「歌词文本行」对齐到「演唱行」，抗改词/吞字
 *   2. ordinal ：匹配率太低时，退化为「过滤掉段落标记后的可唱行序号」1:1 对齐
 *   3. uniform ：完全没有时间戳时，均匀分配
 *
 * 另外修掉旧实现的第二个时机 bug：没有映射到歌词的气泡直接复用上一个气泡的
 * 帧号（`frame = lastFrame`），导致它们**同帧成堆弹出**。这里改为在相邻两个
 * 已知锚点之间做线性插值，并强制单调递增 + 最小间隔。
 */

import { BubbleData } from './remotion/ChatBubble';

export interface LyricLine {
  lineIndex: number;
  text: string;
  startS: number;
  endS: number;
}

/** Suno alignedWords 精简后的词级时间戳（w 可能含 \n 行边界标记） */
export interface LyricWord {
  w: string;
  s: number;
  e: number;
}

export interface LineMapEntry {
  lineIndex: number;
  dialogueIndex: number;
}

export interface AlignReport {
  strategy: 'char' | 'fuzzy' | 'ordinal' | 'uniform';
  singableLines: number;
  timelineLines: number;
  matchedLines: number;
  anchoredBubbles: number;
  totalBubbles: number;
  /** 副歌重复而额外生成的「重演气泡」数量 */
  repeatInstances?: number;
}

/** 气泡之间至少间隔多少帧，避免多个气泡同帧堆叠 */
export const MIN_GAP_FRAMES = 5;
/**
 * 一条对话最多额外重演几次。
 *
 * generateLyrics 的 assembleLyrics 会让副歌行重复引用同一批 dialogueIndex，
 * Suno 也确实把副歌唱了两遍。每一次演唱都应该有对应的气泡出场事件，
 * 否则重复副歌那十几秒画面就是定格的。
 */
const MAX_REPEAT_INSTANCES = 2;
/**
 * 与上一次出场至少间隔这么久（秒）才值得重演。
 * 低于这个间隔说明是相邻行的误配或紧挨着的 hook 复读，
 * 再插一次入场只会显得抽搐。
 */
const REPEAT_MIN_GAP_S = 4;
/** 模糊匹配判定为「同一行」的相似度阈值 */
const MATCH_THRESHOLD = 0.55;
/** 模糊匹配整体可信度阈值，低于此值降级为序号对齐 */
const FUZZY_TRUST_RATIO = 0.4;

// ── 文本工具 ────────────────────────────────────────────────────────

/** 中英文标点 + 空白，匹配前统一剔除（Suno 返回的词不带标点） */
const NOISE = /[\s`~!@#$%^&*()_\-+=<>?:"{}|,./;'\\[\]·～！＠＃￥％……＆＊（）——＝｛｝｜《》？：“”【】、；‘’，。～]/g;

function normalize(s: string): string {
  return String(s || '').replace(NOISE, '').toLowerCase();
}

/** `[Verse 1]` / `（间奏）` / `【Hook】` 这类段落标记行 —— Suno 不会唱出来 */
function isSectionTag(line: string): boolean {
  return /^\s*[[(（【].{0,24}[\])）】]\s*$/.test(line);
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length <= 1) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice 相似度（0~1），对「改了几个字」比编辑距离更宽容也更快 */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((g) => {
    if (B.has(g)) inter += 1;
  });
  return (2 * inter) / (A.size + B.size);
}

// ── 核心：歌词文本行号 → 演唱时间 ───────────────────────────────────

interface Span {
  startS: number;
  endS: number;
}

/**
 * 长对话被拆成多条子气泡时（见 renderChatScreenshots 的气泡拆分逻辑），
 * 同一个 dialogueIndex 下的多条子气泡共享同一段演唱时间跨度（span）。
 * 这里按 splitStart/splitEnd（0~1，由字符数占比算出）把整段时间比例切给每条子气泡，
 * 做到「这句唱到哪，气泡就切到哪」，而不是整段时间都给一个大气泡。
 */
function subSpan(span: Span, b: BubbleData): Span {
  const s = typeof b.splitStart === 'number' ? Math.max(0, Math.min(1, b.splitStart)) : 0;
  const e = typeof b.splitEnd === 'number' ? Math.max(0, Math.min(1, b.splitEnd)) : 1;
  const dur = span.endS - span.startS;
  return {
    startS: span.startS + dur * s,
    endS: span.startS + dur * Math.max(e, s + 0.001),
  };
}

/**
 * 把「歌词纯文本的行号」映射到「该行实际被唱出来的时间区间」。
 *
 * @param lyrics    task.lyrics（含 [Verse] 标记与空行的原始文本）
 * @param timeline  task.lyricsTimeline（Suno 词级时间戳聚合出的演唱行）
 */
export function buildTextLineTimeMap(
  lyrics: string,
  timeline: LyricLine[],
): { map: Map<number, Span>; strategy: 'fuzzy' | 'ordinal'; singable: number; matched: number } {
  const map = new Map<number, Span>();

  // 1) 抽出「可唱行」：跳过空行与段落标记行，它们不在 timeline 里
  const singable: Array<{ textIndex: number; norm: string }> = [];
  lyrics.split('\n').forEach((line, textIndex) => {
    if (!line.trim() || isSectionTag(line)) return;
    const norm = normalize(line);
    if (!norm) return;
    singable.push({ textIndex, norm });
  });

  const tl = timeline
    .slice()
    .sort((a, b) => a.startS - b.startS)
    .map((t) => ({ startS: t.startS, endS: t.endS, norm: normalize(t.text) }));

  if (singable.length === 0 || tl.length === 0) {
    return { map, strategy: 'ordinal', singable: singable.length, matched: 0 };
  }

  // 2) 双指针模糊对齐：Suno 可能多唱（重复副歌）或少唱（吞行），
  //    用前瞻比较决定「跳歌词行」还是「跳演唱行」，保证整体顺序不乱。
  const pairs = new Map<number, number>(); // singableIdx -> timelineIdx
  let i = 0;
  let j = 0;
  while (i < singable.length && j < tl.length) {
    if (dice(singable[i].norm, tl[j].norm) >= MATCH_THRESHOLD) {
      pairs.set(i, j);
      i += 1;
      j += 1;
      continue;
    }
    const skipLyric = i + 1 < singable.length ? dice(singable[i + 1].norm, tl[j].norm) : -1;
    const skipSung = j + 1 < tl.length ? dice(singable[i].norm, tl[j + 1].norm) : -1;
    if (skipLyric > skipSung) i += 1;
    else if (skipSung > skipLyric) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  const trust = pairs.size / Math.min(singable.length, tl.length);
  const strategy: 'fuzzy' | 'ordinal' = trust >= FUZZY_TRUST_RATIO ? 'fuzzy' : 'ordinal';

  if (strategy === 'ordinal') {
    // 3a) 降级：按可唱行序号 1:1 对齐（这才是 timeline.lineIndex 的真实语义）
    pairs.clear();
    const n = Math.min(singable.length, tl.length);
    for (let k = 0; k < n; k += 1) pairs.set(k, k);
  }

  // 3b) 把已配对的写入结果
  pairs.forEach((tlIdx, sIdx) => {
    map.set(singable[sIdx].textIndex, { startS: tl[tlIdx].startS, endS: tl[tlIdx].endS });
  });

  // 4) 未配对的可唱行：用左右最近锚点线性插值，避免它们全部落到同一时刻
  const avgLineDur =
    tl.length > 1 ? (tl[tl.length - 1].endS - tl[0].startS) / tl.length : Math.max(tl[0].endS - tl[0].startS, 1);

  for (let k = 0; k < singable.length; k += 1) {
    if (pairs.has(k)) continue;
    let left = -1;
    for (let p = k - 1; p >= 0; p -= 1) {
      if (pairs.has(p)) {
        left = p;
        break;
      }
    }
    let right = -1;
    for (let p = k + 1; p < singable.length; p += 1) {
      if (pairs.has(p)) {
        right = p;
        break;
      }
    }

    let startS: number;
    if (left >= 0 && right >= 0) {
      const a = tl[pairs.get(left) as number].startS;
      const b = tl[pairs.get(right) as number].startS;
      startS = a + ((b - a) * (k - left)) / (right - left);
    } else if (left >= 0) {
      startS = tl[pairs.get(left) as number].endS + avgLineDur * (k - left - 1);
    } else if (right >= 0) {
      startS = Math.max(0, tl[pairs.get(right) as number].startS - avgLineDur * (right - k));
    } else {
      startS = tl[0].startS + avgLineDur * k;
    }
    map.set(singable[k].textIndex, { startS, endS: startS + avgLineDur });
  }

  return { map, strategy, singable: singable.length, matched: pairs.size };
}

// ── 核心：字级对齐（词级时间戳主策略）────────────────────────────────

interface TimedChar {
  ch: string;
  s: number;
  e: number;
}

/** 带字符区间索引的时间跨度，用于子气泡精确切分 */
interface CharSpan {
  startS: number;
  endS: number;
  startIdx: number;
  endIdx: number;
}

/**
 * 把词级时间戳展平成「带时间戳的归一化字符流」。
 * 跳过 \n（行边界标记）与标点/空白（normalize 后为空），
 * 词内多字符按位置比例分配 [s,e] 区间，得到每个字符的真实起止时间。
 */
function buildCharStream(words: LyricWord[]): TimedChar[] {
  const out: TimedChar[] = [];
  for (const w of words) {
    const chars = Array.from(String(w.w || ''));
    const n = chars.length;
    if (n === 0) continue;
    const s0 = Number(w.s) || 0;
    const e0 = Number(w.e) || s0;
    const dur = Math.max(0, e0 - s0);
    for (let k = 0; k < n; k += 1) {
      const ch = chars[k];
      if (ch === '\n') continue; // 行边界标记，不进字符流
      const norm = normalize(ch);
      if (!norm) continue; // 标点/空白剔除
      const tStart = n === 1 ? s0 : s0 + (dur * k) / (n - 1);
      const tEnd = n === 1 ? e0 : s0 + (dur * Math.min(k + 1, n - 1)) / (n - 1);
      out.push({ ch: norm, s: tStart, e: tEnd });
    }
  }
  return out;
}

interface CharMatch {
  startS: number;
  endS: number;
  startIdx: number;
  endIdx: number;
  score: number;
}

/**
 * 在字符流里滑窗找 query 的最佳匹配位置（fromIdx 起向后扫描）。
 * 逐位比较归一化字符，取匹配率最高的窗口；完美匹配即提前退出。
 */
function findLineInStream(stream: TimedChar[], query: string, fromIdx: number): CharMatch | null {
  const qlen = query.length;
  if (qlen === 0 || stream.length === 0) return null;
  if (qlen > stream.length) {
    return {
      startS: stream[0].s,
      endS: stream[stream.length - 1].e,
      startIdx: 0,
      endIdx: stream.length - 1,
      score: stream.length / qlen,
    };
  }
  const maxStart = stream.length - qlen;
  const start0 = Math.min(Math.max(fromIdx, 0), maxStart);
  let bestScore = -1;
  let bestStart = start0;
  for (let i = start0; i <= maxStart; i += 1) {
    let match = 0;
    for (let k = 0; k < qlen; k += 1) {
      if (stream[i + k].ch === query[k]) match += 1;
    }
    const score = match / qlen;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
      if (score >= 1) break;
    }
  }
  return {
    startS: stream[bestStart].s,
    endS: stream[bestStart + qlen - 1].e,
    startIdx: bestStart,
    endIdx: bestStart + qlen - 1,
    score: bestScore,
  };
}

/** 字级对齐判定为「命中」的相似度阈值 */
const CHAR_MATCH_THRESHOLD = 0.5;

/**
 * 字级对齐主策略：把每条「可唱歌词行」直接在词级字符流里滑窗匹配，
 * 拿到该行真实起唱/收尾的字符区间与时间。
 *
 * 返回 map: 歌词文本行号 → CharSpan（含字符流区间索引，供子气泡精确切分）。
 * 用 cursor 保持行序与演唱序一致，避免副歌重复导致跨段错配。
 */
export function buildTextLineTimeMapFromWords(
  lyrics: string,
  words: LyricWord[],
): { map: Map<number, CharSpan>; stream: TimedChar[]; matched: number; singable: number } {
  const map = new Map<number, CharSpan>();
  const stream = buildCharStream(words);
  if (stream.length === 0) return { map, stream, matched: 0, singable: 0 };

  const lines = lyrics.split('\n');
  let singable = 0;
  let matched = 0;
  let cursor = 0;

  for (let textIndex = 0; textIndex < lines.length; textIndex += 1) {
    const line = lines[textIndex];
    if (!line.trim() || isSectionTag(line)) continue;
    singable += 1;
    const query = normalize(line);
    if (!query) continue;
    const found = findLineInStream(stream, query, cursor);
    if (found && found.score >= CHAR_MATCH_THRESHOLD) {
      map.set(textIndex, {
        startS: found.startS,
        endS: found.endS,
        startIdx: found.startIdx,
        endIdx: found.endIdx,
      });
      matched += 1;
      cursor = found.endIdx + 1; // 保持顺序，下一行从匹配末尾之后找
    }
  }
  return { map, stream, matched, singable };
}

/**
 * 用字符流区间 + 子气泡的 splitStart/splitEnd（0~1）精确切出起止时间，
 * 比 subSpan 的纯比例切分更贴近真实演唱进度。
 */
function subSpanFromChars(stream: TimedChar[], cs: CharSpan, b: BubbleData): Span {
  const s = typeof b.splitStart === 'number' ? Math.max(0, Math.min(1, b.splitStart)) : 0;
  const e = typeof b.splitEnd === 'number' ? Math.max(0, Math.min(1, b.splitEnd)) : 1;
  const len = cs.endIdx - cs.startIdx + 1;
  if (len <= 1) return { startS: cs.startS, endS: cs.endS };
  const subStartIdx = Math.min(cs.startIdx + Math.floor(len * s), cs.endIdx);
  const subEndIdx = Math.max(subStartIdx, Math.min(cs.startIdx + Math.ceil(len * e) - 1, cs.endIdx));
  return { startS: stream[subStartIdx].s, endS: stream[subEndIdx].e };
}

/**
 * 同一条对话在歌词里的一次出场。
 *
 * 【为什么必须是数组而不是单个 span】
 * 副歌 hook 会被 generateLyrics 重复引用，同一个 dialogueIndex 在
 * lyricsLineMap 里出现多次（不同 lineIndex）。旧实现把这些出场用
 * min(startS) / max(endS) 塌成一个跨度，后果是：
 *   - 气泡只锚在第一次出现的位置，副歌重复段一个入场事件都没有
 *     → buildGroups 把那十几秒并进上一组的停留期 → 画面定格
 *   - endS 取 max 让首次出场的 endFrame 被拉到第二遍唱完，
 *     退场时机整体推迟十几秒
 * 所以这里按演唱顺序保留每一次出场，交给下游决定重演。
 */
interface Occurrence {
  startS: number;
  endS: number;
  /** 字级路径携带的字符流区间索引，用于子气泡精确切分 */
  startIdx?: number;
  endIdx?: number;
}

/** 按子气泡的 splitStart/splitEnd 从一次出场里切出实际时间跨度 */
function sliceOccurrence(occ: Occurrence, b: BubbleData, stream: TimedChar[] | null): Span {
  if (stream && occ.startIdx != null && occ.endIdx != null) {
    return subSpanFromChars(
      stream,
      { startS: occ.startS, endS: occ.endS, startIdx: occ.startIdx, endIdx: occ.endIdx },
      b,
    );
  }
  return subSpan({ startS: occ.startS, endS: occ.endS }, b);
}

// ── 核心：气泡出现帧 ────────────────────────────────────────────────

/**
 * uniform 降级的编排参数。
 *
 * 拿不到时间戳时这条路就是唯一的路，所以它不能只是「能跑」，
 * 必须自己造出节奏感。核心是两件事：
 *   1. 分簇：气泡按 1/2/3 条一簇交替，簇内挨着（→ 对话组密集波次），
 *      簇间拉开（→ 独立分组）。纯等间隔会让每条各自成组 → 全片 Hero。
 *   2. 留边距：不要从第 0 帧铺到最后一帧，给前奏/尾奏留白。
 */
const UNIFORM_LAYOUT = {
  /** 开头留白：总时长比例，上限 introMaxS 秒 */
  introRatio: 0.05,
  introMaxS: 4,
  /** 结尾留白 */
  outroRatio: 0.04,
  outroMaxS: 3,
  /**
   * 簇内相邻气泡间隔（秒）的下限与上限。
   * 必须始终小于 ChatMVComposition 的 GROUP_MAX_GAP_S(1.8s)，否则簇会被拆散。
   * 气泡稀疏（簇间距很大）时取上限，把入场事件铺开，缓解长停留的静止感。
   */
  clusterInnerGapMinS: 0.55,
  clusterInnerGapMaxS: 1.5,
  /** 簇内间隔占簇间距的比例，用于在上下限之间插值 */
  clusterInnerGapRatio: 0.12,
  /**
   * 簇大小循环模式。1 = Hero 独占，2/3 = 多气泡对话组。
   * 这个模式让 Hero 占比稳定落在 2/6 ≈ 33%，正好贴着
   * ChatMVComposition 的 HERO_MAX_RATIO(0.35)，无需事后合并救场。
   */
  clusterPattern: [2, 3, 1, 2, 1, 3],
  /**
   * 簇间距上限（秒）。
   *
   * ⚠️ 这是「长时间没动画」的关键闸门。ChatMVComposition 的
   * GROUP_MAX_SPAN_S 只约束组内气泡的时间跨度，约束不到「一组在屏幕上
   * 停留多久」—— 后者由下一组何时开始决定。气泡稀疏时簇间距会被拉到
   * 十几秒甚至几十秒，那一整段只有极微弱的 idle 呼吸，观感依然是静止。
   * 超过这个上限就把大簇拆成单条铺开，保证入场事件的密度。
   */
  clusterStrideMaxS: 6,
  /** 单条气泡的估计「演唱时长」上限（秒），用于给退场留窗口 */
  estimatedSungMaxS: 3,
  /** 估计演唱时长占簇间距的比例 */
  estimatedSungRatio: 0.75,
} as const;

/** 合成节拍的默认 BPM（嘻哈 / 流行常见区间的中位数） */
const FALLBACK_BPM = 92;

/**
 * 合成等间隔节拍。
 *
 * uniform 降级时 lyricsTimeline 往往也是空的，`beats` 就成了空数组，
 * 于是 ChatMVComposition 的常驻律动层失去鼓点分量、reAccent 二次脉冲
 * 完全不触发 —— 画面只剩极微弱的自呼吸，观感依然接近静止。
 * 这里按固定 BPM 造一组节拍，让律动层在无时间戳场景下也能满血工作。
 */
function syntheticBeats(totalFrames: number, fps: number, bpm = FALLBACK_BPM): number[] {
  const step = (60 / bpm) * fps;
  if (!Number.isFinite(step) || step <= 0) return [];
  const out: number[] = [];
  for (let f = 0; f < totalFrames; f += step) out.push(Math.round(f));
  return out;
}

/**
 * 节奏化均匀分配。
 *
 * 相比旧的 `i * per` 等间隔，这里做了三件事：
 *   - 分簇：产生 Hero / 对话组交替，动画类型不再单一
 *   - 留边距：前奏尾奏留白，首条气泡不在第 0 帧（避免 anticipation 吃掉入场）
 *   - endFrame 留窗口：不顶到下一簇起点，保证退场动画有帧可播
 */
function uniformTimings(
  bubbles: BubbleData[],
  totalFrames: number,
  fps: number,
): BubbleData[] {
  const n = bubbles.length;
  if (n === 0) return [];
  const lastAllowed = Math.max(totalFrames - 1, 0);

  // 1) 边距：气泡稀疏时留白，密集时（放不下）自动放弃边距
  let intro = Math.round(
    Math.min(totalFrames * UNIFORM_LAYOUT.introRatio, UNIFORM_LAYOUT.introMaxS * fps),
  );
  let outro = Math.round(
    Math.min(totalFrames * UNIFORM_LAYOUT.outroRatio, UNIFORM_LAYOUT.outroMaxS * fps),
  );
  if (totalFrames - intro - outro < n * MIN_GAP_FRAMES) {
    intro = 0;
    outro = 0;
  }
  const usable = Math.max(totalFrames - intro - outro, n * MIN_GAP_FRAMES);

  // 2) 按模式分簇
  const clusters: number[] = [];
  let remaining = n;
  let pi = 0;
  while (remaining > 0) {
    const pattern = UNIFORM_LAYOUT.clusterPattern;
    const size = Math.min(pattern[pi % pattern.length], remaining);
    clusters.push(size);
    remaining -= size;
    pi += 1;
  }

  // 2.5) 簇数下限：只在「簇间距离谱地大」时才补簇。
  //      注意不能为了压缩停留时长而把所有簇拆成单条 —— 那会让 Hero 占比
  //      冲到 90%+，重新变成「全片 Hero 独占」的老毛病。气泡本身稀疏是
  //      客观事实（20 条撑 120s 就是平均 6s 一条），压不掉的长停留交给
  //      ChatMVComposition 的自适应律动层（holdSeconds 越长律动越强）处理。
  const strideCapFrames = UNIFORM_LAYOUT.clusterStrideMaxS * fps;
  const minClusters = Math.min(
    // 最多拆到「每簇至少还有 2 条」，保住对话组结构
    Math.ceil(n / 2),
    Math.ceil(usable / strideCapFrames),
  );
  while (clusters.length < minClusters) {
    let biggest = 0;
    for (let i = 1; i < clusters.length; i += 1) {
      if (clusters[i] > clusters[biggest]) biggest = i;
    }
    if (clusters[biggest] <= 2) break; // 只拆 3 条以上的簇
    clusters[biggest] -= 1;
    clusters.splice(biggest + 1, 0, 1);
  }

  const clusterStride = usable / clusters.length;
  const maxClusterSize = Math.max(...clusters);
  // 簇内间隔：簇间距越大越往上限靠，把入场事件铺开；
  // 同时不能让一簇占满整个 stride，也不能突破分组阈值。
  const innerGap = Math.max(
    MIN_GAP_FRAMES,
    Math.round(
      Math.min(
        Math.max(
          UNIFORM_LAYOUT.clusterInnerGapMinS * fps,
          clusterStride * UNIFORM_LAYOUT.clusterInnerGapRatio,
        ),
        UNIFORM_LAYOUT.clusterInnerGapMaxS * fps,
        clusterStride / (maxClusterSize + 1),
      ),
    ),
  );

  // 3) 落帧
  const starts: number[] = [];
  clusters.forEach((size, k) => {
    const base = intro + k * clusterStride;
    for (let j = 0; j < size; j += 1) {
      starts.push(Math.round(base + j * innerGap));
    }
  });

  // 4) 单调递增 + 上界收敛（与主路径保持一致的不变量）
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] < starts[i - 1] + MIN_GAP_FRAMES) starts[i] = starts[i - 1] + MIN_GAP_FRAMES;
  }
  if (starts[starts.length - 1] > lastAllowed) {
    starts[starts.length - 1] = lastAllowed;
    for (let i = starts.length - 2; i >= 0; i -= 1) {
      const ceiling = starts[i + 1] - MIN_GAP_FRAMES;
      if (starts[i] > ceiling) starts[i] = Math.max(0, ceiling);
    }
  }

  // 5) endFrame：估一个「唱完」时刻，并给退场留出余量。
  //    顶满到下一条起点会让退场窗口被挤掉（详见 computeBubbleTimings 第 4 步注释）。
  //    极端密集时相邻间隔可能只有 MIN_GAP_FRAMES，此时按比例留余量而不是
  //    硬减固定帧数 —— 否则下限 startFrame + MIN_GAP_FRAMES 会反过来盖掉余量。
  const estimatedSung = Math.round(
    Math.min(
      clusterStride * UNIFORM_LAYOUT.estimatedSungRatio,
      UNIFORM_LAYOUT.estimatedSungMaxS * fps,
    ),
  );
  return bubbles.map((b, i) => {
    const startFrame = starts[i];
    const nextStart = i + 1 < starts.length ? starts[i + 1] : lastAllowed + 1;
    const room = Math.max(nextStart - startFrame, 1);
    // 退场余量：至少 1 帧，正常情况下留 MIN_GAP_FRAMES
    const reserve = Math.max(1, Math.min(MIN_GAP_FRAMES, Math.floor(room * 0.4)));
    const ceiling = Math.min(nextStart - reserve, lastAllowed);
    const endFrame = Math.max(
      startFrame + 1,
      Math.min(startFrame + estimatedSung, ceiling),
    );
    return { ...b, startFrame, endFrame };
  });
}

/**
 * 计算每个气泡的出现帧 / 结束帧。
 *
 * 对齐策略（逐级降级，永不抛错）：
 *   1. char    ：有词级时间戳时，每条歌词行直接在字符流里滑窗匹配，拿到真实
 *               起唱/收尾帧，子气泡按字符区间精确切分（主策略，最准）
 *   2. fuzzy   ：无词级数据时，用文本模糊匹配把歌词行对齐到演唱行
 *   3. ordinal ：模糊匹配率太低，退化为可唱行序号 1:1 对齐
 *   4. uniform ：完全没有时间戳，均匀分配
 *
 * 映射链：
 *   bubble.index (= dialogueIndex)
 *     ← lyricsLineMap → 歌词文本行号
 *     ← buildTextLineTimeMapFromWords / buildTextLineTimeMap → 演唱时间区间
 *     × fps → 帧号
 */
export function computeBubbleTimings(params: {
  bubbles: BubbleData[];
  lineMap?: LineMapEntry[];
  timeline?: LyricLine[];
  lyrics?: string;
  /** 词级时间戳（Suno alignedWords 精简版），有则启用字级对齐主策略 */
  lyricsWords?: LyricWord[];
  totalFrames: number;
  fps: number;
}): { bubbles: BubbleData[]; beats: number[]; report: AlignReport } {
  const { bubbles, lineMap, timeline, lyrics, lyricsWords, totalFrames, fps } = params;

  const hasTimeline = Array.isArray(timeline) && timeline.length > 0;
  const hasMap = Array.isArray(lineMap) && lineMap.length > 0;
  const hasLyrics = typeof lyrics === 'string' && lyrics.trim().length > 0;
  const hasWords = Array.isArray(lyricsWords) && lyricsWords.length > 0;

  const beatsFromTimeline = (): number[] =>
    hasTimeline
      ? Array.from(
          new Set((timeline as LyricLine[]).map((t) => Math.round(t.startS * fps))),
        ).sort((a, b) => a - b)
      : [];

  /**
   * 舞台律动用的 beats。
   *
   * 绝不返回空数组 —— 空 beats 会让 ChatMVComposition 常驻律动层的鼓点分量
   * 和 reAccent 二次脉冲同时失效，画面重新退化成近似静止。
   * 逐级降级：timeline 行首 → 词级起始帧 → 按 FALLBACK_BPM 合成节拍。
   */
  const beatsForStage = (): number[] => {
    const real = beatsFromTimeline();
    if (real.length > 1) return real;
    if (hasWords) {
      const fromWords = Array.from(
        new Set(
          (lyricsWords as LyricWord[])
            .filter((w) => typeof w.s === 'number')
            .map((w) => Math.round(w.s * fps)),
        ),
      ).sort((a, b) => a - b);
      if (fromWords.length > 1) return fromWords;
    }
    return syntheticBeats(totalFrames, fps);
  };

  // 无对齐所需数据 → 均匀分配
  if (!hasMap || !hasLyrics || (!hasTimeline && !hasWords)) {
    return {
      bubbles: uniformTimings(bubbles, totalFrames, fps),
      beats: beatsForStage(),
      report: {
        strategy: 'uniform',
        singableLines: 0,
        timelineLines: hasTimeline ? (timeline as LyricLine[]).length : 0,
        matchedLines: 0,
        anchoredBubbles: 0,
        totalBubbles: bubbles.length,
      },
    };
  }

  // 每条对话的**所有**演唱出场（副歌重复会有多次）；
  // 字级路径额外携带字符流区间索引（可选）。
  const dialogueOccurrences = new Map<number, Occurrence[]>();
  let charStream: TimedChar[] | null = null;
  let strategy: AlignReport['strategy'] = 'uniform';
  let singable = 0;
  let matched = 0;

  const pushOcc = (dialogueIndex: number, occ: Occurrence) => {
    const list = dialogueOccurrences.get(dialogueIndex);
    if (list) list.push(occ);
    else dialogueOccurrences.set(dialogueIndex, [occ]);
  };

  // 按 lineIndex 升序遍历，保证 occurrence 数组顺序 == 演唱顺序。
  // lineMap 本身是按行生成的，但显式排序更稳，也顺手滤掉段落标记行（-1）。
  const orderedMap = (lineMap as LineMapEntry[])
    .filter((m) => m && m.dialogueIndex >= 0)
    .slice()
    .sort((a, b) => a.lineIndex - b.lineIndex);

  // ── 字级对齐主策略（有词级时间戳时优先）────────────────────────────
  if (hasWords) {
    const cr = buildTextLineTimeMapFromWords(lyrics as string, lyricsWords as LyricWord[]);
    charStream = cr.stream.length > 0 ? cr.stream : null;
    singable = cr.singable;
    matched = cr.matched;
    for (const m of orderedMap) {
      const cs = cr.map.get(m.lineIndex);
      if (!cs) continue;
      pushOcc(m.dialogueIndex, {
        startS: cs.startS,
        endS: cs.endS,
        startIdx: cs.startIdx,
        endIdx: cs.endIdx,
      });
    }
    strategy = dialogueOccurrences.size > 0 ? 'char' : 'uniform';
  }

  // ── 降级：字级无锚点且有行级时间戳 → 回到行级模糊/序号对齐 ──────────
  if (dialogueOccurrences.size === 0 && hasTimeline) {
    const lr = buildTextLineTimeMap(lyrics as string, timeline as LyricLine[]);
    singable = lr.singable;
    matched = lr.matched;
    strategy = lr.strategy;
    charStream = null; // 行级路径无字符流
    for (const m of orderedMap) {
      const span = lr.map.get(m.lineIndex);
      if (!span) continue;
      pushOcc(m.dialogueIndex, { startS: span.startS, endS: span.endS });
    }
  }

  if (dialogueOccurrences.size === 0) {
    return {
      bubbles: uniformTimings(bubbles, totalFrames, fps),
      beats: beatsForStage(),
      report: {
        strategy: 'uniform',
        singableLines: singable,
        timelineLines: hasTimeline ? (timeline as LyricLine[]).length : 0,
        matchedLines: matched,
        anchoredBubbles: 0,
        totalBubbles: bubbles.length,
      },
    };
  }

  // 子气泡时间切分：只看**首次**出场，保持主管线（锚点/插值/单调化）语义不变。
  // 副歌重复的第 2、3 次出场在第 5 步单独生成「重演气泡」。
  const getSubSpan = (b: BubbleData): Span | null => {
    const occs = dialogueOccurrences.get(b.index);
    if (!occs || occs.length === 0) return null;
    return sliceOccurrence(occs[0], b, charStream);
  };

  // 1) 打锚点
  const clampFrame = (f: number) => Math.max(0, Math.min(Math.round(f), Math.max(totalFrames - 1, 0)));
  const anchored: Array<number | null> = bubbles.map((b) => {
    const sub = getSubSpan(b);
    if (!sub) return null;
    return clampFrame(sub.startS * fps);
  });
  const anchoredCount = anchored.filter((v) => v != null).length;

  // 2) 未锚定的气泡：在相邻锚点之间线性插值（旧实现在这里直接复用上一帧，
  //    导致连续多个未映射气泡同帧爆出，是「时机不一致」的第二个原因）
  const frames: number[] = new Array(bubbles.length).fill(0);
  for (let i = 0; i < bubbles.length; i += 1) {
    if (anchored[i] != null) {
      frames[i] = anchored[i] as number;
      continue;
    }
    let left = -1;
    for (let p = i - 1; p >= 0; p -= 1) {
      if (anchored[p] != null) {
        left = p;
        break;
      }
    }
    let right = -1;
    for (let p = i + 1; p < bubbles.length; p += 1) {
      if (anchored[p] != null) {
        right = p;
        break;
      }
    }
    if (left >= 0 && right >= 0) {
      const a = anchored[left] as number;
      const b = anchored[right] as number;
      frames[i] = clampFrame(a + ((b - a) * (i - left)) / (right - left));
    } else if (left >= 0) {
      frames[i] = clampFrame((anchored[left] as number) + MIN_GAP_FRAMES * (i - left));
    } else if (right >= 0) {
      frames[i] = clampFrame((anchored[right] as number) - MIN_GAP_FRAMES * (right - i));
    } else {
      frames[i] = clampFrame((totalFrames * i) / Math.max(bubbles.length, 1));
    }
  }

  // 3) 强制单调递增 + 最小间隔
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i] < frames[i - 1] + MIN_GAP_FRAMES) frames[i] = frames[i - 1] + MIN_GAP_FRAMES;
  }

  // 3.5) 【硬性规则】歌词没唱完，气泡绝不提前出场：
  // 每条锚定了歌词行的气泡，startFrame 不得早于歌词起唱帧。
  // 防止未锚定的插值气泡跑到关联歌词行之前。
  for (let i = 0; i < bubbles.length; i += 1) {
    const sub = getSubSpan(bubbles[i]);
    if (!sub) continue;
    const minFrame = clampFrame(sub.startS * fps);
    if (frames[i] < minFrame) frames[i] = minFrame;
  }
  // 重新确保单调性（clamp 后可能打乱顺序）
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i] < frames[i - 1] + MIN_GAP_FRAMES) frames[i] = frames[i - 1] + MIN_GAP_FRAMES;
  }

  // 3.6) 上界收敛：单调化过程会把帧号累加推到 totalFrames 之外。
  //      越界气泡永远不会被渲染，但它们仍然参与 ChatMVComposition 的
  //      group.end 计算（group.end = 下一组的 start），于是最后一个可见组的
  //      end 落在视频时长之外 → 它的退场永远等不到 → 尾段静止定格到片尾。
  //      这里从后往前压缩间隔，把所有帧号收进合法区间。
  const lastAllowed = Math.max(totalFrames - 1, 0);
  if (frames.length > 0 && frames[frames.length - 1] > lastAllowed) {
    frames[frames.length - 1] = lastAllowed;
    for (let i = frames.length - 2; i >= 0; i -= 1) {
      const ceiling = frames[i + 1] - MIN_GAP_FRAMES;
      if (frames[i] > ceiling) frames[i] = Math.max(0, ceiling);
    }
  }

  // 4) endFrame：只表达「这句唱完了」这一个语义。
  //
  //    ⚠️ 旧实现是 Math.max(sungEnd, nextStart)，会让 endFrame 恒 ≥ 下一条气泡的
  //    startFrame。而 ChatMVComposition 里 group.end 正好等于下一组第一条的
  //    startFrame，于是 bubbleExitStart = max(exitStart, endFrame) ≥ group.end，
  //    而渲染过滤器在 frame >= group.end 就把这组摘掉了 —— 结果退场进度恒为 0，
  //    9 种退场变体一帧都播不出来，表现为气泡「硬切消失、看着像没动画」。
  const out = bubbles.map((b, i) => {
    const sub = getSubSpan(b);
    const sungEnd = sub ? Math.round(sub.endS * fps) : frames[i] + fps;
    return {
      ...b,
      startFrame: frames[i],
      endFrame: Math.max(
        frames[i] + MIN_GAP_FRAMES,
        Math.min(sungEnd, Math.max(totalFrames - 1, 0)),
      ),
    };
  });

  // 5) 副歌重复 → 生成「重演气泡」。
  //
  //    generateLyrics 的副歌段会重复引用同一批 dialogueIndex，Suno 确实唱了两遍。
  //    第 1~4 步只用了首次出场，第 2 次及以后的演唱区间在 startFrame 上没有任何
  //    事件，buildGroups 会把那十几秒并进上一组的停留期 → 画面定格。
  //    这里给每一次额外出场克隆一条气泡，让副歌重复时画面重新炸屏
  //    （也正是 MV 处理 hook 复读的常规做法）。
  const repeats: BubbleData[] = [];
  for (const b of bubbles) {
    const occs = dialogueOccurrences.get(b.index);
    if (!occs || occs.length <= 1) continue;
    let prevStartS = occs[0].startS;
    let made = 0;
    for (let k = 1; k < occs.length && made < MAX_REPEAT_INSTANCES; k += 1) {
      const occ = occs[k];
      // 间隔太近说明是相邻行误配或紧挨着的复读，再插入入场只会显得抽搐
      if (occ.startS - prevStartS < REPEAT_MIN_GAP_S) continue;
      const sub = sliceOccurrence(occ, b, charStream);
      const startFrame = clampFrame(sub.startS * fps);
      // 越界的重演不会被渲染，但会污染 group.end 计算，直接丢弃
      if (startFrame >= lastAllowed) continue;
      repeats.push({
        ...b,
        // uid 必须唯一：ChatMVComposition 用它做 React key
        uid: `${b.uid ?? b.index}-r${k}`,
        // 错开动画种子，让重演的入场/退场变体与首次不同，避免看着像卡帧重播
        subIndex: (b.subIndex || 0) + k * 3,
        startFrame,
        endFrame: Math.max(startFrame + MIN_GAP_FRAMES, clampFrame(sub.endS * fps)),
      });
      prevStartS = occ.startS;
      made += 1;
    }
  }

  // 6) 合并重演气泡后重排，并重新建立「单调递增 + 最小间隔」不变量。
  //    ChatMVComposition 的 buildGroups / buildWaves 都假设 bubbles 按
  //    startFrame 升序，破坏这个前提会让分组逻辑错乱。
  const merged =
    repeats.length === 0
      ? out
      : [...out, ...repeats].sort((a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0));

  if (repeats.length > 0) {
    for (let i = 1; i < merged.length; i += 1) {
      const prevStart = merged[i - 1].startFrame ?? 0;
      if ((merged[i].startFrame ?? 0) < prevStart + MIN_GAP_FRAMES) {
        merged[i].startFrame = prevStart + MIN_GAP_FRAMES;
      }
      if ((merged[i].endFrame ?? 0) <= (merged[i].startFrame ?? 0)) {
        merged[i].endFrame = (merged[i].startFrame ?? 0) + MIN_GAP_FRAMES;
      }
    }
  }

  return {
    bubbles: merged,
    // 主路径同样不能返回空 beats：只有 lyricsWords 没有 timeline 时
    // beatsFromTimeline() 是空的，会让常驻律动层失去鼓点分量。
    // 逐级降级：真实行首 → 词级起始 → 合成节拍。
    beats: beatsForStage(),
    report: {
      strategy,
      singableLines: singable,
      timelineLines: hasTimeline ? (timeline as LyricLine[]).length : 0,
      matchedLines: matched,
      anchoredBubbles: anchoredCount,
      totalBubbles: bubbles.length,
      repeatInstances: repeats.length,
    },
  };
}
