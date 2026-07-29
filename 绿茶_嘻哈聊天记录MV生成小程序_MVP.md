---
name: 绿茶/嘻哈聊天记录MV生成小程序 MVP
overview: 设计并规划一个微信小程序MVP：用户输入话题/风格后，AI生成一段"很绿茶"或搞笑的双人聊天对话文本，渲染成逼真的仿微信聊天气泡截图（按气泡逐条生成），再将对话改编为歌词并调用AI音乐生成接口生成对应风格（嘻哈/随机风格）的完整歌曲，最后在云端用Remotion将聊天截图与歌曲、歌词字幕合成为一个"文字MV"视频，供用户导出/分享，导出环节接入激励视频广告。
design:
  architecture:
    component: tdesign
  styleKeywords:
    - 潮流嘻哈
    - 暗色霓虹
    - 玻璃拟态
    - 趣味热梗
    - 活力渐变
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 22px
      weight: 700
    subheading:
      size: 16px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#FF2D78"
      - "#7C3AED"
      - "#FFB800"
    background:
      - "#0E0B16"
      - "#1A1625"
    text:
      - "#FFFFFF"
      - "#A5A0B8"
    functional:
      - "#22C55E"
      - "#EF4444"
      - "#60A5FA"
todos:
  - id: init-project-scaffold
    content: 搭建微信小程序项目骨架，初始化CloudBase云开发环境（云函数目录、云数据库集合、云存储、云托管项目结构）
    status: pending
  - id: design-provider-interfaces-and-data-model
    content: 设计并实现LLM/音乐生成/聊天截图渲染的可插拔Provider接口层，定义任务状态机与tasks/works数据模型
    status: pending
    dependencies:
      - init-project-scaffold
  - id: implement-dialogue-and-screenshot-pipeline
    content: 实现文案生成（含红包/转账/表情包/时间分隔条等消息类型）、聊天气泡数据转换（renderChatScreenshots仅做结构化转换，视觉渲染留给Remotion阶段）、歌词改编云函数链路
    status: pending
    dependencies:
      - design-provider-interfaces-and-data-model
  - id: implement-music-generation-pipeline
    content: 实现音乐生成云函数，封装音乐Provider的提交/轮询/取回结果逻辑并更新任务状态
    status: pending
    dependencies:
      - design-provider-interfaces-and-data-model
  - id: build-remotion-video-service
    content: 搭建云托管Remotion视频合成服务，按气泡截图与歌词时间轴合成文字MV并上传云存储
    status: pending
    dependencies:
      - implement-dialogue-and-screenshot-pipeline
      - implement-music-generation-pipeline
  - id: implement-notification-and-works-query
    content: 实现任务完成后的订阅消息通知与"我的作品"列表查询云函数
    status: pending
    dependencies:
      - build-remotion-video-service
  - id: develop-miniprogram-pages
    content: 开发小程序五个核心页面（首页/创作/对话预览编辑/生成进度/我的作品），接入TDesign Miniprogram组件
    status: pending
    dependencies:
      - design-provider-interfaces-and-data-model
  - id: integrate-export-and-ad
    content: 接入生成进度轮询、视频导出下载流程与激励视频广告位
    status: pending
    dependencies:
      - develop-miniprogram-pages
      - implement-notification-and-works-query
  - id: e2e-integration-and-compliance-watermark
    content: 端到端联调MVP全链路，并在截图/视频中加入"AI生成/虚构娱乐"合规水印声明
    status: pending
    dependencies:
      - integrate-export-and-ad
---

## 产品概述

一款"AI生成好玩/绿茶风聊天对话 + 逼真聊天气泡截图 + AI改编歌词并生成对应风格歌曲 + 自动合成文字MV"的微信小程序，用户输入一个主题/人设，一键生成一段"完整且好玩"的短视频内容，可在小程序内查看、导出、分享。

## 核心功能

