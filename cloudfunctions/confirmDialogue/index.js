/**
 * confirmDialogue 云函数（Event Function）
 * 职责：用户在对话预览页确认（可能编辑过）对话内容后，写回并触发后续链路：
 * renderChatScreenshots → generateLyrics → generateMusic → (music完成后) 触发 Remotion 渲染
 *
 * ⚠️ 本函数是「每日生成次数」的唯一扣费闸门。
 * 为什么扣在这里而不是 createTask：对话生成只花少量 LLM 成本且用户可能看完就放弃，
 * 而从本函数往下才进入 Suno 作曲 + 云托管渲染这两道真正昂贵的环节，
 * 「确认对话开始转 MV」与「一支 MV 的成本」严格一一对应。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 必须在 cloud.init() 之后再 require：quota 模块内部要用数据库句柄
const { consumeQuota } = require('./quota');

const db = cloud.database();

exports.main = async (event) => {
  const { taskId, dialogue } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const openid = cloud.getWXContext().OPENID || '';
  const tasksCol = db.collection('tasks');

  try {
    // ── 所有权校验：只能提交自己的任务 ──
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;
    if (!task || task.userId !== openid) {
      return { success: false, code: 'FORBIDDEN', message: '无权操作此任务' };
    }

    // ── 额度闸门 ──
    // 幂等：同一任务只扣一次（quotaDateKey 即扣费凭证），
    // 用户重复点确认、或从进度页返回再次提交都不会二次计费。
    let quotaDateKey = task.quotaDateKey || '';
    if (!quotaDateKey) {
      const q = await consumeQuota(openid);
      if (!q.ok) {
        return {
          success: false,
          code: 'QUOTA_EXCEEDED',
          message: `今日生成次数已用完（每天 ${q.limit} 次），明天 0 点恢复`,
          data: { limit: q.limit, remain: 0 },
        };
      }
      quotaDateKey = q.dateKey;
    }

    const updateData = {
      dialogue: dialogue || [],
      status: 'generating_screenshots',
      progress: 30,
      // 扣费凭证：下游付费函数据此判断该任务是否已合法扣额，防止绕过闸门直接触发
      quotaDateKey,
      updatedAt: Date.now(),
    };

    // ── 完成通知（一次性订阅消息）──
    // 本函数不再接收订阅凭证：授权邀请已移到进度页（进入 2 秒后自动弹出），
    // 由 setTaskNotify 单独写入 notifyState/notifyTemplateId。
    // 这里只负责补齐缺失的初始值，且绝不覆盖已有状态——用户可能已在进度页
    // 开启过通知后返回本页再次确认，覆盖会让那次授权白白作废。
    if (!task.notifyState) {
      updateData.notifyState = 'none';
      updateData.notifyTemplateId = '';
    }

    await tasksCol.doc(taskId).update({ data: updateData });

    // 异步触发截图渲染，不等待其完成（后续阶段由各云函数自行串联）
    cloud.callFunction({ name: 'renderChatScreenshots', data: { taskId } }).catch((e) => {
      console.error('trigger renderChatScreenshots failed', e);
    });

    return { success: true, data: { taskId } };
  } catch (e) {
    console.error('confirmDialogue error', e);
    return { success: false, message: e.message || '确认对话失败' };
  }
};
