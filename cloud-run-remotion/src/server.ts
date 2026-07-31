import express from 'express';
import { renderTask, debugRenderSteps, getTaskVideoUrl } from './render';
import * as tcb from '@cloudbase/node-sdk';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chat-mv-remotion' });
});

// 诊断端点（同步）：只返回环境变量清单，完全不碰数据库，保证一定能返回
app.get('/debug-env', (_req, res) => {
  const envId = process.env.TCB_ENV_ID || 'chayan-d1gwl5uub1e0e9d0b';
  const envKeys = Object.keys(process.env).filter(
    (k) => k.startsWith('TENCENTCLOUD') || k.startsWith('TCB') || k.startsWith('CLOUDBASE') || k.startsWith('SCF_'),
  );
  res.json({
    envId,
    hasSecretId: !!process.env.TENCENTCLOUD_SECRETID,
    hasSecretKey: !!process.env.TENCENTCLOUD_SECRETKEY,
    hasSessionToken: !!process.env.TENCENTCLOUD_SESSIONTOKEN,
    envKeys,
  });
});

// 诊断端点：验证云托管实例能否访问 CloudBase 数据库
app.get('/debug-db', async (_req, res) => {
  const envId = process.env.TCB_ENV_ID || 'chayan-d1gwl5uub1e0e9d0b';
  let responded = false;
  const guard = setTimeout(() => {
    if (!responded) {
      responded = true;
      res.status(504).json({ ok: false, error: 'HANDLER_TIMEOUT_3s (db request hung)' });
    }
  }, 3000);
  try {
    const diagApp = tcb.init({ env: envId } as never);
    const r = (await diagApp.database().collection('tasks').limit(1).get()) as { data?: unknown[] };
    if (!responded) {
      responded = true;
      clearTimeout(guard);
      res.json({ ok: true, count: r.data?.length ?? 0 });
    }
  } catch (e) {
    if (!responded) {
      responded = true;
      clearTimeout(guard);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

// 诊断端点：同步执行渲染前置各步骤，逐步返回结果/错误（不依赖CLS日志）
app.get('/debug-render/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  try {
    const steps = await debugRenderSteps(taskId);
    res.json({ ok: true, steps });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 用容器内 SDK 生成有效签名的视频临时下载链接（按 taskId 读库拿 fileID）
app.get('/temp-url/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const result = await getTaskVideoUrl(taskId);
    if (!result) {
      res.status(404).json({ ok: false, error: 'no resultVideoUrl for this task' });
      return;
    }
    res.json({ ok: true, taskId, fileId: result.fileId, url: result.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
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
