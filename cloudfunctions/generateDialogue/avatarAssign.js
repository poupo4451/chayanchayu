/**
 * avatarAssign.js
 * 职责：为对话里的每个说话人分配一个稳定的默认头像标识（如 "male-2"）。
 *
 * 规则：
 * 1. 先按昵称关键词猜测性别；
 * 2. 若两个说话人都能猜出且性别不同，直接采用猜测结果；
 * 3. 猜不出、或两人猜出同一性别，则按说话人在对话中首次出现的顺序，
 *    强制分配为一男一女，保证两人不会撞头像风格；
 * 4. 同一性别下，用昵称哈希稳定选出 1~4 号头像，确保同一昵称从头到尾用同一张，
 *    不同昵称尽量不撞同一张。
 *
 * 产出的 avatarId 只是一个标识（不是 URL），小程序端会拼成
 * `/images/avatars/${avatarId}.png` 本地路径使用；
 * Remotion 渲染端会去 `public/avatars/${avatarId}.png` 找同名素材使用。
 * 两边各自放一份同名头像图片即可，互不依赖网络传输。
 */

const MALE_HINTS = ['哥', '弟', '先生', '帅', '爷', '郎', '小伙', '男友', '老公', '汉', '强', '伟', '军', '刚', '磊', '鹏', '超', '涌', '虎', '龙'];
const FEMALE_HINTS = ['姐', '妹', '小姐', '美女', '女友', '老婆', '宝贝', '公主', '甜心', '仙女', '丫头', '娜', '丽', '婷', '雪', '梅', '芳', '琳', '萌', '花', '媚'];

const AVATAR_COUNT = 4;

function guessGender(name) {
  if (!name) return null;
  if (MALE_HINTS.some((h) => name.includes(h))) return 'male';
  if (FEMALE_HINTS.some((h) => name.includes(h))) return 'female';
  return null;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * @param {Array} dialogue 原始对话数组，元素含 name/role 等字段
 * @returns {Array} 新数组，每个元素在原字段基础上补充 avatarId（说话人为空则不补充）
 */
function assignAvatars(dialogue) {
  const list = dialogue || [];
  const speakerOrder = [];
  const genderGuess = new Map();

  list.forEach((line) => {
    const name = (line.name || '').trim();
    if (!name || genderGuess.has(name)) return;
    speakerOrder.push(name);
    genderGuess.set(name, guessGender(name));
  });

  const finalGender = new Map();
  let toggle = 0;
  speakerOrder.forEach((name) => {
    let gender = genderGuess.get(name);
    if (!gender) {
      gender = toggle % 2 === 0 ? 'male' : 'female';
      toggle += 1;
    }
    finalGender.set(name, gender);
  });

  // 若前两位说话人被猜成同一性别，强制把第二位换到另一性别，避免头像风格单一
  if (speakerOrder.length >= 2) {
    const g0 = finalGender.get(speakerOrder[0]);
    const g1 = finalGender.get(speakerOrder[1]);
    if (g0 === g1) {
      finalGender.set(speakerOrder[1], g0 === 'male' ? 'female' : 'male');
    }
  }

  const avatarIdByName = new Map();
  speakerOrder.forEach((name) => {
    const gender = finalGender.get(name) || 'male';
    const slot = (hashCode(name) % AVATAR_COUNT) + 1;
    avatarIdByName.set(name, `${gender}-${slot}`);
  });

  return list.map((line) => {
    const name = (line.name || '').trim();
    if (!name || !avatarIdByName.has(name)) return line;
    return { ...line, avatarId: avatarIdByName.get(name) };
  });
}

module.exports = { assignAvatars, guessGender };
