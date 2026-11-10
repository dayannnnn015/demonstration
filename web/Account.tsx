import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { message, rememberMe, remembered } from './api';
import { BrandMark } from './components/brand';
import { Icon } from './components/icons';
import { StatusLine, type Status, idle, Spinner } from './components/primitives';

type Stage = 'loading' | 'signin' | 'set-password' | 'ready';

/**
 * A password field that can be read back.
 *
 * Hiding what was typed defends against someone standing behind you, which in
 * a staffroom is a real threat — and so is mistyping a twelve-character
 * password twice on a shared keyboard. The toggle lets the person decide which
 * risk they are in, which is the only way that judgement can be made correctly.
 */
function Password({ id, name = id, label, hint, autoComplete, value, onChange }: {
  id: string;
  /** What a password manager files the value under; it needs a name as well as an id. */
  name?: string;
  label: string;
  hint?: string;
  autoComplete: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <span className="password-wrap">
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? 12 : undefined}
          required
          value={value}
          onChange={event => onChange(event.target.value)}
        />
        <button
          type="button"
          className="password-peek"
          aria-pressed={shown}
          // One name, not two. A toggle button keeps its label and lets
          // `aria-pressed` carry the state; swapping the words as well said the
          // same thing twice, and a screen reader read it twice over — "Hide
          // password, pressed". Asked for 2026-11-09.
          aria-label="Show password"
          title="Show password"
          onClick={() => setShown(v => !v)}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} size={16} />
        </button>
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Tells the browser that this email and password just worked, so its own
 * password manager offers to save them, or to update the one it holds (decision
 * D1a). Chrome and Edge are told directly; Firefox and Safari find out from the
 * named fields and the submitted form. EDUNEXUS keeps nothing: the password goes
 * only to the browser's store, and the session still ends with the tab.
 */
export function offerToSave(email: string, password: string) {
  const Credential = (globalThis as { PasswordCredential?: new (data: { id: string; password: string }) => globalThis.Credential }).PasswordCredential;
  if (!Credential || !email || !password || !globalThis.navigator?.credentials?.store) return;
  // A refusal or a dismissed prompt changes nothing about the sign-in.
  void globalThis.navigator.credentials.store(new Credential({ id: email, password })).catch(() => undefined);
}

/**
 * Sign-in and invitation completion.
 * Supabase owns passwords and refresh tokens; this only drives its client.
 */
