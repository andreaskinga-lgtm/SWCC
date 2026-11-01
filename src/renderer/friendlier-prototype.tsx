// PROTOTYPE: Does action-led motion make SWCC friendlier without changing its identity or flow?
// Three variants on the existing /?prototype=friendlier route, switchable via ?variant=A|B|C.
// Tokens: olive #526332, ink #303b25, quiet #647151, leaf #dfe8ca, canvas #f2f4eb, paper #ffffff.
// Keep Trebuchet MS / Segoe UI, existing type scale, left alignment, rail, header, and annual workflow.
// A [workflow | goals | activities]; B [workflow | goal -> unfolding activities]; C [workflow | goal picker | linked activities].
// Brief review: rejected new palettes, mascots, card-hover lifts, and page-wide entrances. Warmth belongs in feedback.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { App } from './App.js';
import type { PrototypeOverviewProps } from './App.js';
import type { Activity, YearPackage } from '../shared/application.js';
import { ActionFeedbackProvider } from './action-feedback.js';
import { createPrototypeOperations } from './friendlier-prototype-operations.js';
import { FRIENDLIER_VARIANTS, PrototypeSwitcher, prototypeVariant, usePrototypeSearch } from './prototype-switcher.js';
import type { PrototypeVariant } from './prototype-switcher.js';
import './friendlier-prototype.css';

type InteractionState = { expandedGoals?: string[]; selectedGoal?: string | null };
const PrototypeContext = createContext<{
  variant: PrototypeVariant; compare: boolean; setInteraction: (state: InteractionState) => void;
}>({ variant: 'A', compare: false, setInteraction: () => {} });

function ActivityLink({ activity, pkg, openActivity }: {
  activity: Activity; pkg: YearPackage; openActivity: (id: string | null) => void;
}) {
  return <button type="button" className="activity-node prototype-activity"
    aria-label={`Open activity ${activity.ref}: ${activity.title}`} onClick={() => openActivity(activity.id)}>
    <div><span className="goal-reference">{activity.ref}</span><span className="activity-state">{activity.status}</span></div>
    <h3>{activity.title}</h3>
    <span className="goal-link-chips">{pkg.goals.filter(goal => activity.goalIds.includes(goal.id))
      .map(goal => <span key={goal.id}>{goal.ref}</span>)}</span>
  </button>;
}

export function VariantA({ children }: PrototypeOverviewProps) {
  return <>{children}</>;
}

export function VariantB({ pkg, navigate, openActivity }: PrototypeOverviewProps) {
  const [expanded, setExpanded] = useState<string[]>(pkg.goals.slice(0, 1).map(goal => goal.id));
  const { setInteraction } = useContext(PrototypeContext);
  useEffect(() => { setInteraction({ expandedGoals: expanded }); }, [expanded, setInteraction]);
  return <section className="relationship-board surface prototype-unfold">
    <div className="prototype-board-heading"><h2>Learning goals and activities</h2>
      <button type="button" className="text-button" onClick={() => openActivity(null)}><Plus size={15} />Record an activity</button></div>
    <p className="prototype-board-copy">Open a goal to see the learning that supports it.</p>
    {pkg.goals.map(goal => {
      const activities = pkg.activities.filter(activity => activity.goalIds.includes(goal.id));
      const open = expanded.includes(goal.id);
      return <article className="prototype-learning-row" key={goal.id}>
        <button type="button" className="prototype-goal-toggle" aria-expanded={open}
          aria-controls={`prototype-links-${goal.id}`}
          onClick={() => setExpanded(open ? expanded.filter(id => id !== goal.id) : [...expanded, goal.id])}>
          <span className="goal-reference">{goal.ref}</span>
          <span><strong>{goal.title}</strong><small>{activities.length} linked {activities.length === 1 ? 'activity' : 'activities'}</small></span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        <div className="prototype-expand-shell" data-open={open} aria-hidden={!open} inert={!open}
          id={`prototype-links-${goal.id}`}><div><div className="prototype-expand-content">
          <p>{goal.description}</p>
          <div className="prototype-linked-activities">{activities.map(activity =>
            <ActivityLink key={activity.id} activity={activity} pkg={pkg} openActivity={openActivity} />)}</div>
          {!activities.length && <p className="empty">No supporting activity yet. Record one when you are ready.</p>}
        </div></div></div>
      </article>;
    })}
    {!pkg.goals.length && <p className="empty">No goals yet. Start with your self-assessment.</p>}
    <SupplementaryActivities pkg={pkg} openActivity={openActivity} />
    <div className="prototype-board-actions"><button type="button" className="secondary" onClick={() => navigate('assessment')}>Update your self assessment</button>
      <button type="button" className="secondary" onClick={() => navigate('plan')}>View development plan</button></div>
  </section>;
}

