import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { BookOpen, Check, ClipboardList, Home, Layers, HardDrive, Sprout, Network } from 'lucide-react';
import type { AppState, DesktopOperations, EvidenceAttachment, Result, YearPackage } from '../shared/application.js';
import { localDate } from '../shared/application.js';
import { hasSubstantiveAssessmentContent } from '../shared/assessment.js';
import { activityDateError } from '../shared/plan.js';
import { DraftSession } from './draft-session.js';
import { AssessmentScreen, Dialog } from './assessment-screen.js';
import { PlanScreen } from './plan-screen.js';
import { ANNUAL_STEPS, evaluateWorkflow } from '../shared/workflow.js';
import type { AnnualStep } from '../shared/workflow.js';
import { AnnualWorkflowPanel, DeclarationDialog, FormsExportDialog } from './annual-workflow.js';
import { ReviewSession } from './review-session.js';
import { Review } from './Review.js';
import { BackupScreen } from './backup-screen.js';
import type { BackupProgress } from '../shared/backup.js';
import type { PortfolioProgress } from '../shared/portfolio.js';
import { PortfolioExportDialog } from './portfolio-dialog.js';
import type { RestorePreview, RestoreProgress } from '../shared/restore.js';
import { RestorePreviewDialog } from './backup-screen.js';
import { useProgressMonitor } from './operation-progress.js';
import { useActionFeedback } from './action-feedback.js';
import { useMotionCoordinator } from './motion.js';

