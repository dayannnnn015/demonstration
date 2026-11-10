import { useEffect, useRef, useState } from 'react';
import { ApiError, message, type Row } from '../api';
import type { ScreenProps } from '../routes';
import { Avatar, Glyph, avatarIcons, avatarTones, type Look } from '../components/avatar';
import { Icon } from '../components/icons';
import { Confirm, Sheet } from '../components/overlay';
import { Callout, PageHeader, StatusLine, TableSkeleton, Unrecorded, gradeName, idle, sentence, type Status, Spinner, BlockSkeleton } from '../components/primitives';
import type { SessionAuth } from '../api';
import { MyActivity, NameCorrection, type NameRequest } from './ProfileRecords';
import { editions } from '../help';
import { useHelp } from '../help/context';
import { Prose } from '../help/Prose';
import { whatsNew } from '../help/en/whats-new';
import { available, routes, type Role } from '../routes';
import { PhotoProblem, centred, clampCrop, drawCrop, maxZoom, openPicture, preparePhoto, turned, type Crop } from '../photo';

export type Profile = Look & { avatar: string; avatar_icon: string | null; avatar_tone: string; landing: string | null; text_size: string; motion: string; theme: string; density: string;
  contrast: string; links: string; focus: string; targets: string; spacing: string; typeface: string; version: number };
export type Mine = { user_id: string; display_name: string; role: string; position: string | null; specialization: string | null; profile: Profile; advises: Row[]; name_request?: NameRequest | null;
  photo_taken_down?: { at: string; by: string | null; reason: string } | null };
type Picture = { sha256: string; base64: string };

// The full picture, once per photo: the page and the staff list ask for the same one more than once.
const pictures = new Map<string, Promise<Picture | null>>();
export const fullPicture = (api: ScreenProps['api'], userId: string, sha: string) => {
  let found = pictures.get(sha);
  if (!found) {
    found = api<{ image: string; sha256: string }>(`/staff/${userId}/photo`).then(r => ({ sha256: r.sha256, base64: r.image })).catch(() => { pictures.delete(sha); return null; });
    pictures.set(sha, found);
  }
  return found;
};

const conflict = (error: unknown) => error instanceof ApiError && error.code === 'VERSION_CONFLICT';
// Not only another tab: a manager taking a photo down changes the profile too (found in the test pass).
export const changedElsewhere = 'Your profile changed since this page opened, in another tab or by the principal or administrative officer. It has been read again, so choose again.';

/**
 * A person's own page: how the school has them recorded, how they appear, and
 * (in the cards that follow) how they sign in and what the workspace remembers
 * for them. Only what is theirs to change is a control here; the name and
 * position print on official forms, so those stay with the principal and the
 * administrative officer.
 */
