/**
 * 微信聊天气泡视觉规范
 * =====================================================================
 * 所有尺寸先以 iOS 微信真机的 **pt** 记录，再统一乘同一个换算系数变成像素。
 *
 * 现在所有参数从 animation-config.ts 统一读取。
 * 此文件保留原有导出名以向后兼容。
 */

import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  PX_PER_PT,
  pt,
  FONT_FAMILY,
  WX_COLOR,
  WX_COLORS,
  WX_SIZE,
  WX_SIZES,
  WX_LINE_HEIGHT,
} from './animation-config';

export { CANVAS_WIDTH, CANVAS_HEIGHT, PX_PER_PT, pt, WX_SIZE, WX_SIZES };

// 向后兼容的独立命名导出
export { FONT_FAMILY, WX_COLOR, WX_COLORS, WX_LINE_HEIGHT };
