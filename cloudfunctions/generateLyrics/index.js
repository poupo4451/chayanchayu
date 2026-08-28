/**
 * generateLyrics 云函数（Event Function）
 * 职责：调用真实 LLM（CloudBase AI，deepseek-v4-flash）把对话逐条改写成歌词，
 * 并由代码确定性生成「歌词行 → 对话索引」映射（lineMap），用于后续把音频时间戳对齐到聊天气泡。
 * 不再由本函数触发 generateMusic（原因见文末 exports.main 内注释），
 * 由小程序端 task-progress 轮询页检测到 status=generating_music 且尚无
 * musicProviderTaskId 时直接客户端调用。
 *
 * 设计要点（与旧版本的关键区别）：
 * - 旧版本让 LLM 把整段对话"改编"成一首带副歌重复结构的完整歌曲，内容被大幅重写、
 *   条数被压缩/复用，导致歌词与对话对不上、歌词与旋律也很难精确对齐。
 * - 新版本要求"每条对话对应且仅对应一句唱词"，顺序、数量严格跟对话走，不允许合并/
 *   拆分/增删/重复。lines 数量与对话条数是否一致由**代码**校验兜底，不完全依赖 LLM
 *   自觉遵守，即使 LLM 漏行/多行/完全失败，也会用兜底文案补齐，保证行数=对话数。
 * - lineMap 不再让 LLM 猜，而是代码按对话顺序确定性拼出，杜绝映射出错的风险。
 *
 * 输出存储（降级安全）：
 * - task.lyrics：纯文本歌词（generateMusic 读它提交 Suno，零影响）
 * - task.lyricsLineMap：[{lineIndex, dialogueIndex}]（dialogueIndex=-1 表示分声部标记行，不参与气泡对齐）
 */
const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
const { assignSpeakerGenders } = require('./genderAssign');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 55000 });

const db = cloud.database();

// 小程序成长计划升级后的 hy3 通过 cloudbase 模型组调用。
// 429 为并发限流，官方建议退避重试或换模型重试（不同模型资源池独立）。
const MODEL_GROUP = 'cloudbase';
const MODEL_CANDIDATES = ['hy3', 'hy3-preview'];
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;
const RETRY_MAX_DELAY_MS = 6000;
// 云函数超时 60s，这里限制 LLM 总耗时预算，超出即走兜底唱词，避免被平台掐断
const TOTAL_LLM_BUDGET_MS = 40000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(e) {
  return !!e && (String(e.code) === '429' || /429/.test(e.message || ''));
}

const RANDOM_GENRE_POOL = ['嘻哈', 'R&B', '流行', '抖音风', '粤语说唱'];

function resolveGenre(genre) {
  if (genre === '随机' || !genre) {
    return RANDOM_GENRE_POOL[Math.floor(Math.random() * RANDOM_GENRE_POOL.length)];
  }
  return genre;
}

/** 过滤掉 "time"（时间条）和 "image"（表情包）类型，这些不需要唱词，保留原始 dialogue 下标 */
function getSingableEntries(dialogue) {
  return (dialogue || [])
    .map((d, index) => ({ ...d, _originalIndex: index }))
    .filter((d) => {
      const type = d.type || 'text';
      return type !== 'time' && type !== 'image';
    });
}

/** 每条对话的兜底唱词：LLM 缺行/漏行/完全失败时用它保证「行数=对话数」这条硬约束。
 *  表情包（image）已在 getSingableEntries 中过滤，此处不再处理。 */
function fallbackLine(entry) {
  const type = entry.type || 'text';
  if (type === 'redpacket') {
    return `${entry.name || '有人'}发了个红包${entry.text ? `，写着${entry.text}` : ''}`.trim();
  }
  if (type === 'transfer') {
    return `${entry.name || '有人'}悄悄转了笔钱${entry.text ? `，备注${entry.text}` : ''}`.trim();
  }
  return (entry.text || '').trim() || '沉默了几秒';
}

// 带本地序号（0..N-1，不含 time/image 条目）的清单，供 LLM 逐条对应改写
// 表情包（image）已在 getSingableEntries 中过滤，此处不再处理
function formatSingableList(entries) {
  return entries
    .map((d, i) => {
      const type = d.type || 'text';
      if (type === 'redpacket') {
        const amount = d.params && d.params.amount;
        return `[${i}] 〔${d.name}发了一个红包${amount ? `，金额${amount}元` : ''}${d.text ? `，留言"${d.text}"` : ''}〕`;
      }
      if (type === 'transfer') {
        const amount = d.params && d.params.amount;
        return `[${i}] 〔${d.name}转账${amount ? `${amount}元` : ''}${d.text ? `，备注"${d.text}"` : ''}〕`;
      }
      return `[${i}] ${d.name}: ${d.text}`;
    })
    .join('\n');
}

