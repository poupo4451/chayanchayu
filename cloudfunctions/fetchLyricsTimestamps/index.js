/**
 * fetchLyricsTimestamps 云函数（Event Function）
 * 职责：音乐生成完成后，调用 Suno get-timestamped-lyrics API 获取逐词时间戳，
 * 聚合成行级歌词时间表 lyricsTimeline（[{lineIndex, text, startS, endS}]），落库。
 *
 * 降级策略：任一步（缺参数/API调用失败/聚合异常）失败，lyricsTimeline 置空，
 * 仍推进 status 到 rendering_video——render 层会退化为均匀分配气泡时间，不阻塞主流程。
 *
 * 注意：不再由本函数触发 notifyAndFinalize（原因见 exports.main 内注释），
 * 由小程序端 task-progress 轮询页检测到 status=rendering_video 时直接客户端调用。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || 'https://api.sunoapi.org';
const SUNO_QUERY_BASE_URL = process.env.SUNO_QUERY_BASE_URL || (SUNO_BASE_URL.includes('://api.') ? SUNO_BASE_URL : 'https://api.sunoapi.org');

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
        timeout: 20000,
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
            return reject(new Error(`Suno时间戳响应解析失败: ${body.slice(0, 200)}`));
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

/**
 * 把词级时间戳（word 字段可能含 \n 和段落标记）聚合成行级时间表。
 * 行号 lineIndex 与歌词按 \n 切分的行号对齐（含 [Verse] 等段落标记行）。
 */
function aggregateLines(alignedWords) {
  const lines = [];
  let cur = null; // { text, startS, endS }

  const flush = () => {
    if (cur && cur.text.trim()) {
      lines.push({
        lineIndex: lines.length,
        text: cur.text.trim(),
        startS: cur.startS,
        endS: cur.endS,
      });
    }
    cur = null;
  };

  for (const w of alignedWords) {
    const parts = String(w.word || '').split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        // 换行符：结束当前行，开始新行
        flush();
      }
      const seg = parts[i];
      if (seg !== '') {
        if (!cur) {
          cur = { text: seg, startS: w.startS, endS: w.endS };
        } else {
          cur.text += seg;
          cur.endS = w.endS;
        }
      }
    }
  }
  flush();
  return lines;
}

/**
 * 把 Suno 原始 alignedWords 精简成 {w,s,e} 三元组列表，供渲染层做字级对齐。
 * 保留 word 中的 \n（行边界标记），剔除空词。
 */
function simplifyWords(alignedWords) {
  if (!Array.isArray(alignedWords)) return [];
  const out = [];
  for (const w of alignedWords) {
    const word = String(w.word || '');
    if (word === '') continue;
    out.push({ w: word, s: Number(w.startS) || 0, e: Number(w.endS) || 0 });
  }
  return out;
}

async function fetchTimestamps({ providerTaskId, audioId }) {
  if (!SUNO_API_KEY) throw new Error('缺少 SUNO_API_KEY');
  if (!providerTaskId || !audioId) throw new Error('缺少 providerTaskId 或 audioId');

  const { statusCode, json } = await httpsPostJson(
    `${SUNO_QUERY_BASE_URL}/api/v1/generate/get-timestamped-lyrics`,
    { taskId: providerTaskId, audioId },
    { authorization: `Bearer ${SUNO_API_KEY}` }
  );

  if (!json || json.code !== 200 || !json.data || !Array.isArray(json.data.alignedWords)) {
    throw new Error(
      `Suno时间戳获取失败: ${(json && json.msg) || `HTTP ${statusCode}`}`
    );
  }
  return {
    timeline: aggregateLines(json.data.alignedWords),
    words: simplifyWords(json.data.alignedWords),
  };
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');
  let lyricsTimeline = [];
  let lyricsWords = [];

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    try {
      const tsResult = await fetchTimestamps({
        providerTaskId: task.musicProviderTaskId,
        audioId: task.audioId,
      });
      lyricsTimeline = tsResult.timeline;
      lyricsWords = tsResult.words;
      console.log(
        `fetchLyricsTimestamps: got ${lyricsTimeline.length} lyric lines, ${lyricsWords.length} words`
      );
    } catch (e) {
      // 降级：时间戳拿不到，留空，渲染层会均匀分配
      console.error('fetchLyricsTimestamps failed, will fallback to uniform timing:', e.message);
      lyricsTimeline = [];
      lyricsWords = [];
    }

    await tasksCol.doc(taskId).update({
      data: {
        lyricsTimeline,
        lyricsWords,
        status: 'rendering_video',
        progress: 75,
        updatedAt: Date.now(),
      },
    });

    // 注意：不再通过 cloud.callFunction 触发 notifyAndFinalize。
    // 原因：云函数间调用存在一条独立于被调函数自身 Timeout 配置的约 3 秒调用通道限制，
    // notifyAndFinalize 要请求 Remotion 云托管渲染服务（外部网络调用），耗时容易超过
    // 这条限制被平台强杀。现改为由小程序端 task-progress 轮询页检测到
    // status=rendering_video 时直接客户端调用 notifyAndFinalize。

    return { success: true, data: { taskId, lineCount: lyricsTimeline.length } };
  } catch (e) {
    console.error('fetchLyricsTimestamps fatal error', e);
    // 严重错误：仍尝试推进状态，避免任务卡死，由客户端后续触发渲染
    await tasksCol.doc(taskId).update({
      data: {
        lyricsTimeline: [],
        lyricsWords: [],
        status: 'rendering_video',
        progress: 75,
        updatedAt: Date.now(),
      },
    }).catch(() => {});
    return { success: false, message: e.message || '歌词时间戳获取失败', lineCount: 0 };
  }
};
