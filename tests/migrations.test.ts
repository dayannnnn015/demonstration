import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * The migration registry: `database/migration-checksums.json` against the files
 * on disk.
 *
 * This is the test that makes "never modify an applied migration" enforceable
 * rather than merely written down. The runner refuses a changed applied file
 * against a real database, but the only place that check can run *before* a
 * deploy is here, and a migration edited by one character — a typo fixed in a
 * comment — is then refused at the worst possible moment, mid-deploy, against
 * the live database.
 *
 * It was lost with `tests/` in the 0.86.1 recovery and rebuilt on 2026-11-05.
 * In the window where it did not exist, 0048–0053 were added and their
 * checksums kept by hand.
 */

const DIR = 'database/migrations';
const REGISTRY = 'database/migration-checksums.json';
/** As `scripts/migrate.ts` computes it: SHA-256 of the source with CRLF normalised, so a checkout on Windows matches one on Linux. */
const checksum = (source: string) => createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');

const files = async () => (await readdir(DIR)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const registry = async () => JSON.parse(await readFile(REGISTRY, 'utf8')) as Record<string, string>;

describe('the migration registry', () => {
  it('records every migration, and records nothing that is not one', async () => {
    const [names, recorded] = [await files(), await registry()];
    expect(names.length).toBeGreaterThan(0);
    // Named in both directions, so neither a new migration without a checksum
    // nor a checksum for a deleted file can pass.
    expect(names.filter(name => !(name in recorded))).toEqual([]);
    expect(Object.keys(recorded).filter(name => !names.includes(name))).toEqual([]);
  });

  it('matches every file on disk, so no applied migration has been edited', async () => {
    const recorded = await registry();
    const drifted: string[] = [];
    for (const name of await files()) {
      if (checksum(await readFile(`${DIR}/${name}`, 'utf8')) !== recorded[name]) drifted.push(name);
    }
    // The message matters: this failing means either a migration was edited,
    // which is the thing that must never happen, or a new one needs its
    // checksum added. The fix is different each way round.
    expect(drifted, 'edited after being recorded — add a new migration instead, or add the checksum for a new file').toEqual([]);
  });

  it('is numbered from 0001 with no gap and no repeat, since the runner applies them in name order', async () => {
    const numbers = (await files()).map(name => Number(name.slice(0, 4)));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  it('holds a lowercase 64-character digest for each, and no stray key', async () => {
    for (const [name, value] of Object.entries(await registry())) {
      expect(value, name).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('never plainly re-creates a function an earlier migration already created', async () => {
    // A bare `create function` on a name that already exists fails at apply
    // time, and the runner applies every pending migration in **one
    // transaction** — so one such line fails the whole deploy, after the
    // checksums have already passed. There are exactly three ways to replace a
    // deployed function, and this allows all three and nothing else:
    //
    //   create or replace   — 0018, 0019, 0021, 0053
    //   drop function       — then create it afresh
    //   alter … rename to   — 0012 keeps the old body under a new name, so old
    //                         journal snapshots still read as they were written
    //
    // Matching is by name, not by signature, so a genuine overload would fire
    // this too. That is the right way round: an overload of a security definer
    // function is worth a second pair of eyes, and the repository has none.
    const live = new Map<string, string>();
    const clashes: string[] = [];
    for (const name of await files()) {
      const sql = await readFile(`${DIR}/${name}`, 'utf8');
      // Freed first within a file: a drop or rename above a create is the point of both.
      for (const match of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(edunexus\.[a-z0-9_]+)/gi)) live.delete(match[1]!.toLowerCase());
      for (const match of sql.matchAll(/alter\s+function\s+(edunexus\.[a-z0-9_]+)\s*\([^)]*\)\s*rename\s+to/gi)) live.delete(match[1]!.toLowerCase());
      for (const match of sql.matchAll(/create\s+(or\s+replace\s+)?function\s+(edunexus\.[a-z0-9_]+)/gi)) {
        const fn = match[2]!.toLowerCase();
        if (!match[1] && live.has(fn)) clashes.push(`${fn} is created plainly in ${name}, and already exists from ${live.get(fn)}`);
        live.set(fn, name);
      }
    }
    expect(clashes).toEqual([]);
  });
});
