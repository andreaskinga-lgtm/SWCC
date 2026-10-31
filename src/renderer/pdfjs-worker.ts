import { GlobalWorkerOptions } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

GlobalWorkerOptions.workerPort = new PdfWorker();
