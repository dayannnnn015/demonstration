import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signInProblem } from '../web/Account';

/**
 * The sign-in form: one name for the password toggle, and what a refusal says.
 *
 * Both were asked for on 2026-11-09. The second was asked for as *"specify
 * which one is wrong"* and is deliberately **not** built that way, so the
 * larger half of this file guards the decision rather than the behaviour: a
 * later session reading the generic message will reasonably take it for
 * laziness and "fix" it, and nothing would have failed.
 *
 * The argument is on `signInProblem` and in `docs/constraints.md`; what is
 * asserted here is that it still refuses to name the wrong half, that it still
 * tells apart the states which give nothing away, and that the reasoning has
 * not been deleted from the source.
 */

const account = readFileSync('web/Account.tsx', 'utf8');
const constraints = readFileSync('docs/constraints.md', 'utf8');

describe('the password toggle has one name', () => {
  it('keeps a constant label and lets aria-pressed carry the state', () => {
    expect(account).toContain('aria-label="Show password"');
    expect(account).toContain('aria-pressed={shown}');
  });

  it('no longer swaps the words as well, which said it twice', () => {
    // "Hide password, pressed" is the same fact twice over.
    expect(account).not.toContain("'Hide password'");
    expect(account).not.toContain('"Hide password"');
  });
});

describe('a refused sign-in names both halves, never one', () => {
  it('says the pair does not match, and where to go next', () => {
    const text = signInProblem({ code: 'invalid_credentials' });
    expect(text).toContain('That email and password do not match an account');
    expect(text).toContain('recovery link');
    // The two things people actually get wrong and cannot see.
    expect(text).toMatch(/capitals/i);
    expect(text).toMatch(/space at the end/i);
  });

  it('never says which of the two was wrong', () => {
    const text = signInProblem({ code: 'invalid_credentials' });
    // Any of these would let somebody try addresses until one answered
    // differently, which is the whole of the enumeration leak.
    for (const leak of [/no account/i, /not registered/i, /unknown email/i, /wrong password/i, /incorrect password/i, /email not found/i]) {
      expect(text, `the refusal now leaks: ${leak}`).not.toMatch(leak);
    }
  });

  it('still tells apart the states that give nothing away about anybody else', () => {
    expect(signInProblem({ code: 'email_not_confirmed' })).toContain('has not been set up yet');
    expect(signInProblem({ code: 'over_request_rate_limit' })).toContain('Too many sign-in attempts');
    expect(signInProblem({ code: 'user_banned' })).toContain('suspended');
  });

  it('falls back to what the service said rather than inventing a reason', () => {
    expect(signInProblem({ message: 'Service unavailable' })).toBe('Service unavailable');
    expect(signInProblem(null)).toBe('');
  });

  it('is what the sign-in actually throws, not a helper nothing calls', () => {
    expect(account).toContain('throw new Error(signInProblem(error))');
  });
});

describe('the decision not to name the wrong half is kept where it can be read', () => {
  it('keeps the reasoning in the source', () => {
    expect(account).toContain('does not say whether the email or the password was the wrong one');
    expect(account).toContain('service-role key');
  });

  it('is recorded in constraints.md, with the gate it waits behind', () => {
    expect(constraints).toContain('never which of the two was wrong');
    // The gate row names what is now waiting on it, so opening the gate does not
    // silently open this too: it is necessary but not sufficient.
    expect(constraints).toContain('one request waits here');
  });
});
