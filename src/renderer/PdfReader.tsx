import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import type { DesktopOperations } from '../shared/application.js';
import type { ReviewPosition } from '../shared/review.js';
import './review.css';

GlobalWorkerOptions.workerPort = new PdfWorker();

export function PdfReader({ operations, position, onPosition, onVisit }: {
  operations: DesktopOperations;
  position: ReviewPosition;
  onPosition: (page: number, offset: number, zoom: number) => void;
  onVisit: (page: number) => void;
}) {
  const { page, zoom } = position;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [renderedKey, setRenderedKey] = useState('');
  const [error, setError] = useState('');
  const [pageInput, setPageInput] = useState(String(page));
  const [width, setWidth] = useState(0);
  const [retry, setRetry] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ position, onPosition, onVisit });
  const renderKey = `${page}-${zoom}-${width}`;
  const rendered = renderedKey === renderKey;
  current.current = { position, onPosition, onVisit };
  useEffect(() => setPageInput(String(page)), [page]);
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setError('');
    void operations.getReviewDocument().then(result => {
      if (disposed) return;
      if (!result.ok) throw new Error(result.error.message);
      const assets = new URL(/* @vite-ignore */ '../pdf-assets/', import.meta.url).href;
      task = getDocument({
        data: new Uint8Array(result.value), cMapUrl: `${assets}cmaps/`, cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
        isEvalSupported: false,
      });
      return task.promise.then(document => {
        if (document.numPages !== 48) throw new Error('The supplied standards document must contain 48 physical pages.');
        if (!disposed) setPdf(document);
      });
    }).catch(failure => { if (!disposed) setError(`Cannot open the bundled standards PDF: ${String(failure)}. Reinstall SWCC if its read-only resources are missing.`); });
    return () => { disposed = true; setPdf(null); void task?.destroy(); };
  }, [operations, retry]);
  useEffect(() => {
    if (!viewport.current) return;
    const root = viewport.current;
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    setWidth(root.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current || !viewport.current || !width) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setRenderedKey('');
    setError('');
    const element = canvas.current;
    void pdf.getPage(page).then(pdfPage => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scaled = pdfPage.getViewport({ scale: Math.min(700, Math.max(180, width - 48)) / base.width * zoom / 100 });
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.ceil(scaled.width * ratio);
      element.height = Math.ceil(scaled.height * ratio);
      element.style.width = `${scaled.width}px`;
      element.style.height = `${scaled.height}px`;
      const context = element.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable.');
      renderTask = pdfPage.render({
        canvas: element, canvasContext: context, viewport: scaled,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      return renderTask.promise.then(() => {
        if (cancelled) return;
        setRenderedKey(`${page}-${zoom}-${width}`);
      });
    }).catch(failure => { if (!cancelled) setError(`Cannot render physical page ${page}: ${String(failure)}. Try again or select another page.`); });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, page, zoom, width, retry]);
  useLayoutEffect(() => {
    if (rendered && viewport.current && canvas.current)
      viewport.current.scrollTop = current.current.position.offset * canvas.current.getBoundingClientRect().height;
  }, [rendered, page, zoom, width]);
  useEffect(() => {
    const root = viewport.current;
    const element = canvas.current;
    if (!rendered || !root || !element) return;
    let active = false;
    let disposed = false;
    let activityEvents = 0;
    const checkVisit = () => {
      if (!active || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const pageRect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const viewportTop = rootRect.top + root.clientTop;
      const viewportBottom = viewportTop + root.clientHeight;
      const visibleHeight = Math.max(0, Math.min(pageRect.bottom, viewportBottom, window.innerHeight)
        - Math.max(pageRect.top, viewportTop, 0));
      const visibleWidth = Math.max(0, Math.min(pageRect.right, rootRect.right, window.innerWidth)
        - Math.max(pageRect.left, rootRect.left, 0));
      if (visibleWidth > 0 && visibleHeight >= Math.min(pageRect.height, root.clientHeight) / 2)
        current.current.onVisit(page);
    };
    const scroll = () => {
      current.current.onPosition(page, Math.min(1, root.scrollTop / element.getBoundingClientRect().height), zoom);
      checkVisit();
    };
    const activeChanged = (value: boolean) => { activityEvents++; active = value; checkVisit(); };
    const unsubscribe = operations.onReaderActiveChanged(activeChanged);
    void operations.getReaderActive().then(result => { if (!disposed && !activityEvents && result.ok) activeChanged(result.value); });
    const intersection = new IntersectionObserver(checkVisit, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    intersection.observe(element);
    root.addEventListener('scroll', scroll);
    window.addEventListener('scroll', checkVisit, true);
    window.addEventListener('resize', checkVisit);
    window.addEventListener('focus', checkVisit);
    document.addEventListener('visibilitychange', checkVisit);
    return () => {
      disposed = true;
      unsubscribe();
      intersection.disconnect();
      root.removeEventListener('scroll', scroll);
      window.removeEventListener('scroll', checkVisit, true);
      window.removeEventListener('resize', checkVisit);
      window.removeEventListener('focus', checkVisit);
      document.removeEventListener('visibilitychange', checkVisit);
    };
  }, [rendered, page, zoom, operations]);
  const jump = (next: number) => {
    if (Number.isInteger(next) && next >= 1 && next <= 48) {
      if (next !== page) current.current.onPosition(next, 0, zoom);
    }
    else setPageInput(String(page));
  };
  return <section className="pdf-reader" aria-label="Supplied ethics PDF reader">
    <div className="reader-toolbar">
      <div className="toolbar-group">
        <button className="reader-icon" aria-label="Previous PDF page" disabled={page === 1} onClick={() => jump(page - 1)}><ChevronLeft size={18} /></button>
        <form onSubmit={event => { event.preventDefault(); jump(Number(pageInput)); }}>
          <label className="page-input">Page <input aria-label="Physical PDF page" type="number" min={1} max={48} value={pageInput}
            onChange={event => setPageInput(event.target.value)} onBlur={() => jump(Number(pageInput))} /> of 48</label>
        </form>
        <button className="reader-icon" aria-label="Next PDF page" disabled={page === 48} onClick={() => jump(page + 1)}><ChevronRight size={18} /></button>
      </div>
      <div className="toolbar-group">
        <button className="reader-icon" aria-label="Zoom out" disabled={zoom <= 75} onClick={() => current.current.onPosition(page, position.offset, zoom - 25)}><Minus size={16} /></button>
        <span aria-label="PDF zoom">{zoom}%</span>
        <button className="reader-icon" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => current.current.onPosition(page, position.offset, zoom + 25)}><Plus size={16} /></button>
      </div>
    </div>
    <div className="pdf-viewport" ref={viewport} tabIndex={0} role="region" aria-label="PDF page viewport">
      {!rendered && !error && <p role="status" className="reader-message">Opening physical page {page}…</p>}
      {error && <div className="reader-message" role="alert"><p>{error}</p><button onClick={() => setRetry(retry + 1)}>Retry PDF</button></div>}
      <canvas ref={canvas} role="img" aria-label={`Supplied Code of Ethics, physical page ${page}`} hidden={!rendered || Boolean(error)} />
    </div>
    <p className="reader-note">Physical pages include the cover as page 1. Only qualifying displays in the active window are tracked, not fetching or skipped pages. This is navigation tracking, not proof of comprehension.</p>
  </section>;
}
