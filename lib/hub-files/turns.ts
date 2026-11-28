/**
 * A small queue for heavy work (the image previews, lib/hub-files/preview-server.ts): at most `max` jobs at a time, the
 * others wait without starting anything; a job that waited longer than `maxWaitMs` gets "busy" and never runs. When a job
 * ends it hands its place straight to the next one. No imports, so the tests run it directly.
 */
export function createTurns(max: number, maxWaitMs: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function inTurn<T>(work: () => Promise<T>): Promise<T | "busy"> {
    if (running < max) running++;
    else {
      const ready = await new Promise<boolean>((resolve) => {
        const turn = () => { clearTimeout(timer); resolve(true); };
        const timer = setTimeout(() => {
          const index = waiting.indexOf(turn);
          if (index >= 0) waiting.splice(index, 1);
          resolve(false);
        }, maxWaitMs);
        waiting.push(turn);
      });
      // Waited too long; otherwise the job that ended handed its place over, so `running` stays as it is.
      if (!ready) return "busy";
    }
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next(); else running--;
    }
  };
}
