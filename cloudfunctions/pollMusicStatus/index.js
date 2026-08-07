/**
 * pollMusicStatus 云函数（Event Function + Timer Trigger）
 * 职责：轮询 Suno 异步音乐生成任务状态，并自动推进到渲染阶段。
 *
 * 处理策略：
 * 1. 扫描 tasks 集合中 status=generating_music 的任务
 * 2. 若尚无音频结果，则调用 Suno record-info 接口按 providerTaskId 主动查询
 * 3. 成功后写回音频信息（audioUrl/audioId）
 * 4. 音频就绪后，直接内联调用 Suno get-timestamped-lyrics API 获取逐词时间戳，
 *    聚合后推进 status 到 rendering_video。
 *
 * 不再依赖小程序端客户端触发 fetchLyricsTimestamps。
 * 原因：用户离开 task-progress 页面后轮询停止，后续流程会断裂卡死。
 * 也不再通过 cloud.callFunction 调用 fetchLyricsTimestamps。
 * 原因：云函数间调用通道有约 3 秒限制，而 Suno API 调用耗时容易超限被强杀。
 * 现在把时间戳获取逻辑直接内联到本函数，由定时触发器自主推进全流程。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const SUNO_API_KEY = process.env.SUNO_API_KEY;
const SUNO_BASE_URL = process.env.SUNO_BASE_URL || 'https://api.sunoapi.org';
const SUNO_QUERY_BASE_URL = process.env.SUNO_QUERY_BASE_URL || (SUNO_BASE_URL.includes('://api.') ? SUNO_BASE_URL : 'https://api.sunoapi.org');
const SUNO_SUBMIT_BASE_URL = SUNO_BASE_URL.includes('://api.') ? SUNO_BASE_URL : 'https://api.sunoapi.org';
const BATCH_SIZE = Number(process.env.MUSIC_POLL_BATCH_SIZE || 10);
const MIN_POLL_INTERVAL_MS = Number(process.env.MUSIC_POLL_INTERVAL_MS || 15000);
const MUSIC_CALLBACK_BASE_URL = process.env.MUSIC_CALLBACK_BASE_URL;

// 云托管 Remotion 渲染服务地址
const REMOTION_SERVICE_URL =
  process.env.REMOTION_SERVICE_URL ||
  'https://chat-mv-remotion-288614-10-1459907343.sh.run.tcloudbase.com';

// ---------------------------------------------------------------------------
// 音乐风格模板（与 generateMusic/musicStyleDict 保持一致）
// ---------------------------------------------------------------------------

const GENRE_STYLE_TEMPLATES = {
  嘻哈: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Boom Bap Hip-hop, 88-96 BPM, gritty 808 sub bass, dusty vinyl crackle, punchy snare with natural swing, confident laid-back rap flow with sharp enunciation, catchy melodic hook in chorus, Beijing underground meets 90s NYC golden age, street-smart storytelling with wit and attitude.',
    'Structure: Sampled intro hook, verse-chorus-verse-chorus, bridge with beat switch, ad-lib outro.',
  ].join('\n'),

  'R&B': [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Gospel Funk R&B, heavy slap bass, punchy brass, fast swing groove, raw soulful vocals, extreme melisma and runs, explosive gospel choir, dramatic shout style, 70s Motown meets trap bass, cinematic comedic storytelling.',
    'Structure: Funky intro, alternating duet, gospel chorus climax, comedic outro.',
  ].join('\n'),

  流行: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Mandopop, 100-112 BPM, bright acoustic guitar and layered piano, four-on-the-floor pop drums, wide anthemic chorus with soaring vocal belt, crisp radio-ready mix with subtle string pads, 2000s Jay Chou ballad meets modern K-drama OST, heartfelt youth storytelling with emotional peak.',
    'Structure: Gentle piano intro, verse buildup, explosive chorus, emotional bridge with key lift, warm fade-out outro.',
  ].join('\n'),

  抖音风: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Viral Short-video Pop, 120-135 BPM, punchy 808 kicks and bright synth stabs, clap-driven four-on-the-floor drop, hyper-catchy loopable hook designed to earworm, sidechain-pumped energetic mix, Douyin trends meets K-pop bounce, playful quirky narrative with instant payoff.',
    'Structure: Instant hook intro skip, micro verse, explosive drop chorus, repeat, cold end.',
  ].join('\n'),

  粤语说唱: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Hong Kong Cantonese Hip-hop, 85-95 BPM, boom bap drums with deep 808 warmth, laid-back Cantonese rhyme flow with sharp local slang, catchy Cantonese melodic hook, warm vintage MPC grit, Mong Kok street vibe meets golden age Hong Kong rap, witty storytelling with local attitude.',
    'Structure: Sampled intro, verse-hook-verse-hook, scratch outro. Please sing in authentic Cantonese colloquial pronunciation throughout.',
  ].join('\n'),

  随机: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Pop-Rap Fusion, 95-110 BPM, punchy hybrid drums blending acoustic and electronic, catchy melodic hook with rap-sung alternation, genre-fluid production, modern radio-ready mix, unexpected beat switches, playful narrative storytelling.',
    'Structure: Hook intro, alternating rap-sing verses, big chorus drop, surprise bridge, confident outro.',
  ].join('\n'),
};

const VOCAL_MODE_SUFFIX = {
  duet: 'male and female alternating verses with natural conversational chemistry, harmonizing powerfully on the chorus',
  'solo-male': 'deep confident male vocal with rich chest tone and expressive delivery',
  'solo-female': 'bright expressive female vocal with clear belt and emotional nuance',
  solo: 'expressive lead vocal with dynamic control and emotional storytelling',
};

function buildSunoStyle(genre, vocalMode) {
  const base = GENRE_STYLE_TEMPLATES[genre] || GENRE_STYLE_TEMPLATES['随机'];
  const vocalSuffix = VOCAL_MODE_SUFFIX[vocalMode] || VOCAL_MODE_SUFFIX.solo;
  return `${base}\nVocal: ${vocalSuffix}\nProduction: minimal intro under 3 seconds, vocals start almost immediately, skip long instrumental prelude, straight into verse.`;
}

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? str.slice(0, max) : str;
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

function httpsGetJson(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers,
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
            return reject(new Error(`Suno状态响应解析失败: ${body.slice(0, 200)}`));
          }
          resolve({ statusCode: res.statusCode, json });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.end();
  });
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

// ---------------------------------------------------------------------------
// Suno API 调用
// ---------------------------------------------------------------------------

/**
 * 提交音乐生成任务到 Suno（内联 generateMusic 的核心逻辑）。
 * 当任务处于 generating_music 但尚无 musicProviderTaskId 时由定时器自动调用，
 * 不再依赖小程序客户端触发。
 */
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

