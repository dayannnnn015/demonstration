// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { rememberMe, remembered, sessionStore } from '../web/api';

/**
 * Where a signed-in session is kept.
 *
 * The default has to be the tab's own store, because the school's staffroom
 * computers are shared and a session left behind there is a stranger holding
 * somebody's account. "Keep me signed in" is the one thing that moves it, and
 * signing out has to clear it wherever it ended up — so each of those is a case
 * here rather than something read off the screen once and trusted.
 */

const KEY = 'edunexus-session';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('where the session is kept', () => {
  it('keeps it in the tab by default, where closing the browser loses it', () => {
    expect(remembered()).toBe(false);
    sessionStore.setItem(KEY, 'a-session');
    expect(sessionStorage.getItem(KEY)).toBe('a-session');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStore.getItem(KEY)).toBe('a-session');
  });

  it('keeps it past the browser once the box is ticked', () => {
    rememberMe(true);
    expect(remembered()).toBe(true);
    sessionStore.setItem(KEY, 'a-session');
    expect(localStorage.getItem(KEY)).toBe('a-session');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('clears both stores on the way out, whichever one held it', () => {
    rememberMe(true);
    sessionStore.setItem(KEY, 'a-session');
    rememberMe(false);
    // The tab's copy of an earlier session must go too, or signing out would leave one behind.
    sessionStorage.setItem(KEY, 'an-older-session');
    sessionStore.removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('forgets the choice when it is turned off, so the next person starts unticked', () => {
    rememberMe(true);
    expect(remembered()).toBe(true);
    rememberMe(false);
    expect(remembered()).toBe(false);
    expect(localStorage.getItem('edunexus-remember')).toBeNull();
  });

  it('reads back what it wrote after the choice is made, not before', () => {
    // The sign-in page sets the choice before the sign-in call for exactly this reason:
    // a session written while the box was still off lands in the tab and is lost.
    sessionStore.setItem(KEY, 'written-first');
    rememberMe(true);
    expect(sessionStore.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe('written-first');
  });

  it('survives a store that throws, as a private window makes it', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      // Nothing may throw out of these: signing in must not fail because the browser keeps nothing.
      expect(remembered()).toBe(false);
      expect(() => rememberMe(true)).not.toThrow();
      expect(() => sessionStore.setItem(KEY, 'a-session')).not.toThrow();
      expect(() => sessionStore.removeItem(KEY)).not.toThrow();
      expect(sessionStore.getItem(KEY)).toBeNull();
    } finally {
      if (real) Object.defineProperty(globalThis, 'localStorage', real);
    }
  });
});
