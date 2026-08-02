Page({
  data: {
    topic: '',
    dialogueTones: ['绿茶', '搞笑', '毒舌'],
    musicGenres: ['嘻哈', 'R&B', '流行', '抖音风', '粤语说唱', '随机'],
    selectedTone: '绿茶',
    selectedGenre: '嘻哈',
    submitting: false,
  },

  onTopicInput(e) {
    this.setData({ topic: e.detail.value });
  },

  selectTone(e) {
    this.setData({ selectedTone: e.currentTarget.dataset.value });
  },

  selectGenre(e) {
    this.setData({ selectedGenre: e.currentTarget.dataset.value });
  },

  async onSubmit() {
    if (!this.data.topic.trim()) {
      wx.showToast({ title: '请输入主题', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const { createTask } = require('../../utils/api');
      const { taskId } = await createTask({
        topic: this.data.topic.trim(),
        dialogueTone: this.data.selectedTone,
        musicGenre: this.data.selectedGenre,
      });
      wx.navigateTo({ url: `/pages/dialogue-preview/dialogue-preview?taskId=${taskId}` });
    } catch (e) {
      const message = (e && e.message) || '创建任务失败';
      wx.showToast({ title: message.slice(0, 20), icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ submitting: false });
    }
  },
});
