const { getWorksList } = require('../../utils/api');

function decodeQueryValue(value) {
  if (value == null) return '';
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return String(value);
  }
}

function formatCreatedAt(timestamp) {
  const time = Number(timestamp || 0);
  if (!time) return '';

  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (num) => String(num).padStart(2, '0');
  return `创作于 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getTempFileURL(fileID) {
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const first = (res.fileList || [])[0] || {};
        const tempUrl = first.tempFileURL || first.tempFileUrl || first.download_url || '';
        if (!tempUrl) {
          reject(new Error(first.errMsg || '获取视频地址失败'));
          return;
        }
        resolve(tempUrl);
      },
      fail: reject,
    });
  });
}

const AUTO_HIDE_DELAY = 3200;

/**
 * 仅凭 taskId 进入时（来自订阅消息推送）的作品查找重试参数。
 * 渲染服务是「先把 tasks 置为 completed，再写入 works 记录」
 * （见 cloud-run-remotion/src/render.ts），而通知由定时器在检测到 completed 后下发，
 * 因此用户点开推送时 works 记录有极小概率还没落库，需有限次重试兜底。
 */
const TASK_LOOKUP_RETRY_MS = 1200;
const TASK_LOOKUP_RETRY_MAX = 3;

Page({
  data: {
    loading: true,
    loadError: '',
    safeTop: 44,
    safeBottom: 0,
    work: {
      id: '',
      title: '',
      duration: '',
      videoUrl: '',
      playUrl: '',
      createdAt: 0,
      createdAtText: '',
    },
    playing: false,
    showControls: true,
    currentTime: 0,
    duration: 0,
    currentTimeText: '00:00',
    durationText: '00:00',
    progressPercent: 0,
  },

  onLoad(query) {
    const app = getApp();
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    const safeAreaBottom = (app.globalData && app.globalData.safeAreaBottom) || 0;

    this.setData({
      safeTop: statusBarHeight + 12,
      safeBottom: safeAreaBottom,
    });
    this.videoCtx = wx.createVideoContext('workVideo', this);

    // 从「我的作品」列表进入：完整信息都在 query 里，无需再查库
    if (query.videoUrl) {
      const createdAt = Number(decodeQueryValue(query.createdAt)) || 0;
      this.setData({
        work: {
          id: decodeQueryValue(query.workId),
          title: decodeQueryValue(query.title) || '未命名作品',
          duration: decodeQueryValue(query.duration) || '--:--',
          videoUrl: decodeQueryValue(query.videoUrl),
          playUrl: '',
          createdAt,
          createdAtText: formatCreatedAt(createdAt),
        },
      });
      this.loadVideo();
      return;
    }

    // 从订阅消息推送进入：page 参数只能带很短的信息，只有 taskId，
    // 需要先按 taskId 反查作品记录再播放
    const taskId = decodeQueryValue(query.taskId);
    if (taskId) {
      this.pendingTaskId = taskId;
      this.lookupRetryLeft = TASK_LOOKUP_RETRY_MAX;
      this.loadByTaskId(taskId);
      return;
    }

    this.setData({ loading: false, loadError: '缺少作品参数，请从「我的作品」进入' });
  },

  onUnload() {
    this.clearAutoHideTimer();
    this.clearLookupTimer();
  },

  clearLookupTimer() {
    if (this.lookupTimer) {
      clearTimeout(this.lookupTimer);
      this.lookupTimer = null;
    }
  },

  /**
   * 按 taskId 在作品列表里反查对应记录。
   * 复用 getWorksList 而不新增云函数：它已做了 openid 过滤，
   * 天然保证用户只能打开自己的作品，无需再写一遍所有权校验。
   */
  async loadByTaskId(taskId) {
    this.setData({ loading: true, loadError: '' });

    try {
      const list = await getWorksList();
      const hit = (list || []).find(
        (item) => item.type === 'work' && item.taskId === taskId && item.videoUrl,
      );

      if (!hit) {
        // works 记录可能还没落库（渲染刚完成的极短窗口），隔一会儿重试
        if (this.lookupRetryLeft > 0) {
          this.lookupRetryLeft -= 1;
          this.clearLookupTimer();
          this.lookupTimer = setTimeout(() => {
            this.lookupTimer = null;
            this.loadByTaskId(taskId);
          }, TASK_LOOKUP_RETRY_MS);
          return;
        }
        this.setData({ loading: false, loadError: '没有找到这个作品，可能已被删除' });
        return;
      }

      const createdAt = Number(hit.createdAt) || 0;
      this.setData({
        work: {
          id: hit.id || '',
          title: hit.title || '未命名作品',
          duration: hit.duration || '--:--',
          videoUrl: hit.videoUrl,
          playUrl: '',
          createdAt,
          createdAtText: formatCreatedAt(createdAt),
        },
      });
      this.loadVideo();
    } catch (e) {
      console.error('loadByTaskId failed', e);
      this.setData({
        loading: false,
        loadError: (e && e.message) || '作品加载失败，请稍后再试',
      });
    }
  },

  async loadVideo() {
    const videoUrl = this.data.work.videoUrl;
    if (!videoUrl) {
      this.setData({ loading: false, loadError: '这个作品还没有生成视频' });
      return;
    }

    this.setData({ loading: true, loadError: '' });

    try {
      const playUrl = videoUrl.startsWith('cloud://') ? await getTempFileURL(videoUrl) : videoUrl;
      this.setData({
        loading: false,
        loadError: '',
        playing: true,
        'work.playUrl': playUrl,
      });
    } catch (e) {
      console.error('load video failed', e);
      this.setData({
        loading: false,
        loadError: (e && e.message) || '视频加载失败，请稍后再试',
        'work.playUrl': '',
      });
    }
  },

  onRetry() {
    // 从推送进入且还没查到作品时，重试要重走「按 taskId 反查」，
    // 否则 videoUrl 为空、loadVideo 只会立刻再报一次同样的错
    if (!this.data.work.videoUrl && this.pendingTaskId) {
      this.lookupRetryLeft = TASK_LOOKUP_RETRY_MAX;
      this.loadByTaskId(this.pendingTaskId);
      return;
    }
    this.loadVideo();
  },

  onVideoError(e) {
    console.error('video error', e);
    wx.showToast({ title: '视频播放失败', icon: 'none' });
  },

  onVideoTap() {
    if (this.data.showControls) {
      this.setData({ showControls: false });
      this.clearAutoHideTimer();
    } else {
      this.showControlsTemporarily();
    }
  },

  onTogglePlay() {
    if (this.data.playing) {
      this.videoCtx && this.videoCtx.pause();
    } else {
      this.videoCtx && this.videoCtx.play();
    }
    this.showControlsTemporarily();
  },

  onPlay() {
    this.setData({ playing: true });
    this.showControlsTemporarily();
  },

  onPause() {
    this.setData({ playing: false });
    this.clearAutoHideTimer();
    this.setData({ showControls: true });
  },

  onEnded() {
    this.setData({ playing: false, showControls: true });
    this.clearAutoHideTimer();
  },

  onTimeUpdate(e) {
    const { currentTime, duration } = e.detail;
    const progressPercent = duration ? (currentTime / duration) * 100 : 0;
    this.setData({
      currentTime,
      duration,
      currentTimeText: formatSeconds(currentTime),
      durationText: formatSeconds(duration),
      progressPercent,
    });
  },

  onSeekChange(e) {
    const value = e.detail.value;
    const seekTime = (value / 100) * (this.data.duration || 0);
    this.videoCtx && this.videoCtx.seek(seekTime);
    this.setData({ progressPercent: value, currentTimeText: formatSeconds(seekTime) });
    this.showControlsTemporarily();
  },

  showControlsTemporarily() {
    this.setData({ showControls: true });
    this.clearAutoHideTimer();
    if (!this.data.playing) return;
    this.autoHideTimer = setTimeout(() => {
      this.setData({ showControls: false });
    }, AUTO_HIDE_DELAY);
  },

  clearAutoHideTimer() {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/my-works/my-works' }),
    });
  },

  onLongPress() {
    const that = this;
    wx.showActionSheet({
      itemList: ['保存视频'],
      success(res) {
        if (res.tapIndex === 0) that.doSaveVideo();
      },
    });
  },

  onSaveVideo() {
    this.doSaveVideo();
  },

  doSaveVideo() {
    const url = this.data.work.playUrl;
    if (!url) {
      wx.showToast({ title: '视频尚未加载', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中…' });
    wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode === 200) {
          wx.saveVideoToPhotosAlbum({
            filePath: res.tempFilePath,
            success() {
              wx.hideLoading();
              wx.showToast({ title: '已保存到相册', icon: 'success' });
            },
            fail(e) {
              wx.hideLoading();
              if (e.errMsg && e.errMsg.indexOf('auth deny') >= 0) {
                wx.showModal({
                  title: '需要授权',
                  content: '请允许保存视频到相册',
                  success(m) {
                    if (m.confirm) wx.openSetting();
                  },
                });
              } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
              }
            },
          });
        } else {
          wx.hideLoading();
          wx.showToast({ title: '下载失败', icon: 'none' });
        }
      },
      fail() {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      },
    });
  },

  onShareAppMessage() {
    const work = this.data.work || {};
    return {
      title: `${work.title || '我的作品'} - 一句话创作你的歌词动画`,
      imageUrl: '/images/share-cover.jpg',
      path: `/pages/my-works/detail?workId=${encodeURIComponent(work.id || '')}&title=${encodeURIComponent(work.title || '')}&duration=${encodeURIComponent(work.duration || '')}&videoUrl=${encodeURIComponent(work.videoUrl || '')}&createdAt=${encodeURIComponent(work.createdAt || '')}`,
    };
  },
});