1. **AI聊天对话生成**：用户输入主题/人设（如"绿茶跟前男友对话""搞笑闺蜜互怼"），AI生成一段双人（MVP阶段）文字对话，用户可在预览页微调文本、昵称、头像。
2. **仿聊天气泡截图渲染**：将对话逐句拆解为独立的仿微信聊天气泡截图/帧，视觉上追求"逼真"但不冒充真实好友聊天记录（内容为虚构、可加轻量AI生成标识），支持用户自行上传截图替换/补充素材。
3. **歌词改编与AI音乐生成**：将对话内容改编为歌词，支持嘻哈/说唱/随机等多种风格（风格可扩展），调用AI音乐生成能力产出带人声的完整歌曲。
4. **文字MV自动合成**：将聊天气泡截图按歌词/歌曲时间轴逐句同步展示，合成为一段完整的"聊天记录风"MV短视频。
5. **异步任务与通知**：整条生成链路（文案→截图→歌词→音乐→视频渲染）耗时较长，采用后台异步任务模式，用户提交后可离开，通过订阅消息通知 + "我的作品"列表查看结果。
6. **导出与广告**：在视频导出/下载环节展示生成进度条，并插入一次激励视频广告，作为变现点。
7. **"我的作品"管理**：以列表形式保存历史生成的MV，可重新观看、下载、分享。

## 视觉与体验

- 整体风格贴近"潮流嘻哈+网络热梗"的活力感，深色背景配合霓虹渐变高亮色，卡片式布局，带轻微动效反馈。
- 对话预览环节需还原"微信聊天"的视觉质感（气泡样式、头像、昵称、时间戳），但整体产品定位为"虚构娱乐创作工具"，避免误导为真实聊天记录截图。
- 生成过程通过阶段化进度条+趣味文案（如"AI正在编绿茶剧本…""正在压混音乐…"）增强等待体验的趣味性。

## 范围说明（MVP）

本阶段聚焦打通"AI文案 → 聊天气泡截图 → 歌词改编 → AI音乐 → 视频合成 → 导出"完整链路，仅支持单一/双人对话、单一或少量预置风格模板；群聊多人对话、语音条/红包等复杂气泡样式、更多风格模板、广告分成等作为后续迭代方向。

## 技术栈选型

- **小程序前端**：微信原生小程序（WXML/WXSS/JS，TypeScript 可选）+ **TDesign Miniprogram** 组件库，保证生成/播放等交互组件的开箱即用与视觉一致性。
- **云端服务**：腾讯云开发 **CloudBase**（云函数 + 云数据库 + 云存储）承载编排逻辑与短耗时任务；**云托管（Cloud Run 容器）** 承载 Remotion 视频渲染（需要完整 Node.js + Headless Chromium 环境，超出云函数执行时长/环境限制）。
- **AI 能力**：LLM 文案/歌词生成、AI 音乐生成、聊天截图渲染均设计为**可插拔 Provider 接口**，不硬编码具体厂商，待用户提供 API Key 及 GitHub 聊天截图项目链接后接入具体实现。
- **视频合成**：Remotion（React + Node.js 渲染管线），运行于云托管服务内，输出 MP4 上传至云存储。

## 实现思路

采用"小程序前端做交互与展示，云端做重活"的经典离线任务模式：小程序发起任务请求 → 云函数创建任务记录并串联各阶段云函数（文案→截图→歌词→音乐）→ 音乐产出后触发云托管 Remotion 渲染服务合成 MV → 完成后写回云存储地址并推送订阅消息通知。所有第三方 AI 能力（大模型、音乐生成、聊天截图渲染）均通过统一 Provider 接口调用，具体实现待补充。

关键决策：

