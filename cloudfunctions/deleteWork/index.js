/**
 * deleteWork 云函数（Event Function）
 * 职责：删除"我的作品"列表中的一条记录
 * - type=work：从 works 集合删除，同时删除云存储中的视频文件
 * - type=task：从 tasks 集合删除（未完成/失败的任务）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { id, type, videoUrl } = event;
  if (!id || !type) {
    return { success: false, message: '缺少 id 或 type 参数' };
  }

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  try {
    if (type === 'work') {
      // 所有权校验：只能删除自己的作品
      const workDoc = await db.collection('works').doc(id).get();
      if (!workDoc.data || workDoc.data.userId !== openid) {
        return { success: false, message: '无权操作此作品' };
      }

      // 删除 works 集合记录
      await db.collection('works').doc(id).remove();

      // 删除云存储中的视频文件
      if (videoUrl && videoUrl.startsWith('cloud://')) {
        try {
          await cloud.deleteFile({ fileList: [videoUrl] });
        } catch (e) {
          console.warn('delete video file failed, continue:', e.message);
        }
      }
    } else if (type === 'task') {
      // 所有权校验：只能删除自己的任务
      const taskDoc = await db.collection('tasks').doc(id).get();
      if (!taskDoc.data || taskDoc.data.userId !== openid) {
        return { success: false, message: '无权操作此任务' };
      }

      // 删除 tasks 集合记录
      await db.collection('tasks').doc(id).remove();
    } else {
      return { success: false, message: `未知的 type: ${type}` };
    }

    return { success: true, data: { id, type } };
  } catch (e) {
    console.error('deleteWork error', e);
    return { success: false, message: e.message || '删除失败' };
  }
};
