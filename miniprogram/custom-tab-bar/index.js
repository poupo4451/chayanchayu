Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: '🏠' },
      { pagePath: '/pages/my-works/my-works', text: '我的作品', icon: '🎬' },
    ],
  },

  lifetimes: {
    attached() {
      this.updateSelected();
    },
  },

  pageLifetimes: {
    show() {
      this.updateSelected();
    },
  },

  methods: {
    updateSelected() {
      const page = getCurrentPages().slice(-1)[0];
      if (!page) return;
      const route = `/${page.route}`;
      const index = this.data.list.findIndex((item) => item.pagePath === route);
      if (index !== -1) this.setData({ selected: index });
    },

    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      const index = this.data.list.findIndex((item) => item.pagePath === path);
      if (index !== -1) this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },
});
