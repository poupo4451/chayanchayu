/**
 * notifyAndFinalize 云函数（Event Function）
 * 职责：渲染完成后更新works集合、发送订阅消息通知
 * 骨架阶段：暂未接入真实 Remotion 渲染（云托管服务待第4步接入），
 * 先用占位视频地址模拟"rendering_video → completed"流转，验证状态机与作品落库
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const PLACEHOLDER_VIDEO_URL = 'https://cloud-tips-1300000000.cos.ap-shanghai.myqcloud.com/placeholder-mv.mp4';

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');
  const worksCol = db.collection('works');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    // TODO: 第4步接入云托管 Remotion 服务后，这里改为真实渲染产物 URL
    const resultVideoUrl = task.resultVideoUrl || PLACEHOLDER_VIDEO_URL;

    await tasksCol.doc(taskId).update({
      data: {
        resultVideoUrl,
        status: 'completed',
        progress: 100,
        updatedAt: Date.now(),
      },
    });

    await worksCol.add({
      data: {
        taskId,
        userId: task.userId,
        title: task.topic,
        videoUrl: resultVideoUrl,
        duration: task.audioDuration || 30,
        style: task.style,
        createdAt: Date.now(),
      },
    });

    // TODO: 接入订阅消息通知（需要 tmplId，用户提供后再补充）

    return { success: true, data: { taskId, resultVideoUrl } };
  } catch (e) {
    console.error('notifyAndFinalize error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'rendering_video',
        errorMsg: e.message || '视频合成失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '视频合成失败' };
  }
};
