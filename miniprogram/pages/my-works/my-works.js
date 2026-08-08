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

const DELETE_WIDTH = 72; // 滑动距离（64rpx按钮 + 48rpx右间距 + 卡片间距 ≈ 72px）

function encodeQueryValue(value) {
  return encodeURIComponent(value == null ? '' : String(value));
}

function formatDuration(duration) {
  if (duration == null || duration === '') return '00:00';

  // 先尝试当数字 / 数字字符串处理
  let totalSeconds = 0;
  const num = Number(duration);
  if (!isNaN(num) && num > 0) {
    totalSeconds = num;
  } else {
    // 解析 "MM:SS" 或 "HH:MM:SS" — 统一转成总秒数
    const parts = String(duration).split(':');
    if (parts.length === 2) {
      totalSeconds = (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
    } else if (parts.length >= 3) {
      totalSeconds =
        (parseFloat(parts[0]) || 0) * 3600 +
        (parseFloat(parts[1]) || 0) * 60 +
        (parseFloat(parts[2]) || 0);
    }
  }

  const total = Math.floor(totalSeconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round((today - target) / 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const hm = `${hh}:${mm}`;
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const Y = d.getFullYear();

  // 当天
  if (diffDays === 0) return hm;
  // 昨天
  if (diffDays === 1) return `昨天 ${hm}`;
  // 最近7天内（不含今天和昨天，1-6天前）
  if (diffDays > 1 && diffDays < 7) return `${WEEK_LABELS[d.getDay()]} ${hm}`;
  // 同一年内
  if (Y === now.getFullYear()) return `${M}/${D} ${hm}`;
  // 不同年份
  return `${Y}/${M}/${D}`;
}

Page({
  data: {
    works: [],
    loading: true,
    safeTop: 60,
    nicknameFocus: false,
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
      // 无昵称时自动聚焦，方便用户获取微信昵称
      if (!profile || !profile.nickName) {
        this.setData({ nicknameFocus: true });
      }
    } catch (e) {
      console.warn('加载用户资料失败', e);
      this.setData({ nicknameFocus: true });
    }
  },

  onNicknameFocus() {
    // 用户点击了 type="nickname" 输入框，微信会自动展示昵称候选
    this.setData({ nicknameFocus: false });
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
        durationText: formatDuration(item.duration),
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
      // 仍在对话预览阶段 → 回到对话预览页继续编辑/确认
      if (work.status === 'pending' || work.status === 'generating_dialogue') {
        wx.navigateTo({
          url: `/pages/dialogue-preview/dialogue-preview?taskId=${encodeQueryValue(work.taskId)}`,
          fail: (err) => {
            console.error('open dialogue-preview failed', err);
            wx.showToast({ title: '打开对话预览失败', icon: 'none' });
          },
        });
        return;
      }
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
