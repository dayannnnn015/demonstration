import { createServer } from 'vite';
import { demoSchool } from './demo-school.js';

/**
 * A local, throwaway EDUNEXUS full of synthetic records, for looking at the
 * workspace without a Supabase account: design review, screenshots, a
 * walkthrough for staff who are learning it.
 *
 * It is the real API and the real screens over an in-memory PGlite database
 * that disappears when the process stops. Sign-in is replaced by a choice of
 * synthetic staff member on `web/demo.html`, so it accepts exactly those
 * identifiers as tokens and nothing else, and it listens on the loopback
 * address only. Nothing here reads `.env`, and no record resembles a real one.
 */
if (process.env.NODE_ENV === 'production') throw new Error('The demo refuses to run with NODE_ENV=production.');

const { db, app, page } = await demoSchool();

const api = app.listen(3001, '127.0.0.1');
const web = await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await web.listen();
console.log(`EDUNEXUS demo, synthetic records only. Open ${page}/demo.html, and the public front page at ${page}/site.html`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { api.close(); void web.close().then(() => db.database.close()).finally(() => process.exit(0)); });
