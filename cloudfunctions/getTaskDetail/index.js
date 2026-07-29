/**
 * getTaskDetail 云函数（Event Function）
 * 职责：查询任务详情，供小程序端轮询/预览页读取
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  try {
    const res = await db.collection('tasks').doc(taskId).get();
    const task = res.data;
    return {
      success: true,
      data: {
        taskId,
        status: task.status,
        progress: task.progress,
        dialogue: task.dialogue,
        lyrics: task.lyrics,
        audioUrl: task.audioUrl,
        resultVideoUrl: task.resultVideoUrl,
        errorStage: task.errorStage,
        errorMsg: task.errorMsg,
      },
    };
  } catch (e) {
    console.error('getTaskDetail error', e);
    return { success: false, message: e.message || '查询任务失败' };
  }
};
