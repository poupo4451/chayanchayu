import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import * as tcb from '@cloudbase/node-sdk';
import { BubbleData } from './remotion/ChatBubble';

const ENV_ID = process.env.TCB_ENV_ID || 'chayanchayu-d4g0fpnxq738c7662';
const BROWSER_EXECUTABLE = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;

// 云托管环境的 @cloudbase/node-sdk 调用云数据库需要显式传入腾讯云 API 凭证
// （云函数会自动注入，云托管不会）。凭证通过环境变量配置，避免硬编码。
const tcbInitConfig: { env: string; secretId?: string; secretKey?: string } = {
  env: ENV_ID,
};
if (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY) {
  tcbInitConfig.secretId = process.env.TENCENTCLOUD_SECRETID;
  tcbInitConfig.secretKey = process.env.TENCENTCLOUD_SECRETKEY;
}

const app = tcb.init(tcbInitConfig as never);
const db = app.database();

const ENTRY_POINT = path.resolve(process.cwd(), 'src/remotion/index.ts');
const OUTPUT_PATH = '/tmp/chat-mv-output.mp4';
const AUDIO_PATH = '/tmp/chat-mv-audio.mp3';

let cachedBundleLocation: string | null = null;

interface TaskData {
  screenshots: BubbleData[];
  audioUrl: string;
  audioDuration: number;
  userId: string;
  topic: string;
  style: { dialogueTone: string; musicGenre: string };
}

async function getBundleLocation(): Promise<string> {
  if (cachedBundleLocation) return cachedBundleLocation;
  console.log('bundling remotion project...');
  cachedBundleLocation = await bundle({ entryPoint: ENTRY_POINT });
  console.log('bundle complete:', cachedBundleLocation);
  return cachedBundleLocation;
}

async function downloadAudio(audioUrl: string): Promise<string | null> {
  try {
    if (audioUrl.startsWith('cloud://')) {
      const result = await app.downloadFile({ fileID: audioUrl });
      const content = (result as { fileContent: Buffer }).fileContent;
      fs.writeFileSync(AUDIO_PATH, content);
      return AUDIO_PATH;
    }
    if (audioUrl.startsWith('http')) {
      const response = await axios.get(audioUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      fs.writeFileSync(AUDIO_PATH, response.data);
      return AUDIO_PATH;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('audio download failed, rendering without audio:', msg);
  }
  return null;
}

async function resolveStickerUrls(bubbles: BubbleData[]): Promise<void> {
  const cloudFileIds = bubbles
    .filter((b) => b.type === 'image' && b.params.imageUrl?.startsWith('cloud://'))
    .map((b) => b.params.imageUrl as string);

  if (cloudFileIds.length === 0) return;

  try {
    const result = await app.getTempFileURL({ fileList: cloudFileIds });
    const fileList = (result as { fileList: Array<{ fileID: string; tempFileURL: string }> }).fileList;
    const urlMap = new Map(fileList.map((f) => [f.fileID, f.tempFileURL]));

    for (const b of bubbles) {
      if (b.type === 'image' && b.params.imageUrl && urlMap.has(b.params.imageUrl)) {
        b.params.imageUrl = urlMap.get(b.params.imageUrl);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('getTempFileURL failed for stickers:', msg);
  }
}

async function uploadVideo(filePath: string, taskId: string): Promise<string> {
  const fileContent = fs.readFileSync(filePath);
  const result = await app.uploadFile({
    cloudPath: `mv/${taskId}.mp4`,
    fileContent,
  });
  return (result as { fileID: string }).fileID;
}

export async function renderTask(taskId: string): Promise<void> {
  console.log(`starting render for task ${taskId}`);

  try {
    await db.collection('tasks').doc(taskId).update({
      data: { progress: 80, updatedAt: Date.now() },
    });

    const taskRes = await db.collection('tasks').doc(taskId).get();
    const task = taskRes.data as TaskData;

    if (!task) throw new Error('task not found');

    const bubbles: BubbleData[] = task.screenshots || [];
    const audioUrl: string = task.audioUrl || '';
    const audioDuration: number = task.audioDuration || 30;

    if (bubbles.length === 0) {
      throw new Error('no screenshots data found');
    }

    await resolveStickerUrls(bubbles);

    const audioPath = audioUrl ? await downloadAudio(audioUrl) : null;

    const serveUrl = await getBundleLocation();

    const inputProps = {
      bubbles,
      audioPath: audioPath || '',
      audioDuration,
    };

    const composition = await selectComposition({
      serveUrl,
      id: 'chat-mv',
      inputProps,
    });

    console.log(`rendering ${composition.durationInFrames} frames at 30fps...`);
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: OUTPUT_PATH,
      ...(BROWSER_EXECUTABLE ? { browserExecutable: BROWSER_EXECUTABLE } : {}),
    });

    const fileId = await uploadVideo(OUTPUT_PATH, taskId);
    console.log(`uploaded to ${fileId}`);

    await db.collection('tasks').doc(taskId).update({
      data: {
        resultVideoUrl: fileId,
        status: 'completed',
        progress: 100,
        updatedAt: Date.now(),
      },
    });

    await db.collection('works').add({
      data: {
        taskId,
        userId: task.userId,
        title: task.topic,
        videoUrl: fileId,
        duration: audioDuration,
        style: task.style,
        createdAt: Date.now(),
      },
    });

    console.log(`render complete for task ${taskId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`render failed for task ${taskId}:`, msg);
    try {
      await db.collection('tasks').doc(taskId).update({
        data: {
          status: 'failed',
          errorStage: 'rendering_video',
          errorMsg: msg,
          updatedAt: Date.now(),
        },
      });
    } catch (updateErr) {
      console.error('failed to update task error status:', updateErr);
    }
  } finally {
    try {
      if (fs.existsSync(OUTPUT_PATH)) fs.unlinkSync(OUTPUT_PATH);
      if (fs.existsSync(AUDIO_PATH)) fs.unlinkSync(AUDIO_PATH);
    } catch {
      // ignore cleanup errors
    }
  }
}
