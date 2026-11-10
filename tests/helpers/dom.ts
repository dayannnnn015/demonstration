import { createElement, type ReactElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApp } from '../../src/http-app.js';
import type { Identity } from '../../src/core/auth.js';
import { createApi, type Api } from '../../web/api.js';
import { ids, type TestDatabase } from './database.js';

/**
 * A screen's data paths, in a real DOM against the real API.
 *
 * `AGENTS.md` requires this: a file starting `// @vitest-environment happy-dom`
 * mounts a screen with `serverApi`, the workspace's own client pointed at an
 * in-process API over PGlite, so fetches, reviews, confirmations and refusals
 * run end to end. Rendering a screen to a string never runs an effect, so
 * without this nothing behind a fetch is exercised by any test.
 *
 * Deliberately not a mock. A mock written to match a screen proves only that
 * the two agree with each other; it cannot catch a contract the server never
 * had, a field the row policy hides, or a refusal whose code the screen does
 * not handle. What runs here is:
 *
 *   the screen -> web/api.ts (its retry loop and its ApiError)
 *     -> a real HTTP request over a loopback port
 *       -> src/http-app.ts (the operation table, the Zod contract, the role gate)
 *         -> the module's service -> the migrations' own SQL, under row security.
 *
 * The one thing stubbed is the token, for the same reason as in `http.ts`: a
 * real Supabase JWT would need a key set and a network. A token here is the
 * staff user id, and the role is still read from `edunexus.staff` inside the
 * transaction exactly as it is live.
 */

/** The four fixed staff, named as a token reads. Same set as `http.ts`. */
export const tokens = { principal: ids.principal, officer: ids.officer, teacher: ids.teacher, otherTeacher: ids.otherTeacher } as const;
export type Who = keyof typeof tokens;

export type ServerApi = {
  /** The workspace client, as a screen receives it. */
  api: Api;
  /** Who the client is signed in as; changing it changes what the API allows. */
  signInAs(who: Who): void;
  /**
   * Signs in with a token that is not one of the four staff, for the cases that
   * need one: a user id with no `edunexus.staff` row, which is what a revoked
   * account looks like to the API.
   */
  signInWithToken(token: string): void;
  /** How many times the client was told its session had gone. */
  sessionLost(): number;
  /** Every request the client actually sent, in order, for asserting what a screen reads. */
  sent: { method: string; path: string }[];
  close(): Promise<void>;
};

/**
 * The real API, with the workspace client pointed at it.
 *
 * The client builds a relative URL (`/api/v1...`), which has no origin in a
 * test, so `fetch` is wrapped. It does **not** delegate to the environment's
 * own `fetch`: happy-dom implements the Same Origin Policy, so a request to the
 * server's loopback port is blocked before it is sent, which is correct of it
 * and useless here. The wrapper hands the request to supertest instead, which
 * binds the app to an ephemeral port and makes a genuine HTTP request to it.
 *
 * So the method, path, headers, body, status and JSON are all real, and the
 * response the client parses is a real `Response`. What is skipped is only the
 * browser's own origin check on a request the browser would never make: in the
 * deployed app the API is same-origin with the workspace.
 */
export async function serverApi(db: TestDatabase): Promise<ServerApi> {
  const { default: request } = await import('supertest');
  const app = createApp({
    database: db.database,
    auth: { async verify(token: string): Promise<Identity> { return { userId: token }; } },
    origins: ['http://127.0.0.1'],
    logger: { info() { /* quiet under test */ }, error() { /* quiet under test */ }, warn() { /* quiet under test */ } } as never,
  });

  let token: string = tokens.principal;
  let lost = 0;
  const sent: { method: string; path: string }[] = [];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    sent.push({ method, path: raw });

    const verb = method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
    let pending = request(app)[verb](raw);
    for (const [key, value] of Object.entries(headersOf(init?.headers))) pending = pending.set(key, value);
    const answer = init?.body === undefined ? await pending : await pending.send(init.body as string);

    // `res.text` is what the server actually wrote; `res.body` is supertest's
    // parse of it. Preferring the text keeps the client doing its own parsing,
    // including the `.catch(() => ({}))` on a body that is not JSON.
    const payload = answer.text !== undefined && answer.text !== '' ? answer.text : JSON.stringify(answer.body ?? {});
    return new Response(payload, {
      status: answer.status,
      headers: { 'Content-Type': String(answer.headers['content-type'] ?? 'application/json') },
    });
  }) as typeof globalThis.fetch;

  /**
   * What the client needs of the sign-in service: a session carrying a token.
   * `createApi` reads it before every request, so switching role mid-test is
   * just changing what this answers with.
   */
  const client = { auth: { async getSession() { return { data: { session: { access_token: token } } }; } } };
  // Never wait between retries: `RETRY_REQUIRED` backs off for up to a second
  // live, which would be a second of a test run doing nothing.
  const api = createApi(client as never, () => { lost += 1; }, async () => { /* no backoff under test */ });

  return {
    api,
    signInAs(who) { token = tokens[who]; },
    signInWithToken(value) { token = value; },
    sessionLost: () => lost,
    sent,
    async close() { globalThis.fetch = realFetch; },
  };
}

