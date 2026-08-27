/**
 * createTask 云函数（Event Function）
 * 职责：创建任务记录，写入 tasks 集合（status: pending）
 * 对话生成由小程序端进入对话预览页时直接调用 generateDialogue 触发（见下方注释原因）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 注意：对话生成不再由本函数通过 cloud.callFunction 触发。
// 原因：云函数间同步调用存在一个独立于被调函数自身 Timeout 配置的约 3 秒调用通道限制，
// 一旦 LLM 触发限流需要退避重试（哪怕只是 1.5~8 秒），该通道就会被平台判定超时，
// 进而强杀下游函数执行，导致任务卡在 generating_dialogue/进度10% 不再往后推进。
// 现改为由小程序端在进入对话预览页时直接调用 generateDialogue（客户端调用无此限制，
// 与"重新生成"按钮走的是同一条稳定路径）。

exports.main = async (event, context) => {
  const { topic, dialogueTone, musicGenre } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  if (!openid) {
    return { success: false, message: '无法获取用户标识，请重新进入小程序后再试' };
  }

  if (!topic) {
    return { success: false, message: '缺少 topic 参数' };
  }

  const now = Date.now();

  try {
    const addRes = await db.collection('tasks').add({
      data: {
        userId: openid,
        topic,
        style: {
          dialogueTone: dialogueTone || '绿茶',
          musicGenre: musicGenre || '嘻哈',
        },
        status: 'pending',
        progress: 0,
        dialogue: [],
        lyrics: '',
        audioUrl: '',
        screenshots: [],
        resultVideoUrl: '',
        errorStage: '',
        errorMsg: '',
        // 完成通知（一次性订阅消息）状态机，由 confirmDialogue / setTaskNotify 写入，
        // sendTaskNotify 消费：none → pending → sending → sent / failed
        notifyState: 'none',
        notifyTemplateId: '',
        createdAt: now,
        updatedAt: now,
      },
    });

    const taskId = addRes._id;

    return { success: true, data: { taskId } };
  } catch (e) {
    console.error('createTask error', e);
    return { success: false, message: e.message || '创建任务失败' };
  }
};
