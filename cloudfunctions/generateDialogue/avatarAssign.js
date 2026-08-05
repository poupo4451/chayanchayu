/**
 * avatarAssign.js
 * 职责：为对话里的每个说话人分配一个稳定的默认头像标识（如 "male-2"）。
 *
 * 规则：
 * 1. 先按昵称关键词猜测性别；
 * 2. 若两个说话人都能猜出且性别不同，直接采用猜测结果；
 * 3. 猜不出、或两人猜出同一性别，则按说话人在对话中首次出现的顺序，
 *    强制分配为一男一女，保证两人不会撞头像风格；
 * 4. 结合该说话人的对话内容匹配同性别的视觉角色；若没有明显特征，
 *    用昵称哈希稳定挑选默认角色，确保同一昵称从头到尾使用同一张头像。
 *
 * 产出的 avatarId 是角色化标识（不是 URL）。小程序端会拼成
 * `/images/avatars/${avatarId}.png`，Remotion 渲染端会读取
 * `public/avatars/${avatarId}.png`。两端必须保留同名素材。
 */

const MALE_HINTS = ['哥', '弟', '先生', '帅', '爷', '郎', '小伙', '男友', '老公', '汉', '强', '伟', '军', '刚', '磊', '鹏', '超', '涌', '虎', '龙'];
const FEMALE_HINTS = ['姐', '妹', '小姐', '美女', '女友', '老婆', '宝贝', '公主', '甜心', '仙女', '丫头', '娜', '丽', '婷', '雪', '梅', '芳', '琳', '萌', '花', '媚'];

const AVATAR_PROFILES = {
  male: [
    { id: 'male-rich-heir', hints: ['富二代', '继承', '别墅', '豪车', '跑车', '法拉利', '保时捷', '宾利', '迈巴赫', '投资', '家里安排', '司机'] },
    { id: 'male-playboy', hints: ['渣男', '宝贝', '亲爱的', '暧昧', '撩', '约会', '前任', '分手', '想你', '见面'] },
    { id: 'male-underdog', hints: ['屌丝', '打工', '工资', '穷', '租房', '加班', '省钱', '单身', '没钱'] },
    { id: 'male-ordinary', hints: [] },
  ],
  female: [
    { id: 'female-green-tea-1', hints: ['绿茶', '哥哥', '人家', '好哥哥', '不是故意', '姐姐不会', '你女朋友', '送我', '礼物', '嘤'] },
    { id: 'female-playgirl', hints: ['渣女', '宝贝', '亲爱的', '暧昧', '撩', '约会', '前任', '分手', '想你', '见面'] },
    { id: 'female-green-tea-2', hints: ['茶', '撒娇', '可怜', '帮帮我', '陪我', '好嘛'] },
    { id: 'female-underdog', hints: ['屌丝女', '打工', '工资', '穷', '租房', '加班', '省钱', '单身', '没钱'] },
  ],
};

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
  return hash >>> 0;
}

function selectAvatarId(gender, name, messages) {
  const profiles = AVATAR_PROFILES[gender] || AVATAR_PROFILES.male;
  const context = [name, ...messages].join(' ');
  const scored = profiles.map((profile) => ({
    profile,
    score: profile.hints.reduce((total, hint) => total + (context.includes(hint) ? 1 : 0), 0),
  }));
  const highestScore = Math.max(...scored.map((entry) => entry.score));
  const candidates = highestScore > 0
    ? scored.filter((entry) => entry.score === highestScore).map((entry) => entry.profile)
    : profiles;
  return candidates[hashCode(name) % candidates.length].id;
}

/**
 * @param {Array} dialogue 原始对话数组，元素含 name/role 等字段
 * @returns {Array} 新数组，每个元素在原字段基础上补充 avatarId（说话人为空则不补充）
 */
function assignAvatars(dialogue) {
  const list = dialogue || [];
  const speakerOrder = [];
  const genderGuess = new Map();
  const speakerMessages = new Map();

  list.forEach((line) => {
    const name = (line.name || '').trim();
    if (!name) return;
    const message = typeof line.text === 'string'
      ? line.text
      : typeof line.content === 'string'
        ? line.content
        : '';
    const messages = speakerMessages.get(name) || [];
    messages.push(message);
    speakerMessages.set(name, messages);
    if (genderGuess.has(name)) return;
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
    avatarIdByName.set(name, selectAvatarId(gender, name, speakerMessages.get(name) || []));
  });

  return list.map((line) => {
    const name = (line.name || '').trim();
    if (!name || !avatarIdByName.has(name)) return line;
    return { ...line, avatarId: avatarIdByName.get(name) };
  });
}

module.exports = { assignAvatars, guessGender };