export function Profile(props: ScreenProps) {
  const { api, token, route, setStatus, account } = props;
  const [mine, setMine] = useState<Mine | null>(null);
  const [failed, setFailed] = useState('');
  const [picture, setPicture] = useState<Picture | null>(null);

  const load = () => api<Mine>('/me/profile').then(row => { setMine(row); setFailed(''); return row; });
  useEffect(() => { setMine(null); void load().catch(error => setFailed(message(error))); }, [api, token]);

  // The full picture, for the large avatar at the top, read once per photo.
  const sha = mine?.profile.photo?.sha256;
  useEffect(() => {
    if (!sha || !mine) { setPicture(null); return; }
    let live = true;
    void fullPicture(api, mine.user_id, sha).then(found => { if (live) setPicture(found); });
    return () => { live = false; };
  }, [sha]);

  /** A saved profile is shown here and in the top bar at once. */
  const saved = (profile: Profile) => {
    setMine(m => (m ? { ...m, profile } : m));
    account?.updateMe({ profile });
  };
  const reread = async () => { const row = await load(); account?.updateMe({ profile: row.profile }); };

  if (failed) return <><PageHeader route={route} /><Callout tone="stopped" title="Your profile could not be read">{failed}</Callout></>;
  if (!mine) return <><PageHeader route={route} /><div className="card"><div className="card-body"><TableSkeleton columns={2} rows={3} /></div></div></>;

  return (
    <>
      <PageHeader route={route} />
      <Identity mine={mine} picture={picture} api={api} onChanged={() => void load().catch(() => undefined)} />
      {/* Side by side on a wide screen: two short cards were a long column (the UI notes of 8 November, note 9). */}
      <div className="profile-grid">
      <PictureCard api={api} mine={mine} setStatus={setStatus} onSaved={saved} onConflict={reread} />
      <div className="card" data-tour="profile-security">
        <div className="card-head"><div>
          <h2>Signing in</h2>
          <p className="card-note">Your password is held by the sign-in service, never by EDUNEXUS. Nobody at the school can read it back to you.</p>
        </div></div>
        <div className="card-body">
          {/* Which account this is. It comes from the open session, not from
              `/me`: the address lives on `auth.users`, which the API cannot
              read, and nothing here is stored. Worth showing because a school
              with shared staffroom computers is exactly where "whose account
              am I in?" is a real question. */}
          <div className="setting">
            <div>
              <b>Signed in as</b>
              <p className="muted">
                {account?.signedInAs?.email
                  ? <span className="mono">{account.signedInAs.email}</span>
                  : <Unrecorded label="Address not available in this view" />}
              </p>
            </div>
            {account?.signedInAs?.lastSignIn
              ? <span className="muted">This sign-in began {new Date(account.signedInAs.lastSignIn).toLocaleString()}</span>
              : null}
          </div>
          <div className="setting">
            <div><b>Password</b><p className="muted">Change it here if you think someone else may know it.</p></div>
            {account?.changePassword
              ? <button type="button" className="btn secondary" onClick={account.changePassword}><Icon name="eye-off" size={15} />Change password</button>
              : <span className="muted">Not available in this view.</span>}
          </div>
          <Sessions api={api} auth={account?.auth} token={token} />
        </div>
      </div>
      </div>
      <MyActivity api={api} token={token} />
    </>
  );
}

