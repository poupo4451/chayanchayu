import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { PreviewRoot } from './PreviewRoot';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@remotion-components/wxTheme';
import { DEMO_PRESETS, FPS, DURATION_FRAMES } from './mock/demoPresets';
import {
  fetchTaskList,
  fetchTaskFixture,
  fixtureToPreset,
  type RealPreset,
  type TaskListItem,
} from './realTask';

/** 统一后的预设形态：mock 预设与真实 task 预设都归一到这个结构 */
interface UnifiedPreset {
  id: string;
  label: string;
  desc: string;
  genre: string;
  bubbles: RealPreset['bubbles'];
  beats: number[];
  durationFrames: number;
  audioPath?: string;
  audioDuration?: number;
  audioTrimBefore?: number;
  audioFadeInFrames?: number;
  audioFadeOutFrames?: number;
  report?: RealPreset['report'];
  logs?: string[];
  real: boolean;
}

const mockToUnified = (p: (typeof DEMO_PRESETS)[number]): UnifiedPreset => ({
  id: p.id,
  label: p.label,
  desc: p.desc,
  genre: p.genre,
  bubbles: p.bubbles,
  beats: p.beats,
  durationFrames: DURATION_FRAMES,
  real: false,
});

const App: React.FC = () => {
  const playerRef = useRef<PlayerRef>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [scrubFrame, setScrubFrame] = useState<number | null>(null);

  // ── 预设来源：mock 快速迭代档 / 真实 task 仿真档 ──────────────
  const [mode, setMode] = useState<'mock' | 'real'>('mock');
  const [mockIdx, setMockIdx] = useState(0);
  const [taskList, setTaskList] = useState<TaskListItem[]>([]);
  const [realPreset, setRealPreset] = useState<RealPreset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [taskIdInput, setTaskIdInput] = useState('');

  const current: UnifiedPreset = useMemo(() => {
    if (mode === 'real' && realPreset) {
      return {
        id: realPreset.id,
        label: realPreset.label,
        desc: `真实 task ${realPreset.id.slice(0, 8)}`,
        genre: realPreset.genre,
        bubbles: realPreset.bubbles,
        beats: realPreset.beats,
        durationFrames: realPreset.durationFrames,
        audioPath: realPreset.audioPath,
        audioDuration: realPreset.audioDuration,
        audioTrimBefore: realPreset.audioTrimBefore,
        audioFadeInFrames: realPreset.audioFadeInFrames,
        audioFadeOutFrames: realPreset.audioFadeOutFrames,
        report: realPreset.report,
        logs: realPreset.logs,
        real: true,
      };
    }
    return mockToUnified(DEMO_PRESETS[mockIdx] ?? DEMO_PRESETS[0]);
  }, [mode, realPreset, mockIdx]);

  const totalFrames = current.durationFrames;

  // 首次进入真实档时拉取任务列表
  useEffect(() => {
    if (mode !== 'real' || taskList.length > 0) return;
    setLoading(true);
    setError(null);
    fetchTaskList()
      .then((list) => setTaskList(list))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [mode, taskList.length]);

  const loadTask = useCallback(async (taskId: string) => {
    setLoading(true);
    setError(null);
    try {
      const fx = await fetchTaskFixture(taskId);
      const preset = fixtureToPreset(fx);
      setRealPreset(preset);
      setMode('real');
      setTimeout(() => {
        playerRef.current?.seekTo(0);
        playerRef.current?.play();
      }, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 订阅播放器事件
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);

    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('frameupdate', onFrame);

    return () => {
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('frameupdate', onFrame);
    };
  }, [current.id]);

  const toggle = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pause();
    else p.play();
  };

  const restart = () => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(0);
    p.play();
  };

  const step = (delta: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.pause();
    const next = Math.max(0, Math.min(totalFrames - 1, (scrubFrame ?? frame) + delta));
    p.seekTo(next);
    setFrame(next);
  };

  // ── 进度条拖拽 / 点击跳转 ──────────────────────
  const calcFrameFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const el = progressRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return Math.round(ratio * totalFrames);
    },
    [totalFrames],
  );

  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const targetFrame = calcFrameFromEvent(e);
      setScrubFrame(targetFrame);
      playerRef.current?.seekTo(targetFrame);

      const onMove = (ev: MouseEvent) => {
        const f = calcFrameFromEvent(ev);
        setScrubFrame(f);
        playerRef.current?.seekTo(f);
      };
      const onUp = () => {
        setScrubFrame(null);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [calcFrameFromEvent],
  );

  const switchMock = (idx: number) => {
    setMockIdx(idx);
    setMode('mock');
    setTimeout(() => {
      playerRef.current?.seekTo(0);
      playerRef.current?.play();
    }, 0);
  };

  const displayFrame = scrubFrame ?? frame;
  const seconds = (displayFrame / FPS).toFixed(1);
  const totalSeconds = (totalFrames / FPS).toFixed(1);
  const rpt = current.report;

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          言语生声 <span>动画预览</span>
        </h1>
        <div className="mode-switch">
          <button
            className={`preset-btn ${mode === 'mock' ? 'active' : ''}`}
            onClick={() => switchMock(mockIdx)}
            title="30 秒构造数据，调单个动画变体用，迭代快"
          >
            快速迭代
          </button>
          <button
            className={`preset-btn ${mode === 'real' ? 'active' : ''}`}
            onClick={() => setMode('real')}
            title="真实历史任务：真实句数 / 真实词级时间戳 / 真实音频，与云端成片一致"
          >
            真实仿真
          </button>
        </div>
      </header>

      {mode === 'mock' ? (
        <div className="preset-picker">
          {DEMO_PRESETS.map((pre, i) => (
            <button
              key={pre.id}
              className={`preset-btn ${mockIdx === i && mode === 'mock' ? 'active' : ''}`}
              onClick={() => switchMock(i)}
              title={pre.desc}
            >
              {pre.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="real-picker">
          <div className="real-row">
            <input
              className="task-input"
              placeholder="粘贴 taskId 直接加载"
              value={taskIdInput}
              onChange={(e) => setTaskIdInput(e.target.value.trim())}
            />
            <button
              className="preset-btn"
              disabled={!taskIdInput || loading}
              onClick={() => loadTask(taskIdInput)}
            >
              加载
            </button>
          </div>
          <select
            className="task-select"
            value={realPreset?.id ?? ''}
            onChange={(e) => e.target.value && loadTask(e.target.value)}
          >
            <option value="">
              {loading ? '加载中…' : `选择历史任务（${taskList.length}）`}
            </option>
            {taskList.map((t) => {
              const gap = t.renderAlignReport?.maxStaticGapS;
              return (
                <option key={t._id} value={t._id}>
                  {t.topic || t._id.slice(0, 8)} · {t.style?.musicGenre || '?'} ·{' '}
                  {Math.round(t.audioDuration ?? 0)}s
                  {gap != null ? ` · 静止${gap}s` : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {error && <p className="err">⚠️ {error}</p>}

      <p className="preset-desc">
        {current.desc} — {current.genre}
        {current.real && rpt && (
          <>
            {' '}
            · 策略 <b>{rpt.strategy}</b> · 气泡 {rpt.bubbleInstances}
            （重演 {rpt.repeatInstances ?? 0}）· 最长静止{' '}
            <b className={(rpt.maxStaticGapS ?? 0) > 6 ? 'bad' : 'good'}>
              {rpt.maxStaticGapS}s
            </b>{' '}
            · 裁前奏 {rpt.introTrimS}s · 成片 {rpt.finalFrames}帧
            <button className="diag-toggle" onClick={() => setShowDiag((v) => !v)}>
              {showDiag ? '收起日志' : '查看日志'}
            </button>
          </>
        )}
      </p>

      {showDiag && current.logs && (
        <pre className="diag-log">{current.logs.join('\n')}</pre>
      )}

      <main className="stage">
        <div className="phone">
          <Player
            key={current.id}
            ref={playerRef}
            component={PreviewRoot}
            inputProps={{
              bubbles: current.bubbles,
              beats: current.beats,
              genre: current.genre,
              audioPath: current.audioPath,
              audioDuration: current.audioDuration,
              audioTrimBefore: current.audioTrimBefore,
              audioFadeInFrames: current.audioFadeInFrames,
              audioFadeOutFrames: current.audioFadeOutFrames,
            }}
            durationInFrames={totalFrames}
            compositionWidth={CANVAS_WIDTH}
            compositionHeight={CANVAS_HEIGHT}
            fps={FPS}
            style={{ width: '100%', height: '100%' }}
            controls={false}
            loop
          />
        </div>
      </main>

      <footer className="playbar">
        <button onClick={restart} title="从头播放">
          ⏮
        </button>
        <button onClick={() => step(-1)} title="上一帧">
          ◀|
        </button>
        <button onClick={toggle} title={playing ? '暂停' : '播放'}>
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => step(1)} title="下一帧">
          |▶
        </button>
        <div className="progress" ref={progressRef} onMouseDown={handleProgressMouseDown}>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${((displayFrame / totalFrames) * 100).toFixed(2)}%` }}
            />
            {/* 气泡入场事件刻度：一眼看出哪里有长空档 */}
            {current.bubbles.map((b, i) => (
              <span
                key={b.uid ?? i}
                className="tick"
                style={{ left: `${(((b.startFrame ?? 0) / totalFrames) * 100).toFixed(2)}%` }}
              />
            ))}
          </div>
        </div>
        <span className="timecode">
          {seconds}s / {totalSeconds}s · 帧 {displayFrame}
        </span>
      </footer>

      <p className="hint">
        改 <code>animation-config.ts</code> / <code>lyricsAlign.ts</code> 后刷新页面（HMR 已关闭）
      </p>
    </div>
  );
};

export default App;
