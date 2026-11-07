import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogBackdropDismiss } from './dialog-dismissal.js';
import './action-feedback.css';

export interface ActionFeedbackRequest {
  title: string;
  message: string;
  kind: 'success' | 'error' | 'info';
  reasons?: readonly string[];
  reasonsLabel?: string;
  action?: { label: string; onClick: () => void };
}

interface ActionFeedbackContextValue {
  showFeedback: (feedback: ActionFeedbackRequest) => void;
  successSequence: number;
}

const ActionFeedbackContext = createContext<ActionFeedbackContextValue | null>(null);

export function useActionFeedback() {
  const context = useContext(ActionFeedbackContext);
  if (!context) throw new Error('Action feedback must be used within its provider.');
  return context;
}

export function ActionFeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<ActionFeedbackRequest | null>(null);
  const [successSequence, setSuccessSequence] = useState(0);
  const feedbackRef = useRef<ActionFeedbackRequest | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const showFeedback = useCallback((next: ActionFeedbackRequest) => {
    if (next.kind === 'success') setSuccessSequence(sequence => sequence + 1);
    if (!feedbackRef.current) {
      const active = document.activeElement;
      const dialog = dialogRef.current;
      restoreFocusRef.current = active instanceof HTMLElement && active !== document.body && !dialog?.contains(active)
        ? active : lastFocusedRef.current;
    }
    feedbackRef.current = next;
    setFeedback(next);
  }, []);

  const dismiss = useCallback(() => {
    feedbackRef.current = null;
    setFeedback(null);
    requestAnimationFrame(() => {
      if (feedbackRef.current) return;
      const original = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (original?.isConnected && !original.matches(':disabled')) {
        original.focus({ preventScroll: true });
        return;
      }
      const fallback = document.querySelector<HTMLElement>('#main-content')
        ?? document.querySelector<HTMLElement>('.map-rail nav button:not(:disabled)');
      fallback?.focus({ preventScroll: true });
    });
  }, []);

  const runAction = useCallback(() => {
    const action = feedbackRef.current?.action;
    dismiss();
    action?.onClick();
  }, [dismiss]);
  const backdropDismiss = useDialogBackdropDismiss(dismiss);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (feedback && !dialog.open) dialog.showModal();
    else if (!feedback && dialog.open) dialog.close();
  }, [feedback]);

  useEffect(() => {
    function rememberFocus(event: FocusEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && !dialogRef.current?.contains(target)) lastFocusedRef.current = target;
    }
    function rememberClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || dialogRef.current?.contains(target)) return;
      const initiator = target.closest<HTMLElement>('button, input, select, textarea, a[href], [role="button"], [tabindex]:not([tabindex="-1"])');
      if (initiator) lastFocusedRef.current = initiator;
    }
    document.addEventListener('focusin', rememberFocus);
    document.addEventListener('click', rememberClick, true);
    return () => {
      document.removeEventListener('focusin', rememberFocus);
      document.removeEventListener('click', rememberClick, true);
    };
  }, []);

  return <ActionFeedbackContext.Provider value={{ showFeedback, successSequence }}>
    {children}
    <dialog
      ref={dialogRef}
      className="action-feedback-dialog"
      aria-modal="true"
      aria-labelledby="action-feedback-title"
      data-kind={feedback?.kind}
      onCancel={event => { event.preventDefault(); dismiss(); }}
      {...backdropDismiss}
    >
      {feedback && <>
        <div className="action-feedback-header">
          <h2 id="action-feedback-title">{feedback.title}</h2>
          <button type="button" className="icon-button" aria-label="Close feedback" onClick={dismiss}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <div className="action-feedback-content">
          <p role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>
          {feedback.reasons?.length ? <ul aria-label={feedback.reasonsLabel ?? 'Details'}>
            {feedback.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
          </ul> : null}
        </div>
        <div className="action-feedback-actions">
          {feedback.action && <button type="button" className="secondary" onClick={runAction}>{feedback.action.label}</button>}
          <button type="button" onClick={dismiss}>OK</button>
        </div>
      </>}
    </dialog>
  </ActionFeedbackContext.Provider>;
}
