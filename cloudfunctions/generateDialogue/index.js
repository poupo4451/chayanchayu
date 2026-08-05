/**
 * generateDialogue 云函数（Event Function）
 * 职责：调用真实 LLM（CloudBase AI，deepseek-v4-flash）生成对话文案，更新任务状态
 * 若 LLM 返回内容解析失败，会重试一次；仍失败则任务标记为 failed，由前端提示用户重试
 */
const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
const { STICKER_IDS } = require('./stickers');
const { assignAvatars } = require('./avatarAssign');
const { assignStickerUrls } = require('./stickerAssign');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 55000 });

const db = cloud.database();

// 小程序成长计划升级后的 hy3 通过 cloudbase 模型组调用。
// 429 是并发限流（环境级默认 10 并发 + 模型全局资源池共享），官方建议退避重试或换模型重试，
// 且不同模型的资源池相互独立，因此这里在 hy3 / hy3-preview 之间轮换并做指数退避。
const MODEL_GROUP = 'cloudbase';
const MODEL_CANDIDATES = ['hy3', 'hy3-preview'];
const MAX_ATTEMPTS = 6;
const RETRY_BASE_DELAY_MS = 1500;
const RETRY_MAX_DELAY_MS = 8000;
// 云函数超时 60s，留出数据库读写与冷启动余量后的 LLM 总预算
const TOTAL_LLM_BUDGET_MS = 45000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(e) {
  return !!e && (String(e.code) === '429' || /429/.test(e.message || ''));
}

const VALID_TYPES = ['text', 'time', 'image', 'redpacket', 'transfer'];

function buildPrompt({ topic, tone }) {
  return `你是一个短视频"聊天记录变说唱MV"小程序的剧本编剧。请根据主题和对话语气，编写一段两人的聊天对话，风格要生动有梗，适合截图做成聊天记录展示。

主题：${topic}
对话语气：${tone}（如"绿茶"要暧昧试探、"毒舌"要犀利互怼、"搞笑"要抽象整活）

要求：
1. 严格输出 JSON 数组，不要输出任何多余文字、markdown代码块标记或解释
2. 数组包含 12~30 轮对话；具体轮数由剧情节奏和信息量自然决定——情节简单就少一点（12~18轮左右），情节有起承转合、需要铺垫反转就多一点（可以到25~30轮），但不要为了凑数而注水、重复啰嗦或硬拉长
   - 【重要】不要严格交替发言！真实聊天中一个人经常连续发2~3条消息（比如连续吐槽、追问、补充），让对话有自然的"连发感"，偶尔出现同一角色连续2条再切回对方
   - 整体 left 和 right 的比例大致在 4:6 到 6:4 之间即可，不必精确相等，更不必严格交替
3. 每个元素默认格式：{"role":"left"或"right","name":"角色昵称","type":"text","text":"对话内容"}
4. 角色昵称要符合主题人设（2~4个字），对话内容口语化、有反转或包袱，单条不超过40字，可适当使用emoji调味
5. 【特殊消息类型】除了默认的 "text"，你还可以使用以下类型让对话更生动，但整段对话中【非text类型总共最多出现2~4条，且不能是第一条或最后一条】：
   - "time"：居中的时间分隔条，格式：{"role":"left","name":"","type":"time","text":"14:32"}（text为时间文案，role随意填但不会显示）
   - "image"：发一个表情包，格式：{"role":"left"或"right","name":"角色昵称","type":"image","text":"","params":{"stickerId":"从下面列表中选一个"}}，stickerId 可选值：${STICKER_IDS.join('、')}
   - "redpacket"：发红包，格式：{"role":"left"或"right","name":"角色昵称","type":"redpacket","text":"祝福语（不超过10字）","params":{"amount":"金额数字字符串，如8.88"}}
   - "transfer"：转账，格式：{"role":"left"或"right","name":"角色昵称","type":"transfer","text":"转账备注（可为空字符串）","params":{"amount":"金额数字字符串，如200"}}
6. 是否插入特殊类型、插入哪种、插入在第几轮，由你根据剧情自主判断，要贴合上下文情绪（比如吵架后转账道歉、暧昧时发红包等），不要生硬插入
7. 只返回 JSON 数组本身，例如：[{"role":"left","name":"小美","type":"text","text":"..."},...]`;
}

