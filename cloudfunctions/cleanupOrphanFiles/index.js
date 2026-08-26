/**
 * cleanupOrphanFiles 云函数（HTTP Function）
 * 职责：扫描云存储 mv/ 目录，删除不被任何 task 或 work 引用的孤儿视频文件
 *
 * 使用方式：
 * - 手动触发（dryRun=true，仅报告不删除）：可在小程序端或云函数测试中调用
 * - 实际清理（dryRun=false）：确认孤儿文件列表后执行删除
 *
 * 前置条件：需要在云函数环境变量中配置 SECRET_ID 和 SECRET_KEY
 * 获取地址：https://console.cloud.tencent.com/cam/capi
 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 获取当前云环境 ID（字符串），cloud.DYNAMIC_CURRENT_ENV 是 Symbol，不能直接拼字符串 */
function getEnvId() {
  try {
    const ctx = cloud.getWXContext();
    if (typeof ctx.ENV === 'string' && ctx.ENV) return ctx.ENV;
  } catch (_) { /* ignore */ }
  return process.env.TCB_ENV || process.env.TCB_ENV_ID || 'cloud1-d7ggdqfhgc4ee2796';
}

// ──────────────────────────────────────────────
// TC3-HMAC-SHA256 签名（调用腾讯云 API 必需）
// ──────────────────────────────────────────────

