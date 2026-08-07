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
  return `你是一个"聊天记录变说唱MV"小程序的剧本编剧。请根据主题和对话语气，编写一段两人的微信聊天对话。

首先要像一段真实的微信聊天记录，然后才考虑它的故事性。真实的聊天记录是高低起伏、长短交错、情绪多变的，不是在轮流写作文。

主题：${topic}
对话语气：${tone}（如"绿茶"要暧昧试探/"毒舌"要犀利互怼/"搞笑"要抽象整活/"甜宠"要撩人心动）

━━━━━━━━━━━━━━━━━━━━━━
【1. 对话规模】
━━━━━━━━━━━━━━━━━━━━━━
输出 20~28 轮对话。不管是喜剧还是狗血，每一轮都要推动剧情或情绪，拒绝水词。剧情要有起承转合，至少经历一个小冲突或一次反转，让故事有完整的弧线。

━━━━━━━━━━━━━━━━━━━━━━
【2. 消息长度 —— 最重要的一条】
━━━━━━━━━━━━━━━━━━━━━━
微信聊天不是对对联！消息长度的自然分布是真实感的根基：

✅ 大部分消息 8~25 字 —— 一句半句中文，这是最自然的微信聊天长度
✅ 情绪爆发处可以飙到 30~40 字（大段吐槽/深情表白/连环追问）
✅ 穿插少量 1~5 字的极短回复（"？""嗯嗯""行""说"），但不是主角，只占 10%~20%

❌ 严禁：每条消息都 3~8 字。这不像聊天，像两个人在对暗号
❌ 严禁：每条消息长度差不多。有的人就是话多，有的人习惯拆成短句连发

【长度分布自检】
想象你正在翻一段真人聊天记录：有的气泡一行，有的两行，有的就一个字，还有的是一大段。如果翻了几十条发现气泡大小都差不多，那就是失败的作品。

━━━━━━━━━━━━━━━━━━━━━━
【3. 发言节奏 —— 不是乒乓球】
━━━━━━━━━━━━━━━━━━━━━━
这是微信聊天，不是回合制游戏。没有人会等你发一条才回一条。

硬性指标：
• 同一侧必须出现 3~5 处"连发 2~3 条"的段落（追问/碎碎念/补充/情绪上头停不下来）
• 至少 1 处"一方连发 3 条 + 对方只回 1 条"的非对称对话（单方输出、对方敷衍或无语）
• 至少 1 处情绪冷场后用 time 分隔，再由某一方打破沉默

【正确示例（好）】
左: "在干嘛"
左: "别装死我知道你看见了"      ← 左连发 2 条
右: "刚洗完澡"
右: "你至于吗"                   ← 右回 2 条
右: "又不欠你的"
左: "？"                         ← 极短回复打破节奏
左: "我关心你还关心错了？"
右: "你那叫关心？"                ← 仅 1 条，拒绝继续对话
左: "行，我不管了"                ← 情绪下行

【错误示例（坏，严禁）】
左: "在干嘛"
右: "刚洗澡"
左: "怎么不理我"
右: "没不理你"
左: "那你现在在干嘛"
右: "准备睡了"
左: "这么早？"
右: "困了"
↑ 这种严格交替的乒乓球模式是绝对禁止的！没有人这样聊天。

━━━━━━━━━━━━━━━━━━━━━━
【4. 情绪弧线 —— 按时间推进】
━━━━━━━━━━━━━━━━━━━━━━
对话的前中后要有明显的情绪温差，让观众看完后能感觉到"发生了什么"：

▸ 开场（前 20%）  — 日常/客气/试探，语气偏平，拉观众入戏
▸ 升温（中 30%） — 冲突萌芽/暧昧升级/话题展开，语气开始有起伏
▸ 高潮（中 30%） — 爆发点：吵架/表白/反转/破防/转账，语言密度最高，可能出现大段输出或连续追问
▸ 收尾（后 20%） — 余味/和解/悬念/开放式结局，不要硬着陆

用对话措辞本身来体现情绪变化，不要用任何说明文字标注情绪。

━━━━━━━━━━━━━━━━━━━━━━
【5. 角色差异化】
━━━━━━━━━━━━━━━━━━━━━━
两个人要有辨识度，不要让读者分不清谁在说话：

• 主动方：往往发起话题，消息偏长、会追问、情绪起伏更大
• 被动方：回复偏简洁，被逼急了才长篇输出，有"被拖入对话"的感觉
• 两人的语言风格要有区别。比如：一个爱用反问句，一个爱用省略号；一个句子完整，一个习惯断句

━━━━━━━━━━━━━━━━━━━━━━
【6. 特殊消息 —— 情绪调味剂】
━━━━━━━━━━━━━━━━━━━━━━
整段对话中插入 3~6 条非 text 类型，贴合上下文情绪，不要为了插入而插入：

• time：居中时间分隔条。至少 1~2 个，制造"对方好久没回""隔了一段时间又开始聊"的时间差感。格式：{"role":"left","name":"","type":"time","text":"14:32"}
• image：表情包，stickerId 从以下列表中选：${STICKER_IDS.join('、')}。格式：{"role":"left或right","name":"昵称","type":"image","text":"","params":{"stickerId":"..."}}
• redpacket：红包（安慰/道歉/示好时用），格式：{"role":"left或right","name":"昵称","type":"redpacket","text":"祝福语（≤10字）","params":{"amount":"8.88"}}
• transfer：转账（和解/补偿/还钱时用），格式：{"role":"left或right","name":"昵称","type":"transfer","text":"备注（可为空）","params":{"amount":"200"}}
• 非 text 类型不能是第一条或最后一条
• 每条非 text 类型出现的位置要有情感动机：不是"这里该放个表情包了"，而是"这个情绪下不发个表情包说不通"

━━━━━━━━━━━━━━━━━━━━━━
【7. 次要规则】
━━━━━━━━━━━━━━━━━━━━━━
• 角色昵称 2~4 字，符合人设
• 可适当使用 emoji，但要节制（1~2 条消息中出现即可，不要条条都有）
• left 和 right 的总数不必相等，大致 4:6 到 6:4 即可

━━━━━━━━━━━━━━━━━━━━━━
【输出格式】
━━━━━━━━━━━━━━━━━━━━━━
严格输出 JSON 数组，不要任何解释文字、markdown 标记或代码块符号。只输出数组本身：

[{"role":"left","name":"小美","type":"text","text":"..."},...]`;
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
  const MAX_EXTRA_TYPES = 6;
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
