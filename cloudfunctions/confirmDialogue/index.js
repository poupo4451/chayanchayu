/**
 * confirmDialogue 云函数（Event Function）
 * 职责：用户在对话预览页确认（可能编辑过）对话内容后，写回并触发后续链路：
 * renderChatScreenshots → generateLyrics → generateMusic → (music完成后) 触发 Remotion 渲染
 * 骨架阶段：串行触发各阶段云函数，全部使用 Mock Provider
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { taskId, dialogue } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');

  try {
    await tasksCol.doc(taskId).update({
      data: {
        dialogue: dialogue || [],
        status: 'generating_screenshots',
        progress: 30,
        updatedAt: Date.now(),
      },
    });

    // 异步触发截图渲染，不等待其完成（后续阶段由各云函数自行串联）
    cloud.callFunction({ name: 'renderChatScreenshots', data: { taskId } }).catch((e) => {
      console.error('trigger renderChatScreenshots failed', e);
    });

    return { success: true, data: { taskId } };
  } catch (e) {
    console.error('confirmDialogue error', e);
    return { success: false, message: e.message || '确认对话失败' };
  }
};
