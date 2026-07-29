/**
 * 任务状态轮询工具
 * 用于生成进度页轮询 tasks 集合状态，直到 completed/failed 或调用 stop()
 */

const DEFAULT_INTERVAL = 2000;

function startPolling({ fetcher, onUpdate, onError, interval = DEFAULT_INTERVAL }) {
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const task = await fetcher();
      if (stopped) return;
      onUpdate && onUpdate(task);
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        stop();
        return;
      }
    } catch (e) {
      onError && onError(e);
    }
    if (!stopped) {
      timer = setTimeout(tick, interval);
    }
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  tick();

  return { stop };
}

module.exports = { startPolling };
