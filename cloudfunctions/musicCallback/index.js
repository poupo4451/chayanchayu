/**
 * musicCallback 云函数（HTTP Function）
 * 职责：接收 Suno API（sunoapi.org）的音乐生成回调通知
 * - 回调 URL 中通过 query 参数 taskId 携带我方任务ID（由 generateMusic 提交任务时拼接）
 * - callbackType 分三阶段：text（歌词/文本完成）、first（首曲完成）、complete（全部完成）
 * - 仅在 complete 阶段落库并触发后续视频渲染；text/first 仅作为进度参考，不做终态更新
 * - 必须在15秒内返回200，否则Suno会重试（连续3次失败后停止重试），因此这里做了幂等判断
 */
const cloud = require('wx-server-sdk');
const http = require('http');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const taskId = url.searchParams.get('taskId');
  const body = await readJsonBody(req);

  if (!taskId) {
    console.error('musicCallback: 缺少 taskId 查询参数', JSON.stringify(body));
    return sendJson(res, 200, { received: true, warning: 'missing taskId' });
  }

  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    if (!task) {
      console.error('musicCallback: 找不到对应任务', taskId);
      return sendJson(res, 200, { received: true, warning: 'task not found' });
    }

    // 幂等保护：任务已不在 generating_music 阶段（说明本回调已处理过或任务已进入其他终态）
    if (task.status !== 'generating_music') {
      return sendJson(res, 200, { received: true, note: 'already processed' });
    }

    const payload = (body && body.data) || {};
    const callbackType = payload.callbackType;
    const code = body && body.code;

    if (code !== 200 || callbackType === 'error') {
      await tasksCol.doc(taskId).update({
        data: {
          status: 'failed',
          errorStage: 'generating_music',
          errorMsg: (body && body.msg) || 'Suno音乐制作失败',
          updatedAt: Date.now(),
        },
      });
      return sendJson(res, 200, { received: true });
    }

    if (callbackType !== 'complete') {
      // text / first 阶段，仅确认收到，不做状态迁移
      return sendJson(res, 200, { received: true });
    }

    const songs = Array.isArray(payload.data) ? payload.data : [];
    const first = songs.find((s) => s && s.audio_url) || songs[0];

    if (!first || !first.audio_url) {
      await tasksCol.doc(taskId).update({
        data: {
          status: 'failed',
          errorStage: 'generating_music',
          errorMsg: 'Suno回调未包含有效音频链接',
          updatedAt: Date.now(),
        },
      });
      return sendJson(res, 200, { received: true });
    }

    await tasksCol.doc(taskId).update({
      data: {
        audioUrl: first.audio_url || first.audioUrl || '',
        audioId: first.id || first.audioId || '',
        audioDuration: first.duration || 0,
        musicTitle: first.title || '',
        // 保持 generating_music，等 fetchLyricsTimestamps 拿到时间戳后再进 rendering_video
        status: 'generating_music',
        progress: 70,
        updatedAt: Date.now(),
      },
    });

    // 注意：不再通过 cloud.callFunction 触发 fetchLyricsTimestamps。
    // 原因：云函数间调用存在一条独立于被调函数自身 Timeout 配置的约 3 秒调用通道限制，
    // fetchLyricsTimestamps 要调用外部 Suno API，容易超过这条限制被平台强杀。
    // 音频结果已落库，后续由小程序端 task-progress 轮询页检测到
    // status=generating_music 且已有 audioUrl 时，直接客户端调用 fetchLyricsTimestamps。

    return sendJson(res, 200, { received: true });
  } catch (e) {
    console.error('musicCallback processing error', e);
    try {
      await tasksCol.doc(taskId).update({
        data: {
          status: 'failed',
          errorStage: 'generating_music',
          errorMsg: e.message || '回调处理失败',
          updatedAt: Date.now(),
        },
      });
    } catch (_) {
      // ignore secondary failure
    }
    return sendJson(res, 200, { received: true });
  }
});

server.listen(9000);
