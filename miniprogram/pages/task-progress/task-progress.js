const { getTaskDetail } = require('../../utils/api');
const { startPolling } = require('../../utils/task-polling');

const STAGE_LABELS = {
  pending: 'AI正在准备…',
  generating_dialogue: 'AI正在编绿茶剧本…',
  generating_screenshots: '正在渲染聊天气泡…',
  generating_lyrics: '正在改编歌词…',
  generating_music: '正在压混音乐…',
  rendering_video: '正在合成MV…',
  completed: '大功告成！',
  failed: '出了点小问题…',
};

const STAGE_ORDER = [
  'pending',
  'generating_dialogue',
  'generating_screenshots',
  'generating_lyrics',
  'generating_music',
  'rendering_video',
  'completed',
];

Page({
  data: {
    taskId: '',
    status: 'pending',
    progress: 0,
    stageLabel: STAGE_LABELS.pending,
    stageOrder: STAGE_ORDER,
    failed: false,
    errorMsg: '',
  },

  onLoad(query) {
    this.setData({ taskId: query.taskId });
    this.subscribeNotify();
    this.poller = startPolling({
      fetcher: () => getTaskDetail(this.data.taskId),
      onUpdate: (task) => this.handleTaskUpdate(task),
      onError: (err) => console.error('poll error', err),
    });
  },

  onUnload() {
    if (this.poller) this.poller.stop();
  },

  handleTaskUpdate(task) {
    this.setData({
      status: task.status,
      progress: task.progress || 0,
      stageLabel: STAGE_LABELS[task.status] || '',
      failed: task.status === 'failed',
      errorMsg: task.errorMsg || '',
    });
    if (task.status === 'completed') {
      if (this.poller) this.poller.stop();
      wx.redirectTo({ url: `/pages/my-works/my-works?highlightTaskId=${this.data.taskId}` });
    }
  },

  subscribeNotify() {
    wx.requestSubscribeMessage({
      tmplIds: [],
      complete: () => {},
    });
  },

  onExit() {
    wx.switchTab({ url: '/pages/home/home' });
  },
});
