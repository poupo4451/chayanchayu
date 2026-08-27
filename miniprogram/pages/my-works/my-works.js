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

/**
 * 左滑展开的距离，需与 .swipe-delete 的宽度一致。
 * 这里以 rpx 声明、运行时按屏宽换算成 px —— 因为触摸事件的 clientX 是 px，
 * 写死 px 会在不同屏宽机型上与删除区实际宽度错位。
 */
const DELETE_WIDTH_RPX = 132;

/** 分组阈值：仅按「今天 / 最近 7 天 / 更早」三档分组，避免列表被标题切碎 */
const GROUP_TODAY = '今天';
const GROUP_WEEK = '最近 7 天';
const GROUP_EARLIER = '更早';

/** 高亮环的展示时长，需与 .work-card-highlight 动画时长一致 */
const HIGHLIGHT_MS = 2800;
/**
 * 渲染服务是「先把 tasks 置为 completed，再写入 works 记录」（见 cloud-run-remotion/src/render.ts），
 * 而 getWorksList 会用 status != completed 过滤 tasks，
 * 因此存在一个极短窗口：这条记录在两个集合里都查不到。此处做有限次重试兜底。
 */
const HIGHLIGHT_RETRY_MS = 1200;
const HIGHLIGHT_RETRY_MAX = 3;

function encodeQueryValue(value) {
  return encodeURIComponent(value == null ? '' : String(value));
}

