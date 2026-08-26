/**
 * getDailyQuota 云函数（Event Function）
 * 职责：只读返回当前用户今日 MV 生成额度，供首页大卡片与创建页展示、前置拦截。
 * 真正的扣减发生在 confirmDialogue（用户确认对话、准备转 MV 的那一刻）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 必须在 cloud.init() 之后再 require：quota 模块内部要用数据库句柄
const { getQuota } = require('./quota');

exports.main = async () => {
  const openid = cloud.getWXContext().OPENID || '';
  if (!openid) {
    return { success: false, message: '无法获取用户标识' };
  }

  try {
    const q = await getQuota(openid);
    return { success: true, data: q };
  } catch (e) {
    console.error('getDailyQuota error', e);
    // 查询失败不应阻断创作，前端按「未知额度」处理，最终由 confirmDialogue 服务端兜底拦截
    return { success: false, message: e.message || '查询额度失败' };
  }
};
