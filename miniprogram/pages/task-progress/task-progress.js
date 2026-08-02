const {
  getTaskDetail,
  startLyrics,
  startMusic,
  startFetchLyricsTimestamps,
  startNotifyAndFinalize,
} = require('../../utils/api');
const { startPolling } = require('../../utils/task-polling');

const STAGE_LABELS = {
  pending: 'AI正在准备…',
  generating_dialogue: 'AI正在编绿茶剧本…',
  generating_screenshots: '正在渲染聊天气泡…',
  generating_lyrics: '正在改编歌词…',
  generating_music: 'AI正在创作专属背景音乐…',
  rendering_video: '正在合成MV…',
  completed: '大功告成！',
  failed: '出了点小问题…',
};

// 音乐生成依赖第三方接口，耗时较长，给出明确的等待预期，避免用户误以为卡住
const STAGE_HINTS = {
  pending: '',
  generating_dialogue: '',
  generating_screenshots: '',
  generating_lyrics: '',
  generating_music: '作曲通常需要 5～15 分钟，进度条会停留一会儿是正常现象～可以先去逛逛，完成后在"我的作品"里就能看到',
  rendering_video: '视频合成马上就好，请稍等',
  completed: '',
  failed: '',
};

// 单个阶段停留超过此时长（毫秒），提示用户可以先离开等待
const LONG_WAIT_MS = 90 * 1000;

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
    hint: '',
  },

  stageEnteredAt: 0,
  lastStatus: '',

  onLoad(query) {
    this.setData({ taskId: query.taskId });
    this.lyricsTriggered = false;
    this.musicTriggered = false;
    this.timestampsTriggered = false;
    this.notifyTriggered = false;
    this.subscribeNotify();
    this.refreshTask();
    this.ensurePolling();
  },

  onShow() {
    if (!this.data.taskId) return;
    this.refreshTask();
    this.ensurePolling();
  },

  onUnload() {
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
  },

  ensurePolling() {
    if (this.poller) return;
    this.poller = startPolling({
      fetcher: () => getTaskDetail(this.data.taskId),
      onUpdate: (task) => this.handleTaskUpdate(task),
      onError: (err) => console.error('poll error', err),
    });
  },

  async refreshTask() {
    try {
      const task = await getTaskDetail(this.data.taskId);
      this.handleTaskUpdate(task);
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        if (this.poller) {
          this.poller.stop();
          this.poller = null;
        }
      }
    } catch (err) {
      console.error('refresh task failed', err);
    }
  },

  handleTaskUpdate(task) {
    const now = Date.now();
    if (task.status !== this.lastStatus) {
      this.lastStatus = task.status;
      this.stageEnteredAt = now;
    }
    const staying = now - (this.stageEnteredAt || now);
    const hint = staying >= LONG_WAIT_MS ? (STAGE_HINTS[task.status] || '') : '';

    this.setData({
      status: task.status,
      progress: task.progress || 0,
      stageLabel: STAGE_LABELS[task.status] || '',
      failed: task.status === 'failed',
      errorMsg: task.errorMsg || '',
      hint,
    });

    // 任务已进入"生成歌词"阶段但歌词仍为空：由客户端直接触发（避免云函数间
    // 调用通道约3秒超时被平台强杀 generateLyrics，导致卡在此阶段不动）
    if (task.status === 'generating_lyrics' && !task.lyrics && !this.lyricsTriggered) {
      this.lyricsTriggered = true;
      startLyrics(this.data.taskId).catch((e) => {
        console.error('startLyrics failed', e);
        this.lyricsTriggered = false;
      });
    }

    // 歌词已生成、但音乐任务尚未提交给 Suno：由客户端直接触发（同样是为了避免
    // 云函数间调用通道约3秒超时被平台强杀 generateMusic，导致卡在此阶段不动）
    if (task.status === 'generating_music' && !task.musicProviderTaskId && !this.musicTriggered) {
      this.musicTriggered = true;
      startMusic(this.data.taskId).catch((e) => {
        console.error('startMusic failed', e);
        this.musicTriggered = false;
      });
    }

    // 音频已拿到，但逐词时间戳尚未抓取：由客户端直接触发 fetchLyricsTimestamps
    if (task.status === 'generating_music' && task.audioUrl && !this.timestampsTriggered) {
      this.timestampsTriggered = true;
      startFetchLyricsTimestamps(this.data.taskId).catch((e) => {
        console.error('startFetchLyricsTimestamps failed', e);
        this.timestampsTriggered = false;
      });
    }

    // 已进入渲染阶段但还没触发过渲染服务：由客户端直接触发 notifyAndFinalize
    if (task.status === 'rendering_video' && !this.notifyTriggered) {
      this.notifyTriggered = true;
      startNotifyAndFinalize(this.data.taskId).catch((e) => {
        console.error('startNotifyAndFinalize failed', e);
        this.notifyTriggered = false;
      });
    }

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
