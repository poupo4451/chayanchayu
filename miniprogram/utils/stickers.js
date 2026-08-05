/**
 * 固定表情包列表（MVP 阶段，占位素材）
 * 与 cloudfunctions/generateDialogue/stickers.js、cloudfunctions/renderChatScreenshots/stickers.js 保持同步
 * 后续接入真实表情图片库时，只需替换这份列表的 url，无需改动上层逻辑
 */
const STICKERS = [
  {
    id: 'laugh',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-01-laugh.png',
    label: '大笑',
  },
  {
    id: 'dog',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-02-dog.png',
    label: '狗头',
  },
  {
    id: 'shock',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-03-shock.png',
    label: '惊恐',
  },
  {
    id: 'skull',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-04-skull.png',
    label: '裂开',
  },
  {
    id: 'thumbsup',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-05-thumbsup.png',
    label: '点赞',
  },
  {
    id: 'smirk',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-06-smirk.png',
    label: '呵呵',
  },
  {
    id: 'confused',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-07-confused.png',
    label: '黑人问号',
  },
  {
    id: 'watching',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-08-watching.png',
    label: '看你能说什么',
  },
  {
    id: 'weepy',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-09-weepy.png',
    label: '委屈',
  },
  {
    id: 'tired',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-10-tired.png',
    label: '我好累',
  },
  {
    id: 'thanks',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-11-thanks.png',
    label: '我谢谢你',
  },
  {
    id: 'bossy',
    url: 'cloud://cloud1-d7ggdqfhgc4ee2796.636c-cloud1-d7ggdqfhgc4ee2796-1462201626/stickers/sticker-12-bossy.png',
    label: '装货',
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