async function queryMusicRecord(providerTaskId) {
  if (!SUNO_API_KEY) {
    throw new Error('缺少 SUNO_API_KEY 环境变量配置');
  }
  if (!providerTaskId) {
    throw new Error('缺少 providerTaskId');
  }

  const url = `${SUNO_QUERY_BASE_URL}/api/v1/generate/record-info?taskId=${encodeURIComponent(providerTaskId)}`;
  const { statusCode, json } = await httpsGetJson(url, {
    authorization: `Bearer ${SUNO_API_KEY}`,
  });

  if (!json || json.code !== 200 || !json.data) {
    throw new Error(`Suno状态查询失败: ${(json && json.msg) || `HTTP ${statusCode}`}`);
  }

  return json.data;
}

function pickFirstAudio(record) {
  const candidates = [
    record && record.data,
    record && record.response && record.response.data,
    record && record.response && record.response.sunoData,
    record && record.sunoData,
  ];

  const songs = candidates.find((list) => Array.isArray(list)) || [];
  return songs.find((item) => item && (item.audio_url || item.audioUrl)) || songs[0] || null;
}

/**
 * 把词级时间戳（word 字段可能含 \n 和段落标记）聚合成行级时间表。
 * 行号 lineIndex 与歌词按 \n 切分的行号对齐（含 [Verse] 等段落标记行）。
 */
