FROM node:18-slim

# 安装 Chromium（Remotion 渲染依赖）和中文字体
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

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
