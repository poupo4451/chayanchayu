Page({
  data: {
    cases: [
      { id: 'demo1', title: '绿茶吵架变说唱', duration: '00:35' },
      { id: 'demo2', title: '闺蜜互怼小剧场', duration: '00:28' },
    ],
    safeTop: 60,
  },

  onLoad() {
    const app = getApp();
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    // 顶部安全距离 = 状态栏高度 + 缓冲，避免与状态栏重叠（本页 navigationStyle 为 custom，系统不预留任何顶部空间）
    this.setData({ safeTop: statusBarHeight + 16 });
  },

  onShareAppMessage() {
    return {
      title: '言语生声',
    };
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },
});
