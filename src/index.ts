import express from 'express';
import pino from 'pino';
import { createApp } from './http-app.js';
import { readConfig } from './core/config.js';
import { createDatabase } from './core/db.js';
import { createAuthenticator } from './core/auth.js';
import { createIdentityProvisioner } from './core/identities.js';

const config = readConfig();
export const database = createDatabase(config.DATABASE_URL, config.DATABASE_SSL);
// Keep an explicit Express entrypoint for Vercel's framework detector.
const app = express();
app.disable('x-powered-by');
app.use(createApp({
  database,
  origins: config.origins,
  logger: pino({ level: config.LOG_LEVEL }),
  publicAuth: { url: config.SUPABASE_URL, publishableKey: config.SUPABASE_PUBLISHABLE_KEY },
  auth: createAuthenticator({ url: config.SUPABASE_URL, publishableKey: config.SUPABASE_PUBLISHABLE_KEY }),
  ...(config.PROVISION_FUNCTION_URL && config.PROVISION_FUNCTION_SECRET
    ? { identities: createIdentityProvisioner({ url: config.PROVISION_FUNCTION_URL, secret: config.PROVISION_FUNCTION_SECRET }) }
    : {}),
}));
export default app;
