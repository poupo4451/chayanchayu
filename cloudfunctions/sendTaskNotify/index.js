/**
 * sendTaskNotify 云函数（Event Function）
 * 职责：任务进入终态（completed / failed）后，通过订阅消息通知用户回来看片。
 *
 * ============================================================================
 * 为什么由本函数（云函数）发送，而不是云托管 Remotion 渲染完直接发：
 *   1. `cloud.openapi.subscribeMessage.send` 是「云调用」，只有 wx-server-sdk
 *      环境具备，云托管用的是 @cloudbase/node-sdk，拿不到这个能力——要发就得
 *      自己管 access_token，多一套凭证与刷新逻辑。
 *   2. 失败路径（Suno 敏感词、渲染异常等）并不经过云托管，只有本函数能统一覆盖，
 *      否则用户遇到失败就永远等不到任何消息。
 *   3. 完全不用改动 cloud-run-remotion，改动面最小。
 * 触发方式：pollMusicStatus 定时器扫描 notifyState=pending 的终态任务后派发。
 *
 * ⚠️ 一次性订阅的核心约束：用户授权一次 = 服务端只能下发一条。
 * 因此本函数必须严格幂等——只处理 notifyState === 'pending'，发完立刻置终态。
 * 「完成」与「失败」共用同一条模板，靠「状态」字段区分文案。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/**
 * 订阅消息的落地小程序版本。
 * ⚠️ 必须与当前调试环境一致，否则消息发出去了但你收不到：
 *   developer - 开发版（微信开发者工具）
 *   trial     - 体验版
 *   formal    - 正式版（线上默认）
 * 通过环境变量配置，方便开发期临时切换而不改代码。
 */
const MP_STATE = process.env.SUBSCRIBE_MP_STATE || 'formal';

/**
 * 后台模板字段 key。
 * 模板「任务描述 + 状态」对应 thing / phrase 两个类型。
 * ⚠️ 编号取决于字段在模板中的排列位置，若下发返回 47003 argument invalid，
 * 用 subscribeMessage.getTemplateList 查真实占位符后只需改这两个常量。
 * 模板 ID 本身不在这里硬编码——它随任务入库（task.notifyTemplateId），
 * 与小程序端 utils/notify.js 保持单一来源。
 */
const FIELD_DESC = 'thing1'; // 任务描述
const FIELD_STATE = 'phrase2'; // 状态

/**
 * 不可重试的下发错误码：继续重试只会一直失败，且每次都在浪费调用。
 *   43101 用户拒绝接收 / 已撤回订阅（额度已不存在）
 *   47003 模板参数不合法（字段名或值不符合模板要求）
 *   40003 openid 非法
 */
const FATAL_ERR_CODES = new Set(['43101', '47003', '40003']);

/** 超过此次数仍失败则放弃，避免定时器无限重试占用资源 */
const MAX_NOTIFY_ATTEMPTS = 3;

/**
 * thing 类型限 20 个字符，超长会被判 47003 —— 而**订阅额度照样被消耗**，
 * 用户白授权一次却收不到任何消息。因此必须在本地截断，不能指望接口容错。
 */
function clampThing(text, fallback) {
  const s = String(text == null ? '' : text).trim() || fallback;
  return s.length > 20 ? `${s.slice(0, 19)}…` : s;
}

