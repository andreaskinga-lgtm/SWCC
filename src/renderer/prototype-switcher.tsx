// PROTOTYPE ONLY: shared URL controls, never rendered in a production build.
import { useEffect, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const FRIENDLIER_VARIANTS = [
  { key: 'A', name: 'Gentle feedback', description: 'Same layout. A soft press, a settling dialog, and a quiet saved confirmation.' },
  { key: 'B', name: 'Unfold the connections', description: 'Expand a goal to reveal its activities. Motion explains the relationship.' },
  { key: 'C', name: 'One goal at a time', description: 'Select a goal and its activities settle into the adjacent pane.' },
] as const;
export type PrototypeVariant = typeof FRIENDLIER_VARIANTS[number]['key'];

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
export function usePrototypeSearch() {
  return new URLSearchParams(useSyncExternalStore(subscribe, () => location.search));
}
export function updatePrototypeSearch(key: string, value: string | null) {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function prototypeVariant(search: URLSearchParams): PrototypeVariant {
  const key = search.get('variant');
  return FRIENDLIER_VARIANTS.find(variant => variant.key === key)?.key ?? 'A';
}

export function PrototypeSwitcher({ stateOpen, toggleState }: { stateOpen: boolean; toggleState: () => void }) {
  const search = usePrototypeSearch();
  const current = prototypeVariant(search);
  const variant = FRIENDLIER_VARIANTS.find(variant => variant.key === current)!;
  const compare = search.get('compare') === 'current';
  const motion = search.get('motion') !== 'off';
  function cycle(direction: number) {
    const index = FRIENDLIER_VARIANTS.findIndex(variant => variant.key === current);
    updatePrototypeSearch('variant', FRIENDLIER_VARIANTS[(index + direction + FRIENDLIER_VARIANTS.length) % FRIENDLIER_VARIANTS.length].key);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"]')) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  if (!import.meta.env.DEV) return null;
  return <nav className="prototype-switcher" aria-label="Prototype controls">
    <div className="prototype-variant-control">
      <button type="button" aria-label="Previous variant" onClick={() => cycle(-1)}><ChevronLeft size={18} /></button>
      <span aria-live="polite">{variant.key} · {variant.name}</span>
      <button type="button" aria-label="Next variant" onClick={() => cycle(1)}><ChevronRight size={18} /></button>
    </div>
    <button type="button" aria-pressed={compare} onClick={() => updatePrototypeSearch('compare', compare ? null : 'current')}>Compare current</button>
    <button type="button" aria-pressed={motion} onClick={() => updatePrototypeSearch('motion', motion ? 'off' : null)}>Motion {motion ? 'on' : 'off'}</button>
    <button type="button" aria-expanded={stateOpen} aria-controls="prototype-state" onClick={toggleState}>Details</button>
  </nav>;
}
