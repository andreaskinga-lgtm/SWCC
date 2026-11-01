import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import type { ArchiveFile } from '../shared/backup.js';

export interface ArchiveSource {
  path: string;
  sourcePath: string;
  byteCount: number;
  sha256?: string;
}
export class ArchiveSourceFailure extends Error {
  constructor(readonly path: string, message: string) { super(message); }
}
export function archiveManifestBytes(manifest: object): Buffer {
  return Buffer.from(JSON.stringify(manifest, null, 2));
}

// Read and hash the exact bytes sent to the archive, rather than a previous read.
export async function writeArchive(
  destination: string,
  sources: ArchiveSource[],
  manifest: (files: ArchiveFile[]) => object,
  progress: (bytes: number, fileCompleted: boolean) => void,
  signal: AbortSignal,
  openOutput: (path: string) => Writable = path => createWriteStream(path, { flags: 'wx', mode: 0o600 }),
) {
  const zip = new ZipFile();
  const files: ArchiveFile[] = [];
  const streams = new Set<Readable>();
  const output = openOutput(destination);
  zip.on('error', error => output.destroy(error));
  const writing = pipeline(zip.outputStream, output, { signal });
  try {
    for (const source of sources) {
      zip.addReadStreamLazy(source.path, { size: source.byteCount, mode: 0o100600 }, callback => {
        const hash = createHash('sha256');
        let byteCount = 0;
        const reader = createReadStream(source.sourcePath);
        const measured = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            byteCount += chunk.byteLength;
            if (byteCount > source.byteCount) { done(new ArchiveSourceFailure(source.path, `File size changed: ${source.path}`)); return; }
            hash.update(chunk);
            progress(chunk.byteLength, false);
            done(null, chunk);
          },
          flush(done) {
            const sha256 = hash.digest('hex');
            if (byteCount !== source.byteCount || (source.sha256 && sha256 !== source.sha256)) {
              done(new ArchiveSourceFailure(source.path, `File integrity check failed: ${source.path}`));
              return;
            }
            files.push({ path: source.path, byteCount, sha256 });
            progress(0, true);
            done();
          },
        });
        streams.add(reader);
        streams.add(measured);
        reader.on('close', () => streams.delete(reader));
        measured.on('close', () => streams.delete(measured));
        reader.on('error', error => measured.destroy(new ArchiveSourceFailure(source.path, `Cannot read ${source.path}: ${error.message}`)));
        measured.on('error', error => output.destroy(error));
        reader.pipe(measured);
        callback(null, measured);
      });
    }
    zip.addReadStreamLazy('manifest.json', callback => {
      try { callback(null, Readable.from([archiveManifestBytes(manifest(files))])); }
      catch (error) { output.destroy(error instanceof Error ? error : new Error(String(error))); }
    });
    zip.end();
    await writing;
  } catch (error) {
    output.destroy(error instanceof Error ? error : new Error(String(error)));
    await writing.catch(() => {});
    throw error;
  } finally {
    for (const stream of streams) stream.destroy();
    output.destroy();
    (zip.outputStream as Readable).destroy();
  }
}
