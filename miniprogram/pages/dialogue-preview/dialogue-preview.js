const { getTaskDetail, startDialogue, regenerateDialogue, confirmDialogue } = require('../../utils/api');
const { showError } = require('../../utils/error-tip');

Page({
  data: {
    taskId: '',
    dialogue: [],
    loading: true,
  },

  onLoad(query) {
    this.setData({ taskId: query.taskId });
    this.pollCount = 0;
    this.pollTimer = null;
    this.dialogueTriggered = false;
    this.loadDialogue();
  },

  // 拉取任务并渲染对话；若对话仍在异步生成中，则轮询等待
  async loadDialogue() {
    try {
      const task = await getTaskDetail(this.data.taskId);
      const dialogue = task.dialogue || [];

      // 对话已生成完成
      if (dialogue.length > 0) {
        this.setData({ dialogue, loading: false });
        this.stopPolling();
        return;
      }

      // 生成失败：提示用户手动重试
      if (task.status === 'failed') {
        this.setData({ loading: false });
        wx.showToast({ title: task.errorMsg || '生成失败，请点重新生成', icon: 'none' });
        this.stopPolling();
        return;
      }

      // 任务刚创建、尚未开始生成对话：由客户端直接触发生成
      // （不走云函数间调用，避免该链路约3秒的调用通道限制导致任务卡死在10%）
      if (task.status === 'pending' && !this.dialogueTriggered) {
        this.dialogueTriggered = true;
        startDialogue(this.data.taskId)
          .then((res) => {
            if (res && res.dialogue && res.dialogue.length > 0) {
              this.setData({ dialogue: res.dialogue, loading: false });
              this.stopPolling();
            }
          })
          .catch((e) => {
            console.error('startDialogue failed', e);
          });
      }

      // 仍在生成中（pending / generating_dialogue），继续轮询，最多约 60 秒
      this.pollCount += 1;
      if (this.pollCount > 20) {
        this.setData({ loading: false });
        wx.showToast({ title: '生成超时，请点重新生成', icon: 'none' });
        this.stopPolling();
        return;
      }

      this.setData({ loading: true });
      this.schedulePoll();
    } catch (e) {
      console.error(e);
      this.pollCount += 1;
      if (this.pollCount > 20) {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.stopPolling();
        return;
      }
      this.schedulePoll();
    }
  },

  schedulePoll() {
    this.stopPolling();
    this.pollTimer = setTimeout(() => {
      this.loadDialogue();
    }, 3000);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
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
    this.stopPolling();
    wx.showLoading({ title: '重新生成中…' });
    try {
      const task = await regenerateDialogue(this.data.taskId);
      this.setData({ dialogue: task.dialogue || [] });
    } catch (e) {
      showError(e, '重新生成失败');
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
      showError(e, '提交失败');
    } finally {
      wx.hideLoading();
    }
  },

  onUnload() {
    this.stopPolling();
  },
});
