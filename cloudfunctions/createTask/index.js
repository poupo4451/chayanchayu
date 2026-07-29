/**
 * createTask 云函数（Event Function）
 * 职责：创建任务记录，写入 tasks 集合，触发后续 generateDialogue 云函数
 * 创建任务记录后异步触发 generateDialogue（真实 AI 对话生成）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { topic, dialogueTone, musicGenre } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || 'mock-user';

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
        createdAt: now,
        updatedAt: now,
      },
    });

    const taskId = addRes._id;

    // 触发对话生成云函数（异步调用，不阻塞返回）
    await cloud.callFunction({
      name: 'generateDialogue',
      data: { taskId },
    });

    return { success: true, data: { taskId } };
  } catch (e) {
    console.error('createTask error', e);
    return { success: false, message: e.message || '创建任务失败' };
  }
};
