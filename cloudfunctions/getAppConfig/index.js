/**
 * getAppConfig 云函数（Event Function）
 * 职责：只读返回运行期开关与创作预设，供小程序端决定创作入口走
 *      「用户输入主题」还是「直接用预设建任务进对话预览」。
 *
 * 为什么用数据库文档而不是云函数环境变量：
 * 审核期间需要能在控制台改一个字段就切换、并立刻对已发布版本生效；
 * 环境变量的修改必须重新部署函数，回滚同样慢。
 *
 * 开关位置：数据库 → app_config 集合 → _id 为 'runtime' 的文档 → auditMode 字段。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COL = 'app_config';
const DOC_ID = 'runtime';

/**
 * 兜底预设。
 * 配置文档存在但 presets 缺失/为空时仍要能跑通审核模式——
 * 否则「开关开了却拿不到内容」会让创作入口直接点不动。
 */
const FALLBACK_PRESETS = [
  { topic: '绿茶跟前任借钱', dialogueTone: '搞笑', musicGenre: 'R&B' },
  { topic: '前任结婚了来请我', dialogueTone: '搞笑', musicGenre: 'R&B' },
  { topic: '闺蜜怀疑我抢她男朋友', dialogueTone: '搞笑', musicGenre: '流行' },
];

exports.main = async () => {
  try {
    const res = await db.collection(COL).doc(DOC_ID).get();
    const cfg = (res && res.data) || {};
    return {
      success: true,
      data: {
        auditMode: !!cfg.auditMode,
        presets:
          Array.isArray(cfg.presets) && cfg.presets.length ? cfg.presets : FALLBACK_PRESETS,
        // 审核模式下首页副标题也要换，否则「输入一个主题」与实际交互不符
        createSubText: cfg.createSubText || '',
      },
    };
  } catch (e) {
    // 集合/文档不存在或读取异常，一律按「开关关闭」返回，且刻意用 success: true：
    // 这是可预期的缺省状态而非故障，不该让客户端弹错误提示。
    // 默认值必须是正常业务流程，否则配置被误删会让线上静默退化成只能随机创作。
    console.warn('getAppConfig fallback to default', (e && e.message) || e);
    return {
      success: true,
      data: { auditMode: false, presets: FALLBACK_PRESETS, createSubText: '' },
    };
  }
};
