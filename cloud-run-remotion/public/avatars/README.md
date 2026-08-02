# 默认头像素材目录

请在这里放置与 `miniprogram/images/avatars/` **同名** 的头像图片（用于最终渲染的 MV 视频），
文件名固定为：

```
public/avatars/
  male-1.png   male-2.png   male-3.png   male-4.png
  female-1.png female-2.png female-3.png female-4.png
```

- 建议正方形、≥200×200px，会被裁成圆形显示。
- 分配逻辑（由 `cloudfunctions/generateDialogue/avatarAssign.js` 决定）：同一段对话里，
  每个说话人昵称第一次出现时会稳定分配到某个 `male-*`/`female-*`，全程保持一致。
- 如果某个文件缺失，`src/render.ts` 的 `resolveAvatars()` 会自动检测并回退成
  首字母色块头像，不会导致渲染报错，但视频里就看不到真实头像图片。
- 放好文件后需要重新构建并部署这个云托管服务才能生效。
