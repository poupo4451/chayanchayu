Page({
  data: {
    cases: [
      { id: 'demo1', title: '绿茶吵架变说唱', duration: '00:35' },
      { id: 'demo2', title: '闺蜜互怼小剧场', duration: '00:28' },
    ],
  },

  onLoad() {},

  onShareAppMessage() {
    return {
      title: '茶言茶曲 - AI聊天记录变MV',
    };
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },
});
