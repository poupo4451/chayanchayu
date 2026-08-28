const {
  getTaskDetail,
  setTaskNotify,
  startLyrics,
  startMusic,
  startFetchLyricsTimestamps,
  startNotifyAndFinalize,
} = require('../../utils/api');
const { startPolling } = require('../../utils/task-polling');
const { startCreateFlow } = require('../../utils/create-entry');
const { MV_DONE_TMPL_ID, requestMvDoneSubscribe } = require('../../utils/notify');

/** hero 区的「人话」文案，与清单里的短名词刻意区分，避免同屏重复 */
const STAGE_LABELS = {
  pending: '正在准备你的创作任务',
  generating_dialogue: '正在琢磨这段对话怎么聊',
  generating_screenshots: '正在逐条排版聊天气泡',
  generating_lyrics: '正在把对话改写成能唱的歌词',
  generating_music: '正在创作专属背景音乐',
  rendering_video: '正在合成最终的 MV',
  completed: '你的作品已经准备好了',
  failed: '创作过程中断了',
};

/** 流程清单：note 只在该步为「进行中」时展示，避免一屏文字堆叠 */
const STEP_META = [
  { key: 'generating_dialogue', label: '编写对话剧本', note: '通常十几秒' },
  { key: 'generating_screenshots', label: '渲染聊天气泡', note: '正在逐条排版' },
  { key: 'generating_lyrics', label: '改编歌词', note: '对齐节奏与韵脚' },
  { key: 'generating_music', label: '创作背景音乐', note: '作曲通常需要 5～15 分钟，可以先离开，完成后会出现在「我的作品」' },
  { key: 'rendering_video', label: '合成 MV', note: '最后一步，马上就好' },
];

const FLOW = STEP_META.map((s) => s.key);

/**
 * 各阶段的展示进度区间。
 *
 * 刻意不与服务端 progress 同刻度：进入本页时「编写对话」已在上一页完成、
 * 「渲染气泡」也就一两秒，若沿用服务端绝对值（截图完成即写 45）会让进度条
 * 一开场就停在 45%，用户完全看不到起步过程。
 * 因此把这两步压到接近 0，把 0～99 几乎整段留给真正需要等待的歌词/作曲/合成。
 */
const STAGE_RANGE = {
  pending: [0, 2],
  generating_dialogue: [0, 3],
  generating_screenshots: [0, 5],
  generating_lyrics: [5, 22],
  generating_music: [22, 86],
  rendering_video: [86, 99],
  completed: [100, 100],
};

/**
 * 服务端在各阶段写出的 progress 里程碑 → 该阶段展示区间内的完成比例。
 *
 * 用查表而非线性折算，是因为服务端数值的间距和真实耗时严重不成比例：
 * 作曲阶段「已提交给 Suno」（60/65）只需几秒，却和「音频已就绪」（70）
 * 之间隔着 5～15 分钟，线性映射会让进度在开头几十秒内窜到一半再长期停滞。
 * 取「不大于当前值的最大里程碑」，因此服务端非单调写值也不会导致进度倒退。
 */
const SERVER_MILESTONES = {
  generating_screenshots: [[20, 0], [30, 0.3]],
  generating_lyrics: [[45, 0]],
  generating_music: [[55, 0], [60, 0.06], [65, 0.08], [70, 0.75]],
  rendering_video: [[75, 0], [80, 0.25]],
};

/** 把服务端 progress 折算到当前阶段的展示刻度 */
function toDisplayProgress(status, raw) {
  const [lo, hi] = STAGE_RANGE[status] || [0, 0];
  const milestones = SERVER_MILESTONES[status];
  if (!milestones) return lo;

  let ratio = 0;
  milestones.forEach(([at, r]) => {
    if (raw >= at && r > ratio) ratio = r;
  });
  return lo + ratio * (hi - lo);
}

const TICK_MS = 1000;
/**
 * 每秒向阶段上界指数逼近的系数：越小越「慢而不停」。
 * 时间常数 ≈ 1/0.004 = 250s，与作曲阶段 5～15 分钟的量级相称；
 * 若取更大值，进度会在头一两分钟就贴到上界，之后长时间纹丝不动。
 */
const CREEP_RATIO = 0.004;

/**
 * 进入本页多久后自动弹出订阅通知邀请。
 * 取 2 秒：足够用户看清进度条已经动起来、任务确实在跑，
 * 又不至于让他先干等太久才知道「其实可以不用等」。
 */
const NOTIFY_INVITE_DELAY_MS = 2000;

function buildSteps(flowStatus, failed) {
  const idx = flowStatus === 'completed'
    ? FLOW.length
    : Math.max(0, FLOW.indexOf(flowStatus));

  return STEP_META.map((meta, i) => {
    let state = 'todo';
    if (i < idx) state = 'done';
    else if (i === idx) state = failed ? 'fail' : 'active';
    return {
      key: meta.key,
      label: meta.label,
      note: state === 'active' ? meta.note : '',
      state,
    };
  });
}

