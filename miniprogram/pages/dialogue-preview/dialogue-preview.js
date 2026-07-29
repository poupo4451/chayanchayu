const { getTaskDetail, regenerateDialogue, confirmDialogue } = require('../../utils/api');

Page({
  data: {
    taskId: '',
    dialogue: [],
    loading: true,
  },

  onLoad(query) {
    this.setData({ taskId: query.taskId });
    this.loadDialogue();
  },

  async loadDialogue() {
    this.setData({ loading: true });
    try {
      const task = await getTaskDetail(this.data.taskId);
      this.setData({ dialogue: task.dialogue || [] });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error(e);
    } finally {
      this.setData({ loading: false });
    }
  },

  onEditLine(e) {
    const { index } = e.currentTarget.dataset;
    wx.showModal({
      title: '编辑台词',
      editable: true,
      placeholderText: this.data.dialogue[index].text,
      success: (res) => {
        if (res.confirm && res.content) {
          const dialogue = this.data.dialogue;
          dialogue[index].text = res.content;
          this.setData({ dialogue });
        }
      },
    });
  },

  async onRegenerate() {
    wx.showLoading({ title: '重新生成中…' });
    try {
      const task = await regenerateDialogue(this.data.taskId);
      this.setData({ dialogue: task.dialogue || [] });
    } catch (e) {
      wx.showToast({ title: '重新生成失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onConfirm() {
    wx.showLoading({ title: '提交中…' });
    try {
      await confirmDialogue(this.data.taskId, this.data.dialogue);
      wx.redirectTo({ url: `/pages/task-progress/task-progress?taskId=${this.data.taskId}` });
    } catch (e) {
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
});
