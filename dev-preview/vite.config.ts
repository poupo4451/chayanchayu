import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const REMOTION_SRC = path.resolve(__dirname, '../cloud-run-remotion/src/remotion');
/**
 * 主工程 src/ 根目录。用于 import buildRenderInputs / lyricsAlign ——
 * 预览必须调用与云端**完全相同**的输入构建函数，否则会重新出现
 * 「预览调好、上云观感不同」的漂移问题。
 */
const RENDER_SRC = path.resolve(__dirname, '../cloud-run-remotion/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@remotion-components', replacement: REMOTION_SRC },
      { find: '@render-src', replacement: RENDER_SRC },
      /**
       * remotion/no-react.js 的 CJS shim 在 ESM 环境下没有 named export。
       * 必须放在 'remotion' 前面，否则前缀匹配的 remotion alias 会先命中。
       */
      {
        find: 'remotion/no-react',
        replacement: path.resolve(__dirname, 'node_modules/remotion/dist/esm/no-react.mjs'),
      },
      {
        find: 'remotion/no-react.js',
        replacement: path.resolve(__dirname, 'node_modules/remotion/dist/esm/no-react.mjs'),
      },
      /**
       * 关键：ChatMVComposition.tsx 位于 cloud-run-remotion/ 下，其 `import from 'remotion'`
       * 默认会解析到 cloud-run-remotion/node_modules/remotion，与 dev-preview 自己的
       * @remotion/player 所用副本是两个独立实例 —— React Context 不互通，导致
       * useCurrentFrame 报"can only be called inside a component passed to <Player>"。
       * 这里强制所有 remotion 引用都指向 dev-preview 的同一份。
       */
      { find: 'remotion', replacement: path.resolve(__dirname, 'node_modules/remotion') },
      { find: '@remotion/player', replacement: path.resolve(__dirname, 'node_modules/@remotion/player') },
      { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react') },
      { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom') },
    ],
    dedupe: ['remotion', '@remotion/player', 'react', 'react-dom'],
  },
  /**
   * 关键：Vite 的 esbuild 预打包会把 remotion 内联进 @remotion/player 的 chunk，
   * 而 @fs/ 外部文件（ChatMVComposition）引用另一个独立的 remotion chunk ——
   * 两个实例导致 React Context 不互通，useCurrentFrame 报错。
   * 排除预打包后，二者以原生 ESM 从同一文件路径加载，共享同一实例。
   * 代价：原生 ESM 加载 remotion（数百文件）不支持 HMR 热替换，需配合 server.hmr: false。
   */
  optimizeDeps: {
    exclude: ['remotion', '@remotion/player'],
  },
  /**
   * 直接复用主工程的 public 目录，避免复制一份头像素材。
   * ChatBubble 内的 staticFile('avatars/xxx.png') 由此正确解析。
   */
  publicDir: path.resolve(__dirname, '../cloud-run-remotion/public'),
  server: {
    port: 3001,
    open: false,
    /**
     * 彻底关闭 HMR。remotion 以原生 ESM 加载时（optimizeDeps.exclude），
     * HMR 热替换会导致模块状态断裂白屏。代码变更后手动刷新页面即可。
     */
    hmr: false,
    fs: {
      // 允许读取工作区外层（cloud-run-remotion）的文件
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
