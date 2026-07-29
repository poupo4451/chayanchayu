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
          reject(new Error(res.result.message || `${name} 调用失败`));
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

/** 重新生成对话 */
function regenerateDialogue(taskId) {
  return callFunction('generateDialogue', { taskId, regenerate: true });
}

/** 确认对话内容，进入后续生成流程 */
function confirmDialogue(taskId, dialogue) {
  return callFunction('confirmDialogue', { taskId, dialogue });
}

/** 查询"我的作品"列表 */
function getWorksList() {
  return callFunction('getWorksList', {});
}

module.exports = {
  callFunction,
  createTask,
  getTaskDetail,
  regenerateDialogue,
  confirmDialogue,
  getWorksList,
};