export function Account({ client, onReady, framed = true }: {
  client: SupabaseClient; onReady: () => void;
  /** False inside the front page's Staff portal panel (0.106.0): the card alone, since the page around it is the front page. */
  framed?: boolean;
}) {
  const [stage, setStage] = useState<Stage>('loading');
  const [status, setStatus] = useState<Status>({ text: 'Connecting to the sign-in service…', kind: 'busy' });
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Ticked already for someone who chose it on this computer before, so their own
  // device does not quietly forget them after the session finally expires.
  const [keepSignedIn, setKeepSignedIn] = useState(remembered);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const fail = (error: unknown) => setStatus({ text: message(error), kind: 'error' });

  function finish() {
    setStage('ready');
    setStatus(idle);
    onReady();
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Invitation and recovery links arrive in the fragment. Read once, then
        // drop it from history so the token is not left in the address bar.
        const fragment = new URLSearchParams(location.hash.slice(1));
        const arrival = fragment.get('type');
        if (arrival) history.replaceState(null, '', location.pathname);
        const { data } = await client.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          setEmail(data.session.user?.email ?? '');
          if (arrival === 'invite' || arrival === 'recovery') {
            setStage('set-password');
            setStatus(idle);
            return;
          }
          finish();
          return;
        }
        setStage('signin');
        setStatus(idle);
      } catch (error) { if (!cancelled) { setStage('signin'); fail(error); } }
    })();
    return () => { cancelled = true; };
  }, [client]);

  const submit = (run: () => Promise<void>) => async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await run(); } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const card = (
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark"><BrandMark size={30} /></span>
          <span className="brand-text">
            <b>EDUNEXUS<span className="tag-dev">Dev</span></b>
            <span>Balili Elementary School</span>
          </span>
        </div>

        {stage === 'set-password' ? (
          <>
            <h1>Choose a password</h1>
            <p className="auth-lede">This finishes setting up your account. You will use it to sign in from now on.</p>
          </>
        ) : (
          <>
            <h1>Sign in to EDUNEXUS</h1>
            <p className="auth-lede">Use the school email address your account was created with.</p>
          </>
        )}

        <StatusLine status={status} />

        {stage === 'signin' ? (
          <form method="post" onSubmit={submit(async () => {
            const address = email.trim();
            // Chosen before the sign-in call, because the session is written as it returns
            // and it has to land in the store this person picked.
            rememberMe(keepSignedIn);
            const { error } = await client.auth.signInWithPassword({ email: address, password });
            if (error) { setPassword(''); throw new Error(signInProblem(error)); }
            offerToSave(address, password);
            setPassword('');
            finish();
          })}>
            <div className="field">
              <label className="label" htmlFor="email">School email</label>
              <input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <Password id="password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} />
            {/* Off unless this person turned it on before: the staffroom machine is the
                default case, and the one that must not keep anybody signed in. */}
            <label className="auth-keep" htmlFor="keep-signed-in">
              <input id="keep-signed-in" name="keep-signed-in" type="checkbox" checked={keepSignedIn} onChange={e => setKeepSignedIn(e.target.checked)} />
              <span>
                <b>Keep me signed in on this computer</b>
                <small>Only on a computer that is yours. On a shared staffroom computer leave this off, and signing out ends it everywhere either way.</small>
              </span>
            </label>
            <div className="form-actions">
              <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Signing in…</> : 'Sign in'}</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={async () => {
                const address = email.trim();
                if (!address) { setStatus({ text: 'Enter your school email first.', kind: 'error' }); return; }
                setBusy(true);
                const result = await client.auth.resetPasswordForEmail(address, { redirectTo: `${location.origin}/account/setup` })
                  .catch(error => ({ error } as { error: { code?: string; status?: number } }));
                setBusy(false);
                // Supabase answers 200 for an unknown address but throttles a
                // registered one, so a per-address rate limit would reveal that
                // the account exists. It therefore gets the same reply as
                // success. A disabled provider is project-wide and identical
                // for every address, so that one is safe to name.
                const code = result.error?.code ?? '';
                const throttled = code === 'over_email_send_rate_limit' || result.error?.status === 429;
                if (result.error && !throttled) {
                  setStatus({ kind: 'error', text:
                    code === 'email_provider_disabled'
                      ? 'Email sign-in is switched off for this project, so no recovery link can be sent. The system operator must enable the Email provider in Supabase.'
                      : 'The recovery service did not accept the request. Tell the system operator if this keeps happening.' });
                  return;
                }
                setStatus({ kind: 'done', text: 'If that address has an account, a recovery link is on its way. Only one link is sent a minute, so check your inbox and spam folder before asking for another.' });
              }}>Email a recovery link</button>
            </div>
            <div className="auth-foot">
              <p>Your browser can save your password. Unless you tick the box above, you stay signed in only until this tab is closed, so on a shared computer close the tab when you are done.</p>
              <p>Accounts are created by the school, not self-registered.</p>
            </div>
          </form>
        ) : null}

        {stage === 'set-password' ? (
          <form onSubmit={submit(async () => {
            if (newPassword !== confirmation) throw new Error('The two passwords do not match.');
            const { error } = await client.auth.updateUser({ password: newPassword });
            if (error) { setNewPassword(''); setConfirmation(''); throw error; }
            offerToSave(email, newPassword);
            setNewPassword(''); setConfirmation('');
            finish();
          })}>
            {/* Whose password this is, for the browser's password manager; the person need not type it. */}
            <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
            <Password id="new-password" label="New password" hint="At least 12 characters." autoComplete="new-password" value={newPassword} onChange={setNewPassword} />
            <Password id="confirm-password" label="Confirm password" autoComplete="new-password" value={confirmation} onChange={setConfirmation} />
            <div className="form-actions">
              <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Saving…</> : 'Save password'}</button>
            </div>
            <div className="auth-foot">
              <p>Your password is held by the sign-in service, never by EDUNEXUS. Nobody at the school can read it back to you.</p>
            </div>
          </form>
        ) : null}
      </div>
  );
  if (!framed) return <div className="auth-embed">{card}</div>;
  return (
    <div className="auth">
      {/* The front page's painted hillside, from this origin. It shows no person; the words are the school's. */}
      <section className="auth-art">
        <picture>
          <source media="(max-width: 760px)" srcSet="/images/hero-balili-v1-phone.webp" type="image/webp" />
          <img src="/images/hero-balili-v1-1200.webp" width="1200" height="533" alt="" decoding="async" />
        </picture>
        <div className="auth-art-copy">
          <p className="auth-gov">Republic of the Philippines · Department of Education</p>
          <p className="auth-school">Balili Elementary School</p>
          <p className="auth-place">La Trinidad, Benguet</p>
        </div>
      </section>
      <main className="auth-panel">
      <a className="auth-back" href="/">← The school’s front page</a>
      {card}
      </main>
    </div>
  );
}