Page({
  data: {
    taskId: '',
    status: 'pending',
    displayProgress: 0,
    stageLabel: STAGE_LABELS.pending,
    steps: buildSteps('pending', false),
    failed: false,
    isDone: false,
    errorMsg: '',
    /**
     * 完成通知开关状态：
     *   off    - 未开启，可点击开启
     *   on     - 已开启，任务终态时会收到微信服务通知
     *   banned - 用户已在设置里关闭该模板，点击无法唤起弹窗，只能引导去设置页
     */
    notifyState: 'off',
    // 订阅通知邀请弹层是否可见（进入本页 2 秒后自动弹出一次）
    notifyModal: false,
  },

  // 内部浮点进度，避免整数化后的爬升被反复抹平
  progressValue: 0,
  serverProgress: 0,
  lastFlowStatus: 'pending',

  onLoad(query) {
    this.setData({ taskId: query.taskId });
    this.lyricsTriggered = false;
    this.musicTriggered = false;
    this.timestampsTriggered = false;
    this.notifyTriggered = false;
    // 邀请弹层每次进入页面只自动弹一次，用户关掉后不再骚扰
    this.notifyInviteShown = false;
    this.refreshTask();
    this.ensurePolling();
    this.startTicker();
    // 排在 refreshTask 之后：2 秒内任务详情通常已返回，
    // 若该任务此前已开启过通知（notifyState=pending/sent），弹层会自动跳过
    this.scheduleNotifyInvite();
  },

  onShow() {
    if (!this.data.taskId) return;
    this.refreshTask();
    this.ensurePolling();
    this.startTicker();
  },

  onHide() {
    this.stopTicker();
    // 页面切走时撤销待弹出的邀请：否则用户已经离开，回来时会突然糊上来一个弹层
    this.clearNotifyInviteTimer();
  },

  onUnload() {
    this.stopTicker();
    this.clearNotifyInviteTimer();
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
  },

  /* ==================== 进度平滑 ==================== */

  startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tickProgress(), TICK_MS);
  },

  stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  },

  /**
   * 长阶段（尤其是 5～15 分钟的作曲）服务端进度长时间不变，
   * 这里在当前阶段区间内做指数逼近的伪进度，让用户始终看得到推进，
   * 且永远到不了上界，真实进度一到就立即接管。
   */
  tickProgress() {
    const { status, failed } = this.data;
    if (failed || status === 'completed') return;

    const [lo, hi] = STAGE_RANGE[status] || [0, 0];
    const ceil = Math.max(lo, hi - 1);
    let next = Math.max(this.progressValue, this.serverProgress, lo);
    if (next < ceil) next += (ceil - next) * CREEP_RATIO;

    this.commitProgress(Math.min(next, ceil));
  },

  commitProgress(value) {
    this.progressValue = Math.max(this.progressValue, value);
    const shown = Math.floor(this.progressValue);
    if (shown !== this.data.displayProgress) {
      this.setData({ displayProgress: shown });
    }
  },

  /* ==================== 轮询与状态 ==================== */

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
    const failed = task.status === 'failed';
    if (!failed) this.lastFlowStatus = task.status;
    // 失败时保留最后已知阶段，让用户知道「卡在哪一步」
    const flowStatus = failed ? this.lastFlowStatus : task.status;

    const mapped = toDisplayProgress(task.status, task.progress || 0);
    this.serverProgress = Math.max(this.serverProgress, mapped);
    this.commitProgress(this.serverProgress);

    this.setData({
      status: task.status,
      stageLabel: STAGE_LABELS[task.status] || '',
      steps: buildSteps(flowStatus, failed),
      failed,
      errorMsg: task.errorMsg || '',
    });

    if (failed) this.stopTicker();

    // 同步服务端订阅状态：pending/sending/sent 都意味着"已开启"。
    // 只做单向升级（off/banned → on），不把本地的 on 改回 off：
    // 用户在本页刚授权时是先乐观置 on 再异步入库，若轮询恰好插在中间会把开关闪回去。
    const serverNotifyOn = task.notifyState === 'pending'
      || task.notifyState === 'sending'
      || task.notifyState === 'sent';
    if (serverNotifyOn && this.data.notifyState !== 'on') {
      this.setData({ notifyState: 'on' });
    }

    // 任务已进入「生成歌词」阶段但歌词仍为空：由客户端直接触发（避免云函数间
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

    if (task.status === 'completed') this.finishAndLeave();
  },

  /** 补满 100% 并让完成态停留一瞬，避免进度条在 70% 时页面突然消失 */
  finishAndLeave() {
    if (this.leaving) return;
    this.leaving = true;
    this.stopTicker();
    if (this.poller) this.poller.stop();

    this.progressValue = 100;
    this.setData({
      displayProgress: 100,
      isDone: true,
      steps: buildSteps('completed', false),
    });

    // my-works 是 tabBar 页，只能用 switchTab（redirectTo 对 tab 页无效，
    // 这是原实现里"完成后跳不过去"的原因）；switchTab 不支持 query，
    // 需要高亮的任务 id 走 globalData 传递
    const app = getApp();
    if (app && app.globalData) app.globalData.highlightTaskId = this.data.taskId;

    setTimeout(() => {
      wx.switchTab({ url: '/pages/my-works/my-works' });
    }, 700);
  },

  /* ==================== 完成通知 ==================== */

  /**
   * 进入本页 NOTIFY_INVITE_DELAY_MS 后自动弹出订阅邀请。
   *
   * 为什么不在上一页「确认生成 MV」时弹：那是主流程的关键动作，
   * 中间插一层弹层会让用户以为操作被打断/失败。放到进度页则是「已经在等了」，
   * 此时问「要不要通知你」属于顺理成章的下一步。
   *
   * 延迟 2 秒而非立即：让用户先看到进度条动起来、确认任务真的在跑，
   * 再来问通知，否则弹层会盖住他此刻最想看的信息。
   */
  scheduleNotifyInvite() {
    this.clearNotifyInviteTimer();
    this.notifyInviteTimer = setTimeout(() => {
      this.notifyInviteTimer = null;
      // 期间任务已结束（缓存命中/极快完成）或已开启过通知，就没必要再问
      if (this.data.isDone || this.data.failed) return;
      if (this.data.notifyState === 'on') return;
      if (this.notifyInviteShown) return;
      this.notifyInviteShown = true;
      this.setData({ notifyModal: true });
    }, NOTIFY_INVITE_DELAY_MS);
  },

  clearNotifyInviteTimer() {
    if (this.notifyInviteTimer) {
      clearTimeout(this.notifyInviteTimer);
      this.notifyInviteTimer = null;
    }
  },

  /** 弹层内容区吞掉 tap，避免冒泡到遮罩触发关闭 */
  noop() {},

  /** 弹层上的「好，完成后通知我」 */
  onNotifyAccept() {
    // requestSubscribeMessage 必须紧贴用户 tap 同步发起；不要先做异步操作或等弹层动画结束
    this.requestNotify();
  },

  /** 弹层上的「不用，我自己来看」或点遮罩：关掉即可，卡片仍留在页面上可随时补开 */
  onNotifyDecline() {
    this.setData({ notifyModal: false });
  },

  /** 点击页面上的通知卡片：给拒绝过弹层、后来改主意的用户一个补开入口 */
  onToggleNotify() {
    if (this.data.notifyState === 'on') return;
    this.requestNotify();
  },

  /**
   * 发起订阅授权并把凭证写入任务。
   *
   * ⚠️ requestMvDoneSubscribe 必须在 tap 回调里同步发起（本函数由 onNotifyAccept /
   * onToggleNotify 直接调用，两者都是 tap 回调），不能先 await 云函数，
   * 否则用户手势失效、微信拒绝弹出授权框。
   *
   * 弹层本身是自动出现的，但用户点击「好，完成后通知我」是真实的 tap 手势，
   * 因此授权链路依然成立。
   */
  requestNotify() {
    requestMvDoneSubscribe().then(({ subscribed, banned, state, errMsg }) => {
      this.setData({ notifyModal: false });

      if (!subscribed) {
        console.warn('subscribe not accepted', { state, errMsg });

        if (banned || state === 'ban') {
          // 用户曾勾选「总是保持以上选择」并拒绝，本次不会弹窗。
          // 卡片文案会切换成手动开启路径，避免他反复点却毫无反应。
          this.setData({ notifyState: 'banned' });
          wx.showToast({
            title: '通知已被关闭，可在右上角「…」→ 设置 → 订阅消息中开启',
            icon: 'none',
            duration: 3200,
          });
          return;
        }

        const toastTitleMap = {
          reject: '你取消了通知授权',
          filter: '订阅模板被过滤，请检查模板配置',
          unsupported: '当前微信版本不支持订阅消息',
        };
        const title = toastTitleMap[state]
          || (/TAP gesture/i.test(errMsg || '') ? '请点击按钮后立即授权通知' : '')
          || errMsg
          || '未能唤起通知授权，请重试';
        wx.showToast({ title, icon: 'none', duration: 3200 });
        return;
      }

      // 先乐观置为已开启：授权本身已经成功，入库失败只影响下发、不该让开关跳回去误导用户
      this.setData({ notifyState: 'on' });
      setTaskNotify(this.data.taskId, MV_DONE_TMPL_ID).catch((e) => {
        console.error('setTaskNotify failed', e);
        this.setData({ notifyState: 'off' });
        wx.showToast({
          title: e.message || '通知开启失败，请重试',
          icon: 'none',
          duration: 3200,
        });
      });
    });
  },

  /** 此刻用户想「盯着它」，去我的作品比回首页更贴合意图（那里有进行中卡片） */
  onExit() {
    wx.switchTab({ url: '/pages/my-works/my-works' });
  },

  /**
   * 失败后重新创建。
   * 用 redirect：当前进度页已无返回价值，不该继续堆栈。
   * 走输入页还是审核旁路由 create-entry 统一决定。
   */
  onRecreate() {
    startCreateFlow({ redirect: true });
  },
});