function extractErrCode(e) {
  if (!e) return '';
  if (e.errCode != null) return String(e.errCode);
  // 云调用异常有时只在 message 里带码，如 "errcode: 43101, errmsg: ..."
  const m = /errcode[":\s]*(\d+)/i.exec(e.message || '');
  return m ? m[1] : '';
}

exports.main = async (event = {}) => {
  const { taskId, inspectTemplates } = event;

  // ── 调试分支：核对模板真实字段名 ──
  // 在云开发控制台/开发者工具里以 { "inspectTemplates": true } 调用本函数，
  // 返回账号下所有模板及其 content 占位符（形如「任务描述：{{thing1.DATA}}」）。
  // 若与上方 FIELD_DESC / FIELD_STATE 不一致，改那两个常量即可，无需改别处。
  if (inspectTemplates) {
    try {
      const res = await cloud.openapi.subscribeMessage.getTemplateList();
      const list = (res && res.data) || [];
      return {
        success: true,
        data: {
          expected: { desc: FIELD_DESC, state: FIELD_STATE },
          templates: list.map((t) => ({
            priTmplId: t.priTmplId,
            title: t.title,
            content: t.content,
          })),
        },
      };
    } catch (e) {
      console.error('getTemplateList failed', e);
      return { success: false, message: e.message || '查询模板列表失败' };
    }
  }

  if (!taskId) {
    return { success: false, message: '缺少 taskId 参数' };
  }

  const tasksCol = db.collection('tasks');

  let task;
  try {
    const res = await tasksCol.doc(taskId).get();
    task = res.data;
  } catch (e) {
    console.error('sendTaskNotify: 读取任务失败', taskId, e.message);
    return { success: false, message: e.message || '读取任务失败' };
  }

  if (!task) {
    return { success: false, message: '任务不存在' };
  }

  // ── 幂等闸门 ──
  // 一次性订阅只有一次下发额度，非 pending 一律跳过：
  // 定时器可能在同一任务上重复扫到（上一轮写入尚未可见、或并发触发）。
  if (task.notifyState !== 'pending') {
    return { success: true, data: { taskId, skipped: true, reason: `state=${task.notifyState || 'none'}` } };
  }

  if (!task.notifyTemplateId || !task.userId) {
    await tasksCol.doc(taskId).update({
      data: { notifyState: 'none', updatedAt: Date.now() },
    });
    return { success: true, data: { taskId, skipped: true, reason: 'missing_template_or_user' } };
  }

  const isDone = task.status === 'completed';
  const isFailed = task.status === 'failed';
  // 只在终态下发：中间态被误派发时保持 pending，等真正结束再发
  if (!isDone && !isFailed) {
    return { success: true, data: { taskId, skipped: true, reason: 'not_final_status' } };
  }

  // ⚠️ 先占位再发送：把状态提前推离 pending，
  // 防止定时器在本次云调用（可能耗时数秒）期间再次扫到这条任务而重复下发。
  try {
    await tasksCol.doc(taskId).update({
      data: { notifyState: 'sending', updatedAt: Date.now() },
    });
  } catch (e) {
    console.error('sendTaskNotify: 占位失败', taskId, e.message);
    return { success: false, message: '占位失败，稍后重试' };
  }

  const data = {
    // 任务描述 → 用户创建时输入的主题，即"对应当前项目名"
    [FIELD_DESC]: { value: clampThing(task.topic, '你的作品') },
    // phrase 类型限 5 个汉字："已完成"(3) / "创作失败"(4) 均合规
    [FIELD_STATE]: { value: isDone ? '已完成' : '创作失败' },
  };

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: task.userId,
      templateId: task.notifyTemplateId,
      // 完成 → 直接进播放页（detail 支持仅凭 taskId 进入）；
      // 失败 → 进度页，那里能看到失败原因并直接「重新创建」
      page: isDone
        ? `pages/my-works/detail?taskId=${taskId}`
        : `pages/task-progress/task-progress?taskId=${taskId}`,
      miniprogramState: MP_STATE,
      lang: 'zh_CN',
      data,
    });

    await tasksCol.doc(taskId).update({
      data: {
        notifyState: 'sent',
        notifiedAt: Date.now(),
        notifyError: '',
        updatedAt: Date.now(),
      },
    });

    return { success: true, data: { taskId, status: task.status } };
  } catch (e) {
    const code = extractErrCode(e);
    const attempts = Number(task.notifyFailCount || 0) + 1;
    // 致命错误或已达上限 → 置 failed 终止；否则回到 pending 等定时器下一轮重试
    const giveUp = FATAL_ERR_CODES.has(code) || attempts >= MAX_NOTIFY_ATTEMPTS;

    console.error(
      `sendTaskNotify: 下发失败 task=${taskId} code=${code} attempts=${attempts} giveUp=${giveUp}`,
      e.message
    );

    await tasksCol.doc(taskId).update({
      data: {
        notifyState: giveUp ? 'failed' : 'pending',
        notifyFailCount: attempts,
        notifyError: `${code} ${e.errMsg || e.message || ''}`.trim().slice(0, 200),
        updatedAt: Date.now(),
      },
    });

    return { success: false, message: e.message || '下发订阅消息失败', data: { code, attempts } };
  }
};
