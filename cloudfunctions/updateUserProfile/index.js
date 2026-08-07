/**
 * updateUserProfile 云函数（Event Function）
 * 职责：更新当前用户的头像和/或昵称
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const $ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';

  if (!openid) {
    return { success: false, message: '无法获取用户标识' };
  }

  const { nickName, avatarUrl } = event;

  // 至少需要提供一个要更新的字段
  if (nickName === undefined && avatarUrl === undefined) {
    return { success: false, message: '请提供 nickName 或 avatarUrl 参数' };
  }

  try {
    const usersCol = db.collection('users');
    const res = await usersCol.where({ _openid: openid }).limit(1).get();

    if (!res.data || res.data.length === 0) {
      // 记录不存在，创建一条
      const createRes = await usersCol.add({
        data: {
          _openid: openid,
          nickName: nickName || '',
          avatarUrl: avatarUrl || '',
          createdAt: Date.now(),
        },
      });
      return {
        success: true,
        data: {
          _id: createRes._id,
          nickName: nickName || '',
          avatarUrl: avatarUrl || '',
        },
      };
    }

    // 记录已存在，更新
    const docId = res.data[0]._id;
    const updateData = {};
    if (nickName !== undefined) updateData.nickName = nickName;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    await usersCol.doc(docId).update({ data: updateData });

    return {
      success: true,
      data: {
        _id: docId,
        nickName: nickName !== undefined ? nickName : res.data[0].nickName || '',
        avatarUrl: avatarUrl !== undefined ? avatarUrl : res.data[0].avatarUrl || '',
      },
    };
  } catch (e) {
    console.error('updateUserProfile error', e);
    return { success: false, message: e.message || '更新用户资料失败' };
  }
};