function formatDuration(duration) {
  // 兜底格式与正常分支保持一致（0:00 而非 00:00）
  if (duration == null || duration === '') return '0:00';

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

/** 归入哪一档分组；列表已按时间倒序，故分组天然连续 */
function groupOf(timestamp) {
  if (!timestamp) return GROUP_EARLIER;
  const diffDays = Math.round(
    (startOfDay(new Date()) - startOfDay(new Date(timestamp))) / 86400000,
  );
  if (diffDays <= 0) return GROUP_TODAY;
  if (diffDays < 7) return GROUP_WEEK;
  return GROUP_EARLIER;
}

Page({
  data: {
    works: [],
    loading: true,
    safeTop: 60,
    doneCount: 0,
    pendingCount: 0,
    userProfile: {
      nickName: '',
      avatarUrl: '',
    },
    nicknameEditing: false,
    editingNickname: '',
  },

  // 滑动状态（不放入 data 避免频繁 setData）
  touchStartX: 0,
  touchStartY: 0,
  touching: false,
  currentSwipeIndex: -1,
  startX: 0, // 当前展开项的起始偏移
  deleteWidth: 66, // rpx→px 换算后的左滑距离，onLoad 时按屏宽计算

  // 新作品高亮状态（同样无需进入 data）
  pendingHighlightTaskId: '',
  highlightRetryLeft: 0,
  highlightClearTimer: null,
  highlightRetryTimer: null,

  onLoad() {
    const app = getApp();
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    // 本页 navigationStyle 为 custom，系统不预留顶部空间。
    // 头像区需落在右上角胶囊按钮下方，与首页 hero 取同一基准：
    // 状态栏高度 + 胶囊区(约 44px) + 呼吸间距 12px
    this.setData({ safeTop: statusBarHeight + 56 });

    // 触摸事件的 clientX 单位是 px，而删除区宽度以 rpx 声明，
    // 需按 750rpx 设计稿基准换算，否则窄屏/宽屏上滑动距离与按钮宽度错位
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const windowWidth = info.windowWidth || 375;
      this.deleteWidth = (DELETE_WIDTH_RPX * windowWidth) / 750;
    } catch (e) {
      console.warn('获取窗口宽度失败，左滑距离使用兜底值', e);
    }
  },

  onShow() {
    // 自定义 tab-bar 每个 tab 页各有独立实例，必须由页面显式声明选中项，
    // 否则会出现「切回来仍高亮上一个 tab、需点两次」的问题
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setSelected(1);

    // 取出并立即清空：switchTab 不支持 query，进度页完成后把 taskId 放在 globalData。
    // 必须一次性消费，否则下次进入本页会误高亮同一条。
    const app = getApp();
    if (app && app.globalData && app.globalData.highlightTaskId) {
      this.pendingHighlightTaskId = app.globalData.highlightTaskId;
      this.highlightRetryLeft = HIGHLIGHT_RETRY_MAX;
      app.globalData.highlightTaskId = '';
    }

    this.loadProfile();
    this.loadWorks();
  },

  // tabBar 页切走只触发 onHide、不触发 onUnload，
  // 定时器必须在这里停掉，否则会在后台继续空转拉取列表
  onHide() {
    this.clearHighlightTimers();
  },

  onUnload() {
    this.clearHighlightTimers();
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

  // 打开昵称编辑弹窗
  onOpenNicknameEditor() {
    this.setData({
      nicknameEditing: true,
      editingNickname: this.data.userProfile.nickName || '',
    });
  },

  // 关闭弹窗
  onCloseNicknameEditor() {
    this.setData({ nicknameEditing: false });
  },

  // 弹窗里输入框实时绑定
  onNicknameInput(e) {
    this.setData({ editingNickname: e.detail.value || '' });
  },

  // 弹窗里输入框失焦（用户按"完成"或点击别处）
  onNicknameEditorBlur(e) {
    if (e && e.detail && typeof e.detail.value === 'string') {
      this.setData({ editingNickname: e.detail.value });
    }
  },

  // 确认保存
  onConfirmNickname() {
    const nickName = (this.data.editingNickname || '').trim();
    if (nickName && nickName !== this.data.userProfile.nickName) {
      this.setData({ 'userProfile.nickName': nickName });
      updateUserProfile({ nickName }).catch((err) => {
        console.warn('保存昵称失败', err);
      });
    }
    this.setData({ nicknameEditing: false });
  },

  // modal 内容区吞掉 tap，避免冒泡关闭弹窗
  noop() {},

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

  // ---- 作品列表 ----

  async loadWorks() {
    // 保留旧数据静默刷新，避免每次切 tab 时白屏闪烁
    try {
      const list = await getWorksList();
      const highlightId = this.pendingHighlightTaskId || '';
      const decorated = this.decorateList(
        (list || []).map((item) => ({
          ...item,
          statusLabel: item.type === 'task' ? (STAGE_LABELS[item.status] || '进行中') : '',
          createdAtText: formatTime(item.createdAt),
          durationText: formatDuration(item.duration),
          swipeX: 0,
          // 只高亮「已完成」的那一条，避免任务态记录被误标为新作品
          highlight: !!highlightId && item.type === 'work' && item.taskId === highlightId,
        })),
      );

      this.setData({ ...decorated, loading: false });
      this.settleHighlight(decorated.works);
    } catch (e) {
      this.setData({ loading: false });
      showError(e, '加载作品失败');
    }
  },

  /**
   * 派生分组标题与顶部计数。
   * 分组标题只挂在每组第一条上，列表保持扁平数组 ——
   * 嵌套结构会打乱左滑逻辑依赖的 index。
   * 删除后也要重跑，否则某组唯一一条被删时标题会错挂到下一组。
   */
  decorateList(list) {
    let lastGroup = '';
    let doneCount = 0;
    let pendingCount = 0;

    const works = list.map((item) => {
      if (item.type === 'task') pendingCount += 1;
      else doneCount += 1;

      const group = groupOf(item.createdAt);
      const groupLabel = group === lastGroup ? '' : group;
      lastGroup = group;

      return { ...item, groupLabel };
    });

    return { works, doneCount, pendingCount };
  },

  /* ---- 新作品高亮 ---- */

  /**
   * 命中则定时摘掉高亮标记（动画只播一次）；
   * 未命中说明 works 记录还没落库，隔一会儿重新拉一次列表。
   */
  settleHighlight(works) {
    if (!this.pendingHighlightTaskId) return;

    const hit = works.some((item) => item.highlight);
    if (hit) {
      this.pendingHighlightTaskId = '';
      this.highlightRetryLeft = 0;
      this.clearHighlightTimers();
      this.highlightClearTimer = setTimeout(() => {
        this.highlightClearTimer = null;
        const updates = {};
        this.data.works.forEach((item, i) => {
          if (item.highlight) updates[`works[${i}].highlight`] = false;
        });
        if (Object.keys(updates).length) this.setData(updates);
      }, HIGHLIGHT_MS);
      return;
    }

    if (this.highlightRetryLeft > 0) {
      this.highlightRetryLeft -= 1;
      this.highlightRetryTimer = setTimeout(() => {
        this.highlightRetryTimer = null;
        this.loadWorks();
      }, HIGHLIGHT_RETRY_MS);
    } else {
      this.pendingHighlightTaskId = '';
    }
  },

  clearHighlightTimers() {
    if (this.highlightClearTimer) {
      clearTimeout(this.highlightClearTimer);
      this.highlightClearTimer = null;
    }
    if (this.highlightRetryTimer) {
      clearTimeout(this.highlightRetryTimer);
      this.highlightRetryTimer = null;
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
    // 限制范围：-deleteWidth ~ 0
    if (newX < -this.deleteWidth) newX = -this.deleteWidth;
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
    const threshold = -this.deleteWidth / 2;
    const targetX = work.swipeX < threshold ? -this.deleteWidth : 0;

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

      // 先标记 exiting 触发收起动画，0.2s 后再从列表移除
      this.setData({ [`works[${index}].exiting`]: true });
      setTimeout(() => {
        const rest = this.data.works.filter((_, i) => i !== index);
        // 删除可能让某一组只剩空标题（如某组唯一一条被删），需重算分组归属与计数
        this.setData(this.decorateList(rest));
        wx.showToast({ title: '已删除', icon: 'success' });
      }, 220);
    } catch (e) {
      showError(e, '删除失败');
      wx.hideLoading();
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

  /**
   * 客服会话打开失败（如后台未配置客服、账号能力受限）时的兜底提示。
   * 成功路径由微信原生接管，无需 JS 介入。
   * 注意：开发者工具不支持唤起客服会话，必须真机验证。
   */
  onContactError(e) {
    console.error('open contact failed', e && e.detail);
    wx.showToast({ title: '客服暂时不可用，请稍后再试', icon: 'none' });
  },

  /** 空状态 CTA：本页是 tab 页，创作页是普通页，用 navigateTo 保留返回路径 */
  goCreate() {
    wx.navigateTo({
      url: '/pages/create/create',
      fail: (err) => {
        console.error('open create failed', err);
        wx.showToast({ title: '打开创作页失败', icon: 'none' });
      },
    });
  },

  onShareAppMessage() {
    return {
      title: '一句话创作你的歌词动画 - 言语生声',
      imageUrl: '/images/share-cover.jpg',
    };
  },
});