function buildPrompt({ entries, genre, genderInfo }) {
  const list = formatSingableList(entries);
  const { speakerOrder, genderByName, isDuet } = genderInfo;
  const n = entries.length;

  const speakerGenderDesc = speakerOrder
    .map((name) => `「${name}」→ ${genderByName.get(name) === 'female' ? '女声' : '男声'}`)
    .join('；');

  const vocalNote = isDuet
    ? `本次是男女对唱：不同说话人的台词请按各自声部的语气/用词来写（说话人与声部对应：${speakerGenderDesc}），系统会自动在声部切换处插入分声部标记，你不需要自己写任何 [Verse]/[Chorus]/[Male]/[Female] 之类的段落或声部标记。`
    : `本次是单人视角：全部按 ${genderByName.get(speakerOrder[0]) === 'female' ? '女声' : '男声'} 的语气写，不需要写任何段落标记。`;

  const cantoneseNote = genre === '粤语说唱'
    ? '\n- 这是粤语说唱，每一句都要用粤语口语用词和粤语押韵习惯书写（比如"佈/嘅/唔/係/咩/啦"这类字词），不要写成普通话。'
    : '';

  return `你是一位专业说唱/流行歌曲词作者。下面是一段完整聊天对话，请把它改写成一首有清晰曲式结构（Intro-Verse-Chorus-Bridge-Outro）的歌曲歌词，风格为「${genre}」。

聊天对话内容（共 ${n} 条，每行开头 [数字] 是序号，输出时必须严格按这个顺序一一对应）：
${list}

说话人声部：${vocalNote}

改写要求：
1. **最高优先级：尽量直接用原文**。绝大多数句子直接用原对话文字即可，因为现代说唱/流行歌词本身就是口语化的。只有当原文字数太少（如"嗯""哦""好的"）或者读起来确实不押韵/拗口时，才做最小幅度的微调。能不动就不要动。
2. 输出的 lines 数组长度必须严格等于 ${n}，第 i 句对应且仅对应上面第 [i] 条对话，顺序不能变、不能跳过。
3. 内容、情节、语义要紧贴对应那条对话本身，不能编造原对话里没有的情节。
4. **副歌允许重复**：选出对话里情感最强烈、最有记忆点的 2~4 条作为副歌 hook，在 sections 里让它们重复 1~2 次。副歌行的内容必须和 lines 里对应的行完全一致（从 lines 里原样引用行号，不要重写内容）。
5. 严禁把对话中任何说话人的昵称/称呼原样写进歌词正文。
6. 「〔〕」标注的是特殊消息（红包/转账），用一句简短唱词描述这个动作或它带来的情绪即可。${cantoneseNote}
7. 严格输出 JSON 对象，不要输出任何解释、说明或 markdown 代码块标记。

输出 JSON 格式（lines 数组长度必须严格等于 ${n}）：
{
  "lines": ["第0条对应的唱词", "第1条对应的唱词", "..."],
  "sections": [
    {"tag": "Intro", "lineIndices": [0, 1]},
    {"tag": "Verse 1", "lineIndices": [2, 3, 4, 5]},
    {"tag": "Chorus", "lineIndices": [6, 7]},
    {"tag": "Verse 2", "lineIndices": [8, 9, 10, 11]},
    {"tag": "Chorus", "lineIndices": [6, 7]},
    {"tag": "Outro", "lineIndices": [12, 13]}
  ]
}

sections 要求：
- tag 从 Intro / Verse 1 / Chorus / Verse 2 / Bridge / Outro 中选择
- 每个 section 的 lineIndices 是 lines 数组的索引，所有 lineIndices 覆盖完整 0~${n - 1}，不允许遗漏任何索引
- 副歌 Chorus 的 lineIndices 必须引用之前已在其他 section 出现过的行号（从 lines 里原样重复），内容完全一致，不要重写
- 至少包含 1 个 Chorus 段，intro 可短（2~3 行），如果对话条数太少（<8 条）可省略 Bridge`;
}