function sha256Hex(data, key) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function hashHex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function buildTc3Signature(secretId, secretKey, host, service, action, payload, timestamp) {
  const date = new Date(timestamp * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '-');

  const algorithm = 'TC3-HMAC-SHA256';
  const httpMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQuery = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = hashHex(payload);

  const canonicalRequest = [
    httpMethod,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonical = hashHex(canonicalRequest);
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonical].join('\n');

  const kDate = sha256Hex(date, `TC3${secretKey}`);
  const kService = sha256Hex(service, kDate);
  const kSigning = sha256Hex('tc3_request', kService);
  const signature = sha256Hex(stringToSign, kSigning);

  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/**
 * 调用腾讯云 TCB API
 */
function callTcbApi(secretId, secretKey, action, params) {
  return new Promise((resolve, reject) => {
    const host = 'tcb.tencentcloudapi.com';
    const service = 'tcb';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(params);
    const authorization = buildTc3Signature(
      secretId, secretKey, host, service, action, payload, timestamp,
    );

    const req = https.request(
      {
        hostname: host,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Host': host,
          'X-TC-Action': action,
          'X-TC-Version': '2018-06-08',
          'X-TC-Timestamp': timestamp,
          'Authorization': authorization,
        },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.Response && json.Response.Error) {
              reject(new Error(
                `TCB API Error [${json.Response.Error.Code}]: ${json.Response.Error.Message}`,
              ));
            } else {
              resolve(json.Response || json);
            }
          } catch (e) {
            reject(new Error(`解析 TCB API 响应失败: ${body.slice(0, 500)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('TCB API 请求超时')));
    req.write(payload);
    req.end();
  });
}

/**
 * 通过 TCB API 列出云存储中 mv/ 目录下的所有文件
 * 使用 DescribeStorageFileList 接口
 */
async function listMvFiles(secretId, secretKey, envId) {
  const allFiles = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const response = await callTcbApi(secretId, secretKey, 'DescribeStorageFileList', {
      EnvId: envId,
      Prefix: 'mv/',
      Limit: limit,
      Offset: offset,
    });

    const fileList = response.FileList || response.Data || [];
    if (fileList.length === 0) break;

    allFiles.push(...fileList.map((f) => ({
      fileID: f.FileID || f.Key || f.fileID || f.key || '',
      size: f.Size || f.size || 0,
    })));

    if (fileList.length < limit) break;
    offset += limit;
  }

  return allFiles;
}

// ──────────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────────

exports.main = async (event) => {
  const isDryRun = event.dryRun !== false; // 默认 dry-run

  try {
    // 1. 检查 API 凭证
    const secretId = (event.secretId || process.env.SECRET_ID || '').trim();
    const secretKey = (event.secretKey || process.env.SECRET_KEY || '').trim();

    if (!secretId || !secretKey) {
      return {
        success: false,
        message: [
          '缺少腾讯云 API 凭证，请通过以下任一方式提供：',
          '1. 在云函数环境变量中配置 SECRET_ID / SECRET_KEY',
          '2. 调用时传入 secretId / secretKey 参数',
          '获取凭证：https://console.cloud.tencent.com/cam/capi',
        ].join('\n'),
      };
    }

    const envId = event.envId || getEnvId();

    // 2. 列出云存储 mv/ 目录文件
    let storageFiles;
    try {
      storageFiles = await listMvFiles(secretId, secretKey, envId);
    } catch (e) {
      return {
        success: false,
        message: `列出云存储文件失败: ${e.message}`,
        hint: '请确认 SecretId/SecretKey 正确，且拥有云开发存储读取权限',
      };
    }

    if (storageFiles.length === 0) {
      return {
        success: true,
        data: {
          message: 'mv/ 目录为空，无需清理',
          totalFiles: 0,
          orphanCount: 0,
          deleted: [],
        },
      };
    }

    // 3. 查询所有被数据库引用的云存储文件 ID
    const BATCH_SIZE = 100;
    let allTaskFileIds = [];
    let allWorkFileIds = [];

    // 分页拉取 tasks 中的 resultVideoUrl
    {
      let cursor = null;
      const tasksCol = db.collection('tasks');
      while (true) {
        const query = tasksCol
          .field({ resultVideoUrl: true })
          .limit(BATCH_SIZE);
        const res = cursor ? await query.where({ _id: db.command.gt(cursor) }).orderBy('_id', 'asc').get()
          : await query.orderBy('_id', 'asc').get();
        if (res.data.length === 0) break;
        allTaskFileIds.push(...res.data.map((d) => d.resultVideoUrl).filter((u) => u && u.startsWith('cloud://')));
        if (res.data.length < BATCH_SIZE) break;
        cursor = res.data[res.data.length - 1]._id;
      }
    }

    // 分页拉取 works 中的 videoUrl
    {
      let cursor = null;
      const worksCol = db.collection('works');
      while (true) {
        const query = worksCol
          .field({ videoUrl: true })
          .limit(BATCH_SIZE);
        const res = cursor ? await query.where({ _id: db.command.gt(cursor) }).orderBy('_id', 'asc').get()
          : await query.orderBy('_id', 'asc').get();
        if (res.data.length === 0) break;
        allWorkFileIds.push(...res.data.map((d) => d.videoUrl).filter((u) => u && u.startsWith('cloud://')));
        if (res.data.length < BATCH_SIZE) break;
        cursor = res.data[res.data.length - 1]._id;
      }
    }

    const protectedSet = new Set([...allTaskFileIds, ...allWorkFileIds]);

    // 4. 找出孤儿文件
    const orphanIds = storageFiles
      .filter((f) => f.fileID && !protectedSet.has(f.fileID))
      .map((f) => f.fileID);

    const stats = {
      totalFiles: storageFiles.length,
      protectedCount: storageFiles.length - orphanIds.length,
      orphanCount: orphanIds.length,
    };

    if (orphanIds.length === 0) {
      return {
        success: true,
        data: { ...stats, message: '没有孤儿文件，存储状态健康', deleted: [] },
      };
    }

    // 5. 删除 / 报告
    if (isDryRun) {
      return {
        success: true,
        data: {
          ...stats,
          dryRun: true,
          message: `[DRY-RUN] 发现 ${orphanIds.length} 个孤儿文件（未实际删除）`,
          orphanFiles: orphanIds.slice(0, 20), // 只展示前 20 个
          orphanFilesTruncated: orphanIds.length > 20,
          deleted: [],
        },
      };
    }

    // 实际删除：分批（cloud.deleteFile 每次最多 50 个）
    const deleted = [];
    const failed = [];
    for (let i = 0; i < orphanIds.length; i += 50) {
      const batch = orphanIds.slice(i, i + 50);
      try {
        await cloud.deleteFile({ fileList: batch });
        deleted.push(...batch);
        console.log(`已删除批次 ${Math.floor(i / 50) + 1}: ${batch.length} 个文件`);
      } catch (e) {
        console.error(`删除批次失败: ${e.message}`);
        failed.push(...batch.map((id) => ({ fileID: id, error: e.message })));
      }
    }

    return {
      success: true,
      data: {
        ...stats,
        message: `清理完成：成功删除 ${deleted.length} 个，失败 ${failed.length} 个`,
        deleted,
        failed,
      },
    };
  } catch (e) {
    console.error('cleanupOrphanFiles error:', e.message, e.stack);
    return {
      success: false,
      message: e.message || '清理孤儿文件失败',
    };
  }
};
