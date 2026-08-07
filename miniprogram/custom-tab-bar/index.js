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
      // 延迟确保 getCurrentPages() 返回已切换后的页面
      setTimeout(() => this.updateSelected(), 50);
    },
  },

  methods: {
    updateSelected() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      if (!page) return;
      const route = '/' + page.route;
      const index = this.data.list.findIndex((item) => item.pagePath === route);
      // 防止页面过渡期被旧 route 覆盖掉 switchTab 已设的选中态
      if (index !== -1 && this.data.selected !== index) {
        this.setData({ selected: index });
      }
    },

    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      const index = this.data.list.findIndex((item) => item.pagePath === path);
      if (index !== -1) this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },
});
