const { getWorksList } = require('../../utils/api');

Page({
  data: {
    works: [],
    loading: true,
  },

  onShow() {
    this.loadWorks();
  },

  async loadWorks() {
    this.setData({ loading: true });
    try {
      const works = await getWorksList();
      this.setData({ works });
    } catch (e) {
      console.error(e);
    } finally {
      this.setData({ loading: false });
    }
  },

  onOpenWork(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/my-works/detail?workId=${id}` });
  },

  onShareAppMessage() {
    return { title: '茶言茶曲 - 我的作品' };
  },
});
