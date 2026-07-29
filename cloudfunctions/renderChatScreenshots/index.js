/**
 * renderChatScreenshots 云函数（Event Function）
 * 职责：不做视觉渲染，只做数据转换——把 dialogue 逐条转换为下游（Remotion）渲染所需的
 * 结构化气泡数据：补全默认 type/params，并把 image 类型的 stickerId 解析为实际云存储 fileID。
 * 转换结果写入 task.screenshots，随后触发 generateLyrics。
 * 真正的气泡视觉渲染在 Remotion 阶段实现，本函数不生成任何图片。
 */
const cloud = require('wx-server-sdk');
const { getStickerUrl } = require('./stickers');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function buildScreenshotData(dialogue) {
  return (dialogue || []).map((line, index) => {
    const type = line.type || 'text';
    const params = line.params || {};
    const item = {
      index,
      role: line.role,
      name: line.name || '',
      type,
      text: line.text || '',
      params,
    };
    if (type === 'image') {
      item.params = { ...params, imageUrl: getStickerUrl(params.stickerId) };
    }
    return item;
  });
}

exports.main = async (event) => {
  const { taskId } = event;
  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');

  try {
    const taskRes = await tasksCol.doc(taskId).get();
    const task = taskRes.data;

    const screenshots = buildScreenshotData(task.dialogue);

    await tasksCol.doc(taskId).update({
      data: {
        screenshots,
        status: 'generating_lyrics',
        progress: 45,
        updatedAt: Date.now(),
      },
    });

    cloud.callFunction({ name: 'generateLyrics', data: { taskId } }).catch((e) => {
      console.error('trigger generateLyrics failed', e);
    });

    return { success: true, data: { taskId, screenshots } };
  } catch (e) {
    console.error('renderChatScreenshots error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_screenshots',
        errorMsg: e.message || '截图渲染失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '截图渲染失败' };
  }
};
