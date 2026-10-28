import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_NAME, passwordProblem } from '@nexus/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isWeb } from '@/lib/webBridge';
import { ErrorText } from '@/components/ui';
import { PasswordRules } from '@/components/PasswordRules';

type Mode = 'signin' | 'signup' | 'verify' | 'forgot' | 'reset';
type Go = (m: Mode, opts?: { notice?: string; email?: string }) => void;

/** Email links open `#/verify-email?token=…` / `#/reset-password?token=…` (web); desktop users paste them. */
function initialMode(path: string): Mode {
  if (path === '/verify-email') return 'verify';
  if (path === '/reset-password') return 'reset';
  return 'signin';
}

export default function Login() {
  const location = useLocation();
  const [mode, setMode] = useState<Mode>(() => initialMode(location.pathname));
  const [notice, setNotice] = useState<string | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);
  const [presetEmail, setPresetEmail] = useState('');
  const linkToken = new URLSearchParams(location.search).get('token') ?? '';

  useEffect(() => {
    // Public sign-up exists only in multi mode (SOT D23); single mode keeps the sign-in-only screen.
    api.get<{ signup: boolean }>('/auth/config').then((c) => setSignupOpen(c.signup), () => {});
  }, []);

  // A mailed link opened while this screen is already showing.
  useEffect(() => {
    const m = initialMode(location.pathname);
    if (m !== 'signin') setMode(m);
  }, [location.pathname, location.search]);

  const go: Go = (m, opts = {}) => {
    setNotice(opts.notice ?? null);
    if (opts.email !== undefined) setPresetEmail(opts.email);
    setMode(m);
  };

  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="w-full max-w-[400px] px-6">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-xl font-semibold text-surface">N</div>
          <span className="text-3xl font-semibold tracking-tight text-zinc-900">{APP_NAME}</span>
        </div>
        <div className="card p-6 shadow-lg">
          {notice && <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}
          {mode === 'signin' && <SignIn signupOpen={signupOpen} go={go} />}
          {mode === 'signup' && <SignUp go={go} />}
          {mode === 'verify' && <Verify key={linkToken} go={go} email={presetEmail} initialToken={linkToken} />}
          {mode === 'forgot' && <Forgot go={go} email={presetEmail} />}
          {mode === 'reset' && <Reset key={linkToken} go={go} initialToken={location.pathname === '/reset-password' ? linkToken : ''} />}
        </div>
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, submit };
}

function Back({ go, label = 'Back to sign in' }: { go: Go; label?: string }) {
  return (
    <button type="button" className="mt-4 w-full text-center text-sm text-zinc-600 hover:underline" onClick={() => go('signin')}>
      {label}
    </button>
  );
}

function SignIn({ signupOpen, go }: { signupOpen: boolean; go: Go }) {
  const login = useAuth((s) => s.login);
  const loginWithSso = useAuth((s) => s.loginWithSso);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  const [ssoBusy, setSsoBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // SSO buttons appear only when the server has OIDC providers configured, and only on desktop:
    // the loopback flow needs the Electron main process (the web redirect flow is phase 2).
    if (isWeb) return;
    api.get<{ id: string; label: string }[]>('/auth/sso/providers').then(setProviders, () => {});
  }, []);

  const sso = async (id: string) => {
    setSsoBusy(id);
    setError(null);
    try {
      await loginWithSso(id);
    } catch (err) {
      setError(err);
    } finally {
      setSsoBusy(null);
    }
  };

  return (
    <>
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-600">Stay connected with your colleagues</p>
      {providers.length > 0 && (
        <div className="mb-5 space-y-2">
          {providers.map((p) => (
            <button key={p.id} type="button" className="btn-ghost h-12 w-full border border-zinc-300 text-base" disabled={!!ssoBusy} onClick={() => sso(p.id)}>
              {ssoBusy === p.id ? 'Waiting for your browser…' : `Continue with ${p.label}`}
            </button>
          ))}
          {ssoBusy && (
            <button type="button" className="w-full text-center text-xs text-zinc-500 hover:underline" onClick={() => window.nexus.sso.cancel()}>
              Cancel
            </button>
          )}
          <div className="flex items-center gap-3 pt-2 text-xs text-zinc-500">
            <div className="h-px flex-1 bg-zinc-200" />
            or sign in with your password
            <div className="h-px flex-1 bg-zinc-200" />
          </div>
        </div>
      )}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(email, password);
          } catch (err) {
            if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') go('verify', { email, notice: err.message });
            else setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input h-12" type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <input className="input h-12" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorText error={error} />
        <button className="btn-primary h-12 w-full text-base" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button type="button" className="mt-3 w-full text-center text-sm text-zinc-600 hover:underline" onClick={() => go('forgot', { email })}>
        Forgot password?
      </button>
      {signupOpen ? (
        <p className="mt-4 text-center text-sm text-zinc-600">
          New to {APP_NAME}?{' '}
          <button type="button" className="link" onClick={() => go('signup')}>Create an account</button>
        </p>
      ) : (
        <p className="mt-4 text-center text-xs text-zinc-500">Accounts are created by your administrator.</p>
      )}
    </>
  );
}

