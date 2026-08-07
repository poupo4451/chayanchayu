const { getStickerUrl } = require('../../utils/stickers');

Component({
  properties: {
    line: {
      type: Object,
      value: {},
      observer(newVal) {
        const avatarId = newVal && newVal.avatarId;
        const params = (newVal && newVal.params) || {};
        // 优先用云函数已经填好的 imageUrl；老数据没填时按 stickerId 兜底
        const rawUrl = params.imageUrl
          || (params.stickerId ? getStickerUrl(params.stickerId) : '');
        this.setData({
          avatarError: false,
          avatarSrc: avatarId ? `/images/avatars/${avatarId}.png` : '',
          stickerSrc: '',
          stickerLoading: true,
        });
        // cloud:// 协议需要转换为临时 HTTPS 链接才能在小程序 <image> 中稳定加载
        if (rawUrl && rawUrl.startsWith('cloud://')) {
          this._resolveCloudUrl(rawUrl);
        } else {
          this.setData({ stickerSrc: rawUrl, stickerLoading: false });
        }
      },
    },
  },

  data: {
    avatarSrc: '',
    avatarError: false,
    stickerSrc: '',
    stickerLoading: true,
  },

  lifetimes: {
    detached() {
      // 清理 pending 请求标记，避免组件销毁后 setData
      this._resolved = true;
    },
  },

  methods: {
    _resolveCloudUrl(cloudUrl) {
      const app = getApp();
      const cache = (app && app.globalData && app.globalData.tempFileUrlCache) || {};

      // 优先命中应用级缓存，同一次会话内同一文件不重复请求
      if (cache[cloudUrl]) {
        if (this._resolved) return;
        this.setData({ stickerSrc: cache[cloudUrl], stickerLoading: false });
        return;
      }

      wx.cloud.getTempFileURL({
        fileList: [cloudUrl],
        success: (res) => {
          if (this._resolved) return;
          const file = res.fileList && res.fileList[0];
          const tempUrl = file && file.tempFileURL ? file.tempFileURL : '';
          if (tempUrl && app && app.globalData) {
            if (!app.globalData.tempFileUrlCache) app.globalData.tempFileUrlCache = {};
            app.globalData.tempFileUrlCache[cloudUrl] = tempUrl;
          }
          this.setData({ stickerSrc: tempUrl, stickerLoading: false });
        },
        fail: () => {
          if (this._resolved) return;
          // 转换失败时兜底使用原 cloud:// 地址，让 <image> 自行尝试
          this.setData({ stickerSrc: cloudUrl, stickerLoading: false });
        },
      });
    },

    onTap() {
      this.triggerEvent('tap');
    },
    onAvatarError() {
      this.setData({ avatarError: true });
    },
    onStickerError() {
      this.setData({ stickerSrc: '' });
    },
  },
});
