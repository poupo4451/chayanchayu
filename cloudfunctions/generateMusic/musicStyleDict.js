/**
 * musicStyleDict.js
 * 职责：流派 -> Suno style 提示词模板。
 * 直接把用户选的流派名字（如"嘻哈"）原样传给 Suno 信息量太少，生成质量不稳定。
 * 这里为每个流派准备了多段式提示词模板，包含 Voice Lock、编曲细节、人声技法、时代锚点、曲式结构，
 * 并按对唱/独唱模式（vocalMode，由 generateLyrics 的性别猜测逻辑决定）追加人声描述，
 * 让 Suno 有足够信息生成有节奏感、有段落感、有主副歌记忆点的完整歌曲。
 */

const GENRE_STYLE_TEMPLATES = {
  嘻哈: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Boom Bap Hip-hop, 88-96 BPM, gritty 808 sub bass, dusty vinyl crackle, punchy snare with natural swing, confident laid-back rap flow with sharp enunciation, catchy melodic hook in chorus, Beijing underground meets 90s NYC golden age, street-smart storytelling with wit and attitude.',
    'Structure: Sampled intro hook, verse-chorus-verse-chorus, bridge with beat switch, ad-lib outro.',
  ].join('\n'),

  'R&B': [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Gospel Funk R&B, heavy slap bass, punchy brass, fast swing groove, raw soulful vocals, extreme melisma and runs, explosive gospel choir, dramatic shout style, 70s Motown meets trap bass, cinematic comedic storytelling.',
    'Structure: Funky intro, alternating duet, gospel chorus climax, comedic outro.',
  ].join('\n'),

  流行: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Mandopop, 100-112 BPM, bright acoustic guitar and layered piano, four-on-the-floor pop drums, wide anthemic chorus with soaring vocal belt, crisp radio-ready mix with subtle string pads, 2000s Jay Chou ballad meets modern K-drama OST, heartfelt youth storytelling with emotional peak.',
    'Structure: Gentle piano intro, verse buildup, explosive chorus, emotional bridge with key lift, warm fade-out outro.',
  ].join('\n'),

  抖音风: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Viral Short-video Pop, 120-135 BPM, punchy 808 kicks and bright synth stabs, clap-driven four-on-the-floor drop, hyper-catchy loopable hook designed to earworm, sidechain-pumped energetic mix, Douyin trends meets K-pop bounce, playful quirky narrative with instant payoff.',
    'Structure: Instant hook intro skip, micro verse, explosive drop chorus, repeat, cold end.',
  ].join('\n'),

  粤语说唱: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Hong Kong Cantonese Hip-hop, 85-95 BPM, boom bap drums with deep 808 warmth, laid-back Cantonese rhyme flow with sharp local slang, catchy Cantonese melodic hook, warm vintage MPC grit, Mong Kok street vibe meets golden age Hong Kong rap, witty storytelling with local attitude.',
    'Structure: Sampled intro, verse-hook-verse-hook, scratch outro. Please sing in authentic Cantonese colloquial pronunciation throughout.',
  ].join('\n'),

  随机: [
    'Strict Voice Lock: Keep Female for [Female], keep Deep Male for [Male]. Never switch genders within same tag block.',
    'Chinese Pop-Rap Fusion, 95-110 BPM, punchy hybrid drums blending acoustic and electronic, catchy melodic hook with rap-sung alternation, genre-fluid production, modern radio-ready mix, unexpected beat switches, playful narrative storytelling.',
    'Structure: Hook intro, alternating rap-sing verses, big chorus drop, surprise bridge, confident outro.',
  ].join('\n'),
};

const VOCAL_MODE_SUFFIX = {
  duet: 'male and female alternating verses with natural conversational chemistry, harmonizing powerfully on the chorus',
  'solo-male': 'deep confident male vocal with rich chest tone and expressive delivery',
  'solo-female': 'bright expressive female vocal with clear belt and emotional nuance',
  solo: 'expressive lead vocal with dynamic control and emotional storytelling',
};

function buildSunoStyle(genre, vocalMode) {
  const base = GENRE_STYLE_TEMPLATES[genre] || GENRE_STYLE_TEMPLATES['随机'];
  const vocalSuffix = VOCAL_MODE_SUFFIX[vocalMode] || VOCAL_MODE_SUFFIX.solo;
  return `${base}\nVocal: ${vocalSuffix}\nProduction: minimal intro under 3 seconds, vocals start almost immediately, skip long instrumental prelude, straight into verse.`;
}

module.exports = { GENRE_STYLE_TEMPLATES, VOCAL_MODE_SUFFIX, buildSunoStyle };