- **异步任务 + 状态机**：任务耗时数分钟，采用 `任务状态字段 + 云数据库 tasks 集合` 记录进度（pending → generating_dialogue → generating_screenshots → generating_lyrics → generating_music → rendering_video → completed/failed），前端轮询/订阅消息双通道获知结果，避免小程序页面长时间阻塞等待。
- **Remotion 渲染放云托管而非云函数**：因云函数有执行时长与内存限制，且 Remotion 渲染依赖 Headless Chromium，云托管容器更适合长耗时、重资源渲染任务。
- **聊天截图渲染先做默认实现再对齐开源项目**：由于用户提供的 GitHub 项目细节待补充，先实现一个基于服务端 Node Canvas（或小程序端 Canvas 2D 离屏绘制后上传）的默认气泡渲染 Provider，跑通 MVP 链路；后续拿到开源项目后可平替该 Provider 的具体实现，不影响上层任务编排逻辑。
- **音乐生成异步轮询封装**：AI 音乐生成通常本身是异步任务（提交歌词→轮询/回调拿结果），在 MusicProvider 接口中统一封装"提交任务、查询状态、获取结果"三段式方法，屏蔽具体厂商差异。
- **内容合规设计**：对话内容与气泡截图均为独立生成帧、非真实截图导出，预留"AI生成/虚构娱乐"水印位；用户可自定义头像昵称，降低影射真实个人的风险。

## 性能与可靠性

- 各阶段云函数职责单一、幂等，失败可基于 `taskId` 重试对应阶段而非从头重来。
- Remotion 渲染是主要耗时与资源瓶颈（预计单个 MV 渲染耗时与素材数量、视频时长正相关），云托管需支持按任务排队/并发限流，避免资源耗尽；渲染产物统一走云存储 CDN 分发，减轻回源压力。
- 音乐生成、大模型调用为外部网络依赖，需设置合理超时与重试次数，失败态需在任务记录中明确 errorStage/errorMsg，便于前端展示具体失败环节。

## 目录结构

```
茶言茶曲/
├── miniprogram/                        # 微信小程序前端源码
│   ├── pages/
│   │   ├── home/                       # [NEW] 首页：热门案例展示 + 创建入口
│   │   ├── create/                     # [NEW] 创作页：输入主题、选择对话/音乐风格
│   │   ├── dialogue-preview/           # [NEW] 对话预览编辑页：查看/编辑AI生成的聊天气泡，确认后提交生成任务
│   │   ├── task-progress/              # [NEW] 生成进度页：轮询任务状态，展示阶段化进度动画
│   │   └── my-works/                   # [NEW] 我的作品页：作品列表 + 详情播放/导出（含激励视频广告位）
│   ├── components/
│   │   └── chat-bubble-preview/        # [NEW] 聊天气泡预览组件，复用于对话预览页与作品详情缩略展示
│   ├── utils/
│   │   ├── api.ts                      # [NEW] 封装云函数调用（createTask/getTaskStatus/getWorks等）
│   │   └── task-polling.ts             # [NEW] 任务状态轮询与订阅消息授权逻辑
│   └── app.json / app.ts               # [MODIFY] 小程序全局配置、页面路由与订阅消息权限声明
├── cloudfunctions/                     # CloudBase 云函数（任务编排与AI调用）
│   ├── createTask/                     # [NEW] 创建任务记录，写入tasks集合，触发文案生成
│   ├── generateDialogue/               # [NEW] 调用LLMProvider生成对话文案，更新任务状态
│   ├── renderChatScreenshots/          # [NEW] 仅做结构化数据转换（补全type/params，解析表情包fileID），不做视觉渲染；真正气泡渲染在Remotion阶段实现
│   ├── generateLyrics/                 # [NEW] 调用LLMProvider将对话改编为指定风格歌词
│   ├── generateMusic/                  # [NEW] 调用MusicProvider提交歌词生成任务并轮询/回调获取歌曲结果
│   ├── notifyAndFinalize/              # [NEW] 渲染完成后更新works集合、发送订阅消息通知
│   └── getWorksList/                   # [NEW] 查询用户"我的作品"列表与任务状态
├── providers/                           # [NEW] 可插拔Provider抽象层（云函数公共层，供上述云函数引用）
│   ├── llm/index.ts                    # [NEW] LLMProvider接口定义 + 占位实现，待接入用户提供的大模型API
│   ├── music/index.ts                  # [NEW] MusicProvider接口定义（submit/poll/getResult）+ 占位实现
│   └── screenshot/index.ts             # [NEW] ScreenshotProvider接口定义 + 默认Node Canvas气泡渲染实现，待后续替换为用户GitHub项目逻辑
├── cloud-run-remotion/                 # [NEW] 云托管服务：Remotion视频合成
│   ├── src/
│   │   ├── remotion/
│   │   │   ├── Composition.tsx         # [NEW] Remotion合成组件：按气泡帧+歌词时间轴逐句展示，同步歌曲进度
│   │   │   └── timeline.ts             # [NEW] 时间轴计算：气泡出现时机与歌词行时间对齐逻辑
│   │   └── server.ts                   # [NEW] 接收渲染任务请求，触发render，产物上传云存储，回调更新任务状态
│   └── package.json                    # [NEW] Remotion与依赖声明
└── database/
    └── collections.md                  # [NEW] 云数据库集合结构说明：tasks（任务状态机）、works（作品记录）
```

