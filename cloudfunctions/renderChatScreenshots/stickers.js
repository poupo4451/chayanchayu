/**
 * 固定表情包列表（MVP 阶段，占位素材）
 * 与 miniprogram/utils/stickers.js、cloudfunctions/generateDialogue/stickers.js 保持同步
 * 本文件用于把 dialogue 中的 stickerId 解析为实际的云存储 fileID
 */
const STICKER_MAP = {
  laugh: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-01-laugh.png',
  dog: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-02-dog.png',
  shock: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-03-shock.png',
  skull: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-04-skull.png',
  thumbsup: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-05-thumbsup.png',
};

function getStickerUrl(stickerId) {
  return STICKER_MAP[stickerId] || '';
}

module.exports = { STICKER_MAP, getStickerUrl };
