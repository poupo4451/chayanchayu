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
        const stickerSrc = params.imageUrl
          || (params.stickerId ? getStickerUrl(params.stickerId) : '');
        this.setData({
          avatarError: false,
          avatarSrc: avatarId ? `/images/avatars/${avatarId}.png` : '',
          stickerSrc,
        });
      },
    },
  },

  data: {
    avatarSrc: '',
    avatarError: false,
    stickerSrc: '',
  },

  methods: {
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
