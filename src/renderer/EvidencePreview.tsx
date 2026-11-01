import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import type { EvidencePreview } from '../shared/application.js';
import { Dialog } from './assessment-screen.js';
import './pdfjs-worker.js';

const pdfAssets = new URL(/* @vite-ignore */ '../pdf-assets/', import.meta.url).href;

function objectUrl(preview: EvidencePreview) {
  const buffer = new ArrayBuffer(preview.data.byteLength);
  new Uint8Array(buffer).set(preview.data);
  return URL.createObjectURL(new Blob([buffer], { type: preview.type }));
}

export function EvidencePreviewDialog({ preview, onClose }: { preview: EvidencePreview; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState('');
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [width, setWidth] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (preview.type !== 'application/pdf') {
      const url = objectUrl(preview);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    let disposed = false;
    const loading = getDocument({
      data: Uint8Array.from(preview.data),
      cMapUrl: `${pdfAssets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfAssets}standard_fonts/`,
      wasmUrl: `${pdfAssets}wasm/`,
      isEvalSupported: false,
      enableXfa: false,
      useWorkerFetch: false,
      stopAtErrors: true,
    });
    void loading.promise.then(document => {
      if (!disposed) { setPdf(document); setPage(1); setError(''); }
    }).catch(failure => {
      if (!disposed) setError(`This PDF could not be previewed safely: ${failure instanceof Error ? failure.message : String(failure)}.`);
    });
    return () => { disposed = true; void loading.destroy(); };
  }, [preview]);

  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvas.current || !width) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    const element = canvas.current;
    setRendered(false);
    void pdf.getPage(page).then(pdfPage => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scaled = pdfPage.getViewport({ scale: Math.min(960, Math.max(220, width - 32)) / base.width * zoom / 100 });
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.ceil(scaled.width * ratio);
      element.height = Math.ceil(scaled.height * ratio);
      element.style.width = `${scaled.width}px`;
      element.style.height = `${scaled.height}px`;
      const context = element.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable.');
      task = pdfPage.render({
        canvas: element, canvasContext: context, viewport: scaled,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      return task.promise.then(() => { if (!cancelled) setRendered(true); });
    }).catch(failure => {
      if (!cancelled) setError(`This PDF page could not be rendered: ${failure instanceof Error ? failure.message : String(failure)}.`);
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, zoom, width]);

  return <Dialog
    title={`Preview ${preview.ref} · ${preview.originalName}`}
    className="goal-dialog evidence-preview-dialog"
    onClose={onClose}
  >
    {preview.type === 'application/pdf' ? <section className="evidence-preview" aria-label="PDF evidence preview">
      {pdf && <div className="evidence-preview-toolbar">
        <button type="button" className="reader-icon" aria-label="Previous evidence page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button>
        <span aria-label="Evidence PDF page">{page} of {pdf.numPages}</span>
        <button type="button" className="reader-icon" aria-label="Next evidence page" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button>
        <button type="button" className="reader-icon" aria-label="Zoom out evidence preview" disabled={zoom <= 75} onClick={() => setZoom(zoom - 25)}><Minus size={16} /></button>
        <span>{zoom}%</span>
        <button type="button" className="reader-icon" aria-label="Zoom in evidence preview" disabled={zoom >= 200} onClick={() => setZoom(zoom + 25)}><Plus size={16} /></button>
      </div>}
      <div className="evidence-preview-viewport" ref={host} tabIndex={0} role="region" aria-label="Evidence PDF viewport">
        {!rendered && !error && <p role="status">Opening {preview.originalName}…</p>}
        {error && <p role="alert">{error}</p>}
        <canvas role="img" aria-label={`Evidence PDF page ${page}`} hidden={!rendered || Boolean(error)} ref={canvas} />
      </div>
    </section> : <section className="evidence-preview image-evidence-preview">
      {imageUrl && <img src={imageUrl} alt={`Evidence preview ${preview.ref} · ${preview.originalName}`}
        onError={() => setError(`The image ${preview.originalName} could not be displayed.`)} />}
      {error && <p role="alert">{error}</p>}
    </section>}
  </Dialog>;
}
