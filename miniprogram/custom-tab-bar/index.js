Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/home/home',
        text: '首页',
        icon: '/images/tab-home.svg',
        activeIcon: '/images/tab-home-active.svg',
      },
      {
        pagePath: '/pages/my-works/my-works',
        text: '我的作品',
        icon: '/images/tab-works.svg',
        activeIcon: '/images/tab-works-active.svg',
      },
    ],
  },

  methods: {
    /**
     * 由各 tab 页在 onShow 中显式调用，传入自身索引。
     * 自定义 tab-bar 在每个 tab 页都是独立实例，
     * 不能在点击时给「即将离开的页面」写状态（会残留脏值导致下次进入不刷新），
     * 也不能依赖 getCurrentPages() + setTimeout 猜时机（存在竞态）。
     */
    setSelected(index) {
      if (index !== this.data.selected) {
        this.setData({ selected: index });
      }
    },

    switchTab(e) {
      const { path, index } = e.currentTarget.dataset;
      // 点击当前页不重复跳转，避免 switchTab 无谓开销
      if (Number(index) === this.data.selected) return;
      wx.switchTab({ url: path });
    },
  },
});
