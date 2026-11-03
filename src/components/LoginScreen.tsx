import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { cloud, friendlyError, isApp } from '../lib/cloud';

type Mode = 'signin' | 'signup' | 'magic' | 'reset';

/**
 * Sign-in page. Required on the web; in the desktop and mobile apps it's optional and
 * only opened when you want to share (onCancel takes you back).
 */
export function LoginScreen({ onCancel, note }: { onCancel?: () => void; note?: string } = {}) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const addr = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const api = await cloud();
      if (mode === 'signin') await api.signIn(addr, password);
      else if (mode === 'signup') {
        const mustConfirm = await api.signUp(addr, password);
        if (mustConfirm) setInfo(`Almost done! We sent a confirmation link to ${addr}. Open it to finish creating your account.`);
      } else if (mode === 'magic') {
        await api.sendMagicLink(addr);
        setInfo(`Check your email. We sent a sign-in link to ${addr}.`);
      } else {
        await api.sendPasswordReset(addr);
        setInfo(`If ${addr} has an account, a password reset link is on its way.`);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    signin: 'Sign in to Inkwell',
    signup: 'Create your Inkwell account',
    magic: 'Sign in with an email link',
    reset: 'Reset your password',
  };
  const buttons: Record<Mode, string> = {
    signin: 'Sign in',
    signup: 'Create account',
    magic: 'Send sign-in link',
    reset: 'Send reset link',
  };
  const needsPassword = mode === 'signin' || mode === 'signup';

  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./icon.svg" alt="" width={56} height={56} />
        <h1>{titles[mode]}</h1>
        <p className="muted login-sub">
          {note ??
            (mode === 'signup'
              ? 'An account lets you share documents with other people.'
              : isApp
                ? 'Sign in to share documents and see documents shared with you. Your own documents stay on this device.'
                : 'Write, draw and share documents from any browser.')}
        </p>

        {(mode === 'signin' || mode === 'signup') && (
          <div className="segmented login-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
              Sign in
            </button>
            <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
          </div>
        )}

        <form onSubmit={submit} className="login-form">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </label>
          {needsPassword && (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
          )}
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          {info && (
            <p className="login-info" role="status">
              <Mail size={16} /> {info}
            </p>
          )}
          <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" />} {buttons[mode]}
          </button>
        </form>

        <div className="login-links">
          {mode === 'signin' && (
            <>
              {/* Emailed links open the website, so this option is web-only */}
              {!isApp && (
                <button className="link-btn" onClick={() => setMode('magic')}>
                  Email me a sign-in link instead
                </button>
              )}
              <button className="link-btn" onClick={() => setMode('reset')}>
                Forgot password?
              </button>
            </>
          )}
          {(mode === 'magic' || mode === 'reset') && (
            <button className="link-btn" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          )}
          {onCancel && (
            <button className="link-btn muted" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {isApp && (mode === 'signup' || mode === 'reset') && (
          <p className="muted small login-app-note">
            The confirmation or reset email opens the Inkwell website. After that, come back here and sign in.
          </p>
        )}
      </div>
      {!isApp && <p className="muted small login-foot">
        Prefer no account? The{' '}
        <a href="https://github.com/tkfam151/notetaking-app/releases/latest" target="_blank" rel="noreferrer">
          Mac, Windows, Linux and Android apps
        </a>{' '}
        work offline without signing in.
      </p>}
    </div>
  );
}

/** Shown after following a password-reset email link. */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./icon.svg" alt="" width={56} height={56} />
        <h1>Choose a new password</h1>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await (await cloud()).updatePassword(pw);
              onDone();
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="btn btn-primary login-submit" disabled={busy}>
            Save password
          </button>
        </form>
      </div>
    </div>
  );
}
