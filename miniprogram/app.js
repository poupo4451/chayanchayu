// app.js
App({
  onLaunch: function() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-d7ggdqfhgc4ee2796',
        traceUser: true,
      });
    }

    // 提前算好状态栏高度/底部安全区，存进 globalData，
    // 供各页面（尤其是 navigationStyle: custom 的自定义导航栏页面）动态计算顶部/底部安全距离，
    // 避免不同机型（灵动岛/无 Home 键等）状态栏高度不一致导致的布局重叠。
    try {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = windowInfo.statusBarHeight || 20;
      const screenHeight = windowInfo.screenHeight || 0;
      const safeAreaBottom = windowInfo.safeArea
        ? Math.max(screenHeight - windowInfo.safeArea.bottom, 0)
        : 0;
      this.globalData.statusBarHeight = statusBarHeight;
      this.globalData.safeAreaBottom = safeAreaBottom;
    } catch (e) {
      console.error('获取窗口信息失败', e);
      this.globalData.statusBarHeight = 20;
      this.globalData.safeAreaBottom = 0;
    }
  },

  globalData: {
    statusBarHeight: 20,
    safeAreaBottom: 0,
  }
});