function SupplementaryActivities({ pkg, openActivity }: {
  pkg: YearPackage; openActivity: (id: string | null) => void;
}) {
  const activities = pkg.activities.filter(activity => !activity.goalIds.length);
  return activities.length ? <section className="prototype-supplementary"><h3>Supplementary learning</h3>
    {activities.map(activity => <button type="button" className="text-button" key={activity.id}
      onClick={() => openActivity(activity.id)}>{activity.ref}: {activity.title}</button>)}</section> : null;
}

export function VariantC({ pkg, navigate, openActivity }: PrototypeOverviewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(pkg.goals[0]?.id ?? null);
  const selected = pkg.goals.find(goal => goal.id === selectedId) ?? pkg.goals[0];
  const { setInteraction } = useContext(PrototypeContext);
  useEffect(() => { setInteraction({ selectedGoal: selected?.id ?? null }); }, [selected?.id, setInteraction]);
  return <section className="relationship-board surface prototype-focus">
    <div className="prototype-focus-columns">
      <div className="prototype-goal-picker"><h2>Learning goals</h2>
        <div role="tablist" aria-label="Goal connections" aria-orientation="vertical">
          {pkg.goals.map((goal, index) => <button type="button" role="tab" key={goal.id}
            id={`prototype-tab-${goal.id}`} aria-selected={selected?.id === goal.id}
            aria-controls="prototype-focused-activities" tabIndex={selected?.id === goal.id ? 0 : -1}
            onClick={() => setSelectedId(goal.id)} onKeyDown={event => {
              let nextIndex: number;
              if (event.key === 'ArrowDown') nextIndex = (index + 1) % pkg.goals.length;
              else if (event.key === 'ArrowUp') nextIndex = (index - 1 + pkg.goals.length) % pkg.goals.length;
              else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = pkg.goals.length - 1;
              else return;
              event.preventDefault(); event.stopPropagation();
              setSelectedId(pkg.goals[nextIndex].id);
              document.getElementById(`prototype-tab-${pkg.goals[nextIndex].id}`)?.focus();
            }}>
            <span className="goal-reference">{goal.ref}</span><strong>{goal.title}</strong>
          </button>)}
        </div>
        {!pkg.goals.length && <p className="empty">No goals yet. Start with your self-assessment.</p>}
        <button type="button" className="secondary" onClick={() => navigate('assessment')}>Update your self assessment</button>
      </div>
      <div className="prototype-focus-activities" id="prototype-focused-activities"
        role={selected ? 'tabpanel' : undefined} aria-labelledby={selected ? `prototype-tab-${selected.id}` : undefined}
        tabIndex={0} data-selected-goal={selected?.id}>
        <h2>{selected ? `Supporting ${selected.ref}` : 'Activities'}</h2>
        {selected && <p className="prototype-selected-description">{selected.description}</p>}
        <div className="prototype-focus-links" key={selected?.id}>
          {pkg.activities.filter(activity => selected && activity.goalIds.includes(selected.id)).map(activity =>
            <ActivityLink key={activity.id} activity={activity} pkg={pkg} openActivity={openActivity} />)}
          {selected && !pkg.activities.some(activity => activity.goalIds.includes(selected.id)) &&
            <p className="empty">No supporting activity yet. Record one when you are ready.</p>}
        </div>
        <button type="button" className="text-button" onClick={() => openActivity(null)}><Plus size={15} />Record an activity</button>
      </div>
    </div>
    <SupplementaryActivities pkg={pkg} openActivity={openActivity} />
    <div className="prototype-board-actions"><button type="button" className="secondary" onClick={() => navigate('plan')}>View development plan</button></div>
  </section>;
}

function FriendlierOverview(props: PrototypeOverviewProps) {
  const { variant, compare } = useContext(PrototypeContext);
  if (compare || variant === 'A') return <VariantA {...props} />;
  return variant === 'B' ? <VariantB key={props.pkg.id} {...props} /> : <VariantC key={props.pkg.id} {...props} />;
}

