import express from 'express';
import { renderTask, debugRenderSteps, getTaskVideoUrl, getTaskFixture } from './render';
import * as tcb from '@cloudbase/node-sdk';
import {
  STAGE_SAFE_AREA_RATIO,
  NORMAL_PEAK_WIDTH_RATIO,
  HERO_PEAK_WIDTH_RATIO,
  BEAT_ATTACK_S,
} from './remotion/animation-config';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '2mb' }));

/**
 * 健康检查 + **代码版本探针**。
 *
 * 【为什么要回显动画参数】
 * CloudRun 的 `list` 命令只反映「服务」是否 normal，不反映「本次部署的镜像
 * 是否真的构建成功并接管了流量」—— 构建失败时服务会继续用旧镜像跑，
 * 状态照样是 normal，`/health` 也照样 200。仅凭这两个信号会误判部署成功。
 *
 * 这里回显几个刚改过的动画常量：只要它们等于新值，就证明线上运行的确实是
 * 新代码；如果还是旧值（或字段不存在），说明镜像没换。这是最轻量、
 * 不依赖构建日志的部署校验手段。
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'chat-mv-remotion',
    animationConfig: {
      stageSafeAreaRatio: STAGE_SAFE_AREA_RATIO,
      normalPeakWidthRatio: NORMAL_PEAK_WIDTH_RATIO,
      heroPeakWidthRatio: HERO_PEAK_WIDTH_RATIO,
      beatAttackS: BEAT_ATTACK_S,
    },
  });
});

/**
 * 导出真实 task 的预览夹具，供本地 dev-preview 复现渲染输入。
 *
 * 开放 CORS：dev-preview 跑在 localhost:3001，属于跨域读取。
 * 返回内容只是已完成任务的歌词与气泡文案（用户自己的创作素材），
 * 且必须显式知道 taskId 才能取到，不含凭证或他人隐私数据。
 */
app.get('/fixture/:taskId', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const { taskId } = req.params;
  try {
    const fixture = await getTaskFixture(taskId);
    if (!fixture) {
      res.status(404).json({ ok: false, error: 'task not found' });
      return;
    }
    res.json({ ok: true, fixture });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** 列出最近若干条已完成任务，方便 dev-preview 下拉选择 */
app.get('/fixture-list', async (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const envId = 'cloud1-d7ggdqfhgc4ee2796';
    const listApp = tcb.init({
      env: envId,
      ...(process.env.CLOUDBASE_APIKEY ? { accessKey: process.env.CLOUDBASE_APIKEY } : {}),
    } as never);
    const r = (await listApp
      .database()
      .collection('tasks')
      .where({ status: 'completed' })
      .field({
        _id: true,
        topic: true,
        audioDuration: true,
        style: true,
        createdAt: true,
        renderAlignReport: true,
      })
      .orderBy('createdAt', 'desc')
      .limit(40)
      .get()) as { data?: unknown[] };
    res.json({ ok: true, tasks: r.data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

// 诊断端点（同步）：只返回环境变量清单，完全不碰数据库，保证一定能返回
app.get('/debug-env', (_req, res) => {
  const envId = 'cloud1-d7ggdqfhgc4ee2796';
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
  const envId = 'cloud1-d7ggdqfhgc4ee2796';
  let responded = false;
  const guard = setTimeout(() => {
    if (!responded) {
      responded = true;
      res.status(504).json({ ok: false, error: 'HANDLER_TIMEOUT_3s (db request hung)' });
    }
  }, 3000);
  try {
    const diagApp = tcb.init({
      env: envId,
      ...(process.env.CLOUDBASE_APIKEY ? { accessKey: process.env.CLOUDBASE_APIKEY } : {}),
    } as never);
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
