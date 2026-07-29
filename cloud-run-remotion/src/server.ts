import express from 'express';
import { renderTask } from './render';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chat-mv-remotion' });
});

app.post('/render', (req, res) => {
  const { taskId } = req.body as { taskId?: string };
  if (!taskId) {
    res.status(400).json({ error: 'missing taskId' });
    return;
  }

  // 异步渲染，立即返回 202
  renderTask(taskId).catch((err) => {
    console.error(`uncaught render error for ${taskId}:`, err);
  });

  res.status(202).json({ message: 'rendering started', taskId });
});

app.listen(PORT, () => {
  console.log(`chat-mv-remotion server listening on port ${PORT}`);
});
