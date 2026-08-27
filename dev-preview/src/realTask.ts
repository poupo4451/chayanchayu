/**
 * 真实 task 加载：把云端历史任务变成可在浏览器里逐帧调试的预览输入。
 *
 * 【设计要点】
 * 云托管 /fixture/:taskId 只做浏览器做不到的事（读库、cloud:// 换临时 URL、
 * 校验头像素材），**时间轴计算完全在本地跑**，调用的是与云端 render.ts
 * 同一个 buildRenderInputs。所以：
 *   - 改 lyricsAlign / ChatMVComposition / animation-config → 刷新即可验证
 *   - 数据是真实的（真实句数、真实词级时间戳、真实前奏长度、真实音频）
 *   - 不需要维护会过期的 fixture 文件
 */
import { buildRenderInputs, RENDER_FPS } from '@render-src/buildRenderInputs';
import type { RenderAlignReport } from '@render-src/buildRenderInputs';
import type { BubbleData } from '@remotion-components/ChatBubble';
import type { LineMapEntry, LyricLine, LyricWord } from '@render-src/lyricsAlign';

/** 云托管渲染服务地址；可用 VITE_RENDER_HOST 覆盖 */
export const RENDER_HOST =
  import.meta.env.VITE_RENDER_HOST
  || 'https://chat-mv-remotion-290686-7-1462201626.sh.run.tcloudbase.com';

export interface TaskFixture {
  taskId: string;
  topic: string;
  screenshots: BubbleData[];
  audioUrl: string;
  audioDuration: number;
  lyrics: string;
  lyricsLineMap: LineMapEntry[];
  lyricsTimeline: LyricLine[];
  lyricsWords: LyricWord[];
  style: { dialogueTone?: string; musicGenre?: string; vocalMode?: string };
}

export interface TaskListItem {
  _id: string;
  topic?: string;
  audioDuration?: number;
  createdAt?: number;
  style?: { musicGenre?: string; dialogueTone?: string; vocalMode?: string };
  renderAlignReport?: { maxStaticGapS?: number; strategy?: string; bubbleInstances?: number };
}

/** 拉取最近已完成任务列表 */
export async function fetchTaskList(): Promise<TaskListItem[]> {
  const r = await fetch(`${RENDER_HOST}/fixture-list`);
  if (!r.ok) throw new Error(`fixture-list HTTP ${r.status}`);
  const j = (await r.json()) as { ok: boolean; tasks?: TaskListItem[]; error?: string };
  if (!j.ok) throw new Error(j.error || 'fixture-list failed');
  return j.tasks ?? [];
}

/** 拉取单条 task 的原始夹具数据 */
export async function fetchTaskFixture(taskId: string): Promise<TaskFixture> {
  const r = await fetch(`${RENDER_HOST}/fixture/${encodeURIComponent(taskId)}`);
  if (!r.ok) throw new Error(`fixture HTTP ${r.status}`);
  const j = (await r.json()) as { ok: boolean; fixture?: TaskFixture; error?: string };
  if (!j.ok || !j.fixture) throw new Error(j.error || 'fixture failed');
  return j.fixture;
}

export interface RealPreset {
  id: string;
  label: string;
  bubbles: BubbleData[];
  beats: number[];
  genre: string;
  audioPath: string;
  audioDuration: number;
  audioTrimBefore: number;
  audioFadeInFrames: number;
  audioFadeOutFrames: number;
  durationFrames: number;
  report: RenderAlignReport;
  /** 诊断日志，便于在 UI 上展开查看对齐决策过程 */
  logs: string[];
}

/**
 * 把夹具喂进与云端相同的 buildRenderInputs，产出可直接交给 Player 的预设。
 * durationFrames 用返回的 durationInFrames，与 Root.tsx calculateMetadata 一致。
 */
export function fixtureToPreset(fx: TaskFixture): RealPreset {
  const logs: string[] = [];
  const built = buildRenderInputs({
    task: {
      lyrics: fx.lyrics,
      lyricsLineMap: fx.lyricsLineMap,
      lyricsTimeline: fx.lyricsTimeline,
      lyricsWords: fx.lyricsWords,
      style: fx.style,
    },
    // 深拷贝：buildRenderInputs 会就地改 startFrame，避免重复加载时被污染
    bubbles: JSON.parse(JSON.stringify(fx.screenshots)) as BubbleData[],
    audioDuration: fx.audioDuration,
    audioPath: fx.audioUrl,
    fps: RENDER_FPS,
    log: (m) => logs.push(m),
  });

  const p = built.inputProps;
  return {
    id: fx.taskId,
    label: `${fx.topic || fx.taskId.slice(0, 8)}（${fx.style.musicGenre || '?'}）`,
    bubbles: p.bubbles,
    beats: p.beats,
    genre: p.genre,
    audioPath: p.audioPath,
    audioDuration: p.audioDuration,
    audioTrimBefore: p.audioTrimBefore,
    audioFadeInFrames: p.audioFadeInFrames,
    audioFadeOutFrames: p.audioFadeOutFrames,
    durationFrames: built.durationInFrames,
    report: built.report,
    logs,
  };
}
