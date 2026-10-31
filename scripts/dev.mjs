import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const compiler = spawn('node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.main.json'], { stdio: 'inherit' });
const code = await new Promise(resolve => compiler.once('exit', resolve));
if (code !== 0) process.exit(code ?? 1);
const server = await createServer();
await server.listen();
const desktop = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', SWCC_DEV_URL: 'http://127.0.0.1:5173' },
});
desktop.once('exit', async code => { await server.close(); process.exit(code ?? 0); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { desktop.kill(signal); void server.close(); });
}
