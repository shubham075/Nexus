/** Common throwaway-mail providers (SOT §14.4, 2d). `DISPOSABLE_EMAIL_DOMAINS` replaces this list. */
const BUILT_IN = [
  '10minutemail.com', 'discard.email', 'dispostable.com', 'emailondeck.com', 'fakeinbox.com', 'getnada.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamailblock.com', 'maildrop.cc', 'mailinator.com',
  'mailnesia.com', 'mintemail.com', 'mohmal.com', 'sharklasers.com', 'spamgourmet.com', 'temp-mail.org',
  'tempmail.com', 'tempmailo.com', 'throwawaymail.com', 'trashmail.com', 'yopmail.com',
];

export const parseDomains = (raw: string | undefined): Set<string> =>
  new Set(raw === undefined ? BUILT_IN : raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean));

// Read directly (not via env.ts) so the unit test needs no server config. Unset = built-in list, empty = none.
const blocked = parseDomains(process.env.DISPOSABLE_EMAIL_DOMAINS);

/** True if the address is on a blocked domain or one of its subdomains. */
export function isDisposableEmail(email: string, domains: Set<string> = blocked): boolean {
  const parts = email.slice(email.lastIndexOf('@') + 1).toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) if (domains.has(parts.slice(i).join('.'))) return true;
  return false;
}