async function callLLMForLyrics({ entries, genre, genderInfo, modelName }) {
  const ai = app.ai();
  const model = ai.createModel(MODEL_GROUP);
  const prompt = buildPrompt({ entries, genre, genderInfo });

  const result = await model.generateText({
    model: modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.85,
  });

  return (result.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

// 解析 LLM 输出的 lines 数组和 sections；解析失败或数量不对时不抛错，交给 reconcileLines / autoGenerateSections 兜底
function parseLinesResult(raw) {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const jsonStr = start !== -1 && end !== -1 && end > start ? raw.slice(start, end + 1) : raw;
    const obj = JSON.parse(jsonStr);
    if (obj && Array.isArray(obj.lines)) {
      return {
        lines: obj.lines.map((s) => (typeof s === 'string' ? s.trim() : '')),
        sections: Array.isArray(obj.sections) ? obj.sections : null,
      };
    }
  } catch (_) {
    // 忽略，走兜底
  }
  return { lines: [], sections: null };
}

/**
 * 把 LLM 生成的 lines 严格对齐到 entries 数量：
 * 多了截断；少了/该位置为空的用兜底唱词补齐。
 * 保证「对话有多少条，歌词就有多少句、顺序完全一致」这条硬约束由代码兜底，不完全依赖 LLM。
 */
function reconcileLines(llmLines, entries) {
  return entries.map((entry, i) => {
    const line = llmLines[i];
    return line && line.trim() ? line.trim() : fallbackLine(entry);
  });
}

/**
 * LLM 未输出 sections 时的规则引擎兜底：
 * - 前 2 行 → Intro
 * - 中间 → Verse N（每 4 行一组）
 * - 对话条数 ≥ 8 时，在约 1/3 处抽 2~3 行做 Chorus，并在倒数第 2 段前重复一次
 * - 最后 2 行 → Outro
 */
function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function autoGenerateSections(lineCount) {
  const sections = [];
  if (lineCount <= 4) {
    sections.push({ tag: 'Intro', lineIndices: [...Array(lineCount).keys()] });
    return sections;
  }

  // Intro: first 2 lines
  sections.push({ tag: 'Intro', lineIndices: [0, 1] });
  let cursor = 2;

  // Determine chorus position: around 1/3 through
  const hasChorus = lineCount >= 8;
  const chorusStart = hasChorus ? Math.floor(lineCount / 3) : lineCount;
  const chorusSize = Math.min(3, lineCount - chorusStart - 2);
  const chorusIndices = hasChorus && chorusSize >= 1 ? range(chorusStart, chorusStart + chorusSize - 1) : null;

  // Verse 1: from cursor to chorusStart (or to last 2 lines if no chorus)
  if (hasChorus && cursor < chorusStart) {
    sections.push({ tag: 'Verse 1', lineIndices: range(cursor, chorusStart - 1) });
  } else if (!hasChorus && cursor < lineCount - 2) {
    sections.push({ tag: 'Verse 1', lineIndices: range(cursor, lineCount - 3) });
    cursor = lineCount - 2;
  }

  // Chorus (first appearance)
  if (hasChorus && chorusIndices) {
    sections.push({ tag: 'Chorus', lineIndices: chorusIndices });
    cursor = chorusStart + chorusSize;
  }

  // Remaining lines between first chorus and outro
  const outroCount = Math.min(2, lineCount - cursor);
  const remainingBeforeOutro = lineCount - cursor - outroCount;
  if (remainingBeforeOutro > 0) {
    sections.push({ tag: 'Verse 2', lineIndices: range(cursor, cursor + remainingBeforeOutro - 1) });
    cursor += remainingBeforeOutro;

    // Repeat chorus
    if (hasChorus && chorusIndices) {
      sections.push({ tag: 'Chorus', lineIndices: chorusIndices });
    }
  }

  // Outro: last 2 lines
  if (cursor < lineCount) {
    sections.push({ tag: 'Outro', lineIndices: range(cursor, lineCount - 1) });
  }

  return sections;
}

/**
 * 按 sections 结构组装歌词文本 + lyricsLineMap。
 * 声部标记 [Male]/[Female] 嵌套在 section 标记 [Verse]/[Chorus] 之下。
 * 副歌重复行：同一个 dialogueIndex 在 lyricsLineMap 中出现多次（不同 lineIndex），
 * 渲染层 computeBubbleTimings 的 span 合并逻辑会自动兜底，气泡不会消失又出现。
 */
function assembleLyrics({ entries, lines, genderInfo, sections }) {
  const { genderByName, isDuet } = genderInfo;
  const rows = [];

  for (const sec of sections) {
    // Section tag: [Intro], [Verse 1], [Chorus], etc.
    rows.push({ text: `[${sec.tag}]`, dialogueIndex: -1 });

    let lastGender = null;
    for (const idx of sec.lineIndices) {
      const entry = entries[idx];
      const line = lines[idx];
      if (!line) continue;

      if (isDuet) {
        const gender = genderByName.get(entry.name) === 'female' ? 'female' : 'male';
        if (gender !== lastGender) {
          rows.push({ text: gender === 'female' ? '[Female]' : '[Male]', dialogueIndex: -1 });
          lastGender = gender;
        }
      }
      rows.push({ text: line, dialogueIndex: entry._originalIndex });
    }
  }

  const lyrics = rows.map((r) => r.text).join('\n');
  const lineMap = rows.map((r, lineIndex) => ({ lineIndex, dialogueIndex: r.dialogueIndex }));
  return { lyrics, lineMap };
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const openid = cloud.getWXContext().OPENID || '';
  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    if (!task) {
      return { success: false, message: '任务不存在' };
    }

    // ── 客户端调用的前置校验（服务端函数调用无 OPENID，直接放行）──
    // 本函数会把任务推进到 generating_music，是付费链路的入口之一，
    // 因此要求调用者是任务所有者且任务已在 confirmDialogue 合法扣过每日额度。
    if (openid) {
      if (task.userId !== openid) {
        return { success: false, code: 'FORBIDDEN', message: '无权操作此任务' };
      }
      if (!task.quotaDateKey) {
        return { success: false, code: 'QUOTA_REQUIRED', message: '任务状态异常，请重新发起创作' };
      }
    }

    const genre = resolveGenre(task.style && task.style.musicGenre);
    const genderInfo = assignSpeakerGenders(task.dialogue);
    const entries = getSingableEntries(task.dialogue);

    if (entries.length === 0) {
      throw new Error('对话内容为空，无法创作歌词');
    }

    let llmLines = [];
    let llmSections = null;
    let lastError = null;
    const startedAt = Date.now();
    // 429 是并发限流，瞬发重试只会持续被拒；这里做退避 + 模型轮换，
    // 并用总预算限制耗时。即使全部失败，下面也会用兜底唱词补齐，不阻塞主流程。
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const modelName = MODEL_CANDIDATES[attempt % MODEL_CANDIDATES.length];
      try {
        const raw = await callLLMForLyrics({ entries, genre, genderInfo, modelName });
        const parsed = parseLinesResult(raw);
        llmLines = parsed.lines;
        llmSections = parsed.sections;
        if (llmLines.length > 0) {
          lastError = null;
          break;
        }
      } catch (e) {
        lastError = e;
        console.error(
          `generateLyrics LLM attempt ${attempt} failed (model=${modelName}, rateLimited=${isRateLimitError(e)}):`,
          e.message
        );
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= TOTAL_LLM_BUDGET_MS || attempt === MAX_ATTEMPTS - 1) break;

      const delay = isRateLimitError(lastError)
        ? Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS)
        : 500;
      if (TOTAL_LLM_BUDGET_MS - elapsed <= delay) break;
      await sleep(delay);
    }

    if (lastError) {
      console.error('generateLyrics LLM unavailable, fallback to raw dialogue text');
    }

    if (llmLines.length !== entries.length) {
      console.warn(
        `generateLyrics: LLM返回${llmLines.length}行，与对话数${entries.length}不符，将用兜底文案补齐/截断`
      );
    }

    const lines = reconcileLines(llmLines, entries);

    // 兜底：LLM 未返回 sections 或 sections 不完整 → 规则引擎自动生成
    let sections = llmSections;
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      sections = autoGenerateSections(entries.length);
    }

    const { lyrics, lineMap } = assembleLyrics({ entries, lines, genderInfo, sections });

    await tasksCol.doc(taskId).update({
      data: {
        lyrics,
        lyricsLineMap: lineMap,
        lyricsSections: sections,
        'style.musicGenre': genre,
        'style.vocalMode': genderInfo.vocalMode,
        status: 'generating_music',
        progress: 55,
        errorStage: '',
        errorMsg: '',
        updatedAt: Date.now(),
      },
    });

    // 注意：不再通过 cloud.callFunction 触发 generateMusic。
    // 原因：云函数间调用存在一条独立于被调函数自身 Timeout 配置的约 3 秒调用通道限制，
    // generateMusic 内部要提交请求到 Suno 音乐生成 API（外部网络调用），耗时一旦超过
    // 这条通道限制就会被平台强杀，导致任务卡在 generating_music、musicProviderTaskId 始终为空。
    // 现改为由小程序端 task-progress 轮询页检测到该状态后直接客户端调用 generateMusic。

    return { success: true, data: { taskId, lyrics, lineMap, llmFailed: !!lastError } };
  } catch (e) {
    console.error('generateLyrics error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_lyrics',
        errorMsg: e.message || '歌词创作失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '歌词创作失败' };
  }
};
