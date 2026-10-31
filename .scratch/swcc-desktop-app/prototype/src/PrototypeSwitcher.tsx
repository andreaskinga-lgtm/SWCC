import { ChevronLeft, ChevronRight, RotateCcw, Braces } from 'lucide-react';
import { useEffect, useState } from 'react';
import { variantNames, type Variant } from './model';

export function PrototypeSwitcher({ variant, onChange, state, onReset }: {
  variant: Variant; onChange: (variant: Variant) => void; state: unknown; onReset: () => void;
}) {
  const [inspect, setInspect] = useState(false);
  useEffect(() => {
    console.info('[SWCC throwaway prototype]', { variant, name: variantNames[variant], state });
  }, [variant, state]);
  useEffect(() => {
    function cycle(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], dialog')) return;
      if (document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const keys: Variant[] = ['A', 'B', 'C'];
      onChange(keys[(keys.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    }
    document.addEventListener('keydown', cycle);
    return () => document.removeEventListener('keydown', cycle);
  }, [variant, onChange]);
  if (!import.meta.env.DEV) return null;
  const keys: Variant[] = ['A', 'B', 'C'];
  return <aside className="prototype-tools" aria-label="Prototype design switcher">
    {inspect && <section className="state-inspector">
      <h2>In-memory prototype state</h2>
      <p>No records survive a reload. File contents are omitted from this view.</p>
      <pre>{JSON.stringify(state, (key, value) => key === 'file' ? '[in-memory File]' : value, 2)}</pre>
    </section>}
    <div className="switcher">
      <span className="throwaway-label">UI prototype</span>
      <button aria-label="Previous design" onClick={() => onChange(keys[(keys.indexOf(variant) + 2) % 3])}><ChevronLeft size={18} /></button>
      <span className="variant-name" aria-live="polite"><b>{variant}</b> {variantNames[variant]}</span>
      <button aria-label="Next design" onClick={() => onChange(keys[(keys.indexOf(variant) + 1) % 3])}><ChevronRight size={18} /></button>
      <span className="switcher-divider" />
      <button aria-label="Inspect prototype state" aria-expanded={inspect} onClick={() => setInspect(!inspect)}><Braces size={18} /></button>
      <button aria-label="Reset sample data" onClick={onReset}><RotateCcw size={16} /></button>
    </div>
  </aside>;
}
