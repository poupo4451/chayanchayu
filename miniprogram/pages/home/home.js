const { getDailyQuota } = require('../../utils/api');
const {
  DEFAULT_CREATE_SUB,
  loadConfig,
  resolveCreateSub,
  startCreateFlow,
} = require('../../utils/create-entry');

// 首页案例预览视频（仅用于首页展示，16:9 横版）。
// 与生成管线的 3:4 输出（CANVAS 720x960）无关，二者互不影响；更换案例只改这两行。
const DEMO_VIDEO_URL =
  'https://cloud1-d7ggdqfhgc4ee2796-1462201626.tcloudbaseapp.com/demo/demo-16x9.mp4';
const DEMO_POSTER_URL =
  'https://cloud1-d7ggdqfhgc4ee2796-1462201626.tcloudbaseapp.com/demo/demo-poster.jpg';

Page({
  data: {
    safeTop: 96,
    demoUrl: DEMO_VIDEO_URL,
    demoPoster: DEMO_POSTER_URL,
    muted: true,
    demoError: false,
    // 今日生成额度：加载完成前不渲染标记，避免先闪一个错误数字再纠正
    quotaLoaded: false,
    quotaLimit: 3,
    quotaRemain: 3,
    // 预计算「已用尽」，避免在 WXML 属性里写 <= 比较（易被解析器误判为标签）
    quotaExhausted: false,
    // 额度拉取失败时降级展示「3 次/天」，避免故障被静默隐藏
    quotaUnknown: false,
    // 白名单账号（不限次数），角标显示「不限次数」而非固定的 3/3，
    // 否则数字永远不变，无法分辨是白名单生效还是扣减出了问题
    quotaUnlimited: false,
    // 角标文案在 JS 里预计算，避免 WXML 里堆叠多层三元表达式
    quotaText: '',
    // 创作卡片副标题：审核模式下由 app_config 覆盖（见 utils/create-entry.js）
    createSub: DEFAULT_CREATE_SUB,
  },

  onLoad() {
    const app = getApp();
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || 20;
    // 本页 navigationStyle 为 custom，系统不预留顶部空间。
    // 标题需落在右上角胶囊按钮下方：状态栏高度 + 胶囊区(约 44px) + 呼吸间距 12px
    this.setData({ safeTop: statusBarHeight + 56 });
    this.videoCtx = wx.createVideoContext('demoVideo', this);
  },

  onShow() {
    // 自定义 tab-bar 每个 tab 页各有独立实例，必须由页面显式声明选中项，
    // 否则会出现「切回来仍高亮上一个 tab、需点两次」的问题
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setSelected(0);

    // 回到首页恢复「静音循环」的默认状态，避免离开时开着声音、返回后突然出声
    if (!this.data.muted) this.setData({ muted: true });
    this.videoCtx && this.videoCtx.play();

    // 每次回到首页都刷新额度：用户可能刚在别处消耗掉一次
    this.loadQuota();

    // 提前拉运行期开关，让 goCreate 能同步决定走哪条路（点击后再等网络会有明显延迟）。
    // 也因此，控制台改完 auditMode 后用户切走再切回首页即生效，无需重新发版。
    this.loadAppConfig();
  },

  /**
   * 读运行期开关（审核模式）。
   * 失败已在 create-entry 内部降级为「开关关闭」，这里只负责同步副标题文案。
   */
  async loadAppConfig() {
    const cfg = await loadConfig();
    const createSub = resolveCreateSub(cfg);
    if (createSub !== this.data.createSub) this.setData({ createSub });
  },

  /**
   * 拉取今日剩余生成次数。
   * 失败时不弹窗打扰用户（真正的闸门在 confirmDialogue 服务端，网络抖动不该阻断创作），
   * 但必须把标记降级显示为「今日次数：3 次/天」而不是让它凭空消失——
   * 否则一旦云函数未部署或调用异常，界面看起来就像功能没做，问题会被完全隐藏。
   */
  async loadQuota() {
    try {
      const q = await getDailyQuota();
      this.setData({
        quotaLoaded: true,
        quotaLimit: q.limit,
        quotaRemain: q.remain,
        quotaUnlimited: !!q.unlimited,
        quotaExhausted: !q.unlimited && q.remain <= 0,
        quotaText: q.unlimited ? '不限次数' : `今日次数 ${q.remain}/${q.limit}`,
      });
    } catch (e) {
      console.error('loadQuota failed', e);
      this.setData({
        quotaLoaded: true,
        quotaUnknown: true,
        quotaExhausted: false,
        quotaText: `今日次数 ${this.data.quotaLimit} 次/天`,
      });
    }
  },

  onHide() {
    this.videoCtx && this.videoCtx.pause();
  },

  onUnload() {
    this.videoCtx && this.videoCtx.pause();
  },

  /**
   * 点击视频卡片：仅切换静音 / 有声。
   * 视频是 16:9 横版，卡片内已完整展示（object-fit: cover 且素材同比例），
   * 无需全屏——此前用 requestFullScreen 会因隐藏了全部控件而无退出入口，
   * 且 direction:0 强制竖屏会把横版视频旋转放大。
   */
  onToggleMute() {
    if (this.data.demoError) return;
    this.setData({ muted: !this.data.muted });
    this.videoCtx && this.videoCtx.play();
  },

  // 加载失败后点击重试
  onRetryDemo() {
    this.setData({ demoError: false, muted: true });
  },

  onDemoError(e) {
    console.error('demo video error', e);
    this.setData({ demoError: true });
  },

  goCreate() {
    // 额度已用完就地拦住，别让用户白写一段主题、创作完对话才在确认时被拒
    if (this.data.quotaLoaded && this.data.quotaExhausted) {
      wx.showModal({
        title: '今日次数已用完',
        content: `每天可以创作 ${this.data.quotaLimit} 支歌词动画，明天 0 点恢复～`,
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    startCreateFlow();
  },

  onShareAppMessage() {
    return {
      title: '一句话创作你的歌词动画 - 言语生声',
      imageUrl: '/images/share-cover.jpg',
    };
  },
});
