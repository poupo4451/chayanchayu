Component({
  properties: {
    line: {
      type: Object,
      value: {},
      observer(newVal) {
        const avatarId = newVal && newVal.avatarId;
        this.setData({
          avatarError: false,
          avatarSrc: avatarId ? `/images/avatars/${avatarId}.png` : '',
        });
      },
    },
  },

  data: {
    avatarSrc: '',
    avatarError: false,
  },

  methods: {
    onTap() {
      this.triggerEvent('tap');
    },
    onAvatarError() {
      // 默认头像素材还没放进 images/avatars 目录时，静默回退到首字母色块头像
      this.setData({ avatarError: true });
    },
  },
});
