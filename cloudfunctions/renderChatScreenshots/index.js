/**
 * renderChatScreenshots 云函数（Event Function）
 * 职责：不做视觉渲染，只做数据转换——把 dialogue 逐条转换为下游（Remotion）渲染所需的
 * 结构化气泡数据：补全默认 type/params，把 image 类型的 stickerId 解析为实际云存储 fileID，
 * 并把过长的文字消息按标点/长度拆成多条子气泡（一句话不用太多字，长了就拆开）。
 * 转换结果写入 task.screenshots，随后触发 generateLyrics。
 * 真正的气泡视觉渲染在 Remotion 阶段实现，本函数不生成任何图片。
 */
const cloud = require('wx-server-sdk');
const { getStickerUrl } = require('./stickers');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 单个气泡建议的最大字数，超过则尝试按标点拆分成多条子气泡 */
const MAX_BUBBLE_CHARS = 14;
/** 拆分后允许的字数上限缓冲（避免临界值反复拆出极短的尾巴） */
const SOFT_MAX_CHARS = Math.round(MAX_BUBBLE_CHARS * 1.4);
const SPLIT_PUNCTUATION = /([，,。.！!？?~～；;\n])/;

/**
 * 把一条较长的文字消息拆成多条子气泡文本。
 * 优先按标点断句，标点保留在前一段末尾；过短的分句会合并到相邻分句，
 * 避免出现只有一两个字的孤立气泡；拆完仍然过长的分句再按字数硬切。
 */
function splitTextIntoChunks(text) {
  const raw = String(text || '').trim();
  if (!raw) return [raw];
  if (raw.length <= MAX_BUBBLE_CHARS) return [raw];

  const parts = raw.split(SPLIT_PUNCTUATION);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i] || '';
    const punct = parts[i + 1] || '';
    const merged = (seg + punct).trim();
    if (merged) sentences.push(merged);
  }
  if (sentences.length === 0) sentences.push(raw);

  // 合并过短分句，避免孤立的一两个字
  const chunks = [];
  let buffer = '';
  sentences.forEach((seg) => {
    if (!buffer) {
      buffer = seg;
      return;
    }
    if ((buffer + seg).length <= MAX_BUBBLE_CHARS) {
      buffer += seg;
    } else {
      chunks.push(buffer);
      buffer = seg;
    }
  });
  if (buffer) chunks.push(buffer);

  // 硬切仍然超长的分句
  const final = [];
  chunks.forEach((chunk) => {
    if (chunk.length <= SOFT_MAX_CHARS) {
      final.push(chunk);
      return;
    }
    for (let i = 0; i < chunk.length; i += MAX_BUBBLE_CHARS) {
      final.push(chunk.slice(i, i + MAX_BUBBLE_CHARS));
    }
  });

  return final.length > 0 ? final : [raw];
}

function buildScreenshotData(dialogue) {
  const items = [];

  (dialogue || []).forEach((line, index) => {
    const type = line.type || 'text';
    const params = line.params || {};
    const avatarId = line.avatarId || '';
    const baseFields = { index, role: line.role, name: line.name || '', avatarId };

    if (type === 'text') {
      const chunks = splitTextIntoChunks(line.text || '');
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
      let cursor = 0;
      chunks.forEach((chunk, subIndex) => {
        const splitStart = cursor / totalLen;
        cursor += chunk.length;
        const splitEnd = subIndex === chunks.length - 1 ? 1 : cursor / totalLen;
        items.push({
          ...baseFields,
          uid: `${index}-${subIndex}`,
          subIndex,
          subTotal: chunks.length,
          type,
          text: chunk,
          params,
          splitStart,
          splitEnd,
        });
      });
      return;
    }

    const item = {
      ...baseFields,
      uid: `${index}-0`,
      subIndex: 0,
      subTotal: 1,
      type,
      text: line.text || '',
      params,
      splitStart: 0,
      splitEnd: 1,
    };
    if (type === 'image') {
      item.params = { ...params, imageUrl: getStickerUrl(params.stickerId) };
    }
    items.push(item);
  });

  return items;
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

    const screenshots = buildScreenshotData(task.dialogue);

    await tasksCol.doc(taskId).update({
      data: {
        screenshots,
        status: 'generating_lyrics',
        progress: 45,
        updatedAt: Date.now(),
      },
    });

    // 注意：generateLyrics 同样调用限流 LLM 并做退避重试，若通过 cloud.callFunction
    // 在此处触发，会遇到与 createTask→generateDialogue 相同的云函数间调用通道（约3秒）
    // 被平台判定超时而强杀下游执行的问题，导致任务卡在 generating_lyrics 不动。
    // 因此改为由小程序端（task-progress 轮询页）在检测到 generating_lyrics 且歌词为空时
    // 直接调用 generateLyrics（客户端调用无此限制）。

    return { success: true, data: { taskId, screenshots } };
  } catch (e) {
    console.error('renderChatScreenshots error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_screenshots',
        errorMsg: e.message || '截图渲染失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '截图渲染失败' };
  }
};
