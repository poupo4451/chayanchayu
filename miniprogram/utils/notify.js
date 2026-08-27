/**
 * 订阅消息（一次性）统一入口
 * ============================================================================
 * 业务背景：一支 MV 从「确认对话」到出片要经过 Suno 作曲（5~15 分钟）+ 云托管
 * Remotion 渲染，用户不可能一直盯着进度页。服务端流程本身已不依赖前端存活
 * （pollMusicStatus 定时器会自主把任务推到底），所以只要在完成时给用户发一条
 * 微信服务通知，就能让「先退出去干别的、收到通知再回来看片」成立。
 *
 * 为什么只做一次性订阅：
 * 长期订阅（永久授权、可无限次下发）仅对政务/医疗等特定行业开放，本小程序不符合
 * 资质。一次性订阅 = 用户点一次授权、服务端换来一次下发额度，因此：
 *   - 「完成」和「失败」必须共用同一条模板，只发一条（详见 sendTaskNotify）
 *   - 每次新建任务都要重新邀请一次授权，不能缓存"这个用户已经授权过了"
 */

/**
 * MV 生成完成提醒模板 ID。
 * 模板字段：任务描述（项目名）+ 状态（已完成 / 生成失败）。
 *
 * 这个常量在前端只出现一次：授权成功后随任务一起上报入库（task.notifyTemplateId），
 * 服务端发送时读库里的值而不是自己再硬编码一份，避免两端各写一处、改了一边忘另一边。
 */
const MV_DONE_TMPL_ID = 'dlEWnEzXRnGb803dxPmtJAYa83uueDqfKzDDiLq3Kvc';

/**
 * 请求「MV 生成完成」订阅授权。
 *
 * ⚠️ 调用时机的硬约束：必须在 tap 事件回调里**同步**调用。
 * 微信要求本 API 由用户点击手势直接触发，若先 `await` 一个云函数、或放在
 * `wx.showModal` 的 success 回调里再调用，手势上下文已丢失，会直接 fail：
 *   errMsg: "requestSubscribeMessage:fail can only be invoked by user TAP gesture"
 * 这也是本项目用自定义弹层（bindtap）而非 wx.showModal 做订阅邀请的原因。
 * 注意「弹层自动出现」不影响这条约束——邀请弹层由定时器弹出，但用户点击弹层上的
 * 按钮仍是真实 tap，授权链路成立。
 *
 * @returns {Promise<{ subscribed: boolean, banned: boolean, state: string, errMsg: string }>}
 *   subscribed - 用户是否同意接收
 *   banned     - 用户是否已勾选「总是保持以上选择」并拒绝（此后不再弹窗，
 *                只能引导去右上角「…」→ 设置 → 订阅消息 里手动开启）
 *   state      - 微信对当前模板的返回状态：accept / reject / ban / filter / fail / unsupported
 *   errMsg     - 微信原始错误信息，便于排查模板 ID、手势上下文、基础库等问题
 */
function requestMvDoneSubscribe() {
  return new Promise((resolve) => {
    if (!wx.requestSubscribeMessage) {
      // 基础库过低，静默降级：不阻断生成流程
      resolve({
        subscribed: false,
        banned: false,
        state: 'unsupported',
        errMsg: '当前微信版本不支持订阅消息',
      });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: [MV_DONE_TMPL_ID],
      success: (res) => {
        console.log('requestSubscribeMessage success', res);
        const state = (res && res[MV_DONE_TMPL_ID]) || 'unknown';
        // state 取值：accept / reject / ban / filter
        // ban = 后台已封禁该模板；filter = 模板被过滤（如内容不符规范）
        resolve({
          subscribed: state === 'accept',
          banned: state === 'ban',
          state,
          errMsg: (res && res.errMsg) || '',
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        // 用户曾勾选「总是保持以上选择」并选择拒绝时，本次不会弹窗、直接 fail，
        // 这属于正常业务分支而非异常，只记 warn 不打扰用户
        console.warn('requestSubscribeMessage failed', err || msg);
        resolve({
          subscribed: false,
          // 10004/10005 及带 "TAP gesture" 的错误都不是"被永久拒绝"，
          // 只有明确的 ban 才引导去设置页，避免误导用户
          banned: /ban/i.test(msg),
          state: 'fail',
          errMsg: msg,
        });
      },
    });
  });
}

module.exports = {
  MV_DONE_TMPL_ID,
  requestMvDoneSubscribe,
};
