import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const REMOTION_SRC = path.resolve(__dirname, '../cloud-run-remotion/src/remotion');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@remotion-components': REMOTION_SRC,
    },
  },
  /**
   * 直接复用主工程的 public 目录，避免复制一份头像素材。
   * ChatBubble 内的 staticFile('avatars/xxx.png') 由此正确解析。
   */
  publicDir: path.resolve(__dirname, '../cloud-run-remotion/public'),
  server: {
    port: 3001,
    open: false,
    fs: {
      // 允许读取工作区外层（cloud-run-remotion）的文件
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
