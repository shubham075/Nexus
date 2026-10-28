import { Check, Circle } from 'lucide-react';
import { PASSWORD_RULES } from '@nexus/shared';

/** Live checklist of the password policy the server enforces (SOT §8). */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.id} className={`flex items-center gap-1.5 ${ok ? 'text-zinc-900' : 'text-zinc-500'}`}>
            {ok ? <Check size={13} className="text-brand-500" /> : <Circle size={11} />}
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}
