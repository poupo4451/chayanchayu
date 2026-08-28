/**
 * 创作入口统一收口
 * ============================================================================
 * 背景：通向「输入主题」的入口有三个——首页大卡片、我的作品空状态、
 * 进度页失败后的重新创建。审核期若只改首页，剩下两条旁路照样能进到
 * 自由输入页，开关等于漏的，所以三处共用本模块。
 *
 * 开关来源：数据库 app_config/runtime 文档的 auditMode 字段（见 getAppConfig 云函数）。
 *   auditMode = false → 原流程：跳 create 页，用户自己写主题
 *   auditMode = true  → 审核旁路：随机取一条预设直接建任务，跳对话预览
 */
const { getAppConfig, createTask } = require('./api');
const { showError } = require('./error-tip');

/** 开关关闭时的默认副标题，与 create 页的自由输入语境一致 */
const DEFAULT_CREATE_SUB = '输入一个主题，自动创作对话与配乐';

const DEFAULT_CONFIG = { auditMode: false, presets: [], createSubText: '' };

/**
 * 进程内缓存最近一次成功读到的配置。
 *
 * 为什么需要它：goCreate 必须能同步判断走哪条路，不能在用户点击后再等一次网络往返
 * （那会让按钮出现明显延迟）。配置由页面 onShow 提前拉好放这里，点击时直接读。
 */
let cachedConfig = DEFAULT_CONFIG;
/** 是否已成功拉过一次配置，决定 startCreateFlow 要不要现场补拉 */
let loaded = false;

/**
 * 拉取运行期配置并更新缓存。
 * 失败时不打扰用户：审核期最坏结果是偶发一次进到输入页，
 * 比因配置读取异常导致创作按钮不可用要好。
 */
async function loadConfig() {
  try {
    const cfg = await getAppConfig();
    if (cfg && typeof cfg.auditMode === 'boolean') {
      cachedConfig = {
        auditMode: cfg.auditMode,
        presets: Array.isArray(cfg.presets) ? cfg.presets : [],
        createSubText: cfg.createSubText || '',
      };
      loaded = true;
    }
  } catch (e) {
    console.error('getAppConfig failed, fall back to normal flow', e);
    cachedConfig = DEFAULT_CONFIG;
  }
  return cachedConfig;
}

/** 首页副标题：审核模式下换掉「输入一个主题」，避免文案与实际交互不符 */
function resolveCreateSub(cfg) {
  const c = cfg || cachedConfig;
  return c.auditMode && c.createSubText ? c.createSubText : DEFAULT_CREATE_SUB;
}

/**
 * 防连点标记。
 * 审核模式要先建任务再跳转，慢网下连点会创建多个任务（每个都占额度）。
 * 放模块级而非页面级，是因为三个入口共用同一条链路。
 */
let entering = false;

/**
 * 开始创作。
 * @param {object} [opts]
 * @param {boolean} [opts.redirect] 用 redirectTo 代替 navigateTo。
 *        进度页「重新创建」场景用 true：那一页已经没有返回价值，不该继续堆栈。
 */
async function startCreateFlow(opts = {}) {
  if (entering) return;
  entering = true;

  const jump = opts.redirect
    ? (o) => wx.redirectTo(o)
    : (o) => wx.navigateTo(o);

  const goCreatePage = () => {
    jump({
      url: '/pages/create/create',
      fail: (err) => {
        console.error('open create page failed', err);
        wx.showToast({ title: '打开创作页失败', icon: 'none' });
      },
    });
  };

  try {
    // 首页会在 onShow 预拉配置，点击时直接命中缓存、零延迟。
    // 但「我的作品」空态和进度页重试这两个入口不预拉，首次进入时缓存还是空的，
    // 此时必须现场补拉一次，否则审核模式在这两条路上会静默失效。
    const cfg = loaded ? cachedConfig : await loadConfig();

    // 开关关闭，或开着但没有可用预设（退回正常流程比让按钮点不动更好）
    if (!cfg.auditMode || !cfg.presets.length) {
      if (cfg.auditMode) console.error('auditMode on but presets empty');
      goCreatePage();
      return;
    }

    const preset = cfg.presets[Math.floor(Math.random() * cfg.presets.length)];
    wx.showLoading({ title: '准备中…', mask: true });
    const { taskId } = await createTask({
      topic: preset.topic,
      dialogueTone: preset.dialogueTone,
      musicGenre: preset.musicGenre,
    });
    wx.hideLoading();
    // 与原流程页面栈等价：create 页本就是 redirectTo 到预览页，
    // 所以这里直接跳预览后，栈深度和返回行为都不变。
    jump({ url: `/pages/dialogue-preview/dialogue-preview?taskId=${taskId}` });
  } catch (e) {
    wx.hideLoading();
    showError(e, '创建任务失败');
  } finally {
    entering = false;
  }
}

module.exports = {
  DEFAULT_CREATE_SUB,
  loadConfig,
  resolveCreateSub,
  startCreateFlow,
};