/**
 * Sets a form control's value the way a person typing does, so React sees it.
 *
 * React installs its own value tracker on a controlled input and compares
 * against it before dispatching a change, so assigning `node.value` directly
 * is treated as no change. Going through the prototype's setter updates the
 * node without touching the tracker, and the event that follows then looks to
 * React exactly like a keystroke.
 */
function setNativeValue(element: HTMLElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else (element as HTMLInputElement).value = value;
}

/** A fetch `headers` argument, in any of its three shapes, as a plain object. */
function headersOf(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

/**
 * A mounted screen. `act` is awaited around every mount and interaction, so the
 * effects that do the fetching have run and their state has landed before an
 * assertion reads the markup.
 */
export type Mounted = {
  host: HTMLElement;
  root: Root;
  /** Settle whatever is in flight: effects, resolved fetches, and the renders they cause. */
  settle(): Promise<void>;
  /**
   * Settle until the screen says what the test is waiting for. A request here
   * is real I/O, so it does not land in a fixed number of microtask flushes:
   * waiting on the condition is what makes the test about the screen rather
   * than about how long a round trip took.
   */
  until(ready: (m: Pick<Mounted, 'text' | 'all' | 'byText'>) => boolean, what?: string): Promise<void>;
  /** The rendered text, whitespace collapsed, for asserting what a screen says. */
  text(): string;
  /** Every element matching a selector. */
  all(selector: string): HTMLElement[];
  /** The first element whose text is exactly this, which is how a control is found by its label. */
  byText(text: string, selector?: string): HTMLElement | null;
  /** A labelled form control. */
  field(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  click(element: HTMLElement | null): Promise<void>;
  type(element: HTMLElement | null, value: string): Promise<void>;
  /**
   * Submits the form the given element is in. Every `Finder` and `Editor` in
   * the workspace is a real `<form onSubmit>`, and a synthetic click on a
   * submit button does not submit a form, so a test that only clicked would
   * silently assert nothing.
   */
  submit(element: HTMLElement | null): Promise<void>;
  unmount(): void;
};

/** React warns on every `act` unless it is told it is in a test. */
export function reactTestEnvironment() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export async function mount(element: ReactElement): Promise<Mounted> {
  reactTestEnvironment();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  // A macrotask, not just a microtask: a request through this harness is real
  // I/O, so the promise the effect is waiting on does not resolve within a
  // drained microtask queue.
  const tick = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
  await act(async () => { root.render(element); });
  await settle();

  const all = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
  const view = {
    text: () => collapse(host.textContent ?? ''),
    all,
    byText(text: string, selector = 'button, a, h1, h2, h3, th, td, label, p, span, div, li') {
      return all(selector).find(el => collapse(el.textContent ?? '') === text) ?? null;
    },
  };
  return {
    host, root, settle,
    ...view,
    async until(ready, what = 'the screen to be ready') {
      for (let i = 0; i < 200; i++) {
        if (ready(view)) return;
        await tick();
      }
      throw new Error(`Timed out waiting for ${what}. The screen said: ${view.text().slice(0, 400)}`);
    },
    field(label) {
      const found = all('label').find(el => collapse(el.textContent ?? '').startsWith(label));
      const forId = found?.getAttribute('for');
      // By attribute rather than `#id`: an id generated by React can carry a
      // colon, which is not a bare selector, and CSS.escape is not everywhere.
      if (forId) return host.querySelector(`[id="${forId}"]`);
      return found?.querySelector('input, select, textarea') ?? null;
    },
    async click(element) {
      if (!element) throw new Error('Nothing to click: the control was not found.');
      await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await settle();
    },
    async type(element, value) {
      if (!element) throw new Error('Nothing to type into: the field was not found.');
      await act(async () => {
        // Through the prototype's own setter, not `field.value = x`. Every
        // control in the workspace is a controlled React input, and React
        // tracks the last value it wrote on the node: a direct assignment is
        // seen as no change and the event is swallowed, so the screen's state
        // never moves and a test built on it asserts nothing.
        setNativeValue(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle();
    },
    async submit(element) {
      if (!element) throw new Error('Nothing to submit: the form or its control was not found.');
      const form = element.tagName === 'FORM' ? element : element.closest('form');
      if (!form) throw new Error('That element is not in a form.');
      await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      await settle();
    },
    unmount() { act(() => { root.unmount(); }); host.remove(); },
  };
}

/** A screen, mounted with the props every route takes. See `web/routes.tsx`. */
export async function mountScreen(
  Screen: (props: never) => ReactElement | null,
  server: ServerApi,
  me: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<Mounted & { status: (string | null)[] }> {
  const status: (string | null)[] = [];
  const props = {
    api: server.api,
    me,
    manager: me.role !== 'teacher',
    setStatus: (value: unknown) => { status.push(typeof value === 'string' ? value : value === null ? null : String((value as { message?: string })?.message ?? value)); },
    reload: () => { /* the shell's refetch; a test drives it by remounting */ },
    token: 0,
    route: {},
    ...extra,
  };
  const mounted = await mount(createElement(Screen as never, props as never));
  return { ...mounted, status };
}
