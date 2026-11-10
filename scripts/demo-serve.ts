import express from 'express';
import { demoSchool } from './demo-school.js';

/**
 * The demo as a hosted site, for a walkthrough with people who have no account.
 *
 * One process: the real API and the real screens over an in-memory PGlite
 * database full of synthetic records, with `web/demo.html` in place of signing
 * in. It must be deployed on its own, never on the address the school uses,
 * and it must not share a database with anything — it has none to share, since
 * the school it serves is built at start-up and dies with the process.
 *
 * **It needs a host that keeps a process alive.** The school takes about seven
 * seconds to build and then lives in memory, so on a platform that starts a
 * fresh instance per request every visitor would wait for a rebuild and see
 * their own copy, with nothing they typed surviving the next click.
 *
 * **Do not set `NODE_ENV=production` on the host.** `demoSchool()` refuses to
 * run under it, deliberately, so that synthetic records can never be built by
 * the real deployment. The guard stays; the demo host is configured around it.
 */
const port = Number(process.env.PORT ?? 8080);
const origin = process.env.DEMO_ORIGIN ?? `http://127.0.0.1:${port}`;

const { db, app } = await demoSchool(origin);

// The built demo bundle is served **in front of** the API, not after it. The
// API already answers `/` and `/app` with the real workspace page, so mounting
// the demo behind it left demo.html a 404 while `/` quietly served the real
// sign-in: the demo would have looked deployed and been the wrong thing.
const site = express();
site.use(express.static('public-demo', { index: false }));
site.get('/', (_request, response) => response.redirect('/demo.html'));
site.use(app);

const server = site.listen(port, () => console.log(`EDUNEXUS demo on ${origin} — synthetic records only, rebuilt whenever this process restarts.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); void db.database.close().finally(() => process.exit(0)); });
