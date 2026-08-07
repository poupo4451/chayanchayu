const { getWorksList, deleteWork, getUserProfile, updateUserProfile } = require('../../utils/api');
const { showError } = require('../../utils/error-tip');

const STAGE_LABELS = {
  pending: '排队中',
  generating_dialogue: '编写剧本中',
  generating_screenshots: '渲染聊天气泡中',
  generating_lyrics: '改编歌词中',
  generating_music: '生成音乐中',
  rendering_video: '合成MV中',
  failed: '生成失败',
};

const DELETE_WIDTH = 70; // 删除按钮宽度（140rpx / 2，rpx→px 近似）

function encodeQueryValue(value) {
  return encodeURIComponent(value == null ? '' : String(value));
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

Page({
  data: {
    works: [],
    loading: true,
    safeTop: 60,
    userProfile: {
      nickName: '',
      avatarUrl: '',
    },
  },

  // 滑动状态（不放入 data 避免频繁 setData）
  touchStartX: 0,
  touchStartY: 0,
  touching: false,
  currentSwipeIndex: -1,
  startX: 0, // 当前展开项的起始偏移

  onLoad() {
    const app = getApp();
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    this.setData({ safeTop: statusBarHeight + 16 });
  },

  onShow() {
    this.loadProfile();
    this.loadWorks();
  },

  // ---- 用户资料 ----

  async loadProfile() {
    try {
      const profile = await getUserProfile();
      if (profile) {
        this.setData({
          userProfile: {
            nickName: profile.nickName || '',
            avatarUrl: profile.avatarUrl || '',
          },
        });
      }
    } catch (e) {
      console.warn('加载用户资料失败', e);
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail; // 临时路径
    if (!avatarUrl) return;

    wx.showLoading({ title: '上传中…', mask: true });
    // 上传到云存储
    wx.cloud.uploadFile({
      cloudPath: `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
      filePath: avatarUrl,
      success: (res) => {
        const cloudUrl = res.fileID;
        this.setData({ 'userProfile.avatarUrl': cloudUrl });
        // 异步保存到数据库
        updateUserProfile({ avatarUrl: cloudUrl }).catch((err) => {
          console.warn('保存头像失败', err);
        });
      },
      fail: (err) => {
        console.error('上传头像失败', err);
        wx.showToast({ title: '头像上传失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      },
    });
  },

  onNicknameBlur(e) {
    const nickName = e.detail.value || '';
    if (!nickName || nickName === this.data.userProfile.nickName) return;
    this.setData({ 'userProfile.nickName': nickName });
    updateUserProfile({ nickName }).catch((err) => {
      console.warn('保存昵称失败', err);
    });
  },

  // ---- 作品列表 ----

  async loadWorks() {
    this.setData({ loading: true });
    try {
      const list = await getWorksList();
      const works = (list || []).map((item) => ({
        ...item,
        statusLabel: item.type === 'task' ? (STAGE_LABELS[item.status] || '进行中') : '',
        createdAtText: formatTime(item.createdAt),
        swipeX: 0,
      }));
      this.setData({ works });
    } catch (e) {
      showError(e, '加载作品失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  // ---- 左滑手势 ----

  onSwipeStart(e) {
    const { index } = e.currentTarget.dataset;
    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touching = true;
    this.currentSwipeIndex = index;
    this.startX = (this.data.works[index] && this.data.works[index].swipeX) || 0;
  },

  onSwipeMove(e) {
    if (!this.touching || this.currentSwipeIndex < 0) return;
    const touch = e.touches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;

    // 竖向滑动不处理
    if (Math.abs(dy) > Math.abs(dx)) return;

    let newX = this.startX + dx;
    // 限制范围：-DELETE_WIDTH ~ 0
    if (newX < -DELETE_WIDTH) newX = -DELETE_WIDTH;
    if (newX > 0) newX = 0;

    const key = `works[${this.currentSwipeIndex}].swipeX`;
    this.setData({ [key]: newX });
  },

  onSwipeEnd() {
    if (!this.touching || this.currentSwipeIndex < 0) return;
    this.touching = false;

    const work = this.data.works[this.currentSwipeIndex];
    if (!work) return;

    // 滑过一半就展开，否则收回
    const threshold = -DELETE_WIDTH / 2;
    const targetX = work.swipeX < threshold ? -DELETE_WIDTH : 0;

    // 先收回其他已展开项
    const updates = {};
    this.data.works.forEach((item, i) => {
      if (i !== this.currentSwipeIndex && item.swipeX !== 0) {
        updates[`works[${i}].swipeX`] = 0;
      }
    });
    updates[`works[${this.currentSwipeIndex}].swipeX`] = targetX;
    this.setData(updates);

    this.currentSwipeIndex = -1;
  },

  // ---- 删除 ----

  onDeleteConfirm(e) {
    const { index } = e.currentTarget.dataset;
    const work = this.data.works[index];
    if (!work) return;

    wx.showModal({
      title: '删除作品',
      content: `确定删除「${work.title}」吗？删除后不可恢复。`,
      confirmColor: '#FF4D4F',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return;
        this.doDelete(index);
      },
    });
  },

  async doDelete(index) {
    const work = this.data.works[index];
    if (!work) return;

    wx.showLoading({ title: '删除中…', mask: true });
    try {
      await deleteWork({ id: work.id, type: work.type, videoUrl: work.videoUrl });
      // 从列表移除
      const works = this.data.works.filter((_, i) => i !== index);
      this.setData({ works });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (e) {
      showError(e, '删除失败');
    } finally {
      wx.hideLoading();
    }
  },

  // ---- 打开作品 ----

  onOpenWork(e) {
    const { index } = e.currentTarget.dataset;
    const work = this.data.works[index];
    if (!work) return;

    // 如果当前项已展开左滑，点击先收回而不是打开
    if (work.swipeX < 0) {
      this.setData({ [`works[${index}].swipeX`]: 0 });
      return;
    }

    // 先收回其他已展开项
    this.collapseAll();

    const { id } = work;
    if (work.type === 'task') {
      wx.navigateTo({
        url: `/pages/task-progress/task-progress?taskId=${encodeQueryValue(work.taskId)}`,
        fail: (err) => {
          console.error('open task failed', err);
          wx.showToast({ title: '打开任务失败', icon: 'none' });
        },
      });
      return;
    }

    if (!work.videoUrl) {
      wx.showToast({ title: '这个作品还没有视频', icon: 'none' });
      return;
    }

    const query = [
      `workId=${encodeQueryValue(work.id)}`,
      `title=${encodeQueryValue(work.title)}`,
      `duration=${encodeQueryValue(work.duration)}`,
      `videoUrl=${encodeQueryValue(work.videoUrl)}`,
      `createdAt=${encodeQueryValue(work.createdAt)}`,
    ].join('&');

    wx.navigateTo({
      url: `/pages/my-works/detail?${query}`,
      fail: (err) => {
        console.error('open work failed', err);
        wx.showToast({ title: '打开作品失败', icon: 'none' });
      },
    });
  },

  collapseAll() {
    const updates = {};
    let changed = false;
    this.data.works.forEach((item, i) => {
      if (item.swipeX !== 0) {
        updates[`works[${i}].swipeX`] = 0;
        changed = true;
      }
    });
    if (changed) this.setData(updates);
  },

  onShareAppMessage() {
    return { title: '我的作品 - 言语生声' };
  },
});
