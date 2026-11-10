import type { Express } from 'express';
import { createApp } from '../../src/http-app.js';
import type { Identity } from '../../src/core/auth.js';
import { ids, type TestDatabase } from './database.js';

/**
 * The real API over a throwaway PGlite database, so a test exercises the whole
 * path a request takes: the operation table, the Zod contract, the role gate,
 * the module's service and the row security underneath it.
 *
 * The one thing stubbed is the token. `Authenticator` is a single method, and a
 * real Supabase JWT would need a key set and a network, so a token here is the
 * staff user id itself. Nothing else is replaced: the role is read from
 * `edunexus.staff` inside the transaction exactly as it is live, which is what
 * decides what a teacher may do.
 */
export type TestApi = {
  app: Express;
  get(path: string, token: string): Promise<Answer>;
  post(path: string, token: string, body: unknown): Promise<Answer>;
  patch(path: string, token: string, body: unknown): Promise<Answer>;
};
export type Answer = { status: number; data: Record<string, unknown>; code: string | null; fields: { path: string; message: string }[]; message: string | null };

/** The four fixed staff of the test database, named as a token reads. */
export const tokens = { principal: ids.principal, officer: ids.officer, teacher: ids.teacher, otherTeacher: ids.otherTeacher } as const;

export async function testApi(db: TestDatabase): Promise<TestApi> {
  const { default: request } = await import('supertest');
  const app = createApp({
    database: db.database,
    auth: { async verify(token: string): Promise<Identity> { return { userId: token }; } },
    origins: ['http://127.0.0.1'],
    logger: { info() { /* quiet under test */ }, error() { /* quiet under test */ }, warn() { /* quiet under test */ } } as never,
  });
  const answer = (res: { status: number; body: Record<string, unknown> }): Answer => {
    const error = res.body.error as { code?: string; message?: string; fields?: { path: string; message: string }[] } | undefined;
    return {
      status: res.status,
      data: (res.body.data as Record<string, unknown>) ?? {},
      code: error?.code ?? null,
      fields: error?.fields ?? [],
      message: error?.message ?? null,
    };
  };
  return {
    app,
    async get(path, token) { return answer(await request(app).get(path).set('Authorization', `Bearer ${token}`)); },
    async post(path, token, body) { return answer(await request(app).post(path).set('Authorization', `Bearer ${token}`).send(body as object)); },
    async patch(path, token, body) { return answer(await request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body as object)); },
  };
}
