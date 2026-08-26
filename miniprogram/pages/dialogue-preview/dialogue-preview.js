const { getTaskDetail, startDialogue, regenerateDialogue, confirmDialogue } = require('../../utils/api');
const { showError } = require('../../utils/error-tip');

const TOTAL_AVATARS = 16;

Page({
  data: {
    taskId: '',
    dialogue: [],
    loading: true,
    // ── 头像栏 ──
    leftAvatarId: 1,
    rightAvatarId: 8,
    leftName: '',
    rightName: '',
    // ── 拖拽排序 ──
    dragIndex: -1,
    dragStartY: 0,
    dragTargetIndex: -1,
    dragOffsetY: 0,
    dragItemHeight: 0,
    // 骨架屏占位配置：宽度错落以模拟真实对话节奏
    skeleton: [
      { role: '', w: 300 },
      { role: 'sk-row-right', w: 220 },
      { role: '', w: 380 },
      { role: 'sk-row-right', w: 260 },
      { role: '', w: 200 },
    ],
  },

  // ==================== 生命周期 ====================

  onLoad(query) {
    this.setData({ taskId: query.taskId });
    this.pollCount = 0;
    this.pollTimer = null;
    this.dialogueTriggered = false;
    this.loadDialogue();
  },

  onUnload() {
    this.stopPolling();
    this.stopAutoScroll();
  },

  // ==================== 加载对话 ====================

  async loadDialogue() {
    try {
      const task = await getTaskDetail(this.data.taskId);
      const dialogue = task.dialogue || [];

      if (dialogue.length > 0) {
        this.setData({ dialogue, loading: false });
        this.extractParticipants(dialogue);
        this.measureItemHeight();
        this.stopPolling();
        return;
      }

      if (task.status === 'failed') {
        this.setData({ loading: false });
        wx.showToast({ title: task.errorMsg || '生成失败，请点重新生成', icon: 'none' });
        this.stopPolling();
        return;
      }

      if (task.status === 'pending' && !this.dialogueTriggered) {
        this.dialogueTriggered = true;
        startDialogue(this.data.taskId)
          .then((res) => {
            if (res && res.dialogue && res.dialogue.length > 0) {
              const d = res.dialogue;
              this.setData({ dialogue: d, loading: false });
              this.extractParticipants(d);
              this.measureItemHeight();
              this.stopPolling();
            }
          })
          .catch((e) => {
            console.error('startDialogue failed', e);
          });
      }

      this.pollCount += 1;
      if (this.pollCount > 20) {
        this.setData({ loading: false });
        wx.showToast({ title: '生成超时，请点重新生成', icon: 'none' });
        this.stopPolling();
        return;
      }

      this.setData({ loading: true });
      this.schedulePoll();
    } catch (e) {
      console.error(e);
      this.pollCount += 1;
      if (this.pollCount > 20) {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.stopPolling();
        return;
      }
      this.schedulePoll();
    }
  },

  schedulePoll() {
    this.stopPolling();
    this.pollTimer = setTimeout(() => {
      this.loadDialogue();
    }, 3000);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  // ==================== 头像栏 ====================

  /** 从对话中提取左右参与者信息 */
  extractParticipants(dialogue) {
    let leftAvatarId = 1;
    let rightAvatarId = 8;
    let leftName = '';
    let rightName = '';
    for (const line of dialogue) {
      if (line.type === 'time') continue;
      if (line.role === 'left' && !leftName) {
        leftAvatarId = line.avatarId || 1;
        leftName = line.name || '';
      }
      if (line.role === 'right' && !rightName) {
        rightAvatarId = line.avatarId || 8;
        rightName = line.name || '';
      }
      if (leftName && rightName) break;
    }
    this.setData({ leftAvatarId, rightAvatarId, leftName, rightName });
  },

  /** 切换左头像：排除当前，随机从 16 个中选 */
  onChangeLeftAvatar() {
    const newId = this.getRandomAvatarId(this.data.leftAvatarId);
    const dialogue = this.data.dialogue.map(line => {
      if (line.type === 'time') return line;
      if (line.role === 'left') return { ...line, avatarId: newId };
      return line;
    });
    this.setData({ leftAvatarId: newId, dialogue });
  },

  /** 切换右头像 */
  onChangeRightAvatar() {
    const newId = this.getRandomAvatarId(this.data.rightAvatarId);
    const dialogue = this.data.dialogue.map(line => {
      if (line.type === 'time') return line;
      if (line.role === 'right') return { ...line, avatarId: newId };
      return line;
    });
    this.setData({ rightAvatarId: newId, dialogue });
  },

  getRandomAvatarId(currentId) {
    let newId;
    do {
      newId = Math.floor(Math.random() * TOTAL_AVATARS) + 1;
    } while (newId === currentId);
    return newId;
  },

  /** 交换 A / B：顶部头像栏交换 + 所有非 time 气泡 role 互换（保留原说话人的头像和名字） */
  onSwapAvatars() {
    const { leftAvatarId, rightAvatarId, leftName, rightName } = this.data;
    const dialogue = this.data.dialogue.map(line => {
      if (line.type === 'time') return line;
      if (line.role === 'left') return { ...line, role: 'right' };
      if (line.role === 'right') return { ...line, role: 'left' };
      return line;
    });
    this.setData({
      dialogue,
      leftAvatarId: rightAvatarId,
      rightAvatarId: leftAvatarId,
      leftName: rightName,
      rightName: leftName,
    });
  },

  // ==================== 新增气泡 ====================

  /** 新增白 / 绿色气泡 */
  onAddBubble(e) {
    const role = e.currentTarget.dataset.role;
    const isLeft = role === 'left';

    const newLine = {
      type: 'text',
      role,
      text: '输入内容',
      avatarId: isLeft ? this.data.leftAvatarId : this.data.rightAvatarId,
      name: isLeft ? this.data.leftName : this.data.rightName,
    };

    // 插入到当前可见区域最后一个完整气泡的后面
    this.getInsertIndex((insertIndex) => {
      const dialogue = [...this.data.dialogue];
      dialogue.splice(insertIndex, 0, newLine);
      this.setData({ dialogue }, () => {
        this.editLineAtIndex(insertIndex);
      });
    });
  },

  /** 用 IntersectionObserver 找到最后完整可见的气泡位置 */
  getInsertIndex(callback) {
    const query = wx.createSelectorQuery();
    query.selectAll('.drag-wrapper').boundingClientRect();
    query.selectViewport().boundingClientRect();
    query.exec((res) => {
      const items = res[0];
      const viewport = res[1];
      if (!items || !items.length) {
        callback(this.data.dialogue.length);
        return;
      }
      // 底部面板高度：24+76+20+96+24 = 240rpx ≈ 120px，加底部安全区约 155px
      const bottomBarsHeight = 155;
      const vpBottom = (viewport && viewport.bottom) || wx.getSystemInfoSync().windowHeight;
      const visibleBottom = vpBottom - bottomBarsHeight;
      let lastVisible = items.length - 1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].bottom <= visibleBottom) { lastVisible = i; break; }
        if (i === 0) lastVisible = 0;
      }
      callback(Math.min(lastVisible + 1, this.data.dialogue.length));
    });
  },

  // ==================== 编辑台词 ====================

  onEditLine(e) {
    const { index } = e.currentTarget.dataset;
    this.editLineAtIndex(parseInt(index, 10));
  },

  editLineAtIndex(index) {
    if (index < 0 || index >= this.data.dialogue.length) return;
    if (this.data.dialogue[index].type === 'time') return;
    wx.showModal({
      title: '编辑台词',
      editable: true,
      placeholderText: this.data.dialogue[index].text || '输入内容',
      success: (res) => {
        if (res.confirm && res.content) {
          const dialogue = this.data.dialogue;
          dialogue[index].text = res.content;
          this.setData({ dialogue });
        }
      },
    });
  },

  // ==================== 长按拖拽排序 ====================

  measureItemHeight() {
    setTimeout(() => {
      const query = wx.createSelectorQuery();
      query.select('.drag-wrapper').boundingClientRect();
      query.exec((res) => {
        if (res[0] && res[0].height) {
          this.setData({ dragItemHeight: res[0].height });
        }
      });
    }, 400);
  },

  /** 追踪滚动位置 — 仅非拖拽时同步；拖拽期间由 stepAutoScroll 独占维护，避免互相覆盖抖动 */
  onBubbleScroll(e) {
    if (this.data.dragIndex >= 0) return;
    this._dragScrollBase = e.detail.scrollTop;
  },

  /** 拿到 enhanced scroll-view 的命令式滚动上下文 */
  getScrollCtx() {
    return new Promise((resolve) => {
      if (this._scrollCtx) return resolve(this._scrollCtx);
      const query = this.createSelectorQuery();
      query.select('#bubbleScroll').node();
      query.exec((res) => {
        this._scrollCtx = res && res[0] ? res[0].node : null;
        resolve(this._scrollCtx);
      });
    });
  },

  onLineLongPress(e) {
    const index = e.currentTarget.dataset.index;
    if (this.data.dialogue[index].type === 'time') return;
    wx.vibrateShort();
    const touch = e.touches[0];
    // 提前拿好 scroll context，避免拖拽时异步获取延迟
    this.getScrollCtx();
    // 记录当前手指屏幕坐标 + 起点滚动量
    this._lastTouchY = touch.clientY;
    this._scrollAtStart = this._dragScrollBase || 0;
    this.setData({
      dragIndex: index,
      dragStartY: touch.clientY,
      dragOffsetY: 0,
      dragTargetIndex: index,
    });
  },

  onDragTouchMove(e) {
    if (this.data.dragIndex < 0) return;
    const touch = e.touches[0];
    this._lastTouchY = touch.clientY;

    // 根据手指是否进入上/下边缘区，启停自动滚动定时器
    this.checkEdgeAutoScroll();

    this.applyDrag();
  },

  /** 检查手指是否处于边缘区，处于则开启定时器持续滚动，否则停止 */
  checkEdgeAutoScroll() {
    const vpHeight = wx.getSystemInfoSync().windowHeight;
    const EDGE_TOP = 160;              // 距顶部（含角色栏）多少 px 触发向上滚
    const EDGE_BOTTOM = vpHeight - 200; // 底部操作面板上方多少 px 触发向下滚
    const y = this._lastTouchY;

    let dir = 0;
    if (y < EDGE_TOP) dir = -1;
    else if (y > EDGE_BOTTOM) dir = 1;

    if (dir === 0) {
      this.stopAutoScroll();
      return;
    }
    // 方向没变且定时器在跑，无需重启
    if (this._autoScrollDir === dir && this._autoScrollTimer) return;

    this._autoScrollDir = dir;
    this.stopAutoScroll();
    this._autoScrollTimer = setInterval(() => this.stepAutoScroll(), 16);
  },

  /** 定时器每帧推进滚动（命令式 scrollTo，避免受控属性跳变） */
  stepAutoScroll() {
    if (this.data.dragIndex < 0) {
      this.stopAutoScroll();
      return;
    }
    const SPEED = 12; // 每帧滚动像素
    const delta = this._autoScrollDir * SPEED;
    const cur = this._dragScrollBase || 0;
    const next = Math.max(0, cur + delta);
    if (next === cur) return; // 已到顶，停
    this._dragScrollBase = next;
    if (this._scrollCtx) {
      this._scrollCtx.scrollTo({ top: next, duration: 0 });
    }
    // 内容滚动了，落点要跟着变 → applyDrag 里用 scroll 差值补偿
    this.applyDrag();
  },

  stopAutoScroll() {
    if (this._autoScrollTimer) {
      clearInterval(this._autoScrollTimer);
      this._autoScrollTimer = null;
    }
    this._autoScrollDir = 0;
  },

  /**
   * 计算目标插入位并更新位移动画。
   * target 落点用 (手指位移 + 已滚动距离)；被拖气泡视觉位移只用手指位移，
   * 因为它本身随 scroll 内容一起移动，只需停在手指下。
   */
  applyDrag() {
    const fingerDy = this._lastTouchY - this.data.dragStartY;
    const scrollDy = (this._dragScrollBase || 0) - (this._scrollAtStart || 0);
    const dy = fingerDy + scrollDy;
    const itemH = this.data.dragItemHeight || 120;
    let target = this.data.dragIndex + Math.round(dy / itemH);
    target = Math.max(0, Math.min(target, this.data.dialogue.length - 1));

    const changed = target !== this._lastTarget || Math.abs(dy - (this._lastDy || 0)) > 3;
    if (changed) {
      this._lastTarget = target;
      this._lastDy = dy;
      if (this.data.dragTargetIndex !== target) {
        this.data.dragTargetIndex = target;
      }
      this.updateDragTransforms(target, fingerDy);
    }
  },

  onDragTouchEnd() {
    if (this.data.dragIndex < 0) return;
    this.stopAutoScroll();
    const from = this.data.dragIndex;
    const to = this._lastTarget != null ? this._lastTarget : from;

    // 清理跟踪变量
    this._lastDy = 0;
    this._lastTarget = null;

    // 清理 _translateY 并重排数组
    const dialogue = this.data.dialogue.map(({ _translateY, ...item }) => item);
    if (from !== to) {
      const [moved] = dialogue.splice(from, 1);
      dialogue.splice(to, 0, moved);
    }
    this.setData({
      dialogue,
      dragIndex: -1,
      dragTargetIndex: -1,
      dragOffsetY: 0,
    });
  },

  /** 更新拖拽过程中其他条目的位移动画 */
  updateDragTransforms(targetIndex, offsetY) {
    const { dragIndex, dragItemHeight } = this.data;
    const itemH = dragItemHeight || 120;
    const dialogue = this.data.dialogue.map((item, index) => {
      let tY;
      if (index === dragIndex) {
        tY = offsetY;
      } else if (targetIndex > dragIndex && index > dragIndex && index <= targetIndex) {
        tY = -itemH;
      } else if (targetIndex < dragIndex && index >= targetIndex && index < dragIndex) {
        tY = itemH;
      }
      // 始终设置 _translateY（undefined 会清除旧值），否则回拖时残留 transform 卡住
      return { ...item, _translateY: tY };
    });
    this.setData({ dialogue });
  },

  // ==================== 重新生成 / 确认提交 ====================

  async onRegenerate() {
    this.stopPolling();
    wx.showLoading({ title: '重新生成中…' });
    try {
      const task = await regenerateDialogue(this.data.taskId);
      const d = task.dialogue || [];
      this.setData({ dialogue: d });
      this.extractParticipants(d);
      this.measureItemHeight();
    } catch (e) {
      showError(e, '重新生成失败');
    } finally {
      wx.hideLoading();
    }
  },

  // ==================== 确认提交 ====================

  /**
   * 确认对话内容，进入生成流程。
   *
   * 注意：这里不做「完成通知」的订阅邀请。
   * 主流程上插一层弹层会让用户以为操作被阻断，且此刻他的注意力还在「对话内容对不对」上。
   * 订阅邀请改由进度页在进入 2 秒后自动弹出——那时用户已经进入「等待」语境，
   * 「要不要通知你」才是顺理成章的下一个问题。
   */
  async onConfirm() {
    // 防连点：确认即扣次数，重复提交虽有服务端幂等保护，前端也不该发出多余请求
    if (this.confirming) return;
    this.confirming = true;
    wx.showLoading({ title: '提交中…' });
    try {
      const dialogue = this.data.dialogue.map(({ _translateY, ...item }) => item);
      await confirmDialogue(this.data.taskId, dialogue);
      wx.redirectTo({ url: `/pages/task-progress/task-progress?taskId=${this.data.taskId}` });
    } catch (e) {
      // 额度超限是可预期结果，用明确的弹窗说明而不是通用错误提示
      if (e && e.code === 'QUOTA_EXCEEDED') {
        wx.hideLoading();
        wx.showModal({
          title: '今日次数已用完',
          content: e.message || '今日生成次数已用完，明天 0 点恢复',
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      showError(e, '提交失败');
    } finally {
      this.confirming = false;
      wx.hideLoading();
    }
  },
});
