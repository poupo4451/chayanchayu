/**
 * 固定表情包列表（MVP 阶段，占位素材）
 * 与 miniprogram/utils/stickers.js、cloudfunctions/generateDialogue/stickers.js 保持同步
 * 本文件用于把 dialogue 中的 stickerId 解析为实际的云存储 fileID
 */
const STICKER_MAP = {
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

function getStickerUrl(stickerId) {
  return STICKER_MAP[stickerId] || '';
}

module.exports = { STICKER_MAP, getStickerUrl };
