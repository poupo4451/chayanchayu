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

// 云托管 Remotion 服务的公网域名（从云托管控制台获取）
const REMOTION_SERVICE_URL =
  process.env.REMOTION_SERVICE_URL ||
  'https://chat-mv-remotion-288614-10-1459907343.sh.run.tcloudbase.com';

function postToRenderService(taskId) {
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
        timeout: 30000,
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

  const tasksCol = db.collection('tasks');

  try {
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
