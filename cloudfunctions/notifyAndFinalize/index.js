/**
 * notifyAndFinalize 云函数（Event Function）
 * 职责：音乐产出后，触发云托管 Remotion 服务渲染 MV 视频
 * 通过 HTTP POST 调用云托管服务的 /render 端点（云托管异步处理并更新 task 状态）
 * 不再直接设置 completed——渲染由云托管服务异步完成，渲染完后云托管服务自行更新 task
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 与当前 CloudBase 环境的 chat-mv-remotion 服务保持一致；环境变量可用于显式覆盖。
const REMOTION_SERVICE_URL =
  process.env.REMOTION_SERVICE_URL ||
  'https://chat-mv-remotion-290686-7-1462201626.sh.run.tcloudbase.com';

function postToRenderService(taskId) {
  if (!REMOTION_SERVICE_URL) {
    return Promise.reject(new Error('缺少 REMOTION_SERVICE_URL 环境变量配置'));
  }

  return new Promise((resolve, reject) => {
    const url = new URL('/render', REMOTION_SERVICE_URL);
    const data = JSON.stringify({ taskId });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
        timeout: 90000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.write(data);
    req.end();
  });
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const openid = cloud.getWXContext().OPENID || '';
  const tasksCol = db.collection('tasks');

  try {
    // ── 客户端调用的前置校验（服务端定时器 pollMusicStatus 无 OPENID，直接放行）──
    // 云托管 Remotion 渲染按 CPU/时长计费，必须确认调用者是任务所有者，
    // 且该任务已在 confirmDialogue 正常扣过每日额度。
    if (openid) {
      const taskRes = await tasksCol.doc(taskId).get();
      const task = taskRes.data;
      if (!task) {
        return { success: false, message: '任务不存在' };
      }
      if (task.userId !== openid) {
        return { success: false, code: 'FORBIDDEN', message: '无权操作此任务' };
      }
      if (!task.quotaDateKey) {
        return { success: false, code: 'QUOTA_REQUIRED', message: '任务状态异常，请重新发起生成' };
      }
    }

    const result = await postToRenderService(taskId);
    // 状态保持 rendering_video，等云托管渲染完后更新为 completed
    return {
      success: true,
      data: { taskId, message: 'rendering triggered', service: result.body },
    };
  } catch (e) {
    console.error('notifyAndFinalize error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'rendering_video',
        errorMsg: e.message || '触发视频渲染失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '触发视频渲染失败' };
  }
};
