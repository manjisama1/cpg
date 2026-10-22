import { createGameServer } from './app.ts';

const port = Number(process.env.PORT ?? 3001);
const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
const server = createGameServer({ corsOrigin });

server.listen(port).then((p) => console.log(`Chor Police server listening on :${p}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close().then(() => process.exit(0)));
}