function isValidExtraMessage(item) {
  if (item.type === 'time') {
    return typeof item.text === 'string' && item.text.trim();
  }
  if (item.type === 'image') {
    return (
      item.params &&
      typeof item.params.stickerId === 'string' &&
      STICKER_IDS.includes(item.params.stickerId)
    );
  }
  if (item.type === 'redpacket' || item.type === 'transfer') {
    return (
      item.params &&
      typeof item.params.amount !== 'undefined' &&
      String(item.params.amount).trim() &&
      !Number.isNaN(Number(item.params.amount))
    );
  }
  return false;
}

function parseDialogueResult(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // 去除可能存在的 markdown 代码块标记
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  const jsonStr = cleaned.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const valid = parsed.every((item) => {
    if (
      !item ||
      (item.role !== 'left' && item.role !== 'right') ||
      typeof item.name !== 'string' ||
      typeof item.text !== 'string'
    ) {
      return false;
    }
    const type = item.type || 'text';
    if (!VALID_TYPES.includes(type)) return false;
    if (type === 'text') {
      return item.name.trim() && item.text.trim();
    }
    return isValidExtraMessage({ ...item, type });
  });
  if (!valid) return null;

  // 归一化：补全默认 type，非法/多余的特殊类型条数做兜底（超过上限的后续全部降级为text）
  const MAX_EXTRA_TYPES = 4;
  let extraCount = 0;
  const normalized = parsed.map((item, idx) => {
    const type = item.type || 'text';
    const isFirstOrLast = idx === 0 || idx === parsed.length - 1;
    if (type !== 'text' && (isFirstOrLast || extraCount >= MAX_EXTRA_TYPES)) {
      return { role: item.role, name: item.name, type: 'text', text: item.text || '...' };
    }
    if (type !== 'text') extraCount += 1;
    return { role: item.role, name: item.name, type, text: item.text, params: item.params || {} };
  });

  return normalized;
}

async function callLLMForDialogue({ topic, tone, modelName }) {
  const ai = app.ai();
  const model = ai.createModel(MODEL_GROUP);
  const prompt = buildPrompt({ topic, tone });

  const result = await model.generateText({
    model: modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
  });

  return parseDialogueResult(result.text);
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');

  try {
    await tasksCol.doc(taskId).update({
      data: { status: 'generating_dialogue', progress: 10, updatedAt: Date.now() },
    });

    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;
    const params = { topic: task.topic, tone: task.style.dialogueTone };

    let dialogue = null;
    let lastError = null;
    const startedAt = Date.now();

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !dialogue; attempt += 1) {
      const modelName = MODEL_CANDIDATES[attempt % MODEL_CANDIDATES.length];
      try {
        dialogue = await callLLMForDialogue({ ...params, modelName });
      } catch (e) {
        lastError = e;
        console.error(
          `generateDialogue LLM attempt ${attempt} failed (model=${modelName}, rateLimited=${isRateLimitError(e)})`,
          e.message
        );
      }

      if (dialogue) break;

      const elapsed = Date.now() - startedAt;
      if (elapsed >= TOTAL_LLM_BUDGET_MS || attempt === MAX_ATTEMPTS - 1) break;

      // 限流场景必须退避等待；解析失败则短暂等待后换模型再试
      const delay = isRateLimitError(lastError)
        ? Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS)
        : 500;
      const remaining = TOTAL_LLM_BUDGET_MS - elapsed;
      if (remaining <= delay) break;
      await sleep(delay);
    }

    if (!dialogue) {
      if (isRateLimitError(lastError)) {
        throw new Error('AI服务当前繁忙（并发受限），请稍后重试');
      }
      throw new Error((lastError && lastError.message) || 'AI对话生成解析失败，请重试');
    }

    // 为每个说话人稳定分配默认头像标识（如 male-2），全程保持一致
    dialogue = assignAvatars(dialogue);
    // 把 LLM 输出的 stickerId 翻译成 imageUrl，避免前端因读不到图片而出现"空气泡"
    dialogue = assignStickerUrls(dialogue);

    await tasksCol.doc(taskId).update({
      data: {
        dialogue,
        status: 'generating_dialogue',
        progress: 20,
        errorStage: '',
        errorMsg: '',
        updatedAt: Date.now(),
      },
    });

    return { success: true, data: { taskId, dialogue } };
  } catch (e) {
    console.error('generateDialogue error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_dialogue',
        errorMsg: e.message || '对话生成失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '对话生成失败' };
  }
};
