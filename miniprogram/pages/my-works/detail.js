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

    const createdAt = Number(decodeQueryValue(query.createdAt)) || 0;
    const work = {
      id: decodeQueryValue(query.workId),
      title: decodeQueryValue(query.title) || '未命名作品',
      duration: decodeQueryValue(query.duration) || '--:--',
      videoUrl: decodeQueryValue(query.videoUrl),
      playUrl: '',
      createdAt,
      createdAtText: formatCreatedAt(createdAt),
    };

    this.setData({
      work,
      safeTop: statusBarHeight + 12,
      safeBottom: safeAreaBottom,
    });
    this.videoCtx = wx.createVideoContext('workVideo', this);
    this.loadVideo();
  },

  onUnload() {
    this.clearAutoHideTimer();
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
      title: `${work.title || '我的作品'} - 言语生声`,
      path: `/pages/my-works/detail?workId=${encodeURIComponent(work.id || '')}&title=${encodeURIComponent(work.title || '')}&duration=${encodeURIComponent(work.duration || '')}&videoUrl=${encodeURIComponent(work.videoUrl || '')}&createdAt=${encodeURIComponent(work.createdAt || '')}`,
    };
  },
});
