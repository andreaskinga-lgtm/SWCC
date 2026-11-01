import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type MotionScope = 'page' | 'activity';

interface NativeViewTransition {
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
}

interface TransitionDocument {
  startViewTransition?: (update: () => void) => NativeViewTransition;
}

interface ActiveVisual {
  scope: MotionScope;
  frame: number | null;
  animation: Animation | null;
  native: NativeViewTransition | null;
}

const fallbackMotionByScope: Record<MotionScope, {
  selector: string;
  keyframes: Keyframe[];
  duration: number;
}> = {
  page: {
    selector: '.page-transition-scope',
    keyframes: [{ opacity: 0.35, transform: 'translateX(12px)' }, { opacity: 1, transform: 'translateX(0)' }],
    duration: 220,
  },
  activity: {
    selector: '.activity-editor',
    keyframes: [{ opacity: 0.15, transform: 'translateX(24px)' }, { opacity: 1, transform: 'translateX(0)' }],
    duration: 260,
  },
};

function motionIsDisabled() {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  const archiveMotionOff = search.get('prototype') === 'friendlier'
    && (search.get('motion') === 'off' || search.get('compare') === 'current');
  const productionMotionOff = document.documentElement.dataset.motion === 'off';
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    || archiveMotionOff || productionMotionOff;
}

function subscribeToMotionPreference(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener('change', listener);
  window.addEventListener('popstate', listener);
  return () => {
    preference.removeEventListener('change', listener);
    window.removeEventListener('popstate', listener);
  };
}

function isAbortError(failure: unknown) {
  return typeof failure === 'object' && failure !== null && 'name' in failure
    && failure.name === 'AbortError';
}

export function useMotionDisabled() {
  const disabled = useSyncExternalStore(subscribeToMotionPreference, motionIsDisabled, () => false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const hadAttribute = root.hasAttribute('data-swcc-motion-disabled');
    if (disabled) root.setAttribute('data-swcc-motion-disabled', '');
    else root.removeAttribute('data-swcc-motion-disabled');
    return () => {
      if (hadAttribute) root.setAttribute('data-swcc-motion-disabled', '');
      else root.removeAttribute('data-swcc-motion-disabled');
    };
  }, [disabled]);
  return disabled;
}

export function useMotionCoordinator(onFailure: (failure: unknown) => void) {
  const disabled = useMotionDisabled();
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  const intentSequence = useRef(0);
  const latestAcceptedIntent = useRef(0);
  const activeVisual = useRef<ActiveVisual | null>(null);
  const mounted = useRef(true);

  const cleanupVisual = useCallback((visual: ActiveVisual, skipNative: boolean) => {
    activeVisual.current = null;
    if (visual.frame !== null) cancelAnimationFrame(visual.frame);
    visual.frame = null;
    if (visual.animation) visual.animation.cancel();
    visual.animation = null;
    if (skipNative && visual.native) {
      try {
        visual.native.skipTransition();
      } catch (failure) {
        if (!isAbortError(failure)) onFailureRef.current(failure);
      }
    }
    if (document.documentElement.dataset.swccTransition === visual.scope) {
      delete document.documentElement.dataset.swccTransition;
    }
  }, []);

  const finishVisual = useCallback((visual: ActiveVisual) => {
    if (activeVisual.current !== visual) return;
    cleanupVisual(visual, false);
  }, [cleanupVisual]);

  const cancelVisual = useCallback(() => {
    const visual = activeVisual.current;
    if (!visual) return;
    cleanupVisual(visual, true);
  }, [cleanupVisual]);

  useLayoutEffect(() => {
    if (disabled) cancelVisual();
  }, [disabled, cancelVisual]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latestAcceptedIntent.current = ++intentSequence.current;
      cancelVisual();
    };
  }, [cancelVisual]);

  const beginIntent = useCallback(() => ++intentSequence.current, []);

  const transition = useCallback((
    intent: number,
    scope: MotionScope,
    commit: () => void,
    animate = true,
  ) => {
    if (!mounted.current || intent < latestAcceptedIntent.current) return false;
    latestAcceptedIntent.current = intent;
    cancelVisual();

    const apply = () => {
      if (!mounted.current || intent !== latestAcceptedIntent.current) return;
      flushSync(commit);
    };

    if (!animate || disabledRef.current) {
      apply();
      return true;
    }

    const reportOnce = (() => {
      let reported = false;
      return (failure: unknown) => {
        if (isAbortError(failure) || reported) return;
        reported = true;
        onFailureRef.current(failure);
      };
    })();

    const scheduleFallback = (visual: ActiveVisual) => {
      visual.frame = requestAnimationFrame(() => {
        visual.frame = null;
        if (activeVisual.current !== visual || intent !== latestAcceptedIntent.current || disabledRef.current) {
          finishVisual(visual);
          return;
        }
        const { selector, keyframes, duration } = fallbackMotionByScope[scope];
        const element = document.querySelector<HTMLElement>(selector);
        if (!element || typeof element.animate !== 'function') {
          finishVisual(visual);
          return;
        }
        const animation = element.animate(keyframes, {
          duration,
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: 'both',
        });
        visual.animation = animation;
        void animation.finished.then(
          () => finishVisual(visual),
          failure => {
            if (!isAbortError(failure)) reportOnce(failure);
            finishVisual(visual);
          },
        );
      });
    };

    const visual: ActiveVisual = { scope, frame: null, animation: null, native: null };
    const transitionDocument = document as unknown as TransitionDocument;
    if (typeof transitionDocument.startViewTransition === 'function') {
      let callbackStarted = false;
      document.documentElement.dataset.swccTransition = scope;
      activeVisual.current = visual;
      try {
        const native = transitionDocument.startViewTransition(() => {
          callbackStarted = true;
          apply();
        });
        visual.native = native;
        void native.ready.catch(reportOnce);
        void native.updateCallbackDone.catch(reportOnce);
        void native.finished.then(
          () => finishVisual(visual),
          failure => {
            reportOnce(failure);
            finishVisual(visual);
          },
        );
      } catch (failure) {
        finishVisual(visual);
        if (callbackStarted) throw failure;
        reportOnce(failure);
        const fallback: ActiveVisual = { scope, frame: null, animation: null, native: null };
        activeVisual.current = fallback;
        apply();
        scheduleFallback(fallback);
      }
      return true;
    }

    activeVisual.current = visual;
    apply();
    scheduleFallback(visual);
    return true;
  }, [cancelVisual, finishVisual]);

  return { beginIntent, transition, disabled };
}
