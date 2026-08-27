# ============================================================================
# 多阶段构建：builder 编译 TS，runtime 只保留运行期所需产物
#
# 【为什么改成多阶段】
# 旧版单阶段镜像 2.81GB，CloudBase 构建日志会主动提示优化。体积过大在
# 「镜像推送成功之后」的发布阶段有实际风险：新实例要先拉取整个镜像再启动，
# 冷启动时间被显著拉长，容易触发平台健康检查超时 → 判定启动失败 →
# 自动回滚到旧版本。表现就是「构建成功、服务 normal、但代码还是旧的」。
#
# 拆成两阶段后，编译期依赖（typescript / @cloudbase/cli / ts-node 等
# devDependencies）不会进入最终镜像。
#
# ⚠️ 关键约束：Remotion 渲染时 bundler 需要 **src/ 下的 .tsx 源码**
# （见 render.ts 的 ENTRY_POINT = src/remotion/index.ts），
# 所以 src/ 必须复制进 runtime 阶段，不能只留 dist/。
# ============================================================================

# ── builder：装全量依赖并编译 ────────────────────────────────────────────
FROM node:18-slim AS builder

WORKDIR /app

# 用 npm ci 而不是 npm install：
# package.json 全部以 ^ 声明版本，npm install 不遵守 lockfile，
# 会在每次构建时装到当时的最新版（例如 remotion 4.0.503 → 4.0.518）。
# 这意味着「本地验证通过」不能保证「容器构建通过」，是隐性的构建不确定性。
# npm ci 严格按 package-lock.json 安装，构建结果可复现。
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 剪掉 devDependencies，得到可直接搬运的运行期 node_modules。
# 这样 runtime 阶段无需重新联网安装，也不会残留 typescript(23MB)、
# @cloudbase/cli(27MB) 这类只在编译期用到的包。
RUN npm prune --omit=dev

# ── runtime：仅含运行期所需 ──────────────────────────────────────────────
FROM node:18-slim AS runtime

# Chromium（Remotion 渲染必需）、ffmpeg、中文字体、emoji 字体
#
# 字体说明：只装 fonts-noto-cjk，不装 fonts-noto-cjk-extra。
# local.conf 只把苹方家族映射到 Noto Sans CJK SC/HK/TC，这三个字族都在
# 基础包内；extra 提供的是 Serif/Mono 等额外字族，本项目 CSS 从未引用。
# fonts-noto-color-emoji 必须保留：红包 🧧 等 emoji 否则渲染成豆腐块。
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# 把 CSS 里的苹方（PingFang SC）解析到思源黑体，详见 fonts/local.conf
COPY fonts/local.conf /etc/fonts/local.conf
RUN fc-cache -f

ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Remotion bundler 在渲染时打包 src/remotion/index.ts（.tsx 源码），
# 不是用 dist/ 里的编译产物，因此 src/ 与 tsconfig.json 必须保留。
COPY --from=builder /app/src ./src
COPY tsconfig.json ./

# staticFile() 解析头像与红包/转账 SVG 素材
COPY public ./public

EXPOSE 3000
CMD ["node", "dist/server.js"]
