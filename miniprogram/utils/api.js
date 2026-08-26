/**
 * 云函数调用统一封装
 * 骨架阶段：所有云函数尚未实现真实AI逻辑，先返回/依赖Mock数据跑通全链路
 */

function callFunction(name, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        if (res.result && res.result.success === false) {
          // 保留业务错误码与附加数据，供上层区分「额度超限」这类可预期失败，
          // 走专门的友好提示而不是通用报错弹窗
          const err = new Error(res.result.message || `${name} 调用失败`);
          err.code = res.result.code || '';
          err.payload = res.result.data;
          reject(err);
          return;
        }
        resolve(res.result && res.result.data !== undefined ? res.result.data : res.result);
      },
      fail: reject,
    });
  });
}

/** 创建生成任务 */
function createTask({ topic, dialogueTone, musicGenre }) {
  return callFunction('createTask', { topic, dialogueTone, musicGenre });
}

/** 查询任务详情（含对话/进度/结果） */
function getTaskDetail(taskId) {
  return callFunction('getTaskDetail', { taskId });
}

/** 首次触发对话生成（客户端直接调用，避免云函数间调用链路的耗时限制） */
function startDialogue(taskId) {
  return callFunction('generateDialogue', { taskId });
}

/** 重新生成对话 */
function regenerateDialogue(taskId) {
  return callFunction('generateDialogue', { taskId, regenerate: true });
}

/**
 * 确认对话内容，进入后续生成流程。
 *
 * 完成通知的订阅不在这里挂：主流程上插一层授权弹层会让用户以为操作被阻断。
 * 改由进度页在进入 2 秒后自动邀请，并通过 setTaskNotify 单独写入凭证。
 */
function confirmDialogue(taskId, dialogue) {
  return callFunction('confirmDialogue', { taskId, dialogue });
}

/**
 * 为进行中的任务开启完成通知（进度页的邀请弹层与通知卡片都走这里）。
 * 一次性订阅：用户每授权一次，服务端换来一次下发额度。
 */
function setTaskNotify(taskId, templateId) {
  return callFunction('setTaskNotify', { taskId, templateId });
}

/** 首次触发歌词生成（客户端直接调用，避免云函数间调用链路的耗时限制） */
function startLyrics(taskId) {
  return callFunction('generateLyrics', { taskId });
}

/** 首次触发音乐生成提交（客户端直接调用，避免云函数间调用链路的耗时限制） */
function startMusic(taskId) {
  return callFunction('generateMusic', { taskId });
}

/** 音频到位后触发歌词逐词时间戳抓取（客户端直接调用，避免云函数间调用链路的耗时限制） */
function startFetchLyricsTimestamps(taskId) {
  return callFunction('fetchLyricsTimestamps', { taskId });
}

/** 触发最终视频渲染（客户端直接调用，避免云函数间调用链路的耗时限制） */
function startNotifyAndFinalize(taskId) {
  return callFunction('notifyAndFinalize', { taskId });
}

/** 查询"我的作品"列表 */
function getWorksList() {
  return callFunction('getWorksList', {});
}

/** 删除作品（已完成或进行中的任务） */
function deleteWork({ id, type, videoUrl }) {
  return callFunction('deleteWork', { id, type, videoUrl });
}

/** 获取当前用户资料 */
function getUserProfile() {
  return callFunction('getUserProfile', {});
}

/** 更新用户头像/昵称 */
function updateUserProfile({ nickName, avatarUrl }) {
  return callFunction('updateUserProfile', { nickName, avatarUrl });
}

/** 查询今日 MV 生成额度（剩余次数），用于首页/创建页展示与前置拦截 */
function getDailyQuota() {
  return callFunction('getDailyQuota', {});
}

module.exports = {
  callFunction,
  createTask,
  getTaskDetail,
  startDialogue,
  regenerateDialogue,
  confirmDialogue,
  setTaskNotify,
  startLyrics,
  startMusic,
  startFetchLyricsTimestamps,
  startNotifyAndFinalize,
  getWorksList,
  deleteWork,
  getUserProfile,
  updateUserProfile,
  getDailyQuota,
};
