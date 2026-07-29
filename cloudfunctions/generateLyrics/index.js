/**
 * generateLyrics 云函数（Event Function）
 * 职责：调用真实 LLM（CloudBase AI，deepseek-v4-flash）将对话内容改编为指定风格歌词，然后触发 generateMusic
 * 若 LLM 调用失败，任务标记为 failed
 */
const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const MODEL_GROUP = 'cloudbase';
const MODEL_NAME = 'deepseek-v4-flash';

function formatDialogueForLyrics(dialogue) {
  return (dialogue || []).map((d) => {
    const type = d.type || 'text';
    if (type === 'time') {
      return `〔时间跳转到${d.text}〕`;
    }
    if (type === 'image') {
      return `〔${d.name}发了一个表情包〕`;
    }
    if (type === 'redpacket') {
      const amount = d.params && d.params.amount;
      return `〔${d.name}发了一个红包${amount ? `，金额${amount}元` : ''}${d.text ? `，留言"${d.text}"` : ''}〕`;
    }
    if (type === 'transfer') {
      const amount = d.params && d.params.amount;
      return `〔${d.name}转账${amount ? `${amount}元` : ''}${d.text ? `，备注"${d.text}"` : ''}〕`;
    }
    return `${d.name}: ${d.text}`;
  }).join('\n');
}

function buildPrompt({ dialogue, genre }) {
  const lines = formatDialogueForLyrics(dialogue);
  return `你是一位说唱/流行歌曲词作者。请把下面这段聊天对话改编成一首完整的中文歌词，风格为「${genre}」。

聊天对话内容：
${lines}

要求：
1. 保留对话中的核心情节、梗和情绪冲突，转化为押韵、朗朗上口的歌词
2. 对话中的「〔〕」标注是场景提示（时间跳跃、发红包、转账、发表情包等动作），请在歌词中自然融入这些情节，但不要原样照搬括号格式
3. 使用 [Intro] [Verse 1] [Hook] [Verse 2] [Outro] 等段落标记分段（可根据内容适当增减段落）
4. 歌词整体贴合「${genre}」的节奏感和用词习惯
5. 总字数控制在200~400字之间
6. 只输出歌词文本本身，不要输出任何解释、说明或markdown代码块标记`;
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

  const text = (result.text || '').trim();
  return text.replace(/^```(?:\w+)?\s*/i, '').replace(/```\s*$/i, '').trim();
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
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !lyrics; attempt += 1) {
      try {
        const text = await callLLMForLyrics({
          dialogue: task.dialogue,
          genre: task.style.musicGenre,
        });
        if (text) lyrics = text;
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
        status: 'generating_music',
        progress: 55,
        updatedAt: Date.now(),
      },
    });

    cloud.callFunction({ name: 'generateMusic', data: { taskId } }).catch((e) => {
      console.error('trigger generateMusic failed', e);
    });

    return { success: true, data: { taskId, lyrics } };
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
