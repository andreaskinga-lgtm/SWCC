import { useEffect, useState } from 'react';
import type { Result } from '../shared/application.js';

export interface ProgressMonitor {
  error: string | null;
  retry: () => void;
}
export function useProgressMonitor<T>(
  running: boolean, read: () => Promise<Result<T>>, update: (progress: T) => void,
): ProgressMonitor {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!running) return;
    let active = true;
    let failed = false;
    let reading = false;
    const poll = async () => {
      if (failed || reading) return;
      reading = true;
      try {
        const result = await read();
        if (!active) return;
        if (!result.ok) throw new Error(result.error.message);
        update(result.value);
        setError(null);
      } catch (failure) {
        if (active) {
          failed = true;
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      } finally { reading = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 150);
    return () => { active = false; clearInterval(timer); };
  }, [running, read, update, attempt]);
  return { error: running ? error : null, retry: () => setAttempt(value => value + 1) };
}

export function ProgressFailure({ monitor, label }: { monitor: ProgressMonitor; label: string }) {
  return monitor.error && <section className="goal-validation" role="alert">
    <p>Progress is unavailable: {monitor.error}</p>
    <p>The operation may still be running. Retry monitoring without starting another operation, or wait for its final result.</p>
    <button type="button" className="secondary" onClick={monitor.retry}>Retry {label} progress</button>
  </section>;
}
