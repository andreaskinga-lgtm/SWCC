/*
 * THROWAWAY: Three desktop portfolio variants at /prototype/swcc?variant=A|B|C.
 * Question: which structure makes annual reflection and shared learning easiest?
 *
 * A / Practice desk: plum #563f65, mist #f4f3f7, paper #ffffff,
 * ink #302d39, muted #706b7c, sage #e7f0e9. Avenir Next, sans fallback.
 * Left-aligned workspace, a quiet navigation rail and explicit readiness rows.
 * [year / steps] | [annual workflow      ] [learning ledger]
 *
 * B / Annual folio: blue #245a70, ice #eaf2f5, paper #ffffff,
 * ink #233c48, muted #58717c, sea #d3e5eb. Charter headings, Avenir body.
 * Top navigation and an open annual folio; writing leads, outline follows.
 * [year                    navigation                     ]
 * [reflection / writing               ] [annual outline   ]
 *
 * C / Learning map: olive #526332, linen #f2f4eb, paper #ffffff,
 * ink #303b25, muted #647151, leaf #dfe8ca. Trebuchet MS, sans fallback.
 * Compact utility rail; goal-to-activity relationships are the main surface.
 * [rail] | [goals] -- [one shared activity record] | [workflow]
 *
 * Brief critique: cut generic KPI tiles and percentage rings. The bold element
 * is A's year bookmark, B's open folio, C's relationship rail, not decoration.
 * This is not a persistence, export, backup, or regulatory-compliance service.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronRight, Circle, ClipboardList,
  Download, FileText, FolderOpen, HardDrive, HelpCircle, Layers, Link2,
  ListChecks, Plus, ShieldCheck, Sprout, Trash2, X, type LucideIcon,
} from 'lucide-react';
import {
  blockers, emptyPackage, packageState, samplePackages, sections, stepNames,
  stepState, today, validDate, validLink, variantNames,
  type Activity, type ActivityStatus, type Goal, type Screen, type Step, type Variant, type YearPackage,
} from './model';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { PdfReader } from './PdfReader';

const navItems: { screen: Screen; label: string; icon: LucideIcon }[] = [
  { screen: 'overview', label: 'Year overview', icon: FolderOpen },
  { screen: 'review', label: 'Review', icon: BookOpen },
  { screen: 'assessment', label: 'Self-assessment', icon: FileText },
  { screen: 'plan', label: 'Development plan', icon: Sprout },
];
const steps: Step[] = ['review', 'assessment', 'plan'];
type Modal = 'source' | 'declaration' | 'export' | 'restore' | 'goal' | 'delete-year' | null;
type Update = (recipe: (pkg: YearPackage) => YearPackage, affected?: Step[]) => void;
interface DesignProps {
  pkg: YearPackage; packages: YearPackage[]; screen: Screen; navigate: (screen: Screen) => void;
  chooseYear: (year: number) => void; open: (modal: Modal) => void;
  children: ReactNode; save: string; backupLabel: string;
}
function route() {
  const params = new URLSearchParams(window.location.search);
  const rawVariant = params.get('variant');
  const rawScreen = params.get('screen');
  return {
    variant: (rawVariant === 'B' || rawVariant === 'C' ? rawVariant : 'A') as Variant,
    screen: (['overview', 'review', 'assessment', 'plan', 'years', 'backup'].includes(rawScreen ?? '') ? rawScreen : 'overview') as Screen,
    year: Number(params.get('year')) || 2026,
  };
}
function Badge({ state }: { state: string }) {
  return <span className={`badge ${state === 'Completed' || state === 'Complete' ? 'is-complete' : state === 'Ready' ? 'is-ready' : ''}`}>
    {state === 'Completed' || state === 'Complete' ? <Check size={12} /> : <span className="status-dot" />}{state}
  </span>;
}
function Button({ children, onClick, secondary = false, disabled = false, className = '' }: {
  children: ReactNode; onClick: () => void; secondary?: boolean; disabled?: boolean; className?: string;
}) {
  return <button className={`${secondary ? 'button-secondary' : 'button-primary'} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function YearPicker({ pkg, packages, chooseYear }: Pick<DesignProps, 'pkg' | 'packages' | 'chooseYear'>) {
  return <label className="year-picker"><span>Year package</span>
    <select aria-label="Year package" value={pkg.year} onChange={event => chooseYear(Number(event.target.value))}>
      {packages.map(item => <option key={item.year} value={item.year}>{item.year}</option>)}
    </select>
  </label>;
}
function Navigation({ screen, navigate, compact = false }: Pick<DesignProps, 'screen' | 'navigate'> & { compact?: boolean }) {
  return <nav className={compact ? 'compact-nav' : 'main-nav'} aria-label="Year navigation">
    {navItems.map(({ screen: destination, label, icon: Icon }) => <button key={destination}
      onClick={() => navigate(destination)} aria-current={screen === destination ? 'page' : undefined} title={compact ? label : undefined}>
      <Icon size={19} /><span>{label}</span>
    </button>)}
  </nav>;
}
function SourceNote({ open }: Pick<DesignProps, 'open'>) {
  return <button className="source-note" onClick={() => open('source')}><HelpCircle size={15} />
    <span>Application progress, not verification of College compliance</span>
  </button>;
}
function StepRows({ pkg, navigate }: Pick<DesignProps, 'pkg' | 'navigate'>) {
  return <div className="step-rows">{steps.map((step, index) => {
    const missing = blockers(pkg, step);
    const summary = step === 'review' ? `${sections.filter(section => section.pages.every(page => pkg.visited.includes(page))).length} of 12 sections reviewed`
      : step === 'assessment' ? `${pkg.goals.length} learning goals; ${pkg.standards.length} annual standards`
        : `${pkg.activities.filter(activity => activity.status === 'Completed').length} of ${pkg.activities.length} activities completed`;
    return <button className="step-row" key={step} onClick={() => navigate(step)}>
      <span className="step-number">{pkg.completed[step] ? <Check size={18} /> : index + 1}</span>
      <span className="step-copy"><strong>{stepNames[step]}</strong><span>{summary}</span>
        {missing.length > 0 && <small>{step === 'plan' ? missing[0] : step === 'review' ? `Resume on page ${pkg.page}` : missing[0]}</small>}
        {!missing.length && !pkg.completed[step] && <small>Ready for your confirmation</small>}
      </span>
      <Badge state={stepState(pkg, step)} /><ChevronRight size={18} />
    </button>;
  })}</div>;
}
function GoalLedger({ pkg, navigate }: Pick<DesignProps, 'pkg' | 'navigate'>) {
  return <div className="goal-ledger">{pkg.goals.map(goal => <button key={goal.ref} onClick={() => navigate('plan')}>
    <span className="reference">{goal.ref}</span><span><strong>{goal.title}</strong>
      <small>{pkg.activities.filter(activity => activity.goals.includes(goal.ref)).length} supporting {pkg.activities.filter(activity => activity.goals.includes(goal.ref)).length === 1 ? 'activity' : 'activities'}</small></span><ChevronRight size={15} />
  </button>)}
    {!pkg.goals.length && <p className="empty">Add your first goal in self-assessment or while recording an activity.</p>}
  </div>;
}
function DeclarationCard({ pkg, open }: Pick<DesignProps, 'pkg' | 'open'>) {
  return <section className="declaration-card">
    <ShieldCheck size={22} /><div><h3>External renewal declaration</h3>
      <p>{pkg.declaration ? `Submission date recorded: ${pkg.declaration}` : 'Record the date after submitting through the College’s renewal process.'}</p>
      <button className="text-button" onClick={() => open('declaration')}>{pkg.declaration ? 'Edit recorded date' : 'Record submission date'}</button>
    </div>
  </section>;
}
export function VariantA(props: DesignProps) {
  const { pkg, screen, navigate, open, save, backupLabel } = props;
  return <div className="desk-layout">
    <aside className="desk-sidebar">
      <button className="brand" onClick={() => navigate('years')}><span className="brand-symbol"><Layers size={23} /></span><span>SWCC<small>Continuing competence</small></span></button>
      <YearPicker {...props} />
      <Navigation {...props} />
      <button className="sidebar-link" onClick={() => navigate('years')}><Layers size={18} />All year packages</button>
      <div className="sidebar-bottom"><button className="backup-nav" onClick={() => navigate('backup')}><HardDrive size={19} /><span>Backup & restore<small>{backupLabel}</small></span></button>
        <span className="local-note"><ShieldCheck size={14} />Local-only desktop concept</span></div>
    </aside>
    <div className="desk-workspace">
      <header className="workspace-top"><span>My continuing competence portfolio</span><span className="save-status"><CheckCircle2 size={14} />{save}</span></header>
      <main id="main-content">
        {screen === 'overview' ? <>
          <div className="desk-heading"><div className="year-bookmark">{pkg.year}<span>Year package</span></div>
            <div><h1>A year of thoughtful practice.</h1><p>Your review, reflection, and learning, kept together.</p></div>
            <Button onClick={() => open('export')} secondary><Download size={17} />Preview export</Button>
          </div>
          <div className="overview-grid">
            <section className="workflow-sheet"><div className="section-heading"><h2>Your annual workflow</h2><Badge state={packageState(pkg)} /></div>
              <p className="quiet">Work in any order. Confirm each step when it is ready.</p><StepRows {...props} />
              <DeclarationCard {...props} />
            </section>
            <aside className="learning-aside"><h2>Learning this year</h2><p className="quiet">Goals shared by your assessment and plan.</p><GoalLedger {...props} />
              <div className="next-action"><BookOpen size={24} /><h3>Pick up where you left off</h3>
                <p>Your standards reader is on page {pkg.page}. Review progress is kept separately for each year.</p>
                <Button onClick={() => navigate('review')}>Resume review<ChevronRight size={16} /></Button></div>
            </aside>
          </div><SourceNote {...props} />
        </> : props.children}
      </main>
    </div>
  </div>;
}
export function VariantB(props: DesignProps) {
  const { pkg, screen, navigate, open, save, backupLabel } = props;
  return <div className="folio-layout">
    <header className="folio-masthead"><button className="folio-brand" onClick={() => navigate('years')}><BookOpen size={25} /><span>Practice, reflected.<small>SWCC continuing competence portfolio</small></span></button>
      <div className="folio-utilities"><button onClick={() => navigate('years')}>All years</button><button onClick={() => navigate('backup')}><HardDrive size={16} />Backup & restore</button><span className="save-status">{save}</span></div>
    </header>
    <div className="folio-navigation"><YearPicker {...props} /><Navigation {...props} /></div>
    <main id="main-content">
      {screen === 'overview' ? <>
        <div className="folio-title"><div><h1>Your {pkg.year} practice folio</h1><p>A working record of what you learned and how it changed your practice.</p></div><Button onClick={() => open('export')} secondary><Download size={17} />Preview export</Button></div>
        <div className="open-folio">
          <section className="folio-writing"><span className="folio-tab">Self-assessment</span><h2>What are you bringing<br />to your practice?</h2>
            <p className="reflection-excerpt">{pkg.strengths || 'Make space to reflect on your strengths, interests, and the learning you want to pursue.'}</p>
            <button className="folio-edit" onClick={() => navigate('assessment')}>Continue your reflection<ArrowUpRight size={18} /></button>
            <div className="folio-goals"><h3>Your learning intentions</h3><GoalLedger {...props} /></div>
            <div className="folio-margin-note"><p>One experience can support several goals. Record the activity, evidence, and reflection only once.</p><button className="text-button" onClick={() => navigate('plan')}>Open development plan</button></div>
          </section>
          <section className="folio-outline"><h2>Annual outline</h2><p className="quiet">All three steps are open to you.</p><StepRows {...props} />
            <DeclarationCard {...props} /><div className="folio-backup"><HardDrive size={19} /><span>{backupLabel}<small>Full backups protect all your years.</small></span><button className="text-button" onClick={() => navigate('backup')}>Manage</button></div>
          </section>
        </div><SourceNote {...props} />
      </> : props.children}
    </main>
  </div>;
}
export function VariantC(props: DesignProps) {
  const { pkg, screen, navigate, open, save } = props;
  return <div className="map-layout">
    <aside className="map-rail"><button className="map-mark" aria-label="All year packages" onClick={() => navigate('years')}><Sprout size={29} /></button>
      <Navigation {...props} compact /><div className="map-rail-bottom"><button aria-label="All year packages" onClick={() => navigate('years')}><Layers size={21} /></button><button aria-label="Backup and restore" onClick={() => navigate('backup')}><HardDrive size={21} /></button></div>
    </aside>
    <div className="map-workspace"><header className="map-top"><div className="map-wordmark">SWCC <span>My learning portfolio</span></div><YearPicker {...props} /><span className="save-status">{save}</span></header>
      <main id="main-content">
        {screen === 'overview' ? <>
          <div className="map-heading"><div><h1>Connect learning to practice.</h1><p>Your {pkg.year} goals and the experiences that move them forward.</p></div><Button onClick={() => navigate('plan')}><Plus size={18} />Record an activity</Button></div>
          <div className="map-overview">
            <section className="relationship-board"><div className="board-labels"><h2>Learning goals</h2><h2>Activities & experiences</h2></div>
              <div className="relationship-columns"><div className="goal-nodes">{pkg.goals.map(goal => <button className="goal-node" key={goal.ref} onClick={() => navigate('assessment')}>
                <span className="reference">{goal.ref}</span><h3>{goal.title}</h3><p>{goal.description}</p>
                <span className="node-links"><Link2 size={14} />{pkg.activities.filter(activity => activity.goals.includes(goal.ref)).map(activity => activity.ref).join(', ') || 'No supporting activity yet'}</span>
              </button>)}{!pkg.goals.length && <p className="empty">Start with a learning goal.</p>}</div>
                <div className="activity-nodes">{pkg.activities.map(activity => <button className="activity-node" key={activity.ref} onClick={() => navigate('plan')}>
                  <div><span className="reference">{activity.ref}</span><Badge state={activity.status} /></div><h3>{activity.title}</h3>
                  <span className="goal-link-chips">{activity.goals.length ? activity.goals.map(goal => <span key={goal}>{goal}</span>) : <small>No linked goal; supplementary</small>}</span>
                  {activity.goals.length > 1 && <small className="shared-note">One record supports both goals</small>}
                </button>)}{!pkg.activities.length && <p className="empty">Record an activity and connect it to a goal.</p>}</div>
              </div><div className="board-footer"><Link2 size={17} /><span>Evidence and reflection stay with each activity, never with its links.</span><button className="text-button" onClick={() => navigate('plan')}>Edit plan</button></div>
            </section>
            <aside className="map-checklist"><h2>Close the annual loop</h2><p className="quiet">Work freely. Complete deliberately.</p><StepRows {...props} /><DeclarationCard {...props} /><Button secondary onClick={() => open('export')}><Download size={16} />Preview annual export</Button></aside>
          </div><SourceNote {...props} />
        </> : props.children}
      </main>
    </div>
  </div>;
}
function PageHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}
function Readiness({ pkg, step, onComplete }: { pkg: YearPackage; step: Step; onComplete: () => void }) {
  const missing = blockers(pkg, step);
  return <section className="readiness-panel">
    <div className="section-heading"><h2>Step readiness</h2><Badge state={stepState(pkg, step)} /></div>
    {missing.length ? <><p>Still needed before you can complete this step:</p><ul className="missing-list">{missing.map(item => <li key={item}><Circle size={13} />{item}</li>)}</ul></>
      : <p>{pkg.completed[step] ? 'You confirmed this step. Meaningful edits reopen the affected step.' : 'All application checks are satisfied. Completion still needs your confirmation.'}</p>}
    <Button onClick={onComplete} disabled={Boolean(missing.length) || pkg.completed[step]}><CheckCircle2 size={16} />{pkg.completed[step] ? 'Step completed' : 'Complete Step'}</Button>
    <small>Application readiness is not College compliance.</small>
  </section>;
}
function DateField({ label, value, year, onChange }: { label: string; value: string; year: number; onChange: (value: string) => void }) {
  return <label className="field date-field"><span>{label}</span><input aria-label={label} type="date" value={value} onChange={event => onChange(event.target.value)} />
    {validDate(value) && Number(value.slice(0, 4)) !== year && <small className="warning">This date is outside {year}. You can keep it for backfilled work.</small>}
  </label>;
}
function GoalEditor({ goal, onChange, onDelete }: { goal: Goal; onChange: (patch: Partial<Goal>) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(goal.title);
  return <div className="goal-editor"><div className="goal-editor-top"><span className="reference">{goal.ref}</span>
    <button className="icon-button" aria-label={`Delete goal ${goal.ref}`} onClick={onDelete}><Trash2 size={16} /></button></div>
    <label className="field"><span>Learning goal</span><input value={title} onChange={event => {
      setTitle(event.target.value);
      if (event.target.value.trim()) onChange({ title: event.target.value });
    }} />{!title.trim() && <small className="error">A goal title is required. The last valid title is retained in the demo.</small>}</label>
    <label className="field"><span>Description <small>Optional</small></span><textarea aria-label="Goal description" rows={2} value={goal.description} onChange={event => onChange({ description: event.target.value })} /></label>
  </div>;
}
function Assessment({ pkg, update, complete, addGoal, deleteGoal }: {
  pkg: YearPackage; update: Update; complete: () => void; addGoal: () => void; deleteGoal: (ref: string) => void;
}) {
  function edit(patch: Partial<YearPackage>) { update(current => ({ ...current, ...patch }), ['assessment']); }
  return <>
    <PageHeading title="Reflect on your practice." description="Your annual self-assessment, with room to think. Goals also appear in your development plan." />
    <div className="assessment-layout"><div className="assessment-writing">
      <DateField label="Assessment date" value={pkg.assessmentDate} year={pkg.year} onChange={assessmentDate => edit({ assessmentDate })} />
      <label className="field narrative"><span>What are your strengths?</span><small>What are you doing well in your practice?</small>
        <textarea aria-label="What are your strengths?" rows={5} value={pkg.strengths} onChange={event => edit({ strengths: event.target.value })} /></label>
      <label className="field narrative"><span>Peer feedback <small>Optional</small></span><small>What would others say? “Not applicable” is fine.</small>
        <textarea aria-label="Peer feedback" rows={4} value={pkg.feedback} onChange={event => edit({ feedback: event.target.value })} /></label>
      <label className="field narrative"><span>Learning needs and interests</span><small>Where would further learning benefit your practice?</small>
        <textarea aria-label="Learning needs and interests" rows={5} value={pkg.needs} onChange={event => edit({ needs: event.target.value })} /></label>
      <fieldset className="standard-choices"><legend>Relevant annual standards</legend><p>These selections belong to this year’s self-assessment, not to individual goals.</p>
        {sections.map((section, index) => <label key={section.name}><input type="checkbox" checked={pkg.standards.includes(index)} onChange={event => edit({ standards: event.target.checked ? [...pkg.standards, index] : pkg.standards.filter(item => item !== index) })} /><span>{section.name}</span></label>)}
      </fieldset>
    </div><aside className="assessment-side"><section className="goals-section"><div className="section-heading"><h2>Learning goals</h2><button className="text-button" onClick={addGoal}><Plus size={15} />Add goal</button></div>
      <p className="quiet">One shared set of goals for SAT and PDP.</p>{pkg.goals.map(goal => <GoalEditor key={goal.ref} goal={goal}
        onChange={patch => update(current => ({ ...current, goals: current.goals.map(item => item.ref === goal.ref ? { ...item, ...patch } : item) }), ['assessment', 'plan'])}
        onDelete={() => deleteGoal(goal.ref)} />)}
      {!pkg.goals.length && <p className="empty">Name a learning goal to begin your plan.</p>}
    </section><Readiness pkg={pkg} step="assessment" onComplete={complete} /></aside></div>
  </>;
}
function Review({ pkg, update, complete, notify }: { pkg: YearPackage; update: Update; complete: () => void; notify: (text: string) => void }) {
  const viewed = useCallback((page: number) => {
    update(current => current.visited.includes(page) ? current : { ...current, visited: [...current.visited, page] });
  }, [update]);
  function reset(index: number) {
    update(current => ({ ...current, visited: current.visited.filter(page => !sections[index].pages.includes(page)) }), ['review']);
    notify('Section reset in memory. Navigate to its pages to review again.');
  }
  return <>
    <PageHeading title="Review the standards." description="Supplied Second Edition, amended September 7, 2018. Resume, browse, or revisit any section." />
    <div className="review-layout"><aside className="review-sections"><h2>Section checklist</h2><p className="quiet">Every mapped page must appear in the active reader.</p>
      <div className="review-list">{sections.map((section, index) => {
        const checked = section.pages.every(page => pkg.visited.includes(page));
        return <div className="review-row" key={section.name}>
          <button onClick={() => update(current => ({ ...current, page: section.pages[0] }))} className={section.pages.includes(pkg.page) ? 'reading' : ''}>
            {checked ? <CheckCircle2 size={17} className="checked-icon" /> : <Circle size={17} />}<span>{section.name}<small>Page{section.pages.length > 1 ? 's' : ''} {section.pages[0]}{section.pages.length > 1 ? `–${section.pages.at(-1)}` : ''}</small></span>
          </button>{checked && <button className="reset-section" onClick={() => reset(index)} aria-label={`Reset ${section.name}`}>Reset</button>}
        </div>;
      })}</div>
      <div className="resources-row"><h3>Other required resources</h3>
        {pkg.visited.includes(48) ? <><p>Uses the College website. Internet access is required.</p>
          <Button secondary onClick={() => {
            const opened = window.open('https://www.ocswssw.org/registrants/continuing-competence-program/', '_blank');
            if (!opened) { notify('The browser blocked the new tab. Allow pop-ups and try again. Resources remain unchecked.'); return; }
            opened.opener = null;
            update(current => ({ ...current, resources: true }));
            notify('Demo browser tab opened. This does not verify that the website loaded or was read.');
          }}>Open resources<ArrowUpRight size={14} /></Button>
          {pkg.resources && <><span className="resources-checked"><Check size={15} />Demo browser action recorded</span><button className="text-button" onClick={() => update(current => ({ ...current, resources: false }), ['review'])}>Reset resources action</button></>}
        </> : <p>Available after you display physical page 48. Skipped sections stay unchecked.</p>}
      </div><Readiness pkg={pkg} step="review" onComplete={complete} />
    </aside><PdfReader key={pkg.year} page={pkg.page} onPage={page => update(current => ({ ...current, page }))} onVisit={viewed} /></div>
  </>;
}
function ActivityEditor({ activity, pkg, update, addGoal, deleteActivity, notify }: {
  activity: Activity; pkg: YearPackage; update: Update; addGoal: () => void; deleteActivity: (ref: string) => void; notify: (text: string) => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [draftDate, setDraftDate] = useState(activity.date);
  const [pendingComplete, setPendingComplete] = useState(false);
  const [dateError, setDateError] = useState('');
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => {
    setTitle(activity.title); setDraftDate(activity.date); setPendingComplete(false); setDateError('');
  }, [activity.ref, pkg.year]);
  useEffect(() => {
    if (!preview) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  function edit(patch: Partial<Activity>) {
    update(current => ({ ...current, activities: current.activities.map(item => item.ref === activity.ref ? { ...item, ...patch } : item) }), ['plan']);
  }
  function setStatus(status: ActivityStatus) {
    if (status === 'Completed' && (!validDate(draftDate) || draftDate > today())) {
      setPendingComplete(true); setDateError('Enter the actual completion date, no later than today. Your In Progress draft is kept.');
      if (activity.status === 'Planned') edit({ status: 'In Progress' });
      return;
    }
    setPendingComplete(false); setDateError(''); edit({ status, date: status === 'Completed' ? draftDate : activity.date });
  }
  return <section className="activity-editor">
    <div className="activity-editor-header"><span className="reference">{activity.ref}</span><span>Activity record</span><button className="icon-button" aria-label={`Delete activity ${activity.ref}`} onClick={() => deleteActivity(activity.ref)}><Trash2 size={16} /></button></div>
    <label className="field activity-title"><span>Activity or experience</span><input value={title} onChange={event => {
      setTitle(event.target.value);
      if (event.target.value.trim()) edit({ title: event.target.value });
    }} />{!title.trim() && <small className="error">A title is required. The last valid title is retained in the demo.</small>}</label>
    <label className="field"><span>Description <small>Optional</small></span><textarea aria-label="Activity description" rows={2} value={activity.description} onChange={event => edit({ description: event.target.value })} /></label>
    <fieldset className="goal-link-editor"><legend>Supports these goals</legend>{pkg.goals.map(goal => <label key={goal.ref}><input type="checkbox" checked={activity.goals.includes(goal.ref)} onChange={event => edit({ goals: event.target.checked ? [...activity.goals, goal.ref] : activity.goals.filter(ref => ref !== goal.ref) })} /><span><b>{goal.ref}</b> {goal.title}</span></label>)}
      <button className="text-button" onClick={addGoal}><Plus size={14} />Create and link a new goal</button>
      <p>{activity.goals.length > 1 ? 'Shared activity: evidence and reflection are recorded once for all linked goals.' : !activity.goals.length ? 'No linked goal. This supplementary activity does not block plan readiness.' : 'You can link this activity to more than one goal.'}</p>
    </fieldset>
    <div className="activity-dates"><label className="field"><span>Activity status</span><select aria-label="Activity status" value={pendingComplete ? 'Completed' : activity.status} onChange={event => setStatus(event.target.value as ActivityStatus)}>
      <option>Planned</option><option>In Progress</option><option>Completed</option></select></label>
      <label className="field"><span>Actual completion date</span><input type="date" max={today()} value={draftDate} onChange={event => {
        const value = event.target.value; setDraftDate(value);
        if (validDate(value) && value <= today()) { setDateError(''); edit({ date: value, ...(pendingComplete ? { status: 'Completed' as const } : {}) }); setPendingComplete(false); }
        else { setDateError('Use a valid completion date no later than today. The draft date remains visible.'); }
      }} /></label></div>
    {dateError && <p role="alert" className="error">{dateError}</p>}
    <div className="activity-evidence"><h3>Evidence of learning</h3><p className="quiet">Notes or a valid link are enough. Files are optional.</p>
      <label className="field"><span>Evidence notes</span><textarea aria-label="Evidence notes" rows={3} value={activity.evidence} onChange={event => edit({ evidence: event.target.value })} /></label>
      <label className="field"><span>Evidence link <small>Optional</small></span><input aria-label="Evidence link" type="url" placeholder="https://" value={activity.link} onChange={event => edit({ link: event.target.value })} />
        {activity.link && !validLink(activity.link) && <small className="error">Use a full http:// or https:// address.</small>}</label>
      <div className="attachment-list">{activity.files.map(file => <div key={file.ref}><FileText size={18} /><span><b>{file.ref}</b> {file.name}<small>{(file.bytes / 1024).toFixed(0)} KB; in memory only</small></span>
        <button className="text-button" onClick={() => {
          if (file.file && /^(application\/pdf|image\/)/.test(file.file.type)) setPreview(file.file);
          else notify('This demo previews PDFs and images only. The installed app will explicitly open other documents in their desktop application.');
        }}>Preview</button><button className="icon-button" aria-label={`Remove evidence ${file.ref}`} onClick={() => edit({ files: activity.files.filter(item => item.ref !== file.ref) })}><X size={15} /></button></div>)}</div>
      <label className="file-button"><Plus size={16} />Choose evidence file<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.txt,.csv" onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const extension = file.name.split('.').at(-1)?.toLowerCase();
        if (!extension || !['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'txt', 'csv'].includes(extension)) {
          notify('Unsupported evidence type. Choose a PDF, image, Office document, RTF, text, or CSV file.'); event.target.value = ''; return;
        }
        if (file.size > 52_428_800) { notify('This file exceeds 50 MiB. Choose a smaller file.'); event.target.value = ''; return; }
        update(current => ({
          ...current, nextEvidence: current.nextEvidence + 1,
          activities: current.activities.map(item => item.ref === activity.ref ? { ...item, files: [...item.files, { ref: `E${current.nextEvidence}`, name: file.name, bytes: file.size, file }] } : item),
        }), ['plan']);
        notify('Evidence selected for this demo only. Reloading discards it; no managed copy has been saved.');
        event.target.value = '';
      }} /></label><small className="file-limit">50 MiB per file. Prototype files are not copied to storage.</small>
    </div>
    <label className="field narrative"><span>Application to practice</span><small>How does this learning affect your practice or readiness to practise?</small>
      <textarea aria-label="Application to practice" rows={5} value={activity.reflection} placeholder="Describe what you will do differently..." onChange={event => edit({ reflection: event.target.value })} /></label>
    {preview && <Dialog title={preview.name} close={() => setPreview(null)}>
      {preview.type === 'application/pdf' ? <iframe className="evidence-preview" src={previewUrl} title={preview.name} /> : <img className="evidence-image" src={previewUrl} alt={`Evidence: ${preview.name}`} />}
      <p className="quiet">In-memory preview. No durable attachment has been created.</p>
    </Dialog>}
  </section>;
}
function Plan({ variant, pkg, selected, select, update, addGoal, addActivity, deleteActivity, complete, notify }: {
  variant: Variant; pkg: YearPackage; selected: string; select: (ref: string) => void; update: Update;
  addGoal: () => void; addActivity: () => void; deleteActivity: (ref: string) => void; complete: () => void; notify: (text: string) => void;
}) {
  const activity = pkg.activities.find(item => item.ref === selected) ?? pkg.activities[0];
  const editor = activity ? <ActivityEditor key={`${pkg.year}-${activity.ref}`} activity={activity} pkg={pkg} update={update} addGoal={addGoal} deleteActivity={deleteActivity} notify={notify} /> : <div className="empty-editor"><Sprout size={34} /><h2>Make room for learning.</h2><p>Record an activity, then connect it to a goal or keep it as supplementary learning.</p><Button onClick={addActivity}><Plus size={16} />Add activity</Button></div>;
  const index = <div className="activity-index">{pkg.activities.map(item => <button key={item.ref} className={activity?.ref === item.ref ? 'selected' : ''} onClick={() => select(item.ref)}>
    <span className="reference">{item.ref}</span><strong>{item.title}</strong><span className="index-meta"><Badge state={item.status} /><small>{item.goals.join(', ') || 'No linked goal'}</small></span>
    {item.goals.length > 1 && <small className="shared-note"><Link2 size={12} />Shared activity</small>}
  </button>)}</div>;
  const date = <DateField label="Plan date" value={pkg.planDate} year={pkg.year} onChange={planDate => update(current => ({ ...current, planDate }), ['plan'])} />;
  const ready = <Readiness pkg={pkg} step="plan" onComplete={complete} />;
  return <>
    <PageHeading title={variant === 'B' ? 'A record of learning.' : variant === 'C' ? 'Give your learning a place.' : 'Put learning into practice.'}
      description="Activities support zero, one, or several goals. Evidence and reflections belong to each activity." ><Button onClick={addActivity}><Plus size={17} />Add activity</Button></PageHeading>
    {variant === 'A' ? <div className="desk-plan"><aside><h2>Activities & experiences</h2>{index}<button className="text-button" onClick={addGoal}><Plus size={15} />Add a learning goal</button>{date}{ready}</aside>{editor}</div>
      : variant === 'B' ? <div className="folio-plan"><aside className="folio-plan-outline"><h2>In this plan</h2>{index}<h3>Shared learning goals</h3>{pkg.goals.map(goal => <p className="folio-goal-ref" key={goal.ref}><span className="reference">{goal.ref}</span>{goal.title}</p>)}{date}{ready}</aside><div className="folio-activity-page"><span className="folio-tab">Professional development plan</span>{editor}</div></div>
        : <div className="map-plan"><section className="map-goal-filter"><h2>Goal connections</h2>{pkg.goals.map(goal => <div className="map-goal-line" key={goal.ref}><span className="reference">{goal.ref}</span><strong>{goal.title}</strong>
          <div>{pkg.activities.filter(item => item.goals.includes(goal.ref)).map(item => <button key={item.ref} onClick={() => select(item.ref)} className={activity?.ref === item.ref ? 'chosen' : ''}>{item.ref}</button>)}</div></div>)}
          <button className="text-button" onClick={addGoal}><Plus size={14} />Add goal</button><p className="quiet">Select an activity reference to edit its single shared record.</p></section>
          <div className="map-plan-body"><aside><h2>Activity records</h2>{index}{date}{ready}</aside>{editor}</div></div>}
  </>;
}
function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="modal" aria-label={title} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}
function Years({ packages, openYear, createYear, deleteYear }: { packages: YearPackage[]; openYear: (year: number) => void; createYear: (year: number) => string; deleteYear: (year: number) => void }) {
  const [value, setValue] = useState('2027');
  const [error, setError] = useState('');
  return <>
    <PageHeading title="Your practice, year by year." description="Create a year, revisit an earlier portfolio, or pick up your current work." />
    <section className="year-library">{packages.map(pkg => <div className="year-library-row" key={pkg.year}>
      <button onClick={() => openYear(pkg.year)}><span className="library-year">{pkg.year}</span><div><h2>{pkg.year} year package</h2><p>{pkg.goals.length} goals; {pkg.activities.length} activities{pkg.declaration ? `; declaration recorded ${pkg.declaration}` : ''}</p></div><Badge state={packageState(pkg)} /><ChevronRight size={20} /></button>
      <button className="icon-button" aria-label={`Delete year ${pkg.year}`} onClick={() => deleteYear(pkg.year)}><Trash2 size={17} /></button>
    </div>)}</section>
    <form className="create-year" onSubmit={event => { event.preventDefault(); setError(createYear(Number(value))); }}>
      <label className="field"><span>Calendar year</span><input type="number" min={1900} max={9999} required value={value} onChange={event => { setValue(event.target.value); setError(''); }} /></label>
      <button className="button-primary" type="submit"><Plus size={17} />Create year package</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form><p className="retention-note">Keep portfolios for at least ten years according to the supplied guide. Years stay here indefinitely unless you delete them.</p>
  </>;
}
function Backup({ packages, backupLabel, unbacked, onBackup, onRestore }: {
  packages: YearPackage[]; backupLabel: string; unbacked: boolean; onBackup: () => void; onRestore: () => void;
}) {
  return <>
    <PageHeading title="Keep a copy beyond this device." description="A full-app backup protects every year, its records, review progress, and evidence." />
    <div className="backup-layout"><section className="backup-main"><div className="backup-illustration"><HardDrive size={46} /><span /><FolderOpen size={38} /></div>
      <h2>Your whole portfolio, together.</h2><p>In the installed app, choose a location outside the app’s storage, such as an external drive. There is no automatic cloud sync.</p>
      <div className="backup-summary"><span>{packages.length} year packages</span><span>{packages.reduce((sum, pkg) => sum + pkg.goals.length, 0)} goals</span><span>{packages.reduce((sum, pkg) => sum + pkg.activities.length, 0)} activities</span></div>
      <Button onClick={onBackup}><Download size={18} />Simulate full backup</Button><p className="demo-note">Prototype only: no archive is written. This action updates the in-memory backup indicator.</p>
    </section><aside><section className="backup-state"><h2>Backup status</h2><p><CheckCircle2 size={18} />{backupLabel}</p><Badge state={unbacked ? 'Changes not backed up' : 'Demo backup current'} /><p>Annual portfolio exports are not restorable full-app backups.</p></section>
      <section className="restore-entry"><h2>Restore all years</h2><p>Preview a full backup before replacing the entire dataset. Restore does not merge years.</p><Button secondary onClick={onRestore}>Preview sample restore</Button><p className="demo-note">Sample preview, not an actual file import.</p></section></aside>
    </div>
  </>;
}
export function App() {
  const initial = route();
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [packages, setPackages] = useState(samplePackages);
  const packagesRef = useRef(packages);
  packagesRef.current = packages;
  const [year, setYear] = useState(initial.year);
  const [selected, select] = useState('A2');
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState('');
  const [save, setSave] = useState('Demo saved in memory');
  const [revision, setRevision] = useState(1);
  const [backupRevision, setBackupRevision] = useState(0);
  const [backupTime, setBackupTime] = useState('');
  const [firstRun, setFirstRun] = useState(true);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalError, setGoalError] = useState('');
  const [declarationDate, setDeclarationDate] = useState('');
  const [declarationError, setDeclarationError] = useState('');
  const [deleteRef, setDeleteRef] = useState<{ type: 'goal' | 'activity'; ref: string } | null>(null);
  const [deletingYear, setDeletingYear] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pkg = packages.find(item => item.year === year) ?? packages[0];
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('variant', variant); params.set('screen', screen); params.set('year', String(pkg.year));
    window.history.replaceState(null, '', `/prototype/swcc?${params}`);
  }, [variant, screen, pkg.year]);
  useEffect(() => {
    function restoreRoute() { const next = route(); setVariant(next.variant); setScreen(next.screen); setYear(next.year); }
    window.addEventListener('popstate', restoreRoute);
    return () => { window.removeEventListener('popstate', restoreRoute); if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);
  const update = useCallback<Update>((recipe, affected = []) => {
    const current = packagesRef.current.find(item => item.year === pkg.year);
    if (!current) throw new Error('Selected sample year is unavailable');
    const next = recipe(current);
    if (next === current) return;
    const changed = { ...next, completed: { ...next.completed, ...Object.fromEntries(affected.map(step => [step, false])) } };
    packagesRef.current = packagesRef.current.map(item => item.year === pkg.year ? changed : item);
    setPackages(packagesRef.current);
    setRevision(current => current + 1);
    setSave('Saving in demo...');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSave('Demo saved in memory'), 450);
  }, [pkg.year]);
  function notify(text: string) { setMessage(text); }
  function navigate(next: Screen) { setScreen(next); setMessage(''); }
  function chooseYear(next: number) { setYear(next); select('A2'); setMessage(''); }
  function open(next: Modal) {
    if (next === 'declaration') { setDeclarationDate(pkg.declaration); setDeclarationError(''); }
    if (next === 'goal') { setGoalTitle(''); setGoalDescription(''); setGoalError(''); }
    setModal(next);
  }
  function complete(step: Step) {
    if (blockers(pkg, step).length) { notify('This step is not ready. Review the missing-item checklist.'); return; }
    update(current => ({ ...current, completed: { ...current.completed, [step]: true } }));
    notify(`${stepNames[step]} manually completed in this demo. Relevant edits will reopen it.`);
  }
  function addActivity() {
    const ref = `A${pkg.nextActivity}`;
    update(current => ({
      ...current, nextActivity: current.nextActivity + 1,
      activities: [...current.activities, { ref, title: 'New learning activity', description: '', goals: [], status: 'Planned', date: '', evidence: '', link: '', files: [], reflection: '' }],
    }), ['plan']);
    select(ref);
  }
  function resetSamples() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setPackages(samplePackages()); setYear(2026); select('A2'); setRevision(1); setBackupRevision(0);
    setBackupTime(''); setModal(null); setSave('Demo saved in memory'); notify('Sample records reset. No device records were changed.');
  }
  const backupLabel = backupTime ? `Demo backup ${backupTime}` : 'No full backup yet';
  let content: ReactNode;
  if (screen === 'assessment') content = <Assessment pkg={pkg} update={update} complete={() => complete('assessment')} addGoal={() => open('goal')} deleteGoal={ref => setDeleteRef({ type: 'goal', ref })} />;
  else if (screen === 'review') content = <Review pkg={pkg} update={update} complete={() => complete('review')} notify={notify} />;
  else if (screen === 'plan') content = <Plan variant={variant} pkg={pkg} selected={selected} select={select} update={update} complete={() => complete('plan')} addGoal={() => open('goal')} addActivity={addActivity} deleteActivity={ref => setDeleteRef({ type: 'activity', ref })} notify={notify} />;
  else if (screen === 'years') content = <Years packages={packages} openYear={next => { chooseYear(next); navigate('overview'); }} createYear={next => {
    if (!Number.isInteger(next) || next < 1900 || next > 9999) return 'Enter a calendar year from 1900 to 9999.';
    if (packages.some(item => item.year === next)) return `${next} already exists. Open its year package above.`;
    setPackages(current => [...current, emptyPackage(next)].sort((a, b) => b.year - a.year)); setRevision(current => current + 1);
    chooseYear(next); navigate('overview'); notify(`${next} created in memory. No records will survive reloading.`); return '';
  }} deleteYear={next => { setDeletingYear(next); setModal('delete-year'); }} />;
  else if (screen === 'backup') content = <Backup packages={packages} backupLabel={backupLabel} unbacked={revision !== backupRevision} onBackup={() => {
    setBackupRevision(revision); setBackupTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    notify('Backup simulated. No file was created; the indicator is for comparing this workflow only.');
  }} onRestore={() => open('restore')} />;
  const props: DesignProps = { pkg, packages, screen, navigate, chooseYear, open, children: content, save, backupLabel };
  const Design = variant === 'B' ? VariantB : variant === 'C' ? VariantC : VariantA;
  return <div className={`app variant-${variant}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className="prototype-notice"><span>Throwaway UI prototype</span><span>Sample records only. Reload discards edits. No exports or backups are written.</span></div>
    {firstRun && <div className="first-run-note"><ShieldCheck size={17} /><p><b>Designed to stay on your device.</b> The installed app will need explicit backups. This browser demo stores nothing.</p><button aria-label="Dismiss local storage explanation" onClick={() => setFirstRun(false)}><X size={16} /></button></div>}
    <Design {...props} />
    {message && <div className="feedback-banner" role="status"><span>{message}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={17} /></button></div>}
    <PrototypeSwitcher variant={variant} onChange={setVariant} state={{ question: 'Which desktop structure best supports annual reflection and shared learning?', variant, name: variantNames[variant], screen, selectedYear: pkg.year, selectedActivity: selected, save, revision, backupRevision, packages }} onReset={resetSamples} />
    {modal === 'source' && <Dialog title="About the supplied resources" close={() => setModal(null)}><p>This prototype uses the approved, fixed resource set for every year.</p>
      <dl className="source-details"><dt>Ethics & standards</dt><dd>Second Edition, amended through September 7, 2018; 48 physical pages.</dd><dt>Assessment tool</dt><dd>2026 SAT/PDP document, which references the 2023 Third Edition.</dd><dt>What progress means</dt><dd>Application readiness and your manual completion. Not a guarantee of current-year College compliance.</dd></dl>
      <p>Newer readings and SAPP are not included. This application does not submit or verify external renewal declarations.</p></Dialog>}
    {modal === 'goal' && <Dialog title={screen === 'plan' ? 'Create a shared learning goal' : 'Add a learning goal'} close={() => setModal(null)}>
      <p>{screen === 'plan' ? 'This goal appears in self-assessment and is linked to the activity you are editing.' : 'The same goal will appear in your development plan. No standards are attached to individual goals.'}</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (!goalTitle.trim()) { setGoalError('Name the goal before adding it.'); return; }
        const ref = `G${pkg.nextGoal}`;
        const selectedRef = pkg.activities.find(item => item.ref === selected)?.ref ?? pkg.activities[0]?.ref;
        update(current => ({
          ...current, nextGoal: current.nextGoal + 1, goals: [...current.goals, { ref, title: goalTitle.trim(), description: goalDescription }],
          activities: screen === 'plan' ? current.activities.map(item => item.ref === selectedRef ? { ...item, goals: [...item.goals, ref] } : item) : current.activities,
        }), ['assessment', 'plan']); setModal(null); notify(`${ref} added to the shared annual goals${screen === 'plan' && selectedRef ? ` and linked to ${selectedRef}` : ''}.`);
      }}><label className="field"><span>Goal title</span><input autoFocus value={goalTitle} onChange={event => setGoalTitle(event.target.value)} /></label>
        <label className="field"><span>Description <small>Optional</small></span><textarea aria-label="Goal description" rows={3} value={goalDescription} onChange={event => setGoalDescription(event.target.value)} /></label>
        {goalError && <p className="error" role="alert">{goalError}</p>}<div className="modal-actions"><Button secondary onClick={() => setModal(null)}>Cancel</Button><button className="button-primary" type="submit"><Plus size={16} />{screen === 'plan' ? 'Create and link goal' : 'Add goal'}</button></div></form>
    </Dialog>}
    {modal === 'declaration' && <Dialog title="Record external submission date" close={() => setModal(null)}><p>Enter the date you actually submitted through the College’s renewal process. The app does not submit or verify it.</p>
      {!Object.values(pkg.completed).every(Boolean) && <p className="warning-block">Your application steps are incomplete. You may still record an external submission that already happened.</p>}
      <label className="field"><span>Actual external submission date</span><input type="date" value={declarationDate} onChange={event => { setDeclarationDate(event.target.value); setDeclarationError(''); }} /></label>
      {pkg.declarationRecorded && <p className="quiet">Previously recorded in this demo: {pkg.declarationRecorded}. This is separate from the external submission date.</p>}
      {declarationError && <p className="error" role="alert">{declarationError}</p>}<div className="modal-actions"><Button secondary onClick={() => setModal(null)}>Cancel</Button><Button onClick={() => {
        if (!validDate(declarationDate)) { setDeclarationError('Enter a valid external submission date.'); return; }
        update(current => ({ ...current, declaration: declarationDate, declarationRecorded: new Date().toISOString() }));
        setModal(null); notify('External submission date recorded in memory. Later edits preserve it.');
      }}>Record submission date</Button></div></Dialog>}
    {modal === 'export' && <Dialog title={`${pkg.year} annual export preview`} close={() => setModal(null)}><p>One review checklist, one logical Self-Assessment Tool, and one logical Professional Development Plan. Long entries continue onto additional pages.</p>
      {(!Object.values(pkg.completed).every(Boolean) || !pkg.declaration) && <div className="warning-block"><b>Draft package</b><p>Draft exports are allowed in the installed app. These steps are not manually complete: {steps.filter(step => !pkg.completed[step]).map(step => stepNames[step]).join(', ') || 'none'}.</p>
        <ul>{steps.flatMap(step => blockers(pkg, step)).map(item => <li key={item}>{item}</li>)}</ul></div>}
      <div className="export-options"><div><FileText size={25} /><h3>Forms PDF</h3><p>Checklist, SAT, PDP, and continuation pages. Attachment references, not the files themselves.</p></div><div><FolderOpen size={25} /><h3>Complete portfolio ZIP</h3><p>Forms PDF, evidence index, portfolio manifest, and original evidence files. Not a restorable full backup.</p></div></div>
      <details className="export-projection"><summary>Preview the annual PDP data (each activity appears once)</summary><div className="projection-goals">{pkg.goals.map(goal => <p key={goal.ref}><b>{goal.ref} {goal.title}</b><br />{goal.description}</p>)}</div>{pkg.activities.map(activity => <div key={activity.ref}><h3>{activity.ref} {activity.title}</h3><p>{activity.goals.join(', ') || 'No linked goal'}; {activity.status}{activity.date ? `; ${activity.date}` : ''}</p><p>{activity.description}</p><p><b>Evidence:</b> {activity.evidence} {activity.link} {activity.files.map(file => `${file.ref} ${file.name}`).join(', ')}</p><p><b>Application to practice:</b> {activity.reflection}</p></div>)}</details>
      <p className="demo-note">No PDF or ZIP is generated here. Source templates below are unfilled originals, not exports.</p><div className="template-links"><a href="/checklist.pdf" target="_blank" rel="noreferrer">View checklist source</a><a href="/assessment-tool.pdf#page=8" target="_blank" rel="noreferrer">View SAT source</a><a href="/assessment-tool.pdf#page=11" target="_blank" rel="noreferrer">View PDP source</a></div>
    </Dialog>}
    {modal === 'restore' && <Dialog title="Preview sample full-app restore" close={() => setModal(null)}><p>No backup file was loaded. This sample illustrates the replacement confirmation.</p>
      <div className="restore-compare"><section><h3>Sample backup</h3><p>October 20, 2026</p><p>2026, 2025, 2024</p><p>3 goals, 4 activities, 0 files</p></section><section><h3>Current in-memory data</h3><p>{packages.map(item => item.year).join(', ')}</p><p>{packages.reduce((sum, item) => sum + item.goals.length, 0)} goals, {packages.reduce((sum, item) => sum + item.activities.length, 0)} activities</p></section></div>
      <p className="warning-block">Restore replaces all years; it does not merge them. The installed app must create and verify a recovery backup before replacement. This demo only resets sample state.</p>
      <div className="modal-actions"><Button secondary onClick={() => setModal(null)}>Cancel, keep current data</Button><Button onClick={() => { resetSamples(); notify('Restore simulated by resetting in-memory samples. No filesystem data was replaced or recovery backup created.'); }}>Simulate replacement</Button></div></Dialog>}
    {deleteRef && <Dialog title={`Delete ${deleteRef.type} ${deleteRef.ref}?`} close={() => setDeleteRef(null)}><p>{deleteRef.type === 'goal' ? 'The goal and its activity links will be removed. Activities, their evidence, and reflections will remain.' : 'This removes the activity, its goal links, and its evidence from this demo.'}</p><div className="modal-actions"><Button secondary onClick={() => setDeleteRef(null)}>Cancel</Button><Button className="danger-button" onClick={() => {
      if (deleteRef.type === 'goal') update(current => ({ ...current, goals: current.goals.filter(goal => goal.ref !== deleteRef.ref), activities: current.activities.map(activity => ({ ...activity, goals: activity.goals.filter(ref => ref !== deleteRef.ref) })) }), ['assessment', 'plan']);
      else update(current => ({ ...current, activities: current.activities.filter(activity => activity.ref !== deleteRef.ref) }), ['plan']);
      setDeleteRef(null); notify('Record removed from memory. Public references will not be renumbered or reused.');
    }}>Delete {deleteRef.type}</Button></div></Dialog>}
    {modal === 'delete-year' && <Dialog title={`Delete the ${deletingYear} year package?`} close={() => setModal(null)}><p>This removes its assessment, goals, activities, review progress, and evidence. The supplied guide describes retaining portfolios for at least ten years.</p>
      {packages.length === 1 && <p className="warning-block">Keep at least one year in this UI demo. Create another year before removing this one.</p>}<div className="modal-actions"><Button secondary onClick={() => setModal(null)}>Keep year</Button><Button className="danger-button" disabled={packages.length === 1} onClick={() => {
        const remaining = packages.filter(item => item.year !== deletingYear);
        setPackages(remaining); if (pkg.year === deletingYear) setYear(remaining[0].year);
        setRevision(current => current + 1); setModal(null); notify('Year removed from demo memory only.');
      }}>Delete year package</Button></div></Dialog>}
  </div>;
}
