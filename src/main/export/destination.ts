import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { OperationError } from '../../shared/application.js';

export async function exportDestination(
  selected: string, dataset: string, label: string,
  fail: (code: OperationError['code'], message: string) => never,
  protective = false,
): Promise<string> {
  if (!isAbsolute(selected)) fail('VALIDATION', `Choose an absolute ${label} destination outside SWCC storage.`);
  const storageRoot = await realpath(dirname(dataset));
  let directory: string;
  try { directory = await realpath(dirname(selected)); }
  catch (error) {
    fail('STORAGE', `The ${label} could not be completely written: ${error instanceof Error ? error.message : String(error)}. Check destination permissions and available disk space, then retry. No output was published.`);
  }
  const destination = join(directory, basename(selected));
  const location = relative(storageRoot, directory);
  if (!protective && (!location || (!location.startsWith(`..${sep}`) && location !== '..' && !isAbsolute(location))))
    fail('VALIDATION', `Choose a ${label} destination outside SWCC storage, so an export cannot overwrite records or evidence.`);
  try {
    if ((await lstat(destination)).isSymbolicLink()) fail('VALIDATION', `Choose a regular ${label} file, not a symbolic link.`);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return destination;
}