/** The guided tours for this role, to take again, and what changed lately, in the screens' own words. */
export function Learning({ role }: { role: string }) {
  const help = useHelp();
  const tours = editions.en.tours.filter(t => !t.roles || t.roles.includes(role as Role));
  const opens = new Set(routes.filter(r => available(r, role)).map(r => r.id));
  return (
    <div className="card" data-tour="profile-learning">
      <div className="card-head"><div>
        <h2>Learning EDUNEXUS</h2>
        <p className="card-note">A tour points at the screen itself, one step at a time, and never presses anything for you.</p>
      </div></div>
      <div className="card-body">
        {help.tour ? (
          <div className="tour-list">
            {tours.map(t => (
              <button key={t.id} type="button" className="btn secondary small" onClick={() => help.tour!(t.id)} title={t.summary}>{t.title}</button>
            ))}
          </div>
        ) : <p className="muted">Tours start from the workspace itself.</p>}
        <h3 className="subhead">What’s new</h3>
        <ul className="whats-new">
          {whatsNew.slice(0, 4).map(r => (
            <li key={r.version}>
              <span className="muted">{new Date(`${r.date}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })} · {r.version}</span>
              <ul>{r.items.map((item, i) => <li key={i}><Prose text={item} opens={opens} /></li>)}</ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type SessionRow = { device: string; assurance: string; first_seen: string; last_seen: string; ended_at: string | null; current: boolean };
const when = (iso: string) => new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Where this account has been signed in lately, as the API saw it, and the
 * way to end every session but this one: after a shared staffroom computer
 * was left signed in, or a phone was lost.
 */
function Sessions({ api, auth, token }: { api: ScreenProps['api']; auth: SessionAuth | undefined; token: number }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(idle);
  const read = () => api<{ items: SessionRow[] }>('/me/sessions').then(r => setRows(r.items)).catch(() => setRows([]));
  useEffect(() => { void read(); }, [api, token]);
  const others = rows?.filter(r => !r.current && !r.ended_at).length ?? 0;
  const endOthers = async () => {
    if (!auth) return;
    setBusy(true);
    try {
      // The sign-in service revokes the other sessions first; only then is it recorded here.
      const { error } = await auth.signOut({ scope: 'others' });
      if (error) throw error;
      const { ended } = await api<{ ended: number }>('/me/sessions/end-others', 'POST');
      await read();
      setAsking(false);
      setStatus({ kind: 'done', text: ended ? `Signed out on ${ended === 1 ? 'one other device' : `${ended} other devices`}. This one stays signed in.` : 'Every other session was already ended. This one stays signed in.' });
    } catch (error) { setAsking(false); setStatus({ kind: 'error', text: message(error) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="setting sessions" data-tour="profile-sessions">
      <div>
        <b>Where you are signed in</b>
        <StatusLine status={status} />
        <p className="muted">Each time EDUNEXUS opened in a new sign-in, lately. Only the browser and system are kept, never where you were.</p>
        {rows === null ? <BlockSkeleton lines={2} /> : rows.length ? (
          <ul className="session-list">
            {rows.map((r, i) => (
              <li key={i}>
                <span><b>{r.device}</b>{r.current ? <span className="badge good">This device</span> : r.ended_at ? <span className="badge neutral">Signed out</span> : null}</span>
                <span className="muted">Last seen {when(r.last_seen)}{r.assurance === 'aal2' ? ' · with a code' : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">None recorded yet. A sign-in shows here the next time EDUNEXUS opens in it.</p>}
      </div>
      {auth
        ? <button type="button" className="btn secondary" disabled={busy} onClick={() => { setStatus(idle); setAsking(true); }}>Sign out everywhere else</button>
        : <span className="muted">Not available in this view.</span>}
      {asking ? (
        <Confirm title="Sign out everywhere else?" confirmLabel="Sign out everywhere else" tone="plain" busy={busy} onClose={() => setAsking(false)} onConfirm={() => void endOthers()}
          body={`Every other computer and phone signed in as you${others ? ` (${others} listed here)` : ''} must sign in again. Anything typed there and not yet saved is lost. This one stays signed in.`} />
      ) : null}
    </div>
  );
}

function Identity({ mine, picture, api, onChanged }: { mine: Mine; picture: Picture | null; api: ScreenProps['api']; onChanged: () => void }) {
  const position = [mine.position, mine.specialization].filter(Boolean).join(' · ');
  return (
    <div className="card profile-hero" data-tour="profile-identity">
      <div className="card-body">
        <Avatar name={mine.display_name} look={mine.profile} size="xl" image={picture} label={mine.profile.avatar === 'photo' ? `Your photo` : `Your avatar`} />
        <div className="profile-hero-text">
          <h2>{mine.display_name}</h2>
          <p>{sentence(mine.role)}{position ? ` · ${position}` : ''}</p>
          {mine.position ? null : <p className="muted">Position <Unrecorded label="Not set" /></p>}
          <p className="profile-advises">
            {mine.advises.length
              ? <>Adviser of {mine.advises.map(s => `${gradeName(s.grade_level)} ${String(s.name)} (${Number(s.start_year)}–${Number(s.start_year) + 1}${s.year_status === 'draft' ? ', being set up' : ''})`).join('; ')}</>
              : mine.role === 'teacher' ? 'Not an adviser of any section this school year.' : null}
          </p>
          <p className="muted">Your name, position and specialization print on the SF2, SF4 and SF9, so the principal or the administrative officer keeps them.</p>
        </div>
      </div>
      <div className="card-body profile-request">
        <NameCorrection api={api} mine={mine} onChanged={onChanged} />
      </div>
    </div>
  );
}

type Draft = { avatar: string; avatar_icon: string | null; avatar_tone: string };
const draftOf = (p: Profile): Draft => ({ avatar: p.avatar, avatar_icon: p.avatar_icon, avatar_tone: p.avatar_tone });
const same = (a: Draft, b: Draft) => a.avatar === b.avatar && a.avatar_icon === b.avatar_icon && a.avatar_tone === b.avatar_tone;

function PictureCard({ api, mine, setStatus, onSaved, onConflict }: {
  api: ScreenProps['api']; mine: Mine; setStatus: (s: Status) => void; onSaved: (p: Profile) => void; onConflict: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(mine.profile));
  const [status, setLocal] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { setDraft(draftOf(mine.profile)); }, [mine.profile.version]);
  const hasPhoto = Boolean(mine.profile.photo);
  const dirty = !same(draft, draftOf(mine.profile));

  const choose = (avatar: string) => {
    if (avatar === 'photo' && !hasPhoto) { setUploading(true); return; }
    setDraft(d => ({ ...d, avatar, avatar_icon: avatar === 'icon' ? (d.avatar_icon ?? 'book') : d.avatar_icon }));
  };
  const fail = async (error: unknown) => {
    if (conflict(error)) { await onConflict(); setLocal({ kind: 'error', text: changedElsewhere }); return; }
    setLocal({ kind: 'error', text: message(error) });
  };
  const save = async () => {
    setBusy(true);
    setLocal({ kind: 'busy', text: 'Saving…' });
    try {
      const profile = await api<Profile>('/me/profile', 'PATCH', { version: mine.profile.version, ...draft });
      onSaved(profile);
      setLocal(idle);
      setStatus({ kind: 'done', text: 'Your picture is saved. It shows in the top bar now.' });
    } catch (error) { await fail(error); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const profile = await api<Profile>('/me/photo/remove', 'POST', { version: mine.profile.version });
      onSaved(profile);
      setRemoving(false);
      setLocal(idle);
      setStatus({ kind: 'done', text: 'Your photo is removed and deleted. Your initials show instead.' });
    } catch (error) { setRemoving(false); await fail(error); } finally { setBusy(false); }
  };

  const preview: Look = { ...draft, photo: mine.profile.photo ?? null };
  return (
    <div className="card" data-tour="profile-picture">
      <div className="card-head"><div>
        <h2>Your picture</h2>
        <p className="card-note">How you appear in the top bar and, to the principal and administrative officer, on Staff access. Other teachers do not see it.</p>
      </div></div>
      <div className="card-body">
        <StatusLine status={status} />
        {mine.photo_taken_down && !hasPhoto ? (
          <Callout tone="attention" title="Your photo was taken down">
            {mine.photo_taken_down.by ?? 'A manager'} took it down on {new Date(mine.photo_taken_down.at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}: “{mine.photo_taken_down.reason}” It was deleted. Upload another when you are ready, or keep your initials or an icon.
          </Callout>
        ) : null}
        <div className="picture-choice">
          <Avatar name={mine.display_name} look={preview} size="lg" label="Preview of your picture" />
          <div className="picture-controls">
            <div className="segmented" role="radiogroup" aria-label="Show">
              {([['initials', 'Initials'], ['icon', 'An icon'], ['photo', 'My photo']] as const).map(([key, label]) => (
                <button key={key} type="button" role="radio" aria-checked={draft.avatar === key} className={draft.avatar === key ? 'active' : ''} onClick={() => choose(key)}>{label}</button>
              ))}
            </div>
            {draft.avatar === 'photo' ? null : (
              <div className="field">
                <span className="label" id="tone-label">Colour</span>
                <div className="swatches" role="radiogroup" aria-labelledby="tone-label">
                  {avatarTones.map(([key, label]) => (
                    <button key={key} type="button" role="radio" aria-checked={draft.avatar_tone === key} aria-label={label} title={label}
                      className={`swatch tone-${key}`} onClick={() => setDraft(d => ({ ...d, avatar_tone: key }))}>
                      {draft.avatar_tone === key ? <Icon name="check" size={14} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {draft.avatar === 'icon' ? (
              <div className="field">
                <span className="label" id="icon-label">Icon</span>
                <div className="glyph-grid" role="radiogroup" aria-labelledby="icon-label">
                  {avatarIcons.map(name => (
                    <button key={name} type="button" role="radio" aria-checked={draft.avatar_icon === name} aria-label={sentence(name)} title={sentence(name)}
                      className={`glyph-option${draft.avatar_icon === name ? ' active' : ''}`} onClick={() => setDraft(d => ({ ...d, avatar_icon: name }))}>
                      <Glyph name={name} size={18} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="form-actions">
              <button type="button" className="btn" disabled={!dirty || busy} aria-busy={busy && dirty} onClick={() => void save()}>{busy && dirty ? <><Spinner />Saving…</> : 'Save picture'}</button>
              {dirty ? <button type="button" className="btn ghost" disabled={busy} onClick={() => { setDraft(draftOf(mine.profile)); setLocal(idle); }}>Undo changes</button> : null}
              <button type="button" className="btn secondary" disabled={busy} onClick={() => setUploading(true)}><Icon name="imports" size={15} />{hasPhoto ? 'Change photo' : 'Upload a photo'}</button>
              {hasPhoto ? <button type="button" className="btn ghost danger-text" disabled={busy} onClick={() => setRemoving(true)}>Remove photo</button> : null}
            </div>
          </div>
        </div>
      </div>
      {uploading ? (
        <PhotoSheet api={api} version={mine.profile.version} replacing={hasPhoto} onClose={() => setUploading(false)} onConflict={onConflict}
          onSaved={profile => { onSaved(profile); setUploading(false); setLocal(idle); setStatus({ kind: 'done', text: 'Your photo is saved. It shows in the top bar now.' }); }} />
      ) : null}
      {removing ? (
        <Confirm title="Remove your photo?" confirmLabel="Remove photo" busy={busy} onClose={() => setRemoving(false)} onConfirm={() => void remove()}
          body="It is deleted for good: EDUNEXUS keeps no copy, and your initials show instead. You can upload a photo again at any time." />
      ) : null}
    </div>
  );
}

/**
 * Choosing, framing and sending a photo. Everything happens on this machine
 * until *Use this photo*: the picture is read, framed on a canvas, and only
 * the framed square is encoded and sent, without what the camera recorded.
 */
export function PhotoSheet({ api, version, replacing, onSaved, onClose, onConflict }: {
  api: ScreenProps['api']; version: number; replacing?: boolean; onSaved: (p: Profile) => void; onClose: () => void; onConflict: () => Promise<void>;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop>(centred);
  const [status, setStatus] = useState<Status>(idle);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [opening, setOpening] = useState(false);
  const picks = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null);

  useEffect(() => () => bitmap?.close(), [bitmap]);
  useEffect(() => { if (bitmap && stage.current) drawCrop(stage.current, bitmap, crop, 480); }, [bitmap, crop]);

  // While a picture opens, nothing may use the one on screen: it is closed the moment the new one arrives, and a
  // save already encoding it would fail half-way (found in the browser, 28 October). Of two picked quickly, the last wins.
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const turn = ++picks.current;
    setOpening(true);
    setStatus({ kind: 'busy', text: 'Opening the picture…' });
    try {
      const opened = await openPicture(file);
      if (turn !== picks.current) { opened.close(); return; }
      setBitmap(opened);
      setCrop(centred);
      setStatus(idle);
    } catch (error) {
      if (turn === picks.current) setStatus({ kind: 'error', text: error instanceof PhotoProblem ? error.message : 'That file could not be opened as a picture.' });
    } finally {
      if (input.current) input.current.value = '';
      if (turn === picks.current) setOpening(false);
    }
  };
  const held = busy || opening;
  const move = (next: Crop) => { if (bitmap) setCrop(clampCrop(bitmap.width, bitmap.height, next)); };
  const nudge = (dx: number, dy: number) => move({ ...crop, x: crop.x + dx / crop.zoom, y: crop.y + dy / crop.zoom });

  const send = async () => {
    if (!bitmap || held) return;
    setBusy(true);
    setStatus({ kind: 'busy', text: 'Preparing and saving your photo…' });
    try {
      const prepared = await preparePhoto(bitmap, crop);
      onSaved(await api<Profile>('/me/photo', 'POST', { version, ...prepared }));
    } catch (error) {
      if (conflict(error)) { await onConflict(); setStatus({ kind: 'error', text: `${changedElsewhere} Then choose Use this photo again.` }); }
      else if (error instanceof ApiError && error.code === 'NO_CHANGES') setStatus({ kind: 'error', text: 'That is already your photo, framed the same way.' });
      else setStatus({ kind: 'error', text: error instanceof PhotoProblem ? error.message : message(error) });
      setBusy(false);
    }
  };

  return (
    <Sheet title={bitmap ? 'Frame your photo' : replacing ? 'Change your photo' : 'Upload a photo'} note="A clear photo of your face, like an ID picture. Only the principal and the administrative officer see it besides you." onClose={onClose}>
      <StatusLine status={status} />
      <input ref={input} id="photo-file" className="sr-only" type="file" aria-label="Choose a photo file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        onChange={event => void pick(event.target.files?.[0])} />
      {bitmap ? (
        <>
          <div className="photo-stage">
            <canvas ref={stage} className="photo-crop" tabIndex={0} role="img"
              aria-label="Your photo as it will be kept. Drag, or use the arrow keys, to move it; plus and minus to zoom."
              onPointerDown={event => { (event.target as Element).setPointerCapture?.(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, crop }; }}
              onPointerMove={event => {
                const start = drag.current;
                const box = stage.current?.getBoundingClientRect();
                if (!start || !bitmap || !box?.width) return;
                // A drag across the whole frame moves the picture by the frame's own width, so it follows the finger.
                const span = Math.min(bitmap.width, bitmap.height) / start.crop.zoom;
                move({ ...start.crop, x: start.crop.x - ((event.clientX - start.x) / box.width) * span / bitmap.width, y: start.crop.y - ((event.clientY - start.y) / box.height) * span / bitmap.height });
              }}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
              onKeyDown={event => {
                const step = 0.04;
                const keys: Record<string, () => void> = {
                  ArrowLeft: () => nudge(-step, 0), ArrowRight: () => nudge(step, 0), ArrowUp: () => nudge(0, -step), ArrowDown: () => nudge(0, step),
                  '+': () => move({ ...crop, zoom: crop.zoom + 0.25 }), '=': () => move({ ...crop, zoom: crop.zoom + 0.25 }), '-': () => move({ ...crop, zoom: crop.zoom - 0.25 }),
                };
                const run = keys[event.key];
                if (run) { event.preventDefault(); run(); }
              }} />
          </div>
          <div className="photo-tools">
            <div className="field inline">
              <label className="label" htmlFor="photo-zoom">Zoom</label>
              <input id="photo-zoom" type="range" min={1} max={maxZoom} step={0.05} value={crop.zoom} onChange={event => move({ ...crop, zoom: Number(event.target.value) })} />
            </div>
            <button type="button" className="btn secondary small" disabled={held} onClick={() => { setOpening(true); void turned(bitmap).then(next => { setBitmap(next); setCrop(centred); }).finally(() => setOpening(false)); }}>Turn a quarter</button>
            <button type="button" className="btn secondary small" disabled={held} onClick={() => setCrop(centred)}>Centre</button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => input.current?.click()}>Choose another</button>
          </div>
          <p className="muted">Where the camera recorded the photo, and on what device, is not kept: only the framed square is sent.</p>
          <div className="form-actions">
            <button type="button" className="btn" disabled={held} aria-busy={busy} onClick={() => void send()}>{busy ? <><Spinner />Saving…</> : 'Use this photo'}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <label htmlFor="photo-file" className={`photo-drop${over ? ' over' : ''}`}
          onDragOver={event => { event.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={event => { event.preventDefault(); setOver(false); void pick(event.dataTransfer.files[0]); }}>
          <Icon name="imports" size={22} />
          <b>Choose a photo</b>
          <span>or drop one here. JPEG or PNG, taken on a phone or a camera.</span>
        </label>
      )}
    </Sheet>
  );
}
