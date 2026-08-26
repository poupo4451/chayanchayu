/**
 * generateMusic 云函数（Event Function）
 * 职责：调用 Suno API（sunoapi.org）提交音乐生成任务
 * 音乐生成本身耗时 1-3 分钟，远超云函数超时限制，因此本函数只负责"提交任务"。
 * 后续结果优先通过 pollMusicStatus 主动轮询推进；若配置了 musicCallback HTTP 回调，也可作为补充通道。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');
const { buildSunoStyle } = require('./musicStyleDict');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || 'https://api.sunoapi.org';
const SUNO_SUBMIT_BASE_URL = process.env.SUNO_SUBMIT_BASE_URL || (SUNO_BASE_URL.includes('://api.') ? SUNO_BASE_URL : 'https://api.sunoapi.org');
// musicCallback 云函数的公网访问地址（如 https://xxx.tcloudbaseapp.com/musicCallback），
// 由部署时通过环境变量注入
const MUSIC_CALLBACK_BASE_URL = process.env.MUSIC_CALLBACK_BASE_URL;

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) : str;
}

function httpsPostJson(urlStr, bodyObj, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          ...headers,
        },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(body);
          } catch (e) {
            const preview = body ? body.slice(0, 200) : '[empty body]';
            return reject(new Error(`Suno响应解析失败: HTTP ${res.statusCode}, body=${preview}`));
          }
          resolve({ statusCode: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.write(data);
    req.end();
  });
}

async function submitSunoTask({ taskId, lyrics, genre, vocalMode }) {
  if (!SUNO_API_KEY) {
    throw new Error('缺少 SUNO_API_KEY 环境变量配置');
  }

  const style = buildSunoStyle(genre || '嘻哈', vocalMode);

  const body = {
    customMode: true,
    instrumental: false,
    model: 'V4_5',
    prompt: truncate(lyrics, 4900),
    style: truncate(style, 900),
    title: truncate(`茶言茶曲-${String(taskId).slice(-6)}`, 90),
  };

  if (MUSIC_CALLBACK_BASE_URL) {
    body.callBackUrl = `${MUSIC_CALLBACK_BASE_URL}?taskId=${encodeURIComponent(taskId)}`;
  }

  const { statusCode, json } = await httpsPostJson(`${SUNO_SUBMIT_BASE_URL}/api/v1/generate`, body, {
    authorization: `Bearer ${SUNO_API_KEY}`,
  });

  if (!json || json.code !== 200 || !json.data || !json.data.taskId) {
    throw new Error(`Suno任务提交失败: ${(json && json.msg) || `HTTP ${statusCode}`}`);
  }

  return json.data.taskId;
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const openid = cloud.getWXContext().OPENID || '';
  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    if (!task) {
      return { success: false, message: '任务不存在' };
    }

    // ── 客户端调用的前置校验（服务端定时器 pollMusicStatus 无 OPENID，直接放行）──
    // Suno 作曲是付费环节，必须确认调用者是任务所有者，且该任务已在
    // confirmDialogue 正常扣过每日额度，防止绕过额度闸门直接刷付费接口。
    if (openid) {
      if (task.userId !== openid) {
        return { success: false, code: 'FORBIDDEN', message: '无权操作此任务' };
      }
      if (!task.quotaDateKey) {
        return { success: false, code: 'QUOTA_REQUIRED', message: '任务状态异常，请重新发起生成' };
      }
    }

    if (!task.lyrics) {
      throw new Error('任务缺少歌词内容，无法生成音乐');
    }

    const providerTaskId = await submitSunoTask({
      taskId,
      lyrics: task.lyrics,
      genre: task.style && task.style.musicGenre,
      vocalMode: task.style && task.style.vocalMode,
    });

    await tasksCol.doc(taskId).update({
      data: {
        musicProviderTaskId: providerTaskId,
        status: 'generating_music',
        progress: 65,
        errorStage: '',
        errorMsg: '',
        updatedAt: Date.now(),
      },
    });

    // 后续流程：由 pollMusicStatus（每分钟定时触发）或 musicCallback（Suno回调）
    // 主动查询/接收 Suno 任务结果，写回 audioUrl 到 tasks；再由小程序端 task-progress
    // 轮询页检测到 audioUrl 后直接客户端调用 fetchLyricsTimestamps，避免云函数间调用的耗时限制。
    return { success: true, data: { taskId, providerTaskId } };
  } catch (e) {
    console.error('generateMusic error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_music',
        errorMsg: e.message || '音乐生成任务提交失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '音乐生成任务提交失败' };
  }
};
