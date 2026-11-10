import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;

/** What My profile needs of the sign-in service: ending the other sessions. */
export type SessionAuth = Pick<SupabaseClient['auth'], 'signOut'>;

/**
 * Where the session is kept, and the one choice that moves it.
 *
 * The default is `sessionStorage`: it survives a refresh but dies with the tab,
 * so a shared staffroom browser leaves no session behind. Ticking "Keep me
 * signed in" on the sign-in page moves it to `localStorage`, where it survives
 * closing the browser, and that is the only thing that does (decided
 * 2026-11-03, replacing the flat rule that a session may never be kept).
 *
 * Every access is wrapped: a private window throws on the first touch of either
 * store, and signing in must not fail because of it.
 */
const REMEMBER = 'edunexus-remember';
export const remembered = () => { try { return localStorage.getItem(REMEMBER) === 'yes'; } catch { return false; } };
/** Chosen before the sign-in call, so the session lands in the store the person picked. */
export function rememberMe(on: boolean) {
  try {
    if (on) localStorage.setItem(REMEMBER, 'yes'); else localStorage.removeItem(REMEMBER);
  } catch { /* a private window remembers nothing, which is the safe way round */ }
}
/** Both stores are cleared on the way out, whichever one held it. */
export const sessionStore = {
  getItem(key: string) { try { return (remembered() ? localStorage : sessionStorage).getItem(key); } catch { return null; } },
  setItem(key: string, value: string) { try { (remembered() ? localStorage : sessionStorage).setItem(key, value); } catch { /* nothing kept */ } },
  // Each store in its own `try`. One around the pair would let a browser that refuses
  // `localStorage`, as a private window does, throw before the tab's own copy was
  // cleared — leaving the signed-out session sitting there (found by its test).
  removeItem(key: string) {
    try { localStorage.removeItem(key); } catch { /* nothing kept */ }
    try { sessionStorage.removeItem(key); } catch { /* nothing kept */ }
  },
};
export type Page<T = Row> = { items: T[]; pagination?: { has_more?: boolean; next_after_id?: string | null; next_before_id?: string | null; next_before_version?: number | null } };

/** An API error carrying the server's own code, so screens can react to specific ones. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields: { path: string; message: string }[] = []) {
    super(message);
  }
  /** A stale version or a changed review. The screen must refresh, never silently retry. */
  get isConflict() { return this.status === 409; }
}

export type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

/**
 * Whether anything is waiting on the server right now.
 *
 * Every request in the workspace goes through `createApi`, so counting here is
 * the one place that knows the system is working. Screens say so themselves
 * where they can — a button that reads "Saving…" is better than a notice
 * somewhere else — but a great many clicks open a sheet, refetch a list or
 * reload a screen, and those showed nothing at all while the server thought.
 * To a teacher that is indistinguishable from a button that did not work, and
 * the second click is the one that does harm.
 *
 * A count, not a flag: several requests overlap on most screens, and the last
 * one to finish is what ends the wait.
 */
let waiting = 0;
const watchers = new Set<(working: boolean) => void>();

/** Subscribe to it. Returns the unsubscribe, for an effect's cleanup. */
export function onApiBusy(watch: (working: boolean) => void) {
  watchers.add(watch);
  watch(waiting > 0);
  return () => { watchers.delete(watch); };
}

const counted = async <T>(run: () => Promise<T>): Promise<T> => {
  waiting++;
  if (waiting === 1) for (const watch of watchers) watch(true);
  try { return await run(); }
  finally {
    waiting--;
    if (waiting === 0) for (const watch of watchers) watch(false);
  }
};

/**
 * Whether a failed request may be sent again unchanged. Only a read, and only
 * when the server said the database was busy: `RETRY_REQUIRED` means a lock or
 * serialization wait ran out, the transaction rolled back, and nothing was
 * recorded. A write is never retried here — a refused change needs a fresh
 * review, and a version conflict needs a person to look again.
 */
export const retryable = (method: string, error: unknown) =>
  method === 'GET' && error instanceof ApiError && error.code === 'RETRY_REQUIRED';

export function createApi(client: SupabaseClient, onSessionLost: () => void, wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))): Api {
  const send = createRequest(client, onSessionLost);
  // The whole span, retries included: a retried read is still one wait.
  return <T>(path: string, method = 'GET', body?: unknown): Promise<T> => counted(async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await send<T>(path, method, body); }
      catch (error) {
        if (attempt >= 2 || !retryable(method, error)) throw error;
        // Spread out, so advisers who were refused together do not all come back together.
        await wait(250 + Math.random() * 500 * (attempt + 1));
      }
    }
  });
}

function createRequest(client: SupabaseClient, onSessionLost: () => void) {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const { data } = await client.auth.getSession();
    if (!data.session) { onSessionLost(); throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.'); }
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = payload.error ?? {};
      if (response.status === 401 || error.code === 'STAFF_ACCESS_REQUIRED') onSessionLost();
      throw new ApiError(response.status, error.code ?? 'REQUEST_FAILED', error.message ?? 'The request failed.', error.fields ?? []);
    }
    return payload.data as T;
  };
}

/**
 * The validator's wording names patterns and types; staff read it as noise. A
 * field's own hint already says what the field wants, so a format refusal is
 * said with that, and the common limits in plain words.
 */
export function plainFieldMessage(text: string, hint?: string) {
  if (/must match pattern/i.test(text)) return hint ?? 'This is not in the expected form.';
  let m = /Too small: expected string to have >=(\d+) character/i.exec(text);
  if (m) return `Too short: at least ${m[1]} characters.`;
  m = /Too big: expected string to have <=(\d+) character/i.exec(text);
  if (m) return `Too long: at most ${m[1]} characters.`;
  m = /Too small: expected (?:number|int)\w* to be >=?(-?[\d.]+)/i.exec(text);
  if (m) return `Must be at least ${m[1]}.`;
  m = /Too big: expected (?:number|int)\w* to be <=?(-?[\d.]+)/i.exec(text);
  if (m) return `Must be at most ${m[1]}.`;
  if (/received (null|undefined)|^Required$/i.test(text)) return 'Required.';
  if (/Invalid ISO date|Invalid date/i.test(text)) return 'Enter a date as YYYY-MM-DD.';
  if (/Invalid UUID/i.test(text)) return 'Choose one from the list.';
  if (/Invalid option|Invalid enum/i.test(text)) return 'Choose one of the options offered.';
  return text;
}
/** The validator's own lead line, which says nothing a person can act on. */
export const GENERIC_REFUSAL = 'Review the request fields.';

/**
 * Which server code produced each refusal message handed out recently. Screens
 * put `message(error)` straight into their status line, a hundred places that
 * pass on text and not the error; remembering the code here lets the status
 * line explain a refusal without each of them passing it along.
 */
const recent = new Map<string, string>();
export const codeFor = (text: string) => recent.get(text);

export const message = (error: unknown) => {
  const text = error instanceof ApiError && error.fields.length
    ? [error.message === GENERIC_REFUSAL ? 'Some details need correcting.' : error.message, ...error.fields.map(f => `${f.path}: ${plainFieldMessage(f.message)}`)].join('\n')
    : error instanceof Error ? error.message : 'The request failed. Please try again.';
  if (error instanceof ApiError) {
    recent.delete(text);
    recent.set(text, error.code);
    if (recent.size > 50) recent.delete(recent.keys().next().value!);
  }
  return text;
};

export const query = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};
