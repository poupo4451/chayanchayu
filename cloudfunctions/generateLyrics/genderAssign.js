/**
 * genderAssign.js
 * 职责：根据说话人昵称，猜测/分配男女声部，供 generateLyrics 决定
 * 歌词的分声部标记（[Verse - Male] / [Verse - Female]）以及是否为男女对唱。
 *
 * 规则：
 * 1. 先按昵称关键词猜测性别；
 * 2. 若两个说话人都能猜出且性别不同，直接采用；
 * 3. 猜不出、或猜出同一性别，按首次出现顺序强制分配为一男一女；
 * 4. 只有一个说话人时不构成对唱（isDuet=false）。
 */

const MALE_HINTS = ['哥', '弟', '先生', '帅', '爷', '郎', '小伙', '男友', '老公', '汉', '强', '伟', '军', '刚', '磊', '鹏', '超', '虎', '龙'];
const FEMALE_HINTS = ['姐', '妹', '小姐', '美女', '女友', '老婆', '宝贝', '公主', '甜心', '仙女', '丫头', '娜', '丽', '婷', '雪', '梅', '芳', '琳', '萌', '花', '媚'];

function guessGender(name) {
  if (!name) return null;
  if (MALE_HINTS.some((h) => name.includes(h))) return 'male';
  if (FEMALE_HINTS.some((h) => name.includes(h))) return 'female';
  return null;
}

/**
 * @param {Array} dialogue
 * @returns {{ genderByName: Map<string,string>, speakerOrder: string[], isDuet: boolean, vocalMode: string }}
 */
function assignSpeakerGenders(dialogue) {
  const list = dialogue || [];
  const speakerOrder = [];
  const guess = new Map();

  list.forEach((line) => {
    const name = (line.name || '').trim();
    if (!name || guess.has(name)) return;
    speakerOrder.push(name);
    guess.set(name, guessGender(name));
  });

  const finalGender = new Map();
  let toggle = 0;
  speakerOrder.forEach((name) => {
    let gender = guess.get(name);
    if (!gender) {
      gender = toggle % 2 === 0 ? 'male' : 'female';
    }
    finalGender.set(name, gender);
    toggle += 1;
  });

  // 若所有说话人性别一致，按首次出现顺序强制交替男女
  const allGenders = [...new Set(speakerOrder.map((n) => finalGender.get(n)))];
  if (speakerOrder.length >= 2 && allGenders.length === 1) {
    speakerOrder.forEach((name, i) => {
      finalGender.set(name, i % 2 === 0 ? 'male' : 'female');
    });
  }

  // 兜底：前两位若仍同性别，至少保证前两位不同
  if (speakerOrder.length >= 2) {
    const g0 = finalGender.get(speakerOrder[0]);
    const g1 = finalGender.get(speakerOrder[1]);
    if (g0 === g1) {
      finalGender.set(speakerOrder[1], g0 === 'male' ? 'female' : 'male');
    }
  }

  const genderSet = new Set(finalGender.values());
  const isDuet = speakerOrder.length >= 2 && genderSet.size >= 2;

  let vocalMode = 'solo';
  if (isDuet) {
    vocalMode = 'duet';
  } else if (speakerOrder.length >= 1) {
    vocalMode = finalGender.get(speakerOrder[0]) === 'female' ? 'solo-female' : 'solo-male';
  }

  return { genderByName: finalGender, speakerOrder, isDuet, vocalMode };
}

module.exports = { assignSpeakerGenders, guessGender };
