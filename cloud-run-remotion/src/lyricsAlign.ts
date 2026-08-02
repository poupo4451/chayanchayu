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
}

/** 气泡之间至少间隔多少帧，避免多个气泡同帧堆叠 */
const MIN_GAP_FRAMES = 5;
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

// ── 核心：气泡出现帧 ────────────────────────────────────────────────

function uniformTimings(bubbles: BubbleData[], totalFrames: number): BubbleData[] {
  const n = Math.max(bubbles.length, 1);
  const per = Math.max(Math.floor(totalFrames / n), MIN_GAP_FRAMES);
  return bubbles.map((b, i) => {
    const startFrame = Math.min(i * per, Math.max(totalFrames - 1, 0));
    return { ...b, startFrame, endFrame: Math.min(startFrame + per, totalFrames) };
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

  // 无对齐所需数据 → 均匀分配
  if (!hasMap || !hasLyrics || (!hasTimeline && !hasWords)) {
    return {
      bubbles: uniformTimings(bubbles, totalFrames),
      beats: beatsFromTimeline(),
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

  // 对话条目的时间跨度；字级路径额外携带字符流区间索引（可选）
  type DT = Span & { startIdx?: number; endIdx?: number };
  const dialogueSpan = new Map<number, DT>();
  let charStream: TimedChar[] | null = null;
  let strategy: AlignReport['strategy'] = 'uniform';
  let singable = 0;
  let matched = 0;

  // ── 字级对齐主策略（有词级时间戳时优先）────────────────────────────
  if (hasWords) {
    const cr = buildTextLineTimeMapFromWords(lyrics as string, lyricsWords as LyricWord[]);
    charStream = cr.stream.length > 0 ? cr.stream : null;
    singable = cr.singable;
    matched = cr.matched;
    for (const m of lineMap as LineMapEntry[]) {
      if (!m || m.dialogueIndex < 0) continue;
      const cs = cr.map.get(m.lineIndex);
      if (!cs) continue;
      const cur = dialogueSpan.get(m.dialogueIndex);
      if (!cur) {
        dialogueSpan.set(m.dialogueIndex, {
          startS: cs.startS,
          endS: cs.endS,
          startIdx: cs.startIdx,
          endIdx: cs.endIdx,
        });
      } else {
        cur.startS = Math.min(cur.startS, cs.startS);
        cur.endS = Math.max(cur.endS, cs.endS);
        cur.startIdx = Math.min(cur.startIdx ?? cs.startIdx, cs.startIdx);
        cur.endIdx = Math.max(cur.endIdx ?? cs.endIdx, cs.endIdx);
      }
    }
    strategy = dialogueSpan.size > 0 ? 'char' : 'uniform';
  }

  // ── 降级：字级无锚点且有行级时间戳 → 回到行级模糊/序号对齐 ──────────
  if (dialogueSpan.size === 0 && hasTimeline) {
    const lr = buildTextLineTimeMap(lyrics as string, timeline as LyricLine[]);
    singable = lr.singable;
    matched = lr.matched;
    strategy = lr.strategy;
    charStream = null; // 行级路径无字符流
    for (const m of lineMap as LineMapEntry[]) {
      if (!m || m.dialogueIndex < 0) continue;
      const span = lr.map.get(m.lineIndex);
      if (!span) continue;
      const cur = dialogueSpan.get(m.dialogueIndex);
      if (!cur) dialogueSpan.set(m.dialogueIndex, { ...span });
      else {
        cur.startS = Math.min(cur.startS, span.startS);
        cur.endS = Math.max(cur.endS, span.endS);
      }
    }
  }

  if (dialogueSpan.size === 0) {
    return {
      bubbles: uniformTimings(bubbles, totalFrames),
      beats: beatsFromTimeline(),
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

  // 子气泡时间切分：有字符流区间时用字级，否则用比例
  const getSubSpan = (b: BubbleData): Span | null => {
    const dt = dialogueSpan.get(b.index);
    if (!dt) return null;
    if (charStream && dt.startIdx != null && dt.endIdx != null) {
      return subSpanFromChars(charStream, {
        startS: dt.startS,
        endS: dt.endS,
        startIdx: dt.startIdx,
        endIdx: dt.endIdx,
      }, b);
    }
    return subSpan(dt, b);
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

  // 4) endFrame：优先用歌词唱完的时间，但不越过下一个气泡
  const out = bubbles.map((b, i) => {
    const sub = getSubSpan(b);
    const nextStart = i + 1 < frames.length ? frames[i + 1] : totalFrames;
    const sungEnd = sub ? Math.round(sub.endS * fps) : frames[i] + fps;
    return {
      ...b,
      startFrame: frames[i],
      endFrame: Math.max(frames[i] + MIN_GAP_FRAMES, Math.min(Math.max(sungEnd, nextStart), totalFrames)),
    };
  });

  return {
    bubbles: out,
    beats: beatsFromTimeline(),
    report: {
      strategy,
      singableLines: singable,
      timelineLines: hasTimeline ? (timeline as LyricLine[]).length : 0,
      matchedLines: matched,
      anchoredBubbles: anchoredCount,
      totalBubbles: bubbles.length,
    },
  };
}
