// Throwaway browser preview. No Electron bridge or portfolio storage is opened.
import { createServer } from 'vite';

const server = await createServer({
  server: { port: 5174, strictPort: true, open: '/?prototype=friendlier&variant=A' },
});
await server.listen();
console.log('Friendlier SWCC prototype: http://127.0.0.1:5174/?prototype=friendlier&variant=A');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void server.close().then(() => process.exit(0)); });
}
