/**
 * 固定表情包列表（MVP 阶段，占位素材）
 * 与 cloudfunctions/generateDialogue/stickers.js、cloudfunctions/renderChatScreenshots/stickers.js 保持同步
 * 后续接入真实表情图片库时，只需替换这份列表的 url，无需改动上层逻辑
 */
const STICKERS = [
  {
    id: 'laugh',
    url: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-01-laugh.png',
    label: '大笑',
  },
  {
    id: 'dog',
    url: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-02-dog.png',
    label: '狗头',
  },
  {
    id: 'shock',
    url: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-03-shock.png',
    label: '惊恐',
  },
  {
    id: 'skull',
    url: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-04-skull.png',
    label: '裂开',
  },
  {
    id: 'thumbsup',
    url: 'cloud://chayanchayu-d4g0fpnxq738c7662.6368-chayanchayu-d4g0fpnxq738c7662-1459907343/stickers/sticker-05-thumbsup.png',
    label: '点赞',
  },
];

const STICKER_MAP = STICKERS.reduce((map, item) => {
  map[item.id] = item.url;
  return map;
}, {});

function getStickerUrl(stickerId) {
  return STICKER_MAP[stickerId] || '';
}

module.exports = {
  STICKERS,
  STICKER_MAP,
  getStickerUrl,
};
