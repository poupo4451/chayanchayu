/**
 * stickerAssign.js
 * 职责：把 LLM 输出的 params.stickerId 翻译成 params.imageUrl，
 *       与 avatarAssign.js 形成的 avatarId 设计对齐。
 *
 * 之所以在云函数里做这个转换：
 * - LLM 只能输出稳定可枚举的 stickerId（避免编造 URL）；
 * - URL 含环境 ID 与云存储路径，不应让 LLM 参与；
 * - 资源在云存储里集中管理，以后替换贴图只动这份映射。
 *
 * 本表的 id 列表与 miniprogram/utils/stickers.js、cloudfunctions/generateDialogue/stickers.js 保持同步。
 */
const STICKER_IDS = [
  'laugh', 'dog', 'shock', 'skull', 'thumbsup',
  'smirk', 'confused', 'watching', 'weepy', 'tired', 'thanks', 'bossy',
];

const STICKER_URL_MAP = {
  laugh: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-01-laugh.png',
  dog: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-02-dog.png',
  shock: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-03-shock.png',
  skull: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-04-skull.png',
  thumbsup: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-05-thumbsup.png',
  smirk: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-06-smirk.png',
  confused: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-07-confused.png',
  watching: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-08-watching.png',
  weepy: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-09-weepy.png',
  tired: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-10-tired.png',
  thanks: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-11-thanks.png',
  bossy: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-12-bossy.png',
};

/**
 * @param {Array} dialogue 已经被 assignAvatars 处理过的对话数组
 * @returns {Array} 新数组，type==='image' 的元素在原字段基础上补充 params.imageUrl
 */
function assignStickerUrls(dialogue) {
  const list = dialogue || [];
  return list.map((line) => {
    if (!line || line.type !== 'image') return line;
    const params = line.params || {};
    if (params.imageUrl) return line; // 已经填过就不再覆盖
    const stickerId = params.stickerId;
    const url = stickerId ? STICKER_URL_MAP[stickerId] : '';
    return { ...line, params: { ...params, imageUrl: url || '' } };
  });
}

module.exports = { assignStickerUrls, STICKER_IDS };
