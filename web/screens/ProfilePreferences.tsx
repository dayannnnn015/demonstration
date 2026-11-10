import { useState } from 'react';
import { ApiError, message, type Api } from '../api';
import { routes, available, type Route } from '../routes';
import { Select, StatusLine, idle, type Status } from '../components/primitives';
import { applyPreferences } from '../preferences';
import { changedElsewhere, type Profile } from './Profile';

type Key = 'text_size' | 'density' | 'motion' | 'theme';
type Access = 'contrast' | 'links' | 'focus' | 'targets' | 'spacing' | 'typeface';
const options: Record<Key | Access, [string, string][]> = {
  text_size: [['small', 'Small'], ['standard', 'Standard'], ['large', 'Large'], ['larger', 'Larger']],
  density: [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']],
  theme: [['light', 'Light'], ['dark', 'Dark'], ['system', 'Same as this device']],
  motion: [['system', 'Same as this device'], ['reduce', 'Less motion']],
  contrast: [['system', 'Same as this device'], ['more', 'Higher contrast']],
  links: [['standard', 'Standard'], ['underline', 'Always underlined']],
  focus: [['standard', 'Standard'], ['strong', 'Thicker outline']],
  targets: [['standard', 'Standard'], ['large', 'Larger']],
  spacing: [['standard', 'Standard'], ['relaxed', 'More space']],
  typeface: [['standard', 'Standard'], ['readable', 'Atkinson Hyperlegible']],
};
const labels: Record<Key | Access, { title: string; note: string }> = {
  text_size: { title: 'Text size', note: 'Every screen, the rail and the forms on screen. Printing is unchanged.' },
  density: { title: 'Spacing', note: 'How much room each row and control is given. Compact fits more of a long register or learner list on a screen; Spacious is easier to hit on a tablet. Printing is unchanged.' },
  theme: { title: 'Theme', note: 'Dark is easier on the eyes in a dim room. Printed forms stay black on white.' },
  motion: { title: 'Motion', note: 'Less motion stops panels sliding and tours gliding between steps.' },
  contrast: { title: 'Contrast', note: 'Grey text as dark as the rest, and lines between things that show. Same as this device follows your computer’s own setting.' },
  links: { title: 'Links', note: 'Underlines every link, so a link never has to be told apart by its colour alone.' },
  focus: { title: 'Keyboard focus', note: 'A thicker outline around whatever the Tab key has reached.' },
  targets: { title: 'Buttons and boxes', note: 'Every button, box and choice at least 44 pixels tall, easier to press with a finger or an unsteady hand.' },
  spacing: { title: 'Line spacing', note: 'More room between lines, letters and words, for reading longer passages.' },
  typeface: { title: 'Typeface', note: 'Atkinson Hyperlegible was drawn for low vision: I, l and 1, and O and 0, look different from one another.' },
};
const access: Access[] = ['contrast', 'links', 'focus', 'targets', 'spacing', 'typeface'];
const defaults: Record<Access, string> = { contrast: 'system', links: 'standard', focus: 'standard', targets: 'standard', spacing: 'standard', typeface: 'standard' };

/**
 * Each choice takes effect as it is made and is saved at once; a refusal puts
 * the page back the way it was, so what is on screen is always what is saved.
 */
function useSave(api: Api, profile: Profile, onSaved: (p: Profile) => void, onConflict: () => Promise<void>) {
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const save = async (change: Partial<Record<Key | Access | 'landing', string | null>>) => {
    if (busy) return;
    setBusy(true);
    applyPreferences({ ...profile, ...change });
    setStatus({ kind: 'busy', text: 'Saving…' });
    try {
      onSaved(await api<Profile>('/me/profile', 'PATCH', { version: profile.version, ...change }));
      setStatus({ kind: 'done', text: 'Saved. It follows you to any computer you sign in on.' });
    } catch (error) {
      applyPreferences(profile);
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') { await onConflict(); setStatus({ kind: 'error', text: changedElsewhere }); }
      else if (error instanceof ApiError && error.code === 'NO_CHANGES') setStatus(idle);
      else setStatus({ kind: 'error', text: message(error) });
    } finally { setBusy(false); }
  };
  return { status, busy, save };
}

function Choice({ name, profile, busy, save, sample }: {
  name: Key | Access; profile: Profile; busy: boolean; save: (change: Partial<Record<Key | Access, string>>) => void; sample?: string | undefined;
}) {
  return (
    <div className="setting">
      <div><b id={`pref-${name}`}>{labels[name].title}</b><p className="muted">{labels[name].note}</p></div>
      <div className="segmented" role="radiogroup" aria-labelledby={`pref-${name}`}>
        {options[name].map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={profile[name] === value} className={`${profile[name] === value ? 'active' : ''}${value === sample ? ' typeface-sample' : ''}`}
            disabled={busy} onClick={() => { if (profile[name] !== value) save({ [name]: value }); }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

/** The preferences that follow you from one computer to the next. */
export function Preferences({ api, role, profile, onSaved, onConflict }: {
  api: Api; role: unknown; profile: Profile; onSaved: (p: Profile) => void; onConflict: () => Promise<void>;
}) {
  const { status, busy, save } = useSave(api, profile, onSaved, onConflict);
  const screens = routes.filter((r: Route) => available(r, role) && r.id !== 'profile' && r.id !== 'settings');

  return (
    <div className="card" data-tour="profile-preferences">
      <div className="card-head"><div>
        <h2>Preferences</h2>
        <p className="card-note">Saved with your account, so they follow you to any computer you sign in on. Whether the sidebar is collapsed stays with this tab.</p>
      </div></div>
      <div className="card-body">
        <StatusLine status={status} />
        <div className="setting">
          <div><label htmlFor="pref-landing"><b>Start on</b></label><p className="muted">The screen that opens when you sign in.</p></div>
          <span className="field inline">
          <Select id="pref-landing" disabled={busy} value={profile.landing && screens.some(s => s.id === profile.landing) ? profile.landing : ''}
            onChange={event => void save({ landing: event.target.value || null })}>
            <option value="">Overview</option>
            {screens.filter(s => s.id !== 'overview').map(s => <option key={s.id} value={s.id}>{s.nav}</option>)}
          </Select>
          </span>
        </div>
        {(['text_size', 'density', 'theme', 'motion'] as Key[]).map(key => <Choice key={key} name={key} profile={profile} busy={busy} save={c => void save(c)} />)}
      </div>
    </div>
  );
}

/**
 * Accessibility settings (the group's notes of 28 October, N6), saved with the
 * account like the preferences above. Each changes how the screens are drawn,
 * never what a paper form prints.
 */
export function Accessibility({ api, profile, onSaved, onConflict }: {
  api: Api; profile: Profile; onSaved: (p: Profile) => void; onConflict: () => Promise<void>;
}) {
  const { status, busy, save } = useSave(api, profile, onSaved, onConflict);
  const changed = access.filter(key => profile[key] !== defaults[key]);
  return (
    <div className="card" data-tour="profile-accessibility">
      <div className="card-head">
        <div>
          <h2>Accessibility</h2>
          <p className="card-note">Easier to see, read and press. Each takes effect at once, on every screen; printed forms are unchanged.</p>
        </div>
        {changed.length ? (
          <div className="card-head-actions">
            <button type="button" className="btn ghost" disabled={busy}
              onClick={() => void save(Object.fromEntries(changed.map(key => [key, defaults[key]])))}>Put these back</button>
          </div>
        ) : null}
      </div>
      <div className="card-body">
        <StatusLine status={status} />
        {access.map(key => <Choice key={key} name={key} profile={profile} busy={busy} save={c => void save(c)} sample={key === 'typeface' ? 'readable' : undefined} />)}
      </div>
    </div>
  );
}
