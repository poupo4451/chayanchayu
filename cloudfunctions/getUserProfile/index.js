/**
 * getUserProfile 云函数（Event Function）
 * 职责：读取当前用户的资料（头像、昵称等）
 * 如果用户记录尚不存在，则创建一条初始记录后返回
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const $ = db.command;

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  if (!openid) {
    return { success: false, message: '无法获取用户标识' };
  }

  try {
    const usersCol = db.collection('users');
    const res = await usersCol.where({ _openid: openid }).limit(1).get();

    if (res.data && res.data.length > 0) {
      // 已有记录，直接返回
      const profile = res.data[0];
      return {
        success: true,
        data: {
          _id: profile._id,
          nickName: profile.nickName || '',
          avatarUrl: profile.avatarUrl || '',
          createdAt: profile.createdAt,
        },
      };
    }

    // 没有记录，创建一条初始记录
    const createRes = await usersCol.add({
      data: {
        _openid: openid,
        nickName: '',
        avatarUrl: '',
        createdAt: Date.now(),
      },
    });

    return {
      success: true,
      data: {
        _id: createRes._id,
        nickName: '',
        avatarUrl: '',
        createdAt: Date.now(),
      },
    };
  } catch (e) {
    console.error('getUserProfile error', e);
    return { success: false, message: e.message || '获取用户资料失败' };
  }
};