type Screen = 'years' | 'overview' | 'assessment' | 'plan' | 'review' | 'backup';
type RailMarker = { left: number; top: number; width: number; height: number; moving: boolean };
const movingDestinations = new Set<Screen>(['overview', 'review', 'assessment', 'plan']);
export interface PrototypeOverviewProps {
  children: ReactNode;
  pkg: YearPackage;
  navigate: (screen: 'assessment' | 'plan') => void;
  openActivity: (id: string | null) => void;
}
export type PrototypeTransition = (kind: 'page' | 'activity', commit: () => void, animate?: boolean) => void;
function OverviewContent({ children }: PrototypeOverviewProps) {
  return <>{children}</>;
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const destinations = [
  { screen: 'overview', name: 'Year overview', icon: Home },
  { screen: 'review', name: 'Review', icon: BookOpen },
  { screen: 'assessment', name: 'Self-assessment', icon: ClipboardList },
  { screen: 'plan', name: 'Development plan', icon: Network },
  { screen: 'years', name: 'All years', icon: Layers },
  { screen: 'backup', name: 'Backup and restore', icon: HardDrive },
] as const;

export function App({ operations, prototypeOverview: Overview = OverviewContent }: {
  operations: DesktopOperations;
  prototypeOverview?: ComponentType<PrototypeOverviewProps>;
  prototypeTransition?: PrototypeTransition;
}) {
  const { showFeedback, successSequence } = useActionFeedback();
  const [session] = useState(() => new DraftSession(operations));
  const [reviewSession] = useState(() => new ReviewSession(operations));
  const flushEdits = useCallback(async () => {
    await Promise.all([session.flush(), reviewSession.flush()]);
  }, [session, reviewSession]);
  const draft = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const review = useSyncExternalStore(reviewSession.subscribe, reviewSession.getSnapshot);
  useEffect(() => {
    if (!draft.failureEvent) return;
    showFeedback({
      title: 'Draft could not be saved',
      message: draft.failureEvent.message,
      kind: 'error',
    });
  }, [draft.failureEvent, showFeedback]);
  useEffect(() => {
    if (!review.failureEvent) return;
    showFeedback({
      title: 'Review progress could not be saved',
      message: review.failureEvent.message,
      kind: 'error',
    });
  }, [review.failureEvent, showFeedback]);
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('years');
  const screenRef = useRef(screen);
  const navigationRef = useRef<HTMLElement | null>(null);
  const markerScreenRef = useRef<Screen | null>(null);
  const [railMarker, setRailMarker] = useState<RailMarker | null>(null);
  const [year, setYear] = useState(localDate().slice(0, 4));
  const [error, setError] = useState<string | null>(null);
  const reportMotionFailure = useCallback((failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    setError(message);
    showFeedback({ title: 'Visual transition could not be completed', message, kind: 'error' });
  }, [showFeedback]);
  const motion = useMotionCoordinator(reportMotionFailure);
  const [sproutSequence, setSproutSequence] = useState(0);
  const [sproutAnimating, setSproutAnimating] = useState(false);
  const handledSuccessSequence = useRef(successSequence);
  useLayoutEffect(() => {
    if (handledSuccessSequence.current === successSequence) return;
    handledSuccessSequence.current = successSequence;
    if (motion.disabled) return;
    setSproutSequence(sequence => sequence + 1);
    setSproutAnimating(true);
  }, [motion.disabled, successSequence]);
  const saveStatus = state
    ? [draft.status, review.status].includes('Not saved') ? 'Not saved'
      : [draft.status, review.status].includes('Saving') ? 'Saving' : 'Saved'
    : error ? 'Unavailable' : 'Opening records';
  const [saveResponseSequence, setSaveResponseSequence] = useState(0);
  const [saveResponseActive, setSaveResponseActive] = useState(false);
  const previousSaveStatus = useRef(saveStatus);
  useLayoutEffect(() => {
    const previous = previousSaveStatus.current;
    previousSaveStatus.current = saveStatus;
    if (previous === 'Saving' && saveStatus === 'Saved' && !motion.disabled) {
      setSaveResponseSequence(sequence => sequence + 1);
      setSaveResponseActive(true);
    }
  }, [motion.disabled, saveStatus]);
  const [busy, setBusy] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgress>({
    phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0,
  });
  const [restoreRunning, setRestoreRunning] = useState(false);
  const [restoreReplacing, setRestoreReplacing] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress>({
    phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0,
  });
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const selectedActivityIdRef = useRef<string | null>(null);
  const [recordRequested, setRecordRequested] = useState(false);
  const [deletingYear, setDeletingYear] = useState<{ id: string; year: number } | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [showFormsExport, setShowFormsExport] = useState(false);
  const [showPortfolioExport, setShowPortfolioExport] = useState(false);
  const [portfolioRunning, setPortfolioRunning] = useState(false);
  const [portfolioProgress, setPortfolioProgress] = useState<PortfolioProgress>({
    phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0,
  });
  const [evidenceByPackage, setEvidenceByPackage] = useState<Record<string, EvidenceAttachment[]>>({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const [hoveredActivityId, setHoveredActivityId] = useState<string | null>(null);
  const [focusedActivityId, setFocusedActivityId] = useState<string | null>(null);
  const pkg = draft.record;
  const linkedActivityId = hoveredActivityId ?? focusedActivityId;
  function updateSelectedActivity(id: string | null) {
    selectedActivityIdRef.current = id;
    setSelectedActivityId(id);
  }
  function clearActivityAssociation() {
    setHoveredActivityId(null);
    setFocusedActivityId(null);
  }
  const measureRailMarker = useCallback((target: Screen, moving = false) => {
    if (!movingDestinations.has(target)) {
      setRailMarker(null);
      return;
    }
    const navigation = navigationRef.current;
    const button = navigation?.querySelector<HTMLButtonElement>(`button[data-screen="${target}"]`);
    if (!navigation || !button) return;
    setRailMarker({
      left: button.offsetLeft,
      top: button.offsetTop,
      width: button.offsetWidth,
      height: button.offsetHeight,
      moving,
    });
  }, []);
  useLayoutEffect(() => {
    const previous = markerScreenRef.current;
    markerScreenRef.current = screen;
    const moving = previous !== null && previous !== screen
      && movingDestinations.has(previous) && movingDestinations.has(screen) && !motion.disabled;
    measureRailMarker(screen, moving);
  }, [screen, motion.disabled, measureRailMarker]);
  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    const snapMarker = () => {
      const current = markerScreenRef.current;
      if (current) measureRailMarker(current);
    };
    const observer = new ResizeObserver(snapMarker);
    observer.observe(navigation);
    navigation.querySelectorAll('button').forEach(button => observer.observe(button));
    window.addEventListener('resize', snapMarker);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', snapMarker);
    };
  }, [measureRailMarker]);
  useEffect(() => {
    if (screen !== 'overview') {
      setHoveredActivityId(null);
      setFocusedActivityId(null);
    }
  }, [screen]);
  function hasInvalidActivityDate() {
    return Boolean(session.getSnapshot().record?.activities.some(activity => activityDateError(activity)));
  }
  const packageEvidence = pkg ? evidenceByPackage[pkg.id] ?? [] : [];
  const readableEvidenceActivityIds = new Set(packageEvidence
    .filter(entry => entry.integrity === 'readable').map(entry => entry.activityId));
  const reviewRecord = review.record?.packageId === pkg?.id ? review.record : null;
  const effectivePackage = pkg ? { ...pkg, reviewRevision: reviewRecord?.reviewRevision ?? pkg.reviewRevision } : null;
  const workflow = effectivePackage ? evaluateWorkflow(effectivePackage,
    reviewRecord ?? { visitedPages: [], resourcesLaunchedAt: null }, undefined, readableEvidenceActivityIds) : null;
  const backupMonitor = useProgressMonitor(backupRunning, operations.getBackupProgress, setBackupProgress);
  const portfolioMonitor = useProgressMonitor(portfolioRunning, operations.getPortfolioProgress, setPortfolioProgress);
  const restoreMonitor = useProgressMonitor(restoreRunning, operations.getRestoreProgress, setRestoreProgress);
  useEffect(() => {
    if (pkg) void reviewSession.open(pkg.id).catch(() => {});
  }, [pkg?.id, reviewSession]);
  useEffect(() => {
    void operations.getState().then(result => {
      if (!result.ok) {
        setError(result.error.message);
        showFeedback({ title: 'Local records are unavailable', message: result.error.message, kind: 'error' });
        return;
      }
      setState(result.value);
      if (result.value.recoveryNotice) showFeedback({
        title: 'Local records were recovered',
        message: result.value.recoveryNotice,
        kind: 'info',
      });
      session.open(result.value.selectedPackage);
      if (result.value.selectedPackage) {
        screenRef.current = 'overview';
        setScreen('overview');
      }
    }).catch(() => {
      const message = 'Cannot connect to local records. Preserve your storage folder and restart SWCC.';
      setError(message);
      showFeedback({ title: 'Local records are unavailable', message, kind: 'error' });
    });
    return operations.onCloseRequested(() => {
      void flushEdits().then(() => operations.completeClose()).then(result => {
        if (!result.ok) {
          setError(result.error.message);
          showFeedback({ title: 'SWCC could not close safely', message: result.error.message, kind: 'error' });
        }
      }).catch(() => { /* The session displays the retained edit and retry action. */ });
    });
  }, [operations, session, reviewSession, flushEdits, showFeedback]);
  useEffect(() => {
    if (!pkg) return;
    let active = true;
    void operations.getEvidence(pkg.id).then(result => {
      if (!active) return;
      if (!result.ok) {
        setEvidenceErrors(previous => ({ ...previous, [pkg.id]: result.error.message }));
        return;
      }
      setEvidenceByPackage(previous => ({ ...previous, [pkg.id]: result.value }));
      setEvidenceErrors(previous => ({ ...previous, [pkg.id]: '' }));
    }).catch(failure => {
      if (active) setEvidenceErrors(previous => ({
        ...previous, [pkg.id]: failure instanceof Error ? failure.message : String(failure),
      }));
    });
    return () => { active = false; };
  }, [operations, pkg?.id]);
  async function refreshEvidence(packageId: string) {
    const result = await operations.getEvidence(packageId);
    if (!result.ok) {
      setEvidenceErrors(previous => ({ ...previous, [packageId]: result.error.message }));
      throw new Error(result.error.message);
    }
    setEvidenceByPackage(previous => ({ ...previous, [packageId]: result.value }));
    setEvidenceErrors(previous => ({ ...previous, [packageId]: '' }));
    return result.value;
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await flushEdits(); await work(); }
    catch (failure) {
      if (!session.getSnapshot().error && !reviewSession.getSnapshot().error && !hasInvalidActivityDate()) {
        const message = failure instanceof Error ? failure.message : String(failure);
        setError(message);
        showFeedback({ title: 'Action could not be completed', message, kind: 'error' });
      } else if (!session.getSnapshot().error && !reviewSession.getSnapshot().error) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
    finally { setBusy(false); }
  }
  function retryDraftSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    void session.retry().catch(() => {}).finally(() => setBusy(false));
  }
  function retryReviewSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const activeRecord = reviewSession.getSnapshot().record;
    const retry = activeRecord ? reviewSession.retry() : pkg ? reviewSession.open(pkg.id) : Promise.resolve();
    void retry.catch(() => {}).finally(() => setBusy(false));
  }
  function backup() {
    void run(async () => {
      setBackupRunning(true);
      setBackupProgress({ phase: 'choosing', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 });
      try {
        const result = unwrap(await operations.createFullBackup());
        setError(null);
        setState(unwrap(await operations.getState()));
        showFeedback(result.cancelled ? {
          title: 'Backup cancelled',
          message: 'The last successful backup is unchanged.',
          kind: 'info',
        } : {
          title: 'Full backup saved',
          message: `${result.fileName} was saved. Store this backup on another device.`,
          kind: 'success',
        });
      } finally { setBackupRunning(false); }
    });
  }
  function inspectBackup() {
    void run(async () => {
      setRestoreRunning(true);
      setRestoreProgress({ phase: 'choosing', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 });
      try {
        const outcome = unwrap(await operations.inspectFullBackup());
        setError(null);
        if (outcome.cancelled) showFeedback({
          title: 'Backup inspection cancelled',
          message: 'Live records and backup status are unchanged.',
          kind: 'info',
        });
        else setRestorePreview(outcome.preview);
      } finally {
        const progress = await operations.getRestoreProgress();
        if (progress.ok) setRestoreProgress(progress.value);
        setRestoreRunning(false);
      }
    });
  }
  function replaceBackup() {
    const preview = restorePreview;
    if (!preview) return;
    void run(async () => {
      setRestoreRunning(true);
      setRestoreReplacing(true);
      setRestoreProgress(previous => ({ ...previous, phase: 'protecting' }));
      try {
        const result = await operations.replaceFullDataset({ previewId: preview.id, confirmed: true });
        setRestorePreview(null);
        const outcome = unwrap(result);
        setState(outcome.state);
        session.open(outcome.state.selectedPackage);
        updateSelectedActivity(null);
        setRecordRequested(false);
        clearActivityAssociation();
        setEvidenceByPackage({});
        setEvidenceErrors({});
        await reviewSession.open(outcome.state.selectedPackage?.id ?? null);
        if (outcome.state.selectedPackage) await refreshEvidence(outcome.state.selectedPackage.id);
        setError(null);
        showFeedback({
          title: 'All years restored',
          message: `The restored dataset passed validation. Protective backup of your previous data: ${outcome.protectiveBackup}. Create a new full backup beyond this device.${outcome.cleanupWarning ?? ''}`,
          kind: 'success',
        });
      } finally {
        setRestoreRunning(false);
        setRestoreReplacing(false);
        setRestoreProgress({ phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 });
      }
    });
  }
  async function cancelInspection() {
    if (restoreReplacing) return;
    if (busy && !restoreRunning) return;
    if (restoreRunning) {
      const result = await operations.cancelRestorePreview();
      if (!result.ok) {
        setError(result.error.message);
        showFeedback({ title: 'Could not cancel backup inspection', message: result.error.message, kind: 'error' });
      }
      return;
    }
    setBusy(true);
    try {
      unwrap(await operations.cancelRestorePreview());
      setError(null);
      setRestorePreview(null);
      setRestoreProgress({ phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 });
      showFeedback({
        title: 'Backup inspection cancelled',
        message: 'Live records and backup status are unchanged.',
        kind: 'info',
      });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      showFeedback({ title: 'Could not cancel backup inspection', message, kind: 'error' });
    }
    finally { setBusy(false); }
  }
  function switchScreen(next: Screen, intent: number, beforeCommit?: () => void) {
    motion.transition(intent, 'page', () => {
      beforeCommit?.();
      if (next !== 'overview') clearActivityAssociation();
      screenRef.current = next;
      setScreen(next);
    }, next !== screenRef.current);
  }
  function navigate(next: Screen) {
    const intent = motion.beginIntent();
    void run(async () => {
      if (!pkg && !['years', 'backup'].includes(next)) { switchScreen('years', intent); return; }
      if (next === 'years' || next === 'backup') setState(unwrap(await operations.getState()));
      switchScreen(next, intent);
    });
  }
  function open(id: string) {
    const intent = motion.beginIntent();
    void run(async () => {
      session.open(unwrap(await operations.openYear(id)));
      updateSelectedActivity(null);
      setRecordRequested(false);
      clearActivityAssociation();
      setState(unwrap(await operations.getState()));
      switchScreen('overview', intent);
    });
  }
  async function create() {
    const intent = motion.beginIntent();
    await run(async () => {
      const result = await operations.createYear(Number(year));
      if (!result.ok) {
        setError(result.error.message);
        const existingPackageId = result.error.code === 'DUPLICATE_YEAR' ? result.error.existingPackageId : undefined;
        showFeedback({
          title: existingPackageId ? 'Year package already exists' : 'Could not create year package',
          message: result.error.message,
          kind: 'error',
          ...(existingPackageId ? {
            action: { label: 'Open existing package', onClick: () => open(existingPackageId) },
          } : {}),
        });
        return;
      }
      session.open(result.value);
      setState(unwrap(await operations.getState()));
      switchScreen('overview', intent);
    });
  }
  async function deleteYear() {
    if (!deletingYear || busy) return;
    const intent = motion.beginIntent();
    setBusy(true);
    try {
      await flushEdits();
      const current = unwrap(await operations.getState());
      const target = current.years.find(item => item.id === deletingYear.id);
      if (!target) throw new Error('This year package no longer exists. Refresh the year list before retrying.');
      const result = await operations.deleteYear({
        packageId: target.id, expectedRevision: target.contentRevision, confirmed: true,
      });
      if (!result.ok) {
        if (result.error.committed) {
          const refreshed = await operations.getState();
          if (refreshed.ok) {
            setState(refreshed.value);
            session.open(refreshed.value.selectedPackage);
            if (refreshed.value.selectedPackage) await reviewSession.open(refreshed.value.selectedPackage.id);
            switchScreen(refreshed.value.selectedPackage ? 'overview' : 'years', intent, () => {
              updateSelectedActivity(null);
              setRecordRequested(false);
            });
            setDeletingYear(null);
            setError(result.error.message);
            showFeedback({ title: 'Year deletion needs attention', message: result.error.message, kind: 'error' });
            return;
          }
        }
        throw new Error(result.error.message);
      }
      setState(result.value);
      session.open(result.value.selectedPackage);
      if (result.value.selectedPackage) await reviewSession.open(result.value.selectedPackage.id);
      setDeletingYear(null);
      switchScreen(result.value.selectedPackage ? 'overview' : 'years', intent, () => {
        updateSelectedActivity(null);
        setRecordRequested(false);
      });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      showFeedback({ title: 'Could not delete year package', message, kind: 'error' });
    } finally { setBusy(false); }
  }
  function activityEntry(id: string | null) {
    const intent = motion.beginIntent();
    void run(async () => {
      switchScreen('plan', intent, () => {
        updateSelectedActivity(id);
        setRecordRequested(!id);
      });
    });
  }
  function reportActivityError(message: string) {
    if (session.getSnapshot().error) return;
    setError(message);
    if (!hasInvalidActivityDate()) showFeedback({ title: 'Activity record needs attention', message, kind: 'error' });
  }
  function selectPlanActivity(id: string) {
    const intent = motion.beginIntent();
    void flushEdits().then(() => {
      const currentId = selectedActivityIdRef.current ?? pkg?.activities[0]?.id ?? null;
      motion.transition(intent, 'activity', () => updateSelectedActivity(id), id !== currentId);
    }).catch(failure => {
      reportActivityError(failure instanceof Error ? failure.message : String(failure));
    });
  }
  function complete(step: AnnualStep) {
    void run(async () => {
      const current = session.getSnapshot().record;
      if (!current) return;
      const latest = unwrap(await operations.getWorkflow(current.id));
      const result = await operations.completeStep({
        packageId: current.id, step, expectedRevision: latest.steps[step].relevantRevision,
      });
      const stepNumber = ANNUAL_STEPS.indexOf(step) + 1;
      if (!result.ok) {
        if (result.error.code === 'NOT_READY') {
          showFeedback({
            title: `Step ${stepNumber} is not ready`,
            message: 'This step is not ready for manual completion.',
            kind: 'error',
            reasons: result.error.missing ?? [],
            reasonsLabel: `Step ${stepNumber} readiness reasons`,
          });
          return;
        }
        throw new Error(result.error.message);
      }
      const completed = result.value;
      session.acceptSaved(completed);
      await refreshEvidence(current.id);
      setState(unwrap(await operations.getState()));
      showFeedback({
        title: `Step ${stepNumber} completed`,
        message: 'This step was manually confirmed. Application completion is not College compliance.',
        kind: 'success',
      });
    });
  }
  function openDeclaration() {
    void run(async () => {
      const current = session.getSnapshot().record;
      if (!current) return;
      session.acceptSaved(unwrap(await operations.openYear(current.id)));
      setDeclaring(true);
    });
  }
  async function saveDeclaration(date: string, warned: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await flushEdits();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before recording a declaration.');
      session.acceptSaved(unwrap(await operations.recordDeclaration({
        packageId: current.id, expectedRevision: current.contentRevision, date,
        ...(warned ? { confirmIncomplete: true as const } : {}),
      })));
      setState(unwrap(await operations.getState()));
      setDeclaring(false);
      showFeedback({
        title: 'External submission date recorded',
        message: 'SWCC has not submitted or verified a declaration.',
        kind: 'success',
      });
    } finally { setBusy(false); }
  }
  function openExport(kind: 'forms' | 'portfolio') {
    void run(async () => {
      const current = session.getSnapshot().record;
      if (!current) return;
      session.acceptSaved(unwrap(await operations.openYear(current.id)));
      await reviewSession.open(current.id);
      await refreshEvidence(current.id);
      setShowFormsExport(kind === 'forms');
      setShowPortfolioExport(kind === 'portfolio');
    });
  }
  async function exportForms(confirmDraft: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await flushEdits();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before exporting its forms.');
      const outcome = unwrap(await operations.exportForms({
        packageId: current.id, ...(confirmDraft ? { confirmDraft: true as const } : {}),
      }));
      if (outcome.cancelled) {
        showFeedback({
          title: 'Forms PDF export cancelled',
          message: 'No output was published.',
          kind: 'info',
        });
      } else {
        setShowFormsExport(false);
        showFeedback({
          title: 'Forms PDF exported',
          message: `${outcome.fileName} is ready (${outcome.pageCount} pages). This is not a full-app backup.`,
          kind: 'success',
        });
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      showFeedback({ title: 'Forms PDF export failed', message, kind: 'error' });
    } finally { setBusy(false); }
  }
  async function exportPortfolio(confirmDraft: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await flushEdits();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before exporting its portfolio.');
      setPortfolioProgress({ phase: 'waiting', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 });
      setPortfolioRunning(true);
      const outcome = unwrap(await operations.exportPortfolio({
        packageId: current.id, ...(confirmDraft ? { confirmDraft: true as const } : {}),
      }));
      setError(null);
      if (outcome.cancelled) {
        showFeedback({
          title: 'Portfolio export cancelled',
          message: 'No output was published.',
          kind: 'info',
        });
      } else {
        setShowPortfolioExport(false);
        showFeedback({
          title: 'Complete Portfolio ZIP exported',
          message: `${outcome.fileName} is ready (${outcome.pageCount} forms pages; ${outcome.attachmentCount} original evidence files). This is not a full-app backup.`,
          kind: 'success',
        });
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      showFeedback({ title: 'Portfolio export failed', message, kind: 'error' });
    } finally { setPortfolioRunning(false); setBusy(false); }
  }
  return <div className="map-layout">
    <aside className="map-rail" aria-label="Portfolio navigation">
      <div className="map-mark">
        <Sprout key={sproutSequence} className={sproutAnimating ? 'sprout-response' : undefined} size={29} aria-hidden="true"
          onAnimationEnd={event => {
            if (event.animationName === 'swcc-sprout-response') setSproutAnimating(false);
          }} />
        <span className="sr-only">SWCC</span>
      </div>
      <nav ref={navigationRef}>
        {railMarker && <span aria-hidden="true" className="rail-selection-marker" data-moving={railMarker.moving}
          style={{ transform: `translate3d(${railMarker.left}px, ${railMarker.top}px, 0)`,
            width: `${railMarker.width}px`, height: `${railMarker.height}px` }}
          onTransitionEnd={event => {
            if (event.target === event.currentTarget && event.propertyName === 'transform') {
              setRailMarker(current => current ? { ...current, moving: false } : current);
            }
          }} />}
        {destinations.map(({ screen: destination, name, icon: Icon }) => <button type="button" key={destination} data-screen={destination} aria-label={name}
        aria-current={screen === destination ? 'page' : undefined} disabled={busy} onClick={() => navigate(destination)}>
        <Icon size={22} aria-hidden="true" /><span>{name}</span>
      </button>)}</nav>
    </aside>
    <div className="map-workspace"><header className="map-top">
      <div className="map-wordmark">SWCC <span>My learning portfolio</span></div>
      <label className="year-picker"><span>Year package</span><select value={pkg?.id ?? ''} disabled={busy || !state?.years.length} onChange={event => open(event.target.value)}>
        {!pkg && <option value="">Choose a year</option>}
        {state?.years.map(row => <option key={row.id} value={row.id}>{row.year}</option>)}
      </select></label>
      <span className={`save-status ${saveStatus === 'Not saved' ? 'warning' : ''}`} role="status" aria-label="Save status">
        <span key={saveResponseSequence} className="save-status-content" data-response={saveResponseActive ? 'true' : undefined}
          onAnimationEnd={event => {
            if (event.animationName === 'save-status-response') setSaveResponseActive(false);
          }}>
          {saveStatus}
          {saveStatus === 'Saved' && <Check size={14} aria-hidden="true" />}
        </span>
      </span>
    </header>
    <main id="main-content" tabIndex={-1}>
      {state && !state.acknowledgedAt && <section className="storage-note" aria-labelledby="local-storage-title">
        <h2 id="local-storage-title">Your records stay on this device.</h2>
        <p>SWCC stores records and evidence under your OS user account. No account or cloud sync. Protect your portfolio with explicit backups; an annual export is not a full backup.</p>
        <p className="storage-path">{state.storageDirectory}</p>
        <button type="button" onClick={() => void run(async () => setState(unwrap(await operations.acknowledgeStorage())))} disabled={busy}>I understand</button>
      </section>}
      {draft.error && <section className="error-panel" role="alert">
        <p>{draft.error}</p>
        <p>Your unsaved edits remain visible. Navigation and close are blocked until saving succeeds. Copy your text elsewhere if recovery is needed.</p>
        <button onClick={retryDraftSave} disabled={busy}>Retry save</button>
      </section>}
      {error && hasInvalidActivityDate() && <section className="error-panel" role="alert"><p>{error}</p></section>}
      {review.error && review.status === 'Not saved' && screen !== 'review' && <section className="error-panel" role="alert"><p>{review.error}</p>
        {review.status === 'Not saved' && <button disabled={busy} onClick={retryReviewSave}>Retry review save</button>}
      </section>}
      {!state && !error && <p role="status">Opening local records…</p>}
      <div className="page-transition-scope">
      {screen === 'years' && <><div className="page-heading"><h1>Your year packages</h1><p>One portfolio per calendar year. Earlier years stay open for editing.</p></div>
        <section className="surface">
          <form className="create-year" onSubmit={event => { event.preventDefault(); void create(); }}>
            <label className="field"><span>New package year</span><input type="number" min="1" max="9999" step="1" required value={year} onChange={event => setYear(event.target.value)} /></label>
            <button type="submit" disabled={busy || !state}>Create year package</button>
          </form>
          {state?.years.length === 0 && <p className="empty">Start with this year, or create a past year to backfill your records.</p>}
          <ul className="year-list">{state?.years.map(row => <li key={row.id}><div><strong>{row.year}</strong><span>{row.status} · application completion</span></div>
            <div className="year-actions"><button disabled={busy} onClick={() => open(row.id)}>Open {row.year}</button>
              <button type="button" className="text-button year-delete" disabled={busy}
                aria-label={`Delete year ${row.year}`} onClick={() => setDeletingYear(row)}>Delete</button></div></li>)}</ul>
        </section></>}
      {screen === 'overview' && pkg && <><div className="page-heading map-heading"><h1>Year overview</h1></div>
        <div className="map-overview">
          {workflow && <AnnualWorkflowPanel pkg={pkg} workflow={workflow} busy={busy} navigate={navigate}
            declare={openDeclaration} exportForms={() => openExport('forms')} exportPortfolio={() => openExport('portfolio')} />}
          <Overview pkg={pkg} navigate={navigate} openActivity={activityEntry}>
          <section className="relationship-board surface" onPointerLeave={() => setHoveredActivityId(null)}><div className="relationship-columns">
          <div className="overview-column"><h2>Learning goals</h2><div className="goal-nodes">
            {pkg.goals.map(goal => <article className="goal-node" key={goal.id}><span className="goal-reference">{goal.ref}</span><h3>{goal.title}</h3>
              {goal.description && <p>{goal.description}</p>}
              <div className="goal-activity-refs">{pkg.activities.filter(activity => activity.goalIds.includes(goal.id)).map(activity =>
                <button type="button" key={activity.id} data-activity-id={activity.id} aria-label={`Open ${activity.ref} from ${goal.ref}`}
                  onPointerEnter={() => setHoveredActivityId(activity.id)}
                  onPointerLeave={() => setHoveredActivityId(current => current === activity.id ? null : current)}
                  onFocus={() => setFocusedActivityId(activity.id)}
                  onBlur={() => setFocusedActivityId(current => current === activity.id ? null : current)}
                  onClick={() => activityEntry(activity.id)}>{activity.ref}</button>)}</div>
              {!pkg.activities.some(activity => activity.goalIds.includes(goal.id)) && <small>No supporting activity yet</small>}
            </article>)}
            {!pkg.goals.length && <p>No goals yet. Add one from self-assessment or development plan.</p>}
            </div>
            <button className="secondary" onClick={() => navigate('assessment')}>
              {hasSubstantiveAssessmentContent(pkg) ? 'Update your self assessment' : 'Write your self assessment'}
            </button>
          </div>
          <div className="overview-column"><h2>Activities</h2><div className="activity-nodes">{pkg.activities.map(activity => <button type="button" key={activity.id}
            className={`activity-node${linkedActivityId === activity.id ? ' associated' : ''}`} data-activity-id={activity.id}
            aria-label={`Open activity ${activity.ref}: ${activity.title}`} onClick={() => activityEntry(activity.id)}>
            <div><span className="goal-reference">{activity.ref}</span><span className="activity-state">{activity.status}</span></div><h3>{activity.title}</h3>
            <span className="goal-link-chips">{activity.goalIds.length ? pkg.goals.filter(goal => activity.goalIds.includes(goal.id)).map(goal => <span key={goal.id}>{goal.ref}</span>)
              : <small>No linked goal · supplementary</small>}</span>
          </button>)}
          {!pkg.activities.length && <p>Record an activity and connect it to a goal, or keep it supplementary.</p>}</div>
          <button className="secondary" onClick={() => navigate('plan')}>View development plan</button></div>
        </div></section></Overview>
          </div></>}
      {screen === 'assessment' && pkg && <AssessmentScreen pkg={pkg} session={session} operations={operations}
        flushEdits={flushEdits}
        complete={() => complete('assessment')} busy={busy} motionDisabled={motion.disabled} />}
      {screen === 'plan' && pkg && <PlanScreen key={pkg.id} pkg={pkg} session={session} operations={operations}
        flushEdits={flushEdits}
        selectedId={selectedActivityId} select={updateSelectedActivity} onSelectActivity={selectPlanActivity}
        recordRequested={recordRequested} clearRecordRequest={() => setRecordRequested(false)}
        evidence={packageEvidence} evidenceError={evidenceErrors[pkg.id] ?? ''}
        evidenceLoaded={Object.hasOwn(evidenceByPackage, pkg.id)} refreshEvidence={() => refreshEvidence(pkg.id)}
        reportError={reportActivityError}
        complete={() => complete('plan')} busy={busy} motionDisabled={motion.disabled} />}
      {screen === 'review' && pkg && workflow && <Review packageId={pkg.id} year={pkg.year} operations={operations} session={reviewSession}
        feedback={workflow.steps.review} complete={() => complete('review')} busy={busy} />}
      {screen === 'backup' && state && <BackupScreen state={state} busy={busy} running={backupRunning} progress={backupProgress}
        backupMonitor={backupMonitor} restoreMonitor={restoreMonitor}
        backup={backup} cancel={() => void operations.cancelFullBackup().then(result => {
          if (!result.ok) {
            setError(result.error.message);
            showFeedback({ title: 'Could not cancel full backup', message: result.error.message, kind: 'error' });
          }
        })}
        inspect={inspectBackup} inspecting={restoreRunning} replacing={restoreReplacing} restoreProgress={restoreProgress} cancelInspection={() => void cancelInspection()} />}
      </div>
      {restorePreview && <RestorePreviewDialog preview={restorePreview} busy={busy} replacing={restoreReplacing} progress={restoreProgress}
        monitor={restoreMonitor}
        replace={replaceBackup} cancel={() => void cancelInspection()} />}
      {deletingYear && <Dialog title={`Delete year ${deletingYear.year}?`} onClose={() => {
        if (!busy) setDeletingYear(null);
      }}>
        <p className="goal-dialog-copy">The supplied guide advises keeping portfolios for at least 10 years. Deleting {deletingYear.year} permanently removes that year’s records and evidence files. Save a copy before deleting if you need to keep them.</p>
        <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={busy}
          onClick={() => setDeletingYear(null)}>Keep year</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void deleteYear()}>Delete {deletingYear.year} year package</button></div>
      </Dialog>}
      {declaring && pkg && workflow && <DeclarationDialog pkg={pkg} busy={busy}
        incomplete={ANNUAL_STEPS.some(step => workflow.steps[step].status !== 'Completed')}
        save={saveDeclaration} close={() => setDeclaring(false)} />}
      {showFormsExport && pkg && workflow && <FormsExportDialog pkg={pkg} workflow={workflow} busy={busy}
        exportForms={draft => void exportForms(draft)} close={() => setShowFormsExport(false)} />}
      {showPortfolioExport && pkg && workflow && <PortfolioExportDialog pkg={pkg} workflow={workflow} busy={busy}
        monitor={portfolioMonitor}
        running={portfolioRunning} progress={portfolioProgress}
        exportPortfolio={draft => void exportPortfolio(draft)} close={() => setShowPortfolioExport(false)}
        cancel={() => void operations.cancelPortfolioExport().then(result => {
          if (!result.ok) {
            setError(result.error.message);
            showFeedback({ title: 'Could not cancel portfolio export', message: result.error.message, kind: 'error' });
          }
        })} />}
      {state && <footer className="source-note"><p>All years use the same bundled sources (ethics: September 2018; assessment tool: 2023 reference). SWCC does not verify current College compliance.</p></footer>}
    </main></div>
  </div>;
}