/** The three Supabase calls a password change needs, so a test can stand in for the service. */
export type PasswordAuth = Pick<SupabaseClient['auth'], 'getUser' | 'signInWithPassword' | 'updateUser' | 'mfa'>;

/**
 * Why a sign-in was refused, in the school's words.
 *
 * **It does not say whether the email or the password was the wrong one, and
 * that is a decision rather than an omission.** Asked for on 2026-11-09; the
 * reasoning is kept here because the request is a reasonable one and will come
 * again:
 *
 * 1. *It would tell anyone who can reach this page which addresses are staff
 *    accounts.* They try addresses until one answers differently. The sign-in
 *    sits on the public internet beside the school's front page, and the
 *    recovery link three lines below already refuses to leak it — "If that
 *    address has an account, a recovery link is on its way". Naming it here
 *    would undo that on the one screen somebody probing would actually visit.
 * 2. *EDUNEXUS could not tell you anyway.* Supabase answers both cases with the
 *    same `invalid_credentials`, deliberately. Distinguishing them means asking
 *    whether the address exists, which needs the **service-role key in the API
 *    runtime** — an open gate in `docs/constraints.md`, and one that would let a
 *    compromised runtime create, alter or delete any identity in the school.
 *
 * So this says both possibilities plainly and names the two ways out, which is
 * the actionable part of what was asked for; and the states that give nothing
 * away about anybody else **are** told apart, because withholding those helps
 * nobody.
 */
export function signInProblem(error: { code?: string | undefined; message?: string | undefined } | null | undefined) {
  if (!error) return '';
  const code = error.code ?? '';
  if (code === 'invalid_credentials') {
    return 'That email and password do not match an account. Check the address for a typo, then the password — '
      + 'capitals and a space at the end both count. If you are not sure of the password, use “Email a recovery link” below.';
  }
  // Safe to name: this is a state the reader is in and can act on, not a fact
  // about whether somebody else's address is registered.
  if (code === 'email_not_confirmed') {
    return 'This account has not been set up yet. Open the invitation the school emailed you and choose a password first.';
  }
  if (code === 'over_request_rate_limit' || /request rate limit/i.test(error.message ?? '')) {
    return 'Too many sign-in attempts in a short time. Wait a minute and try again.';
  }
  if (code === 'user_banned') return 'This account has been suspended. Ask the principal or the administrative officer.';
  return error.message || 'The sign-in service refused the sign-in.';
}

