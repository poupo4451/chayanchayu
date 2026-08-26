/**
 * avatarAssign.js
 * 职责：为对话里的每个说话人分配一个稳定的头像标识（如 "male-rich-heir"）。
 *
 * 规则：
 * 1. 先按昵称关键词猜测性别；
 * 2. 若所有说话人都猜出且性别不同，直接采用猜测结果；
 * 3. 猜不出、或多人猜出同一性别，则按首次出现顺序强制交替分配男女，
 *    保证相邻说话人不会撞性别；
 * 4. 结合对话整体场景（内容关键词）匹配同性别的视觉角色；
 *    若没有明显特征，回退到该性别的默认角色，不再用哈希随机挑选。
 *
 * 产出的 avatarId 是角色化标识（不是 URL）。小程序端会拼成
 * `/images/avatars/${avatarId}.png`，Remotion 渲染端会读取
 * `public/avatars/${avatarId}.png`。两端必须保留同名素材。
 */

const MALE_HINTS = ['哥', '弟', '先生', '帅', '爷', '郎', '小伙', '男友', '老公', '汉', '强', '伟', '军', '刚', '磊', '鹏', '超', '涌', '虎', '龙'];
const FEMALE_HINTS = ['姐', '妹', '小姐', '美女', '女友', '老婆', '宝贝', '公主', '甜心', '仙女', '丫头', '娜', '丽', '婷', '雪', '梅', '芳', '琳', '萌', '花', '媚'];

// 每个性别的角色池，hints 区分度要高，避免男女角色因共用关键词而随机切换
const AVATAR_PROFILES = {
  male: [
    { id: 'male-rich-heir', hints: ['富二代', '继承', '别墅', '豪车', '跑车', '法拉利', '保时捷', '宾利', '迈巴赫', '投资', '家里安排', '司机', '公司', '股份'] },
    { id: 'male-playboy', hints: ['渣男', '撩妹', '海王', '套路', '暧昧', '养鱼', '劈腿', '多线'] },
    { id: 'male-underdog', hints: ['屌丝', '打工', '工资', '穷', '租房', '加班', '省钱', '单身', '没钱', '搬砖', '996'] },
    { id: 'male-ordinary', hints: [] },
  ],
  female: [
    { id: 'female-green-tea-1', hints: ['绿茶', '哥哥', '人家', '好哥哥', '不是故意', '姐姐不会生气吧', '你女朋友', '送我', '礼物', '嘤', '好嘛'] },
    { id: 'female-playgirl', hints: ['渣女', '海后', '养鱼', '撩汉', '约会', '前任', '分手', '备胎', '多线'] },
    { id: 'female-green-tea-2', hints: ['茶', '撒娇', '可怜', '帮帮我', '陪我', '好怕', '不会吧'] },
    { id: 'female-underdog', hints: ['屌丝女', '打工', '工资', '穷', '租房', '加班', '省钱', '没钱'] },
  ],
};

function guessGender(name) {
  if (!name) return null;
  if (MALE_HINTS.some((h) => name.includes(h))) return 'male';
  if (FEMALE_HINTS.some((h) => name.includes(h))) return 'female';
  return null;
}

/**
 * 根据对话场景内容选择头像角色。
 * 按场景关键词匹配度评分，选得分最高的角色；
 * 平局时取列表第一个（更有区分度的角色优先），零分时退到默认角色。
 * 不再使用哈希随机挑选，确保同一场景下同一性别的角色选择稳定可复现。
 */
function selectAvatarId(gender, name, messages) {
  const profiles = AVATAR_PROFILES[gender] || AVATAR_PROFILES.male;
  const context = [name, ...messages].join(' ');
  const scored = profiles.map((profile, index) => ({
    profile,
    index,
    score: profile.hints.reduce((total, hint) => total + (context.includes(hint) ? 1 : 0), 0),
  }));
  const highestScore = Math.max(...scored.map((entry) => entry.score));
  if (highestScore > 0) {
    // 平局时取列表中排在前面的角色（更有区分度），不再用 name 哈希随机选
    const winner = scored.find((entry) => entry.score === highestScore);
    return (winner && winner.profile && winner.profile.id) || profiles[profiles.length - 1].id;
  }
  // 无场景特征 → 使用该性别的默认角色（每个性别列表最后一个，即 hints 为空的兜底角色）
  return profiles[profiles.length - 1].id;
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
  // 修复：toggle 始终递增，保证猜不出性别的说话人按全局顺序交替分配男女，
  // 避免"可猜出性别的人不递增 toggle"导致的性别偏移。
  speakerOrder.forEach((name) => {
    let gender = genderGuess.get(name);
    if (!gender) {
      gender = toggle % 2 === 0 ? 'male' : 'female';
    }
    finalGender.set(name, gender);
    toggle += 1;
  });

  // 若所有说话人性别一致（全部猜出同一性别 / 全部猜不出且 toggle 走到同一边），
  // 按首次出现顺序强制交替男女，确保视觉区分。
  const allGenders = [...new Set(speakerOrder.map((n) => finalGender.get(n)))];
  if (speakerOrder.length >= 2 && allGenders.length === 1) {
    speakerOrder.forEach((name, i) => {
      finalGender.set(name, i % 2 === 0 ? 'male' : 'female');
    });
  }

  // 额外兜底：前两位若仍同性别（比如第一轮纠正后第3人恰好又与某人同性别），
  // 至少保证前两位不同。
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
