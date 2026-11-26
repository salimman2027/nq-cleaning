import { config } from './config';
import { createApp } from './app';
import { closePool, getPool } from './db';

async function main(): Promise<void> {
  void config.jwt.accessSecret; // fail fast when the secret is missing or too short
  await getPool();
  const server = createApp().listen(config.port, () => console.log(`NQ Cleaning API listening on :${config.port}`));
  const stop = async () => {
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error('Startup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
