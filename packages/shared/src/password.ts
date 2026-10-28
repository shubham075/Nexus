/** Password policy (SOT §8). Shared so the change-password screen shows the same rules the server enforces. */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt ignores everything after 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordRule {
  id: 'length' | 'upper' | 'lower' | 'digit' | 'symbol';
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_BYTES} characters`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH && new TextEncoder().encode(pw).length <= PASSWORD_MAX_BYTES,
  },
  { id: 'upper', label: 'An upper-case letter', test: (pw) => /\p{Lu}/u.test(pw) },
  { id: 'lower', label: 'A lower-case letter', test: (pw) => /\p{Ll}/u.test(pw) },
  { id: 'digit', label: 'A number', test: (pw) => /\p{Nd}/u.test(pw) },
  { id: 'symbol', label: 'A symbol (e.g. ! @ # -)', test: (pw) => /[^\p{L}\p{Nd}\s]/u.test(pw) },
];

/** Returns a single user-facing message for the first failed rule, or null when the password is acceptable. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES) return `Use at most ${PASSWORD_MAX_BYTES} characters`;
  const missing = PASSWORD_RULES.filter((r) => r.id !== 'length' && !r.test(pw)).map((r) => r.label.toLowerCase().replace(/^an? /, ''));
  if (missing.length) return `Add ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return null;
}
