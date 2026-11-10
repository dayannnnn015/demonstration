/**
 * What a person chose on My profile, applied to the whole page. These follow
 * the account, so they are saved with it (0043) and arrive with `/me`; the
 * rail's collapsed state stays in the tab instead, since that belongs to the
 * machine in front of you.
 *
 * Each is an attribute on <html> that the stylesheets read, never an inline
 * style, which the content policy would drop.
 */
export type Preferences = {
  text_size?: unknown; motion?: unknown; theme?: unknown; density?: unknown;
  contrast?: unknown; links?: unknown; focus?: unknown; targets?: unknown; spacing?: unknown; typeface?: unknown;
};

// The first of each is the default. Contrast and motion default to the device's own setting, which the stylesheets read.
const choices = {
  text_size: ['standard', 'small', 'large', 'larger'], motion: ['system', 'reduce'], theme: ['light', 'dark', 'system'],
  density: ['comfortable', 'compact', 'spacious'],
  contrast: ['system', 'more'], links: ['standard', 'underline'], focus: ['standard', 'strong'],
  targets: ['standard', 'large'], spacing: ['standard', 'relaxed'], typeface: ['standard', 'readable'],
} as const;

const dark = () => { try { return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false; } catch { return false; } };

/**
 * Sets `data-text`, `data-motion`, `data-theme`, `data-scheme` and the
 * accessibility attributes on <html>. The scheme is the theme resolved: "Same
 * as this device" follows the device's own setting, and keeps following it
 * while the page is open. With nobody signed in, as on the sign-in page, every
 * setting is the device's own, the theme included.
 */
export function applyPreferences(p: Preferences | null | undefined, root: HTMLElement = document.documentElement) {
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    const chosen = p?.[key];
    const value = (choices[key] as readonly unknown[]).includes(chosen) ? String(chosen) : !p && key === 'theme' ? 'system' : choices[key][0];
    root.dataset[key === 'text_size' ? 'text' : key] = value;
  }
  root.dataset.scheme = root.dataset.theme === 'dark' || (root.dataset.theme === 'system' && dark()) ? 'dark' : 'light';
}

/** Follows the device's light or dark setting while "Same as this device" is chosen. Returns the way to stop. */
export function followDevice(root: HTMLElement = document.documentElement) {
  let query: MediaQueryList | undefined;
  try { query = globalThis.matchMedia?.('(prefers-color-scheme: dark)'); } catch { return () => {}; }
  if (!query) return () => {};
  const change = () => { if (root.dataset.theme === 'system') root.dataset.scheme = query!.matches ? 'dark' : 'light'; };
  query.addEventListener('change', change);
  return () => query!.removeEventListener('change', change);
}

/** Where to open: the screen chosen as the start, when nothing in the address asks for another and the role can open it. */
export function startScreen(landing: unknown, hash: string, allowed: (id: string) => boolean) {
  if (hash.replace(/^#\/?/, '')) return null;
  return typeof landing === 'string' && allowed(landing) ? landing : null;
}
