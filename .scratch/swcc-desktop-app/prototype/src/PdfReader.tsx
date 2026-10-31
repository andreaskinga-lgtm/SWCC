import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfReader({ page, onPage, onVisit }: {
  page: number; onPage: (page: number) => void; onVisit: (page: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(100);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const visit = useRef(onVisit);
  visit.current = onVisit;
  useEffect(() => {
    const task = getDocument({ url: '/ethics.pdf' });
    task.promise.then(setPdf).catch((error: Error) => setError(`Cannot open the supplied PDF: ${error.message}. Restart the prototype server.`));
    return () => { void task.destroy(); };
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current || !viewport.current) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setRendered(false);
    setError('');
    viewport.current.scrollTop = 0;
    pdf.getPage(page).then(pdfPage => {
      if (cancelled || !canvas.current || !viewport.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const width = Math.min(700, Math.max(180, viewport.current.clientWidth - 48));
      const scaled = pdfPage.getViewport({ scale: (width / base.width) * zoom / 100 });
      const ratio = window.devicePixelRatio || 1;
      const element = canvas.current;
      element.width = scaled.width * ratio;
      element.height = scaled.height * ratio;
      element.style.width = `${scaled.width}px`;
      element.style.height = `${scaled.height}px`;
      const context = element.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable');
      renderTask = pdfPage.render({
        canvasContext: context, canvas: element, viewport: scaled,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      return renderTask.promise.then(() => { if (!cancelled) setRendered(true); });
    }).catch((error: Error) => {
      if (!cancelled) setError(`Cannot render page ${page}: ${error.message}. Try another page or reload.`);
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pdf, page, zoom]);
  useEffect(() => {
    const root = viewport.current;
    const element = canvas.current;
    if (!rendered || !root || !element) return;
    function checkVisit() {
      if (!root || !element || document.visibilityState !== 'visible' || !document.hasFocus() || document.querySelector('dialog[open]')) return;
      const pageRect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(pageRect.bottom, rootRect.bottom, window.innerHeight) - Math.max(pageRect.top, rootRect.top, 0));
      const visibleWidth = Math.max(0, Math.min(pageRect.right, rootRect.right, window.innerWidth) - Math.max(pageRect.left, rootRect.left, 0));
      if (visibleWidth > 0 && visibleHeight >= 0.5 * Math.min(pageRect.height, rootRect.height)) visit.current(page);
    }
    const observer = new IntersectionObserver(checkVisit, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    observer.observe(element);
    root.addEventListener('scroll', checkVisit);
    window.addEventListener('scroll', checkVisit, true);
    window.addEventListener('resize', checkVisit);
    window.addEventListener('focus', checkVisit);
    document.addEventListener('visibilitychange', checkVisit);
    checkVisit();
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', checkVisit);
      window.removeEventListener('scroll', checkVisit, true);
      window.removeEventListener('resize', checkVisit);
      window.removeEventListener('focus', checkVisit);
      document.removeEventListener('visibilitychange', checkVisit);
    };
  }, [rendered, page]);
  return <section className="pdf-reader" aria-label="Supplied ethics PDF reader">
    <div className="reader-toolbar">
      <div className="toolbar-group">
        <button className="icon-button" aria-label="Previous PDF page" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={18} /></button>
        <label className="page-input">Page <input type="number" min={1} max={48} value={page} onChange={event => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next >= 1 && next <= 48) onPage(next);
        }} /> of 48</label>
        <button className="icon-button" aria-label="Next PDF page" disabled={page === 48} onClick={() => onPage(page + 1)}><ChevronRight size={18} /></button>
      </div>
      <div className="toolbar-group">
        <button className="icon-button" aria-label="Zoom out" disabled={zoom <= 75} onClick={() => setZoom(zoom - 25)}><Minus size={16} /></button>
        <span>{zoom}%</span>
        <button className="icon-button" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => setZoom(zoom + 25)}><Plus size={16} /></button>
      </div>
    </div>
    <div className="pdf-viewport" ref={viewport}>
      {!rendered && !error && <p role="status" className="reader-message">Opening page {page}...</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <canvas ref={canvas} role="img" aria-label={`Supplied Code of Ethics, physical page ${page}`} style={{ visibility: rendered ? 'visible' : 'hidden' }} />
    </div>
    <p className="reader-note">Actual page visits are tracked in this demo. They are not proof of comprehension. <a href={`/ethics.pdf#page=${page}`} target="_blank" rel="noreferrer">Open accessible source PDF</a></p>
  </section>;
}
