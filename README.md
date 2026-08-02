# 茶言茶曲 — 聊天记录 MV 生成小程序

> 将微信聊天对话自动改编为嘻哈音乐 MV 的微信小程序 + CloudBase 全栈项目。

## 架构概览

```
[微信小程序] → [CloudBase 云函数链] → [cloud-run Remotion 渲染] → [MV 视频]
```

### 数据流

1. **createTask** — 创建任务，写入 `tasks` 集合
2. **generateDialogue** — LLM 生成对话文案（@cloudbase/node-sdk AI 模型）
3. **confirmDialogue** — 用户确认对话内容
4. **renderChatScreenshots** — 将对话转换为结构化气泡数据（非图片）
5. **generateLyrics** — LLM 改编歌词
6. **generateMusic** — 提交 Suno 音乐生成任务
7. **musicCallback** (HTTP Function) — 接收 Suno 回调，触发下游
8. **fetchLyricsTimestamps** — 获取逐行歌词时间戳
9. **chat-mv-remotion** (Cloud Run 容器) — Remotion + Chromium 渲染 MV 视频
10. **notifyAndFinalize** — 写入 `works` 集合 + 订阅消息通知

## 已部署资源

### CloudBase 环境

| 属性 | 值 |
|------|-----|
| 环境 ID | `chayan-d1gwl5uub1e0e9d0b` |
| 环境别名 | `chayan` |
| 区域 | ap-shanghai |
| 状态 | NORMAL |

### 云函数（13 个）

全部云函数均部署在小程序绑定的 `chayan-d1gwl5uub1e0e9d0b` 环境。最近一次代码更新：2026-08-02。

| 函数名 | 类型 | 运行时 | 状态 |
|--------|------|--------|------|
| createTask | Event Function | Nodejs16.13 | ✅ 已部署 |
| confirmDialogue | Event Function | Nodejs16.13 | ✅ 已部署 |
| generateDialogue | Event Function | Nodejs16.13 | ✅ 已更新 |
| generateLyrics | Event Function | Nodejs16.13 | ✅ 已更新 |
| generateMusic | Event Function | Nodejs16.13 | ✅ 已更新 |
| fetchLyricsTimestamps | Event Function | Nodejs16.13 | ✅ 已更新 |
| getOpenId | Event Function | Nodejs16.13 | ✅ 已部署 |
| getTaskDetail | Event Function | Nodejs16.13 | ✅ 已更新 |
| getWorksList | Event Function | Nodejs16.13 | ✅ 已更新 |
| musicCallback | Event Function | Nodejs16.13 | ✅ 已更新 |
| notifyAndFinalize | Event Function | Nodejs16.13 | ✅ 已更新 |
| pollMusicStatus | Event Function（每分钟定时触发） | Nodejs16.13 | ✅ 已更新 |
| renderChatScreenshots | Event Function | Nodejs16.13 | ✅ 已更新 |

### CloudRun 渲染服务

| 属性 | 值 |
|------|-----|
| 环境 | `chayan-d1gwl5uub1e0e9d0b` |
| 服务名 | chat-mv-remotion |
| 类型 | Container (Dockerfile) |
| 当前线上版本 | chat-mv-remotion-004 |
| 本次发布 | chat-mv-remotion-005（构建中） |
| 规格 | CPU=1, Mem=2GB, MinNum=1, MaxNum=2 |
| 公网域名 | https://chat-mv-remotion-290149-5-1461115587.sh.run.tcloudbase.com/ |
| 端口 | 3000 |

#### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/debug-env` | 环境变量诊断 |
| GET | `/debug-db` | 数据库连通性诊断 |
| GET | `/debug-render/:taskId` | 分步渲染诊断（不产出视频）|
| POST | `/render` | 触发异步渲染（body: `{taskId}`）|
| GET | `/temp-url/:taskId` | 获取已完成视频的临时下载链接 |

### 数据库集合

| 集合 | 用途 | 状态 |
|------|------|------|
| tasks | 任务主表（对话/截图/音频/歌词/进度） | ✅ 已有数据 |
| works | 作品库（完成后的 MV 元数据） | ✅ 已有数据 |

