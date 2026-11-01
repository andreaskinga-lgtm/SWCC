import { createServer } from 'vite';

// Execute production source under Electron's Node ABI, in a genuinely new process.
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { openApplication } = await server.ssrLoadModule('/src/main/data/application.ts');
  const [root, archive, mode, boundary] = process.argv.slice(2);
  const value = result => { if (!result.ok) throw new Error(result.error.message); return result.value; };
  const app = openApplication(root, {}, undefined, undefined, undefined, undefined, {
    chooseArchive: async () => archive,
    boundary: phase => { if (phase === boundary) process.kill(process.pid, 'SIGKILL'); },
  });
  if (mode === 'replace') {
    const preview = value(await app.operations.inspectFullBackup());
    value(await app.operations.replaceFullDataset({ previewId: preview.preview.id, confirmed: true }));
  }
  const state = value(await app.operations.getState());
  const packages = [];
  for (const year of state.years) {
    const record = value(await app.operations.openYear(year.id));
    packages.push({ record, review: value(await app.operations.getReview(year.id)), evidence: value(await app.operations.getEvidence(year.id)) });
  }
  console.log(JSON.stringify({ state, packages }));
  app.close();
} finally { await server.close(); }
