FROM node:18-slim

# 安装 Chromium（Remotion 渲染依赖）、中文字体与 emoji 字体
# fonts-noto-color-emoji：红包 🧧 等 emoji 否则会渲染成豆腐块
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    fonts-noto-color-emoji \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# 把 CSS 里的苹方（PingFang SC）解析到思源黑体，详见 fonts/local.conf
COPY fonts/local.conf /etc/fonts/local.conf
RUN fc-cache -f

ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Remotion bundler 运行时需要 src/ 下的源码（.tsx）
# dist/ 只包含编译后的 server.js 和 render.js

EXPOSE 3000
CMD ["node", "dist/server.js"]