function useFriendlyMotion(root: RefObject<HTMLDivElement | null>, enabled: boolean, variant: PrototypeVariant,
  setScreen: (screen: string) => void) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let previousScreen = '';
    let previousSave = '';
    let previousGoal = '';
    let initial = true;
    const openDialogs = new Set<Element>();
    const knownRecords = new Set<Element>();
    function animate(target: Element, frames: Keyframe[], duration: number) {
      if (!enabled || preference.matches) return;
      target.animate(frames, { duration, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    function scan() {
      frame = 0;
      if (!element) return;
      const screen = element.querySelector('.page-heading h1')?.textContent ?? '';
      const screenChanged = screen !== previousScreen;
      const knownParents = new Set([...knownRecords].filter(record => record.isConnected).map(record => record.parentElement));
      if (screenChanged) {
        setScreen(screen);
        if (!initial) {
          const heading = element.querySelector('.page-heading');
          if (heading) animate(heading, [{ opacity: .65, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], 180);
        }
        previousScreen = screen;
      }
      const save = element.querySelector<HTMLElement>('.save-status');
      if (save && save.textContent !== previousSave) {
        save.dataset.prototypeSave = save.textContent ?? '';
        if (!initial && previousSave === 'Saving' && save.textContent === 'Saved') {
          animate(save, [{ background: '#dfe8ca', transform: 'scale(.97)' }, { background: '#f2f4eb', transform: 'scale(1)' }], 360);
        }
        previousSave = save.textContent ?? '';
      }
      const focus = element.querySelector<HTMLElement>('.prototype-focus-activities');
      if (focus && previousGoal && focus.dataset.selectedGoal !== previousGoal) {
        const links = focus.querySelector('.prototype-focus-links');
        if (links) animate(links, [{ opacity: .4, transform: 'translateX(6px)' }, { opacity: 1, transform: 'translateX(0)' }], 220);
      }
      previousGoal = focus?.dataset.selectedGoal ?? '';
      const dialogs = element.querySelectorAll('dialog[open]');
      for (const dialog of dialogs) {
        if (!openDialogs.has(dialog) && !initial) {
          animate(dialog, [
            { opacity: .45, transform: variant === 'A' ? 'translateY(8px) scale(.985)' : 'translateY(5px) scale(.99)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ], variant === 'A' ? 220 : 260);
          if (dialog.matches('[data-kind="success"]')) {
            const sprout = element.querySelector('.map-mark svg');
            if (sprout) animate(sprout, [{ transform: 'rotate(-7deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(0)' }], 420);
          }
        }
        openDialogs.add(dialog);
      }
      for (const dialog of openDialogs) if (!dialog.matches('dialog[open]')) openDialogs.delete(dialog);
      const records = element.querySelectorAll('.goal-node, .goal-editor, .activity-node, .activity-index > button');
      for (const record of records) {
        if (!initial && !screenChanged && !knownRecords.has(record)) {
          // Only animate an added record on an existing screen, never a grid entrance.
          if (knownParents.has(record.parentElement)) {
            animate(record, [{ opacity: .4, transform: 'scale(.99)' }, { opacity: 1, transform: 'scale(1)' }], 220);
          }
        }
        knownRecords.add(record);
      }
      for (const record of knownRecords) if (!record.isConnected) knownRecords.delete(record);
      initial = false;
    }
    scan();
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    observer.observe(element, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['open', 'aria-current', 'data-selected-goal'] });
    function stopMotion() {
      if (preference.matches) element?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    }
    preference.addEventListener('change', stopMotion);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      preference.removeEventListener('change', stopMotion);
      element.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    };
  }, [root, enabled, variant, setScreen]);
}

export function FriendlierPrototype() {
  const [store] = useState(createPrototypeOperations);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const search = usePrototypeSearch();
  const variant = prototypeVariant(search);
  const compare = search.get('compare') === 'current';
  const motion = search.get('motion') !== 'off' && !compare;
  const [stateOpen, setStateOpen] = useState(false);
  const [screen, setScreen] = useState('');
  const [interaction, setInteraction] = useState<InteractionState>({});
  const root = useRef<HTMLDivElement>(null);
  const current = FRIENDLIER_VARIANTS.find(item => item.key === variant)!;
  useFriendlyMotion(root, motion, variant, setScreen);
  useEffect(() => { if (compare || variant === 'A') setInteraction({}); }, [compare, variant]);
  useEffect(() => {
    console.info('SWCC throwaway prototype state', { variant, comparison: compare, motionRequested: motion,
      systemReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, screen, interaction, ...snapshot });
  }, [variant, compare, motion, screen, interaction, snapshot]);
  return <div className="friendlier-prototype" data-variant={variant} data-motion={motion} data-compare={compare}>
    <div className="prototype-notice"><strong>Throwaway preview</strong><span>Fictional records. Reload resets edits; your portfolio is not connected.</span></div>
    <PrototypeContext.Provider value={{ variant, compare, setInteraction }}>
      <div ref={root}><ActionFeedbackProvider>
        <App operations={store.operations} prototypeOverview={FriendlierOverview} />
      </ActionFeedbackProvider></div>
    </PrototypeContext.Provider>
    {stateOpen && <aside className="prototype-state" id="prototype-state" aria-label="Prototype details">
      <h2>{compare ? 'Current design' : `${current.key}: ${current.name}`}</h2>
      <p>{compare ? 'Unmodified layout and feedback for comparison.' : current.description}</p>
      <p><strong>Try it:</strong> edit your self-assessment, add a goal, record an activity, or complete Step 2.
        {variant === 'B' && !compare && ' Open and close a goal to see its connections unfold.'}
        {variant === 'C' && !compare && ' Select different goals to see their supporting activities.'}</p>
      <p><strong>Recommendation:</strong> A is the smallest change. Keep motion brief and action-led; do not add looping animation or confetti.
        Files, backups, and exports are deliberately disconnected.</p>
      <details><summary>Full prototype state</summary><pre>{JSON.stringify({
        variant, comparison: compare, motionRequested: motion,
        systemReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        screen, interaction, ...snapshot,
      }, null, 2)}</pre></details>
    </aside>}
    <PrototypeSwitcher stateOpen={stateOpen} toggleState={() => setStateOpen(open => !open)} />
  </div>;
}
