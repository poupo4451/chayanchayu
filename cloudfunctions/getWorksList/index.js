/**
 * getWorksList 云函数（Event Function）
 * 职责：查询用户"我的作品"列表
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || 'mock-user';

  try {
    const res = await db
      .collection('works')
      .where({ userId: openid })
      .orderBy('createdAt', 'desc')
      .get();

    const works = (res.data || []).map((item) => ({
      id: item._id,
      title: item.title,
      videoUrl: item.videoUrl,
      duration: `00:${String(item.duration || 0).padStart(2, '0')}`,
      createdAt: item.createdAt,
    }));

    return { success: true, data: works };
  } catch (e) {
    console.error('getWorksList error', e);
    return { success: false, message: e.message || '查询作品列表失败' };
  }
};
