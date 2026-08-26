/**
 * deleteWork 云函数（Event Function）
 * 职责：删除"我的作品"列表中的一条记录
 * - type=work：从 works 集合删除，同时删除云存储中的视频文件
 * - type=task：从 tasks 集合删除（未完成/失败的任务）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 获取当前云环境 ID（字符串），cloud.DYNAMIC_CURRENT_ENV 是 Symbol，不能直接拼字符串 */
function getEnvId() {
  try {
    const ctx = cloud.getWXContext();
    // wx-server-sdk 云函数中 ENV 为当前环境 ID
    if (typeof ctx.ENV === 'string' && ctx.ENV) return ctx.ENV;
  } catch (_) { /* ignore */ }
  // 兜底：从环境变量获取
  return process.env.TCB_ENV || process.env.TCB_ENV_ID || 'cloud1-d7ggdqfhgc4ee2796';
}

exports.main = async (event) => {
  const { id, type, videoUrl } = event;
  if (!id || !type) {
    return { success: false, message: '缺少 id 或 type 参数' };
  }

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  try {
    if (type === 'work') {
      // 所有权校验（容错：记录已不存在则跳过校验，继续清理文件）
      let workData = null;
      try { workData = (await db.collection('works').doc(id).get()).data; } catch (_) {}
      if (workData) {
        const ownerId = workData.userId || workData._openid || '';
        if (ownerId && ownerId !== openid) {
          return { success: false, message: '无权操作此作品' };
        }
        await db.collection('works').doc(id).remove();
      }

      // 删除云存储中的视频文件
      if (videoUrl && videoUrl.startsWith('cloud://')) {
        try {
          await cloud.deleteFile({ fileList: [videoUrl] });
        } catch (e) {
          console.warn('delete video file failed, continue:', e.message);
        }
      }
    } else if (type === 'task') {
      // 所有权校验（容错：记录已不存在则跳过校验，继续清理文件）
      let taskData = null;
      try { taskData = (await db.collection('tasks').doc(id).get()).data; } catch (_) {}
      if (taskData) {
        const ownerId = taskData.userId || taskData._openid || '';
        if (ownerId && ownerId !== openid) {
          return { success: false, message: '无权操作此任务' };
        }
        await db.collection('tasks').doc(id).remove();
      }

      // 清理云存储中可能存在的视频文件
      const filesToDelete = [];
      const resultUrl = taskData && taskData.resultVideoUrl;
      if (resultUrl && resultUrl.startsWith('cloud://')) {
        filesToDelete.push(resultUrl);
        const dir = resultUrl.substring(0, resultUrl.lastIndexOf('/'));
        const conventionPath = dir + '/' + id + '.mp4';
        if (conventionPath !== resultUrl && !filesToDelete.includes(conventionPath)) {
          filesToDelete.push(conventionPath);
        }
      } else {
        // 任务记录不存在或没有 resultVideoUrl 时，按约定路径兜底清理
        filesToDelete.push(`cloud://${getEnvId()}.6d6f/mv/${id}.mp4`);
      }

      if (filesToDelete.length > 0) {
        try {
          await cloud.deleteFile({ fileList: filesToDelete });
          console.log(`deleted ${filesToDelete.length} video file(s) for task ${id}`);
        } catch (e) {
          console.warn('delete task video files failed, continue:', e.message);
        }
      }
    } else {
      return { success: false, message: `未知的 type: ${type}` };
    }

    return { success: true, data: { id, type } };
  } catch (e) {
    console.error('deleteWork error', e.message, e.stack);
    return { success: false, message: e.message || '删除失败' };
  }
};