function aggregateLines(alignedWords) {
  const lines = [];
  let cur = null;

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

/**
 * 调用 Suno get-timestamped-lyrics API 获取逐词时间戳并聚合成行级时间表。
 * 失败时返回空数组（降级），不抛异常——渲染层会退化为均匀分配气泡时间。
 */
async function fetchTimestamps({ providerTaskId, audioId }) {
  try {
    if (!providerTaskId || !audioId) return { timeline: [], words: [] };

    const { statusCode, json } = await httpsPostJson(
      `${SUNO_QUERY_BASE_URL}/api/v1/generate/get-timestamped-lyrics`,
      { taskId: providerTaskId, audioId },
      { authorization: `Bearer ${SUNO_API_KEY}` }
    );

    if (!json || json.code !== 200 || !json.data || !Array.isArray(json.data.alignedWords)) {
      console.error('fetchTimestamps: Suno返回异常', (json && json.msg) || `HTTP ${statusCode}`);
      return { timeline: [], words: [] };
    }

    return {
      timeline: aggregateLines(json.data.alignedWords),
      words: simplifyWords(json.data.alignedWords),
    };
  } catch (e) {
    console.error('fetchTimestamps failed, will fallback to uniform timing:', e.message);
    return { timeline: [], words: [] };
  }
}

// ---------------------------------------------------------------------------
// Remotion 渲染触发
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 任务处理
// ---------------------------------------------------------------------------

/**
 * 处理 rendering_video 阶段的任务：若尚未触发过 Remotion 渲染，则直接调用渲染服务。
 * 若已触发但超过5分钟仍未完成（status 未变 completed），自动重新触发渲染。
 */
async function processRenderTask(task) {
  const taskId = task._id;
  const tasksCol = db.collection('tasks');

  // 已标记过渲染触发
  if (task.renderTriggeredAt) {
    const elapsed = Date.now() - Number(task.renderTriggeredAt);
    // 超过5分钟仍未完成，清除标记重新触发（可能是 Remotion 服务异常/重启/环境变量错误导致渲染未执行）
    if (elapsed < 5 * 60 * 1000) {
      return { outcome: 'skipped', taskId, reason: 'render_in_progress' };
    }
    console.log(`render stale for ${taskId}, ${Math.floor(elapsed / 1000)}s since trigger, retrying...`);
    await tasksCol.doc(taskId).update({
      data: {
        renderTriggeredAt: '',
        renderRetryCount: Number(task.renderRetryCount || 0) + 1,
        updatedAt: Date.now(),
      },
    });
    // 超过3次重试仍未完成，标记失败
    if (Number(task.renderRetryCount || 0) >= 3) {
      await tasksCol.doc(taskId).update({
        data: {
          status: 'failed',
          errorStage: 'rendering_video',
          errorMsg: '视频渲染多次超时未完成，请检查Remotion服务状态或稍后重试',
          updatedAt: Date.now(),
        },
      });
      return { outcome: 'failed', taskId, reason: 'render_max_retries' };
    }
    // 重新触发渲染
  }

  try {
    const result = await postToRenderService(taskId);
    await tasksCol.doc(taskId).update({
      data: {
        renderTriggeredAt: Date.now(),
        progress: 80,
        updatedAt: Date.now(),
      },
    });
    return { outcome: 'render_triggered', taskId, body: result.body };
  } catch (e) {
    console.error('processRenderTask: 触发渲染失败', taskId, e.message);
    // 不立即标记为 failed，给定时器下一轮重试机会（可能是网络抖动）
    // 但连续失败太多次后标记失败，避免无限重试
    const failCount = Number(task.renderFailCount || 0) + 1;
    if (failCount >= 3) {
      await tasksCol.doc(taskId).update({
        data: {
          status: 'failed',
          errorStage: 'rendering_video',
          errorMsg: e.message || '触发视频渲染失败',
          renderFailCount: failCount,
          updatedAt: Date.now(),
        },
      });
      return { outcome: 'failed', taskId, reason: 'render_max_retries' };
    }
    await tasksCol.doc(taskId).update({
      data: {
        renderFailCount: failCount,
        updatedAt: Date.now(),
      },
    });
    return { outcome: 'skipped', taskId, reason: 'render_will_retry', failCount };
  }
}

async function processTask(task, options = {}) {
  const { debug = false } = options;
  const taskId = task && task._id;
  if (!taskId) {
    return { outcome: 'skipped', reason: 'missing_task_id' };
  }

  const tasksCol = db.collection('tasks');
  const lastMusicPollAt = Number(task.lastMusicPollAt || 0);
  if (Date.now() - lastMusicPollAt < MIN_POLL_INTERVAL_MS) {
    return { outcome: 'skipped', taskId, reason: 'poll_too_frequent' };
  }

  // 音频结果已落库（可能由 musicCallback 或本函数上一轮写入）。
  // 直接内联获取时间戳并推进到 rendering_video，不再依赖客户端触发。
  if (task.audioUrl && task.audioId) {
    const { timeline, words } = await fetchTimestamps({
      providerTaskId: task.musicProviderTaskId,
      audioId: task.audioId,
    });

    await tasksCol.doc(taskId).update({
      data: {
        lyricsTimeline: timeline,
        lyricsWords: words,
        status: 'rendering_video',
        progress: 75,
        lastMusicPollAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    return { outcome: 'advanced', taskId, reason: 'timestamps_done', lineCount: timeline.length };
  }

  if (!task.musicProviderTaskId) {
    // 尚未提交音乐任务到 Suno：自动提交（内联 generateMusic 逻辑），
    // 不再依赖小程序客户端触发 startMusic。
    if (!task.lyrics) {
      return { outcome: 'skipped', taskId, reason: 'missing_lyrics' };
    }
    try {
      const providerTaskId = await submitSunoTask({
        taskId,
        lyrics: task.lyrics,
        genre: task.style && task.style.musicGenre,
        vocalMode: task.style && task.style.vocalMode,
      });
      await tasksCol.doc(taskId).update({
        data: {
          musicProviderTaskId: providerTaskId,
          progress: 60,
          errorStage: '',
          errorMsg: '',
          lastMusicPollAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      return { outcome: 'music_submitted', taskId, providerTaskId };
    } catch (e) {
      console.error('processTask: auto-submit Suno task failed', taskId, e.message);
      const failCount = Number(task.musicSubmitFailCount || 0) + 1;
      if (failCount >= 3) {
        await tasksCol.doc(taskId).update({
          data: {
            status: 'failed',
            errorStage: 'generating_music',
            errorMsg: e.message || '音乐任务提交失败',
            musicSubmitFailCount: failCount,
            updatedAt: Date.now(),
          },
        });
        return { outcome: 'failed', taskId, reason: 'music_submit_failed' };
      }
      await tasksCol.doc(taskId).update({
        data: {
          musicSubmitFailCount: failCount,
          lastMusicPollAt: Date.now(),
        },
      });
      return { outcome: 'skipped', taskId, reason: 'music_submit_will_retry', failCount };
    }
  }

  const record = await queryMusicRecord(task.musicProviderTaskId);
  const first = pickFirstAudio(record);
  const providerStatus = String(record.status || (first ? 'SUCCESS' : '')).toUpperCase();

  // Suno 正常流程中的递进态：PENDING -> TEXT_SUCCESS -> FIRST_SUCCESS -> SUCCESS
  const IN_PROGRESS_STATUS = {
    PENDING: 60,
    GENERATING: 63,
    TEXT_SUCCESS: 65,
    FIRST_SUCCESS: 68,
  };

  // Suno 官方失败态
  const FAILED_STATUS = new Set([
    'FAILED',
    'CREATE_TASK_FAILED',
    'GENERATE_AUDIO_FAILED',
    'CALLBACK_EXCEPTION',
    'SENSITIVE_WORD_ERROR',
  ]);

  if (Object.prototype.hasOwnProperty.call(IN_PROGRESS_STATUS, providerStatus)) {
    await tasksCol.doc(taskId).update({
      data: {
        progress: IN_PROGRESS_STATUS[providerStatus],
        musicProviderStatus: providerStatus,
        lastMusicPollAt: Date.now(),
      },
    });
    return { outcome: 'processing', taskId, providerStatus };
  }

  if (FAILED_STATUS.has(providerStatus)) {
    const FAILED_MSG = {
      SENSITIVE_WORD_ERROR: '歌词包含敏感词，Suno拒绝生成，请调整对话内容后重试',
      CREATE_TASK_FAILED: 'Suno创建音乐任务失败',
      GENERATE_AUDIO_FAILED: 'Suno生成音乐曲目失败',
      CALLBACK_EXCEPTION: 'Suno回调处理异常',
    };
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_music',
        errorMsg: record.errorMessage || record.errorMsg || FAILED_MSG[providerStatus] || 'Suno音乐生成失败',
        musicProviderStatus: providerStatus,
        lastMusicPollAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    return { outcome: 'failed', taskId, providerStatus };
  }

  if (providerStatus !== 'SUCCESS') {
    await tasksCol.doc(taskId).update({
      data: {
        musicProviderStatus: providerStatus || 'UNKNOWN',
        lastMusicPollAt: Date.now(),
      },
    });
    return { outcome: 'unknown', taskId, providerStatus };
  }

  if (!first || !(first.audio_url || first.audioUrl)) {
    // SUCCESS 但暂未拿到音频链接：可能接口数据还未完全同步，先记录稍后重试
    await tasksCol.doc(taskId).update({
      data: {
        musicProviderStatus: providerStatus,
        lastMusicPollAt: Date.now(),
      },
    });
    if (debug) {
      return { outcome: 'unknown', taskId, providerStatus, debugRecord: record };
    }
    return { outcome: 'unknown', taskId, providerStatus };
  }

  // SUCCESS 且拿到音频链接：写回音频信息，然后紧接着内联获取时间戳并推进到渲染阶段
  await tasksCol.doc(taskId).update({
    data: {
      audioUrl: first.audio_url || first.audioUrl || '',
      audioId: first.id || first.audioId || '',
      audioDuration: first.duration || 0,
      musicTitle: first.title || '',
      musicProviderStatus: providerStatus,
      progress: 70,
      lastMusicPollAt: Date.now(),
      updatedAt: Date.now(),
    },
  });

  // 立即接着获取时间戳，一步到位推进到 rendering_video
  const { timeline, words } = await fetchTimestamps({
    providerTaskId: task.musicProviderTaskId,
    audioId: first.id || first.audioId || '',
  });

  await tasksCol.doc(taskId).update({
    data: {
      lyricsTimeline: timeline,
      lyricsWords: words,
      status: 'rendering_video',
      progress: 75,
      updatedAt: Date.now(),
    },
  });

  return { outcome: 'completed', taskId, providerStatus, lineCount: timeline.length };
}

exports.main = async (event = {}) => {
  const tasksCol = db.collection('tasks');
  const { taskId, debug = false } = event;
  const summary = {
    scanned: 0,
    completed: 0,
    advanced: 0,
    processing: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    render_triggered: 0,
    music_submitted: 0,
    errors: [],
  };

  try {
    let tasks = [];

    if (taskId) {
      const singleRes = await tasksCol.doc(taskId).get();
      if (singleRes.data && (singleRes.data.status === 'generating_music' || singleRes.data.status === 'rendering_video')) {
        tasks = [singleRes.data];
      }
    } else {
      // 同时扫描音乐生成阶段和渲染阶段，服务端自主推进全流程
      const musicRes = await tasksCol.where({ status: 'generating_music' }).limit(BATCH_SIZE).get();
      const renderRes = await tasksCol.where({ status: 'rendering_video' }).limit(BATCH_SIZE).get();
      tasks = [
        ...(Array.isArray(musicRes.data) ? musicRes.data : []),
        ...(Array.isArray(renderRes.data) ? renderRes.data : []),
      ];
    }

    summary.scanned = tasks.length;

    for (const task of tasks) {
      try {
        let result;
        if (task.status === 'rendering_video') {
          result = await processRenderTask(task);
        } else {
          result = await processTask(task, { debug });
        }
        if (result && result.outcome && summary[result.outcome] !== undefined) {
          summary[result.outcome] += 1;
        }
      } catch (e) {
        const tid = task && task._id ? task._id : 'unknown';
        summary.errors.push({ taskId: tid, message: e.message || 'unknown error' });
        console.error('pollMusicStatus processTask error', tid, e);
      }
    }

    return { success: true, data: summary };
  } catch (e) {
    console.error('pollMusicStatus fatal error', e);
    return { success: false, message: e.message || '轮询音乐状态失败', data: summary };
  }
};