## 关键数据结构

```typescript
// 任务状态模型（tasks 集合核心字段）
interface GenerationTask {
  taskId: string;
  userId: string;
  status: 'pending' | 'generating_dialogue' | 'generating_screenshots'
        | 'generating_lyrics' | 'generating_music' | 'rendering_video'
        | 'completed' | 'failed';
  style: { dialogueTone: string; musicGenre: string }; // 如"绿茶"、"嘻哈"
  progress: number;                 // 0-100，用于前端进度条
  errorStage?: string;
  resultVideoUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// Provider 可插拔接口（供后续接入具体厂商/开源项目实现）
interface MusicProvider {
  submit(lyrics: string, genre: string): Promise<{ providerTaskId: string }>;
  pollStatus(providerTaskId: string): Promise<'processing' | 'succeeded' | 'failed'>;
  getResult(providerTaskId: string): Promise<{ audioUrl: string; duration: number }>;
}
```

## 扩展方向（非MVP，后续迭代）

- 群聊多人对话、语音条等复杂气泡样式模板（红包/转账/表情包/时间分隔条已纳入MVP范围）
- 表情包图库的用户上传与管理（MVP阶段为固定占位列表，硬编码在stickers配置中）
- dialogue-preview页"插入/改类型"的交互UI（本轮仅打通数据结构与渲染，交互UI留待下一轮）
- 更多歌词风格模板与音乐风格随机化
- 广告分成、会员/付费导出等商业化细节

## 设计说明

整体定位"潮流恶搞+网络热梗"创作工具，视觉上区别于严肃聊天软件的克制感，采用深色底 + 霓虹渐变高亮的活力风格，营造"这段内容很炸裂/很好玩"的第一印象。聊天气泡预览环节适度还原微信气泡质感（保证辨识度），但通过整体界面的潮流色彩与趣味文案强化"虚构娱乐创作"定位。核心5页构成闭环：首页（案例广场激发创作欲）→ 创作页（输入主题与风格）→ 对话预览编辑页（确认气泡内容）→ 生成进度页（异步等待反馈）→ 我的作品页（结果查看/导出/广告）。

### 页面与模块划分

1. **首页**：顶部导航栏 + 热门案例横向卡片流（展示"绿茶吵架变说唱"等示范MV封面，点击可预览）+ 悬浮"开始创作"按钮 + 底部Tab导航。
2. **创作页**：主题输入框（趣味Placeholder引导）+ 对话风格标签选择（绿茶/搞笑/毒舌等Chip组件）+ 音乐风格标签选择（嘻哈/R&B/随机等）+ 生成按钮。
3. **对话预览编辑页**：聊天气泡预览列表（可点击单条编辑文本/切换头像昵称）+ 底部"重新生成"与"确认生成MV"按钮。
4. **生成进度页**：分阶段进度条（文案→截图→歌词→音乐→合成）+ 趣味等待文案轮播 + "允许通知我"订阅按钮 + 可退出提示。
5. **我的作品页**：作品卡片列表（封面缩略图+标题+时长）+ 点击进入详情播放页（视频播放器+下载/分享按钮，下载前触发激励视频广告）。