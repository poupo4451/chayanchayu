/**
 * setTaskNotify 云函数（Event Function）
 * 职责：为一个任务开启「生成完成通知」，写入一次性订阅消息的下发凭证。
 *
 * 这是订阅凭证的**唯一**写入入口，被进度页的两处调用共用：
 *   - 进入进度页 2 秒后自动弹出的邀请弹层（主路径）
 *   - 页面上常驻的通知开关卡片（用户关掉弹层后改主意）
 * 邀请没有放在 confirmDialogue（点「确认生成 MV」）里，是因为在主流程上插一层
 * 授权弹层会让用户以为操作被阻断。
 *
 * 本函数只写「订阅凭证」，不碰任何生成流程字段，也不涉及额度，
 * 因此对主链路零影响：调用失败最坏结果就是收不到通知。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { taskId, templateId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }
  if (!templateId) {
    return { success: false, message: '缺少 templateId 参数' };
  }

  const openid = cloud.getWXContext().OPENID || '';
  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    // 所有权校验：订阅消息按 openid 下发，绝不能让 A 给 B 的任务挂通知
    if (!task || task.userId !== openid) {
      return { success: false, code: 'FORBIDDEN', message: '无权操作此任务' };
    }

    // 已下发过就不再改回 pending —— 一次性订阅只有一次额度，
    // 重置状态会导致同一次授权被消费两次（第二次必然失败并浪费用户的授权）
    if (task.notifyState === 'sent') {
      return { success: true, data: { taskId, notifyState: 'sent', skipped: true } };
    }

    // 正在下发中：本次调用来晚了，让进行中的那次跑完即可。
    // 若它中途被强杀，pollMusicStatus 的 reclaimStaleSending 会把它回收成 pending。
    if (task.notifyState === 'sending') {
      return { success: true, data: { taskId, notifyState: 'sending', skipped: true } };
    }

    // 其余状态（none / pending / failed）一律置 pending：
    // failed 也要放行 —— 用户此刻重新授权就是新的一次额度，理应给一次新的机会。
    // 任务已经是终态也照常置 pending，定时器下一轮会扫到并下发，
    // 而不是判定「来晚了」直接丢弃。
    await tasksCol.doc(taskId).update({
      data: {
        notifyState: 'pending',
        notifyTemplateId: templateId,
        // 清理可能存在的历史失败痕迹，让本次授权得到干净的一次重试机会
        notifyFailCount: 0,
        notifyError: '',
        updatedAt: Date.now(),
      },
    });

    return { success: true, data: { taskId, notifyState: 'pending' } };
  } catch (e) {
    console.error('setTaskNotify error', e);
    return { success: false, message: e.message || '开启完成通知失败' };
  }
};
