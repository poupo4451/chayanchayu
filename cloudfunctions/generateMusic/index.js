/**
 * generateMusic 云函数（Event Function）
 * 职责：封装 MusicProvider 的 submit/poll/getResult 三段式调用，更新任务状态
 * 骨架阶段：内置 Mock 实现，直接"秒过"，返回占位音频链接与时长
 * 音乐产出后触发 rendering_video 阶段（后续接云托管 Remotion 服务，此处先占位串联）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const mockMusicProvider = {
  async submit(lyrics, genre) {
    return { providerTaskId: `mock-${Date.now()}` };
  },
  async pollStatus(providerTaskId) {
    return 'succeeded';
  },
  async getResult(providerTaskId) {
    return {
      audioUrl: 'https://placeholder.cos.ap-shanghai.myqcloud.com/mock-song.mp3',
      duration: 32,
    };
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const { providerTaskId } = await mockMusicProvider.submit(task.lyrics, task.style.musicGenre);

    let status = 'processing';
    let retries = 0;
    while (status === 'processing' && retries < 10) {
      status = await mockMusicProvider.pollStatus(providerTaskId);
      if (status === 'processing') {
        await sleep(1000);
        retries += 1;
      }
    }

    if (status !== 'succeeded') {
      throw new Error('音乐生成超时或失败');
    }

    const { audioUrl, duration } = await mockMusicProvider.getResult(providerTaskId);

    await tasksCol.doc(taskId).update({
      data: {
        audioUrl,
        audioDuration: duration,
        status: 'rendering_video',
        progress: 75,
        updatedAt: Date.now(),
      },
    });

    // 骨架阶段：直接调用 notifyAndFinalize 占位完成"渲染"，后续第4步替换为真实云托管 Remotion 触发
    cloud.callFunction({ name: 'notifyAndFinalize', data: { taskId } }).catch((e) => {
      console.error('trigger notifyAndFinalize failed', e);
    });

    return { success: true, data: { taskId, audioUrl, duration } };
  } catch (e) {
    console.error('generateMusic error', e);
    await tasksCol.doc(taskId).update({
      data: {
        status: 'failed',
        errorStage: 'generating_music',
        errorMsg: e.message || '音乐生成失败',
        updatedAt: Date.now(),
      },
    });
    return { success: false, message: e.message || '音乐生成失败' };
  }
};
