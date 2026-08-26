import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { PreviewRoot } from './PreviewRoot';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@remotion-components/wxTheme';
import { DEMO_PRESETS, FPS, DURATION_FRAMES, DURATION_SEC } from './mock/demoPresets';

const App: React.FC = () => {
  const playerRef = useRef<PlayerRef>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [presetIdx, setPresetIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [scrubFrame, setScrubFrame] = useState<number | null>(null);

  const current = DEMO_PRESETS[presetIdx] ?? DEMO_PRESETS[0];

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
    p.play();

    return () => {
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('frameupdate', onFrame);
    };
  }, [presetIdx]);

  const toggle = () => {
    const p = playerRef.current;
    if (!p) return;
    playing ? p.pause() : p.play();
  };

  const restart = () => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(0);
    p.play();
  };

  // ── 进度条拖拽 / 点击跳转 ──────────────────────
  const calcFrameFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const el = progressRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(ratio * DURATION_FRAMES);
  }, []);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
  }, [calcFrameFromEvent]);

  const switchPreset = (idx: number) => {
    setPresetIdx(idx);
    // 切预设后自动从头播
    const p = playerRef.current;
    if (p) {
      setTimeout(() => {
        p.seekTo(0);
        p.play();
      }, 0);
    }
  };

  const displayFrame = scrubFrame ?? frame;
  const seconds = (displayFrame / FPS).toFixed(1);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          言语生声 <span>动画预览</span>
        </h1>
        <div className="preset-picker">
          {DEMO_PRESETS.map((pre, i) => (
            <button
              key={pre.id}
              className={`preset-btn ${presetIdx === i ? 'active' : ''}`}
              onClick={() => switchPreset(i)}
              title={pre.desc}
            >
              {pre.label}
            </button>
          ))}
        </div>
      </header>

      <p className="preset-desc">{current.desc} — {current.genre}</p>

      <main className="stage">
        <div className="phone">
          <Player
            ref={playerRef}
            component={PreviewRoot}
            inputProps={{
              bubbles: current.bubbles,
              beats: current.beats,
              genre: current.genre,
            }}
            durationInFrames={DURATION_FRAMES}
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
        <button onClick={toggle} title={playing ? '暂停' : '播放'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="progress" ref={progressRef} onMouseDown={handleProgressMouseDown}>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${((displayFrame / DURATION_FRAMES) * 100).toFixed(2)}%` }}
            />
          </div>
        </div>
        <span className="timecode">
          {seconds}s / {DURATION_SEC}s · 帧 {displayFrame}
        </span>
      </footer>

      <p className="hint">
        修改 <code>cloud-run-remotion/src/remotion/animation-config.ts</code> 后热更新
      </p>
    </div>
  );
};

export default App;
