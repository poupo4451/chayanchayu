/**
 * generateLyrics 云函数（Event Function）
 * 职责：调用真实 LLM（CloudBase AI，deepseek-v4-flash）将对话内容改编为指定风格歌词，
 * 并同时产出「歌词行 → 对话索引」映射（lineMap），用于后续把音频时间戳对齐到聊天气泡。
 * 然后触发 generateMusic。
 *
 * 输出存储（降级安全）：
 * - task.lyrics：纯文本歌词（generateMusic 读它提交 Suno，零影响）
 * - task.lyricsLineMap：[{lineIndex, dialogueIndex}]（解析失败则为 []，渲染时降级均匀分配）
 */
const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 55000 });

const db = cloud.database();

const MODEL_GROUP = 'cloudbase';
const MODEL_NAME = 'hy3';

// 带序号的对话清单，让 LLM 能精确映射 dialogueIndex
function formatDialogueWithIndex(dialogue) {
  return (dialogue || []).map((d, i) => {
    const type = d.type || 'text';
    if (type === 'time') {
      return `[${i}] 〔时间跳转到${d.text}〕`;
    }
    if (type === 'image') {
      return `[${i}] 〔${d.name}发了一个表情包〕`;
    }
    if (type === 'redpacket') {
      const amount = d.params && d.params.amount;
      return `[${i}] 〔${d.name}发了一个红包${amount ? `，金额${amount}元` : ''}${d.text ? `，留言"${d.text}"` : ''}〕`;
    }
    if (type === 'transfer') {
      const amount = d.params && d.params.amount;
      return `[${i}] 〔${d.name}转账${amount ? `${amount}元` : ''}${d.text ? `，备注"${d.text}"` : ''}〕`;
    }
    return `[${i}] ${d.name}: ${d.text}`;
  }).join('\n');
}

function buildPrompt({ dialogue, genre }) {
  const lines = formatDialogueWithIndex(dialogue);
  return `你是一位说唱/流行歌曲词作者。请把下面这段聊天对话改编成一首完整的中文歌词，风格为「${genre}」，并同时给出歌词行与对话条目的映射。

聊天对话内容（每行开头的 [数字] 是对话条目序号，用于映射）：
${lines}

要求：
1. 保留对话中的核心情节、梗和情绪冲突，转化为押韵、朗朗上口的歌词
2. 对话中的「〔〕」标注是场景提示（时间跳跃、发红包、转账、发表情包等动作），请在歌词中自然融入这些情节，但不要原样照搬括号格式
3. 使用 [Intro] [Verse 1] [Hook] [Verse 2] [Outro] 等段落标记分段（可根据内容适当增减段落）
4. 歌词整体贴合「${genre}」的节奏感和用词习惯
5. 总字数控制在120~220字之间（精简为主，便于快速生成与对齐）
6. 严格输出 JSON 对象，不要输出任何解释、说明或 markdown 代码块标记

输出 JSON 格式：
{
  "lyrics": "完整歌词文本（含 [Verse] 等段落标记，每行用 \\n 分隔）",
  "lineMap": [
    {"lineIndex": 0, "dialogueIndex": 0},
    {"lineIndex": 1, "dialogueIndex": 0},
    {"lineIndex": 2, "dialogueIndex": 2},
    ...
  ]
}

lineMap 规则：
- lineIndex：歌词按 \\n 切分后的行号（从0开始，含 [Intro]/[Verse] 等段落标记行）
- dialogueIndex：该歌词行源自哪条对话条目（用对话开头的 [数字]）
- 一条对话可对应多行歌词（多次出现）；纯段落标记行或间奏行若无对应对话，dialogueIndex 填 -1
- lineMap 必须覆盖歌词的每一行，长度等于歌词行数`;
}

async function callLLMForLyrics({ dialogue, genre }) {
  const ai = app.ai();
  const model = ai.createModel(MODEL_GROUP);
  const prompt = buildPrompt({ dialogue, genre });

  const result = await model.generateText({
    model: MODEL_NAME,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.85,
  });

  const raw = (result.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return raw;
}

// 解析 LLM 输出，分离出纯文本 lyrics 和 lineMap；失败则降级
function parseLyricsResult(raw) {
  let lyrics = '';
  let lineMap = [];

  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.lyrics === 'string') {
      lyrics = obj.lyrics.trim();
    }
    if (obj && Array.isArray(obj.lineMap)) {
      lineMap = obj.lineMap
        .filter((m) => m && typeof m.lineIndex === 'number' && typeof m.dialogueIndex === 'number')
        .map((m) => ({ lineIndex: m.lineIndex, dialogueIndex: m.dialogueIndex }));
    }
  } catch (_) {
    // JSON 解析失败：降级，把整段当纯文本歌词
    lyrics = raw;
  }

  // 如果 lyrics 解析出来了但 lineMap 空，尝试纯文本兜底
  if (!lyrics) {
    lyrics = raw;
  }

  return { lyrics, lineMap };
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    let lyrics = null;
    let lineMap = [];
    let lastError = null;
    // 注意：微信云函数超时上限 60s，单次 SDK 超时已设 55s；此处只试 1 次，
    // 避免 2 次重试累计 110s 超过平台限制被直接掐断。
    for (let attempt = 0; attempt < 1 && !lyrics; attempt += 1) {
      try {
        const raw = await callLLMForLyrics({
          dialogue: task.dialogue,
          genre: task.style.musicGenre,
        });
        const parsed = parseLyricsResult(raw);
        if (parsed.lyrics) {
          lyrics = parsed.lyrics;
          lineMap = parsed.lineMap;
        }
      } catch (e) {
        lastError = e;
        console.error(`generateLyrics LLM attempt ${attempt} failed`, e);
      }
    }

    if (!lyrics) {
      throw new Error((lastError && lastError.message) || 'AI歌词生成失败，请重试');
    }

    await tasksCol.doc(taskId).update({
      data: {
        lyrics,
        lyricsLineMap: lineMap,
        status: 'generating_music',
        progress: 55,
        updatedAt: Date.now(),
      },
    });

    cloud.callFunction({ name: 'generateMusic', data: { taskId } }).catch((e) => {
      console.error('trigger generateMusic failed', e);
    });

    return { success: true, data: { taskId, lyrics, lineMap } };
  } catch (e) {
    console.error('generateLyrics error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_lyrics',
        errorMsg: e.message || '歌词生成失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '歌词生成失败' };
  }
};
