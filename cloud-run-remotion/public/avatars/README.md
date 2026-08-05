# 聊天头像素材目录

此目录必须与 `miniprogram/images/avatars/` 保持**同名、同内容**，用于最终 MV 渲染。
当前角色化头像：

```
public/avatars/
  male-rich-heir.png  male-playboy.png  male-underdog.png  male-ordinary.png
  female-green-tea-1.png  female-green-tea-2.png  female-playgirl.png  female-underdog.png
```

- 资源为 240×240 PNG；显示时以 `cover` 裁切为圆角矩形，圆角恒为头像边长的 0.2 倍。
- `cloudfunctions/generateDialogue/avatarAssign.js` 会先判断性别，再依据该说话人的对话内容匹配视觉角色；没有明显特征时，使用昵称哈希稳定选择。
- `male-1..4.png` 与 `female-1..4.png` 仅保留为历史任务兼容别名，不能作为新逻辑的目标 ID。
- 文件缺失时，`src/render.ts` 会回退成首字母色块，避免渲染失败。
- 更新本目录后必须重新部署 `chat-mv-remotion` 云托管服务。
