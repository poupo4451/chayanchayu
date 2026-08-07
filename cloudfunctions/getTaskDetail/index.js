/**
 * getTaskDetail 云函数（Event Function）
 * 职责：查询任务详情，供小程序端轮询/预览页读取
 *
 * 注意：本函数不再通过 cloud.callFunction 触发 pollMusicStatus。
 * 原因：云函数间调用存在一条独立于被调函数自身 Timeout 配置的约 3 秒调用通道限制，
 * 而本函数被客户端高频轮询调用（每几秒一次），一旦在这条热路径上触发耗时的下游调用，
 * 极易被平台判定超时并强杀下游执行。pollMusicStatus 本身已有独立的每分钟定时触发器，
 * 无需在此重复触发；音乐结果到位后的后续推进（歌词时间戳/最终渲染）由小程序端
 * task-progress 轮询页根据任务字段状态直接触发对应云函数（与对话/歌词生成同一套安全模式）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  try {
    const tasksCol = db.collection('tasks');
    const res = await tasksCol.doc(taskId).get();
    const task = res.data;

    // 所有权校验：只能查看自己的任务
    if (!task || task.userId !== openid) {
      return { success: false, message: '无权查看此任务' };
    }

    return {
      success: true,
      data: {
        taskId,
        status: task.status,
        progress: task.progress,
        dialogue: task.dialogue,
        lyrics: task.lyrics,
        musicProviderTaskId: task.musicProviderTaskId,
        audioUrl: task.audioUrl,
        resultVideoUrl: task.resultVideoUrl,
        errorStage: task.errorStage,
        errorMsg: task.errorMsg,
      },
    };
  } catch (e) {
    console.error('getTaskDetail error', e);
    return { success: false, message: e.message || '查询任务失败' };
  }
};
