import React, { useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { PreviewRoot } from './PreviewRoot';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@remotion-components/wxTheme';
import { demoBubbles, demoBeats, FPS, DURATION_FRAMES, DURATION_SEC } from './mock/demoBubbles';

/** 可切换的流派，影响气泡入场动画池（见 gsapMotion.GENRE_VARIANT_POOLS） */
const GENRES = ['嘻哈', '抖音风', '粤语说唱', '流行', 'R&B', '随机'] as const;

const App: React.FC = () => {
  const playerRef = useRef<PlayerRef>(null);
  const [genre, setGenre] = useState<string>('嘻哈');
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);

  // 订阅播放器事件，同步播放状态与当前帧
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);

    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('frameupdate', onFrame);

    //挂载后自动播放
    p.play();

    return () => {
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('frameupdate', onFrame);
    };
  }, []);

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

  const seconds = (frame / FPS).toFixed(1);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          茶言茶曲<span>动画预览</span>
        </h1>
        <div className="genre-picker">
          {GENRES.map((g) => (
            <button
              key={g}
              className={`genre-btn ${genre === g ? 'active' : ''}`}
              onClick={() => setGenre(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </header>

      <main className="stage">
        <div className="phone">
          <Player
            ref={playerRef}
            component={PreviewRoot}
            inputProps={{ bubbles: demoBubbles, beats: demoBeats, genre }}
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
        <div className="progress">
          <div
            className="progress-fill"
            style={{ width: `${((frame / DURATION_FRAMES) * 100).toFixed(2)}%` }}
          />
        </div>
        <span className="timecode">
          {seconds}s / {DURATION_SEC}s ·帧 {frame}
        </span>
      </footer>

      <p className="hint">
        修改 <code>cloud-run-remotion/src/remotion/animation-config.ts</code> 后此处自动热更新
      </p>
    </div>
  );
};

export default App;
