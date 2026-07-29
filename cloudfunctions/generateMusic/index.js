/**
 * generateMusic 云函数（Event Function）
 * 职责：调用 Suno API（sunoapi.org）提交音乐生成任务
 * 音乐生成本身耗时1-3分钟，远超云函数超时限制，因此本函数只负责"提交任务"，
 * 不做轮询等待；真正的结果获取由 musicCallback（HTTP Function）接收 Suno 回调完成。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || 'https://api.sunoapi.org';
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
            return reject(new Error(`Suno响应解析失败: ${body}`));
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

async function submitSunoTask({ taskId, lyrics, genre }) {
  if (!SUNO_API_KEY) {
    throw new Error('缺少 SUNO_API_KEY 环境变量配置');
  }
  if (!MUSIC_CALLBACK_BASE_URL) {
    throw new Error('缺少 MUSIC_CALLBACK_BASE_URL 环境变量配置');
  }

  const callBackUrl = `${MUSIC_CALLBACK_BASE_URL}?taskId=${encodeURIComponent(taskId)}`;

  const body = {
    customMode: true,
    instrumental: false,
    model: 'V4_5',
    callBackUrl,
    prompt: truncate(lyrics, 4900),
    style: truncate(genre || '嘻哈', 900),
    title: truncate(`茶言茶曲-${String(taskId).slice(-6)}`, 90),
  };

  const { statusCode, json } = await httpsPostJson(`${SUNO_BASE_URL}/api/v1/generate`, body, {
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

  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    if (!task || !task.lyrics) {
      throw new Error('任务缺少歌词内容，无法生成音乐');
    }

    const providerTaskId = await submitSunoTask({
      taskId,
      lyrics: task.lyrics,
      genre: task.style && task.style.musicGenre,
    });

    await tasksCol.doc(taskId).update({
      data: {
        musicProviderTaskId: providerTaskId,
        status: 'generating_music',
        progress: 65,
        updatedAt: Date.now(),
      },
    });

    // 后续流程：等待 Suno 通过 callBackUrl 回调 musicCallback 云函数，
    // 拿到音频结果后由 musicCallback 更新任务状态并触发 notifyAndFinalize
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
