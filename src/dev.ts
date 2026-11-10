import app, { database } from './index.js';
const server = app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1', () => console.log('EDUNEXUS API is listening on localhost'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(() => { void database.close().finally(() => process.exit(0)); });
});