/** What the sign-in service's refusal means when a password is being *changed*, in the words of this form. */
export function passwordProblem(error: { code?: string | undefined; message?: string | undefined } | null | undefined) {
  if (!error) return '';
  if (error.code === 'same_password') return 'The new password must be different from the one you use now.';
  if (error.code === 'weak_password') return 'The sign-in service found that password too easy to guess. Choose a longer one, or one that is not a common word or phrase.';
  if (error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit') return 'Too many attempts in a short time. Wait a minute and try again.';
  if (error.code === 'insufficient_aal' || /aal2/i.test(error.message ?? '')) return 'Your authenticator code is needed before the password can be changed. Enter the six digits from your authenticator app.';
  if (error.code === 'invalid_totp' || /invalid.*(totp|code)/i.test(error.message ?? '')) return 'That code was not accepted. Codes change every 30 seconds — wait for the next one and try again.';
  return error.message || 'The sign-in service did not accept the change.';
}

/**
 * Changing the password of the account already signed in.
 *
 * The project does not make Supabase ask for the current password — secure
 * password change is off — so anyone who finds a staffroom machine left signed
 * in could otherwise replace it and lock its owner out. The form therefore
 * signs in again with the current password before it changes anything. That
 * is a check in the browser, not a control: the operator should also switch on
 * secure password change, which is recorded in the status.
 *
 * **That re-sign-in is also what broke the form for everyone with MFA on.**
 * `signInWithPassword` returns a session at AAL1, because the authenticator
 * step has not been done in it; Supabase then refuses `updateUser` with "AAL2
 * session is required to update email or password when MFA is enabled", which
 * is the message the school saw and which says nothing about what to do. So
 * when a verified factor exists the form asks for the six digits and lifts the
 * session back to AAL2 before changing anything. Nobody is asked for a code
 * who has not enrolled one.
 */
export function PasswordChange({ auth, onDone }: { auth: PasswordAuth; onDone: (text: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  /** Whether this account has an authenticator to answer for. Unknown until asked. */
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(idle);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next.length < 12) { setStatus({ kind: 'error', text: 'The new password needs at least 12 characters.' }); return; }
    if (next !== confirmation) { setStatus({ kind: 'error', text: 'The two new passwords do not match.' }); return; }
    if (next === current) { setStatus({ kind: 'error', text: 'The new password must be different from the one you use now.' }); return; }
    setBusy(true);
    setStatus({ kind: 'busy', text: 'Checking your current password…' });
    try {
      const { data, error } = await auth.getUser();
      const email = data.user?.email;
      if (error || !email) throw new Error('Your session could not be read. Sign out, sign in again, then retry.');
      const check = await auth.signInWithPassword({ email, password: current });
      setCurrent('');
      if (check.error) { setStatus({ kind: 'error', text: check.error.code === 'invalid_credentials' ? 'That is not your current password.' : passwordProblem(check.error) }); return; }

      // The sign-in above lands at AAL1. If a verified authenticator exists,
      // Supabase will refuse the change until this session answers it.
      const factors = await auth.mfa.listFactors();
      const totp = factors.data?.totp?.find(f => f.status === 'verified');
      if (totp) {
        if (!/^[0-9]{6}$/.test(code.trim())) {
          setNeedsCode(true);
          setStatus({ kind: 'error', text: 'Enter the six digits from your authenticator app, then change the password.' });
          return;
        }
        const lifted = await auth.mfa.challengeAndVerify({ factorId: totp.id, code: code.trim() });
        setCode('');
        if (lifted.error) { setStatus({ kind: 'error', text: passwordProblem(lifted.error) }); return; }
      }

      const changed = await auth.updateUser({ password: next });
      if (changed.error) { setStatus({ kind: 'error', text: passwordProblem(changed.error) }); return; }
      // So the browser's saved password follows the change, rather than filling the old one next time.
      offerToSave(email, next);
      setNext(''); setConfirmation(''); setNeedsCode(false);
      onDone('Password changed. Use the new one the next time you sign in.');
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <StatusLine status={status} />
      <Password id="current-password" label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} />
      <Password id="changed-password" label="New password" hint="At least 12 characters." autoComplete="new-password" value={next} onChange={setNext} />
      <Password id="changed-confirmation" label="Confirm new password" autoComplete="new-password" value={confirmation} onChange={setConfirmation} />
      {needsCode ? (
        <div className="field">
          <label className="label" htmlFor="changed-totp">Authenticator code</label>
          <input id="changed-totp" className="mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ''))} />
          <span className="hint">The six digits shown in your authenticator app right now. The sign-in service asks for them before a password changes.</span>
        </div>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy} aria-busy={busy}>{busy ? <><Spinner />Saving…</> : 'Change password'}</button>
      </div>
      <p className="muted">Your password is held by the sign-in service, never by EDUNEXUS. Other devices stay signed in until their session ends.</p>
    </form>
  );
}
