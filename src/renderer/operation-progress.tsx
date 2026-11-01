import { useEffect, useRef, useState } from 'react';
import type { Result } from '../shared/application.js';
import { useActionFeedback } from './action-feedback.js';

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
  const { showFeedback } = useActionFeedback();
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!monitor.error) {
      reported.current = null;
      return;
    }
    if (reported.current === monitor.error) return;
    reported.current = monitor.error;
    const operation = label[0].toUpperCase() + label.slice(1);
    showFeedback({
      title: `${operation} progress unavailable`,
      message: `Progress is unavailable: ${monitor.error} The operation may still be running. Retry monitoring without starting another operation, or wait for its final result.`,
      kind: 'error',
      action: { label: `Retry ${label} progress`, onClick: monitor.retry },
    });
  }, [label, monitor.error, monitor.retry, showFeedback]);
  return null;
}
