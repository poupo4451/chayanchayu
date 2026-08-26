/**
 * 每日 MV 生成额度控制（成本闸门）
 * ---------------------------------------------------------------------------
 * 背景：一支 MV 要经过 Suno 作曲 + 云托管 Remotion 渲染两道付费环节，
 *      必须限制单用户每日生成次数，否则成本不可控。
 *
 * 存储：quotas 集合，_id = `${openid}_${YYYY-MM-DD}`（UTC+8 日期）
 *      单文档主键直查，无需索引；按天分桶，历史数据不影响当日判断。
 *
 * 扣减：条件自增 CAS（仅当 used < LIMIT 才 +1），保证并发连点不会超发。
 *
 * 退还：当前策略为「不退还」。任务失败也计入次数，实现简单且不可被刷；
 *      若后续要支持失败退还，在此文件补 refundQuota 并由定时器统一处理。
 *
 * ⚠️ 数据库句柄必须懒加载：调用方的 require('./quota') 通常发生在
 *    cloud.init() 之前，若在模块顶层就执行 cloud.database()，
 *    会因 SDK 尚未初始化而在模块加载阶段直接抛错（表现为函数
 *    "code exit unexpected"，且拿不到任何业务日志）。
 *
 * 注意：云函数目录之间不能跨目录 require，本文件在 confirmDialogue /
 *      getDailyQuota 两个函数目录下各有一份副本，修改时需同步。
 */
const cloud = require('wx-server-sdk');

const COL = 'quotas';
/** 每日上限，可通过云函数环境变量 DAILY_MV_LIMIT 覆盖，改数值无需改代码 */
const DAILY_LIMIT = Number(process.env.DAILY_MV_LIMIT || 3);
/** 白名单 openid（自测用），逗号分隔，不受额度限制 */
const WHITELIST = String(process.env.QUOTA_WHITELIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 懒获取数据库句柄，确保在 cloud.init() 之后才真正创建 */
function getDb() {
  return cloud.database();
}

/**
 * 按 UTC+8 计算日期键。
 * 云函数运行时时区可能是 UTC，直接用本地日期会让用户在北京时间早上 8 点「跨天」。
 */
function getDateKey(ts = Date.now()) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function docIdOf(openid, dateKey) {
  return `${openid}_${dateKey}`;
}

function isWhitelisted(openid) {
  return WHITELIST.includes(openid);
}

/** 查询今日额度使用情况（只读，无副作用） */
async function getQuota(openid) {
  const dateKey = getDateKey();
  if (isWhitelisted(openid)) {
    return { limit: DAILY_LIMIT, used: 0, remain: DAILY_LIMIT, unlimited: true, dateKey };
  }

  let used = 0;
  try {
    const res = await getDb().collection(COL).doc(docIdOf(openid, dateKey)).get();
    used = Number((res.data && res.data.used) || 0);
  } catch (e) {
    // 文档不存在：今天还没用过
    used = 0;
  }

  return {
    limit: DAILY_LIMIT,
    used,
    remain: Math.max(DAILY_LIMIT - used, 0),
    unlimited: false,
    dateKey,
  };
}

/**
 * 原子扣减一次额度。
 * @returns {Promise<{ok: boolean, dateKey: string, remain: number, limit: number}>}
 */
async function consumeQuota(openid) {
  const dateKey = getDateKey();
  if (isWhitelisted(openid)) {
    return { ok: true, dateKey, remain: DAILY_LIMIT, limit: DAILY_LIMIT, unlimited: true };
  }

  const db = getDb();
  const _ = db.command;
  const col = db.collection(COL);
  const id = docIdOf(openid, dateKey);
  const now = Date.now();

  // ① 条件自增：仅当 used < LIMIT 时 +1（原子操作，杜绝并发超发）
  const r1 = await col
    .where({ _id: id, used: _.lt(DAILY_LIMIT) })
    .update({ data: { used: _.inc(1), updatedAt: now } });
  if (r1.stats.updated === 1) {
    const q = await getQuota(openid);
    return { ok: true, dateKey, remain: q.remain, limit: DAILY_LIMIT };
  }

  // ② updated === 0 有两种可能：今日文档还不存在，或已达上限。先尝试创建。
  try {
    await col.add({
      data: {
        _id: id,
        userId: openid,
        dateKey,
        used: 1,
        limit: DAILY_LIMIT,
        createdAt: now,
        updatedAt: now,
      },
    });
    return { ok: true, dateKey, remain: DAILY_LIMIT - 1, limit: DAILY_LIMIT };
  } catch (e) {
    // 主键冲突说明文档确实存在（并发新建或已达上限），再 CAS 一次做最终裁决
    const r2 = await col
      .where({ _id: id, used: _.lt(DAILY_LIMIT) })
      .update({ data: { used: _.inc(1), updatedAt: Date.now() } });
    if (r2.stats.updated === 1) {
      const q = await getQuota(openid);
      return { ok: true, dateKey, remain: q.remain, limit: DAILY_LIMIT };
    }
    return { ok: false, dateKey, remain: 0, limit: DAILY_LIMIT };
  }
}

module.exports = { getQuota, consumeQuota, getDateKey, DAILY_LIMIT };
