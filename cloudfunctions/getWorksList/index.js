/**
 * getWorksList 云函数（Event Function）
 * 职责：查询用户"我的作品"列表
 *
 * 注意：一个任务从创建到最终视频渲染完成，中间要经过对话/歌词/音乐/渲染等多个阶段，
 * `works` 集合只有在全部完成后才会写入一条记录。为了让用户新建任务后立刻能在列表里
 * 看到一条"进行中"的记录，这里同时查询 `tasks`（未完成/失败）和 `works`（已完成），
 * 合并成一个列表返回。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const $ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || 'mock-user';

  try {
    const [worksRes, tasksRes] = await Promise.all([
      db
        .collection('works')
        .where({ userId: openid })
        .orderBy('createdAt', 'desc')
        .get(),
      db
        .collection('tasks')
        .where({ userId: openid, status: $.neq('completed') })
        .orderBy('createdAt', 'desc')
        .get(),
    ]);

    const works = (worksRes.data || []).map((item) => ({
      id: item._id,
      type: 'work',
      taskId: item.taskId || '',
      title: item.title,
      videoUrl: item.videoUrl,
      duration: `00:${String(item.duration || 0).padStart(2, '0')}`,
      createdAt: item.createdAt,
      status: 'completed',
      progress: 100,
    }));

    const tasks = (tasksRes.data || []).map((item) => ({
      id: item._id,
      type: 'task',
      taskId: item._id,
      title: item.topic || '生成中的作品',
      videoUrl: '',
      duration: '',
      createdAt: item.createdAt,
      status: item.status,
      progress: item.progress || 0,
    }));

    const merged = works
      .concat(tasks)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return { success: true, data: merged };
  } catch (e) {
    console.error('getWorksList error', e);
    return { success: false, message: e.message || '查询作品列表失败' };
  }
};
