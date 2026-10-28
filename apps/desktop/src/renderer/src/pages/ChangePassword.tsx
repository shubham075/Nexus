import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import { PASSWORD_RULES, passwordProblem } from '@nexus/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorText } from '@/components/ui';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="flex h-full items-start justify-center pt-20">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">{forced ? 'Set your password' : 'Change password'}</h1>
        {forced && <p className="mt-1 text-sm text-zinc-600">Your administrator gave you a temporary password. Choose a new one to continue.</p>}
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const problem = passwordProblem(next);
            if (problem) return setError(new Error(problem));
            if (next !== confirm) return setError(new Error('Passwords do not match'));
            try {
              await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
              setDone(true);
              setCur('');
              await refresh();
              if (!forced) setTimeout(() => navigate(-1), 800);
            } catch (err) {
              setError(err);
            }
          }}
        >
          <div>
            <label className="label">Current password</label>
            <input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          </div>
          <div>
            <label className="label">New password</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required />
            {/* Same rules the server enforces (SOT §8). */}
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {PASSWORD_RULES.map((r) => {
                const ok = r.test(next);
                return (
                  <li key={r.id} className={`flex items-center gap-1.5 ${ok ? 'text-zinc-900' : 'text-zinc-500'}`}>
                    {ok ? <Check size={13} className="text-brand-500" /> : <Circle size={11} />}
                    {r.label}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <ErrorText error={error} />
          {done && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Password updated. Other devices have been signed out.</div>}
          <div className="flex justify-between pt-2">
            {forced ? <button type="button" className="btn-ghost" onClick={logout}>Sign out</button> : <span />}
            <button className="btn-primary">Save password</button>
          </div>
        </form>
      </div>
    </div>
  );
}
