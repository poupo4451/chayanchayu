const { createTask } = require('../../utils/api');
const { showError } = require('../../utils/error-tip');

const MAX_LEN = 100;

// 对话风格：name 传给后端，desc 取自 generateDialogue 的 prompt 定义，
// 让用户选得准、LLM 出得对。后端支持四种，此前前端漏了「甜宠」。
const DIALOGUE_TONES = [
  { name: '绿茶', desc: '暧昧试探' },
  { name: '搞笑', desc: '抽象整活' },
  { name: '毒舌', desc: '犀利互怼' },
  { name: '甜宠', desc: '撩人心动' },
];

// 音乐风格。后端 resolveGenre 仍兼容「随机」，但前端不再暴露该选项，默认「嘻哈」
const MUSIC_GENRES = ['嘻哈', 'R&B', '流行', '抖音风', '粤语说唱'];

const INSPIRATIONS = [
  '绿茶跟前男友借钱',
  '甲方半夜改需求',
  '闺蜜怀疑我抢她男朋友',
  '室友天天不洗碗',
  '前任结婚了来请我',
  '老板说公司就是家',
];

Page({
  data: {
    topic: '',
    maxLen: MAX_LEN,
    dialogueTones: DIALOGUE_TONES,
    musicGenres: MUSIC_GENRES,
    inspirations: INSPIRATIONS,
    selectedTone: '绿茶',
    selectedGenre: '嘻哈',
    submitting: false,
    canSubmit: false,
  },

  onTopicInput(e) {
    const topic = e.detail.value;
    this.setData({ topic, canSubmit: !!topic.trim() });
  },

  /** 点击灵感胶囊：直接填入输入框，降低冷启动门槛 */
  onPickInspiration(e) {
    const topic = e.currentTarget.dataset.value || '';
    this.setData({ topic, canSubmit: !!topic.trim() });
  },

  selectTone(e) {
    this.setData({ selectedTone: e.currentTarget.dataset.value });
  },

  selectGenre(e) {
    this.setData({ selectedGenre: e.currentTarget.dataset.value });
  },

  async onSubmit() {
    // 拦截重复提交：原实现只改了按钮文案，网络慢时连点会创建多个任务
    if (this.data.submitting) return;

    const topic = this.data.topic.trim();
    if (!topic) {
      wx.showToast({ title: '先说说想聊点什么', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const { taskId } = await createTask({
        topic,
        dialogueTone: this.data.selectedTone,
        musicGenre: this.data.selectedGenre,
      });
      wx.redirectTo({ url: `/pages/dialogue-preview/dialogue-preview?taskId=${taskId}` });
    } catch (e) {
      showError(e, '创建任务失败');
    } finally {
      this.setData({ submitting: false });
    }
  },
});
