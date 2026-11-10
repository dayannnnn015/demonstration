// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, onApiBusy } from '../web/api';

/**
 * What a button does while you wait for it.
 *
 * The school reported a delay on clicking, and the delay was not the cause —
 * the cause was that nothing said it was working. A button that stays
 * `disabled` and nothing else is drawn at .45 opacity under a not-allowed
 * cursor, which is indistinguishable from a button that is switched off, so
 * the next thing a person does is click it again. Both halves of the fix are
 * pinned here: the shared signal that something is in flight, and the gate
 * that every acting button marks itself while it waits.
 */

type Client = Parameters<typeof createApi>[0];
const signedIn = { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } } as unknown as Client;

const answers = (queue: { ok: boolean; body: unknown }[]) => {
  const calls: string[] = [];
  globalThis.fetch = (async (path: string) => {
    calls.push(String(path));
    const next = queue.shift() ?? { ok: true, body: { data: {} } };
    return { ok: next.ok, status: next.ok ? 200 : 503, json: async () => next.body } as Response;
  }) as typeof fetch;
  return calls;
};

afterEach(() => { delete (globalThis as { fetch?: unknown }).fetch; });

describe('the signal that the workspace is waiting on the server', () => {
  it('turns on while a request is in flight and off when it lands', async () => {
    answers([]);
    const seen: boolean[] = [];
    const stop = onApiBusy(working => seen.push(working));
    // Subscribing reports the state at once, so a screen that mounts mid-wait
    // does not have to wait for the next request to find out.
    expect(seen).toEqual([false]);

    await createApi(signedIn, () => {})('/learners');

    expect(seen).toEqual([false, true, false]);
    stop();
  });

  it('says nothing more once it is unsubscribed', async () => {
    answers([]);
    const seen: boolean[] = [];
    onApiBusy(working => seen.push(working))();
    await createApi(signedIn, () => {})('/learners');
    expect(seen).toEqual([false]);
  });

  it('counts overlapping requests, so the last one to land ends the wait', async () => {
    answers([]);
    const seen: boolean[] = [];
    const stop = onApiBusy(working => seen.push(working));
    const api = createApi(signedIn, () => {});

    await Promise.all([api('/learners'), api('/sections'), api('/academic-years')]);

    // One wait, not three: a screen that fetches three lists on mount is
    // working once, and the notice must not flicker three times.
    expect(seen.filter(Boolean)).toHaveLength(1);
    expect(seen.at(-1)).toBe(false);
    stop();
  });

  it('treats a retried read as one wait', async () => {
    const calls = answers([{ ok: false, body: { error: { code: 'RETRY_REQUIRED', message: 'The database was busy.' } } }]);
    const seen: boolean[] = [];
    const stop = onApiBusy(working => seen.push(working));

    await createApi(signedIn, () => {}, async () => {})('/learners');

    expect(calls).toHaveLength(2);
    expect(seen).toEqual([false, true, false]);
    stop();
  });

  it('ends the wait when the request is refused', async () => {
    answers([{ ok: false, body: { error: { code: 'NOT_YOUR_CLASS', message: 'Not a class you advise.' } } }]);
    const seen: boolean[] = [];
    const stop = onApiBusy(working => seen.push(working));

    await expect(createApi(signedIn, () => {})('/sections/x/pulls', 'POST', {})).rejects.toThrow();

    // A refusal that left the notice on would read as a system that had hung.
    expect(seen).toEqual([false, true, false]);
    stop();
  });
});

/** Every .tsx in web/, with its text. */
const sources = () => {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) out.push({ file: path, text: readFileSync(path, 'utf8') });
    }
  };
  walk('web');
  return out;
};

/**
 * Pull every `<button>` apart into its opening tag and its words. Brace-aware,
 * because a tag's attributes are full of JSX expressions and `indexOf('>')`
 * stops inside the first one.
 */
const buttons = () => {
  const found: { where: string; tag: string; body: string }[] = [];
  for (const { file, text } of sources()) {
    let i = 0;
    while ((i = text.indexOf('<button', i)) !== -1) {
      let depth = 0, open = -1;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) { open = j; break; }
      }
      if (open === -1) break;
      const tag = text.slice(i, open + 1);
      const close = tag.endsWith('/>') ? -1 : text.indexOf('</button>', open);
      found.push({
        where: `${file}:${text.slice(0, i).split('\n').length}`,
        tag,
        body: close === -1 ? '' : text.slice(open + 1, close),
      });
      i = open + 1;
    }
  }
  return found;
};

describe('what a button looks like while it waits', () => {
  it('has buttons to check', () => {
    // A gate that finds nothing passes for the wrong reason.
    expect(buttons().length).toBeGreaterThan(250);
  });

  it('marks every acting button aria-busy, so it is not drawn as switched off', () => {
    // An acting button is one whose own words turn progressive — "Saving…",
    // "Recording…", "Working…". A cancel button beside it is disabled for a
    // different reason, is not working, and is deliberately not marked.
    const unmarked = buttons()
      .filter(b => /…'/.test(b.body) && b.body.includes('?') && !/aria-busy=/.test(b.tag))
      .map(b => b.where);
    expect(unmarked).toEqual([]);
  });

  it('gives every wordless button a name a screen reader can read', () => {
    const nameless = buttons().filter(b => {
      // Nested tags go first, attributes and all: an icon's own `size={20}` is
      // not a label, and counting it as one is what made the first version of
      // this gate pass on a button whose name had been deleted.
      const children = b.body.replace(/<[^>]*?\/?>/g, ' ');
      const words = children.replace(/\{[^}]*\}/g, ' ').trim();
      const expression = children.includes('{');
      if (words || expression) return false;
      return !/aria-label=|aria-labelledby=|title=/.test(b.tag);
    }).map(b => b.where);
    expect(nameless).toEqual([]);
  });

  it('keeps the busy rules in the stylesheet, since the markup alone only carries the state', () => {
    const css = readFileSync('web/styles/app.css', 'utf8');
    // Without these two a marked button is still drawn switched off, which is
    // the whole of what was reported.
    expect(css).toContain(".btn[aria-busy='true'] { opacity: 1; cursor: progress; }");
    expect(css).toMatch(/\.btn-mark, \.working-mark \{/);
    // A ghost button with a transparent edge reads as a line of text.
    expect(css).not.toMatch(/\.btn\.ghost \{[^}]*border-color: transparent/);
  });
});
