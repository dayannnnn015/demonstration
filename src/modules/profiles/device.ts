/**
 * A browser and system a person would recognise ("Edge on Windows", "Chrome on
 * Android"), from a user-agent string. Coarse on purpose: the list of sessions
 * exists so someone can tell their own devices apart and end one they don't
 * recognise, and the full string identifies a machine more than that needs.
 */
export function deviceLabel(agent: string | undefined): string {
  const ua = agent ?? '';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Unknown browser';
  const system = /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone or iPad'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return system ? `${browser} on ${system}` : browser;
}