### 静态托管

| 属性 | 值 |
|------|-----|
| 域名 | https://chayanchayu-d4g0fpnxq738c7662-1459907343.tcloudbaseapp.com |
| 状态 | 已启用 |

## 验证结果

### 云端渲染验证（2025-07-31）

- **测试 taskId**: `verify-render-001`
- **渲染耗时**: ~50 秒
- **输出**: 1.17 MB MP4 视频
- **视频 URL**: [verify-render-001.mp4](https://6368-chayanchayu-d4g0fpnxq738c7662-1459907343.tcb.qcloud.la/mv/verify-render-001.mp4)

#### 视觉验证项（Linux 容器 Chromium + Noto 字体）

| 项目 | 状态 | 说明 |
|------|------|------|
| 中文字体渲染 | ✅ | Noto CJK SC（思源黑体），fontconfig PingFang→Noto 别名生效 |
| Emoji 渲染 | ✅ | fonts-noto-color-emoji 安装，🧧 等表情可正常显示 |
| 圆形头像 | ✅ | borderRadius 50%，符合微信真实样式 |
| 微信气泡比例 | ✅ | iOS pt 值换算，绿色(#95EC69)/白色(#FFFFFF)，SVG 尖角 |
| 歌词时间对齐 | ✅ | lyricsAlign.ts dice 系数模糊匹配 + computeBubbleTimings |
| GSAP 动画 | ✅ | 7 种入场变体，节拍能量驱动选择 |
| DB 连通性 | ✅ | TENCENTCLOUD_SECRETID/SECRETKEY 自动注入 |
| 视频上传回写 | ✅ | 自动上传至 CloudBase Storage，tasks.resultVideoUrl 更新 |

## 待用户配合事项

### 1. 微信小程序上传

小程序绑定环境为 `chayan-d1gwl5uub1e0e9d0b`（`miniprogram/app.js`）。需在**微信开发者工具**中：

1. 打开项目 `miniprogram/` 目录
2. 确认 AppID 与云开发环境关联
3. 点击「上传」→ 填写版本号 → 上传代码
4. 在「版本管理」中提交审核/发布体验版

### 2. Suno API Key 配置（真实音乐生成必需）

`generateMusic` 云函数需要以下环境变量才能调用 Suno 音乐生成：

| 环境变量 | 说明 | 是否必填 |
|----------|------|----------|
| SUNO_API_KEY | Suno API 密钥 | ✅ 必填 |
| SUNO_BASE_URL | Suno API 地址（默认官方） | 可选 |
| MUSIC_CALLBACK_BASE_URL | musicCallback 公网回调地址 | ✅ 必填（Suno 回调用）|

配置方式：通过 CloudBase 控制台 → 云函数 → generateMusic → 环境变量，或使用 `tcb fn env set` CLI。

> **无 Suno key 时**：可用 mock 音频 URL 替代，跳过音乐生成环节，直接验证渲染链路（如本次验证所做）。

### 3. musicCallback HTTP 触发配置

`musicCallback` 是 Web 函数（监听 9000 端口），接收 Suno 回调。需确保：
- HTTP 触发已开启（公网访问地址）
- `MUSIC_CALLBACK_BASE_URL` 指向该地址

## 本地开发

```bash
# cloud-run-remotion 本地预览
cd cloud-run-remotion
npm install
npx remotion studio src/remotion/index.ts

# 运行对齐自测脚本
npx ts-node scripts/checkAlign.ts

# 渲染预览帧
npx ts-node scripts/previewFrames.ts
```

## 技术栈

- **前端**: 微信小程序原生框架
- **后端**: CloudBase 云函数 (Node.js 18) + CloudRun 容器 (Node.js 18)
- **渲染**: Remotion 4.x + Chromium headless
- **AI**: @cloudbase/node-sdk (LLM 对话/歌词生成)
- **音乐**: Suno API (外部服务)
- **数据库**: CloudBase NoSQL (tasks, works)
- **存储**: CloudBase Storage (视频/截图)
