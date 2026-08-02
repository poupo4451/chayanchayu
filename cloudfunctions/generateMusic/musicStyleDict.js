/**
 * musicStyleDict.js
 * 职责：流派 -> Suno style 提示词模板。
 * 直接把用户选的流派名字（如"嘻哈"）原样传给 Suno 信息量太少，生成质量不稳定。
 * 这里为每个流派准备了包含 BPM 区间、核心乐器、人声质感、混音氛围关键词的详细模板，
 * 并按对唱/独唱模式（vocalMode，由 generateLyrics 的性别猜测逻辑决定）追加人声描述，
 * 让 Suno 有足够信息生成有节奏感、有段落感、有主副歌记忆点的完整歌曲。
 */

const GENRE_STYLE_TEMPLATES = {
  嘻哈: 'Chinese hip-hop, 88-96 BPM, boom bap drums, deep 808 sub bass, punchy snare, laid-back confident rap flow, catchy melodic hook in chorus, vinyl crackle texture, tight modern mix, clear diction, verse-chorus structure with strong dynamic build-up',
  'R&B': 'Chinese R&B, 70-85 BPM, smooth electric piano and warm bass, soft trap-influenced drums, silky emotional vocal delivery, lush harmonies in chorus, dreamy reverb, intimate late-night mix, gentle groove with a soaring chorus climax',
  流行: 'Chinese mandopop, 100-116 BPM, bright acoustic/electric guitar and piano, four-on-the-floor pop drums, uplifting anthemic chorus, wide catchy melodic hook, polished radio-ready mix, clear and bright vocal tone, clear verse-buildup-chorus arc',
  抖音风: 'Chinese short-video viral pop, 120-130 BPM, punchy electronic synths and claps, four-on-the-floor dance beat, extremely catchy repetitive hook designed to loop, bright energetic mix, playful ear-catching drop into the chorus',
  粤语说唱: 'Cantonese hip-hop, 85-95 BPM, boom bap drums with deep 808 bass, laid-back Cantonese rap flow with clear rhyme, catchy Cantonese hook melody, warm vintage mix, please sing in Cantonese colloquial pronunciation',
  随机: 'Chinese pop-rap fusion, 95-110 BPM, punchy drums and catchy melodic hook, modern radio-ready mix, clear verse-chorus dynamic build-up',
};

const VOCAL_MODE_SUFFIX = {
  duet: 'male and female duet vocals, alternating verses, harmonizing on the chorus',
  'solo-male': 'solo confident male vocal',
  'solo-female': 'solo expressive female vocal',
  solo: 'solo expressive vocal',
};

function buildSunoStyle(genre, vocalMode) {
  const base = GENRE_STYLE_TEMPLATES[genre] || GENRE_STYLE_TEMPLATES['随机'];
  const vocalSuffix = VOCAL_MODE_SUFFIX[vocalMode] || VOCAL_MODE_SUFFIX.solo;
  return `${base}, ${vocalSuffix}`;
}

module.exports = { GENRE_STYLE_TEMPLATES, VOCAL_MODE_SUFFIX, buildSunoStyle };
