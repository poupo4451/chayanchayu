/**
 * 统一错误展示工具
 * ----------------------------------------------------------------------------
 * 业务背景：很多页面之前用 `wx.showToast({ title: e.message.slice(0, 20) })` 截断错误，
 *          导致 `cloud.callFunction:fail -404011 ...` 这种关键错误码被截到
 *          `cloud.callFunction:f` 就没了，用户完全不知道为什么失败。
 *
 * 解决策略：
 *   1. 优先去掉 `cloud.callFunction:fail` 前缀，得到核心错误码（如 `-404011 cloud function execution error`）。
 *   2. 短错误直接用 toast 显示完整内容（不截断）。
 *   3. 长错误：toast 显示前 24 字符的摘要 + 紧接着弹一个 modal，让用户能看到完整内容。
 *   4. 任何情况都打 console.error，方便开发者调试。
 *
 * 第三方云函数调用失败的标准错误码含义：
 *   -404011  cloud function execution error  云函数内未捕获异常
 *   -501000  resource not found               云函数或环境不存在（常因 IDE 缓存）
 *   -501003  request timeout                  超时
 *   -401001  unauthorized                     权限不足
 *   -402001  service quota exceeded            配额超限
 */

function explain(err) {
  if (!err) return { raw: '未知错误', short: '未知错误', long: '未知错误' };
  const raw = String(err.message || err.errMsg || err);
  // 去掉 `cloud.callFunction:fail ` / `Error: ` 这类系统前缀
  const stripped = raw
    .replace(/^cloud\.callFunction:fail\s*[-:]?\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  return {
    raw,
    short: stripped.slice(0, 24),
    long: stripped,
  };
}

function showError(err, fallback = '操作失败') {
  const { raw, short, long } = explain(err) || {};
  const safeLong = long || fallback;
  const safeShort = short || fallback;

  console.error('[cloudFunction/full]', raw || fallback);

  if (safeLong.length <= 24) {
    wx.showToast({ title: safeShort, icon: 'none', duration: 3000 });
    return;
  }

  // 长错误：toast 摘要 + modal 完整
  wx.showToast({ title: safeShort + '…', icon: 'none', duration: 2500 });
  setTimeout(() => {
    wx.showModal({
      title: '调用失败',
      content: safeLong,
      showCancel: false,
      confirmText: '知道了',
    });
  }, 50);
}

module.exports = { showError, explain };