function SignUp({ go }: { go: Go }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, setError, busy, submit } = useSubmit(async () => {
    const problem = passwordProblem(password);
    if (problem) return setError(new Error(problem));
    await api.post('/auth/signup', { name, email, password });
    go('verify', { email, notice: `We sent a verification link to ${email}.` });
  });
  return (
    <>
      <h1 className="text-3xl font-semibold">Create account</h1>
      <p className="mb-6 mt-1 text-sm text-zinc-600">Use your work email to join your company</p>
      <form className="space-y-4" onSubmit={submit}>
        <input className="input h-12" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <input className="input h-12" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div>
          <input className="input h-12" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <PasswordRules value={password} />
        </div>
        <ErrorText error={error} />
        <button className="btn-primary h-12 w-full text-base" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <Back go={go} label="I already have an account" />
    </>
  );
}

function Verify({ go, email, initialToken }: { go: Go; email: string; initialToken: string }) {
  const loginWithTokens = useAuth((s) => s.loginWithTokens);
  const [link, setLink] = useState(initialToken);
  const [resent, setResent] = useState(false);
  const { error, busy, submit } = useSubmit(async () => {
    await loginWithTokens(await api.post('/auth/verify-email', { token: link.trim() }));
    window.location.hash = '#/';
  });
  return (
    <>
      <h1 className="text-2xl font-semibold">Verify your email</h1>
      <p className="mb-5 mt-1 text-sm text-zinc-600">
        Open the email from {APP_NAME}{email ? ` sent to ${email}` : ''} and paste its link here.
      </p>
      <form className="space-y-4" onSubmit={submit}>
        <input className="input h-12" placeholder="Verification link" value={link} onChange={(e) => setLink(e.target.value)} autoFocus required />
        <ErrorText error={error} />
        <button className="btn-primary h-12 w-full text-base" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
      </form>
      {email && (
        <button
          type="button"
          className="mt-3 w-full text-center text-sm text-zinc-600 hover:underline disabled:no-underline disabled:opacity-60"
          disabled={resent}
          onClick={() => api.post('/auth/resend-verification', { email }).finally(() => setResent(true))}
        >
          {resent ? 'Sent. Check your inbox.' : 'Send a new link'}
        </button>
      )}
      <Back go={go} />
    </>
  );
}

function Forgot({ go, email: initial }: { go: Go; email: string }) {
  const [email, setEmail] = useState(initial);
  const { error, busy, submit } = useSubmit(async () => {
    await api.post('/auth/forgot-password', { email });
    go('reset', { notice: `If ${email} has an account, we sent it a reset link. It works for 30 minutes.` });
  });
  return (
    <>
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <p className="mb-5 mt-1 text-sm text-zinc-600">We will email you a link to choose a new password.</p>
      <form className="space-y-4" onSubmit={submit}>
        <input className="input h-12" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <ErrorText error={error} />
        <button className="btn-primary h-12 w-full text-base" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
      </form>
      <Back go={go} />
    </>
  );
}

function Reset({ go, initialToken }: { go: Go; initialToken: string }) {
  const [link, setLink] = useState(initialToken);
  const [password, setPassword] = useState('');
  const { error, setError, busy, submit } = useSubmit(async () => {
    const problem = passwordProblem(password);
    if (problem) return setError(new Error(problem));
    await api.post('/auth/reset-password', { token: link.trim(), newPassword: password });
    window.location.hash = '#/';
    go('signin', { notice: 'Password changed. Sign in with the new one; other devices were signed out.' });
  });
  return (
    <>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="mb-5 mt-1 text-sm text-zinc-600">{initialToken ? 'Enter your new password.' : 'Paste the link from the reset email.'}</p>
      <form className="space-y-4" onSubmit={submit}>
        {!initialToken && <input className="input h-12" placeholder="Reset link" value={link} onChange={(e) => setLink(e.target.value)} autoFocus required />}
        <div>
          <input className="input h-12" type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <PasswordRules value={password} />
        </div>
        <ErrorText error={error} />
        <button className="btn-primary h-12 w-full text-base" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
      <Back go={go} />
    </>
  );
}
