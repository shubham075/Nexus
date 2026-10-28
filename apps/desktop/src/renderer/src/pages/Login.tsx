import { useEffect, useState } from 'react';
import { APP_NAME } from '@nexus/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isWeb } from '@/lib/webBridge';
import { ErrorText } from '@/components/ui';

export default function Login() {
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
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="w-full max-w-[400px] px-6">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-xl font-semibold text-surface">N</div>
          <span className="text-3xl font-semibold tracking-tight text-zinc-900">{APP_NAME}</span>
        </div>
        <div className="card p-6 shadow-lg">
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
                setError(err);
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
          <p className="mt-4 text-center text-xs text-zinc-500">Accounts are created by your administrator.</p>
        </div>
      </div>
    </div>
  );
}
