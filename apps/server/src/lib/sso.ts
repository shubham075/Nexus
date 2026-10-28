import { Issuer, type BaseClient } from 'openid-client';
import { API_PREFIX } from '@nexus/shared';
import { env } from './env';

/** OIDC single sign-on (SOT §8, README → "Single sign-on"). Pure helpers are exported for tests. */

export interface SsoProvider {
  id: string;
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  emailClaim: string;
  allowedDomains: string[];
}

/** Reads `OIDC_PROVIDERS=microsoft,google` and `OIDC_<ID>_*` for each. Incomplete providers are an error, not silently dropped. */
export function parseProviders(e: Record<string, string | undefined>): SsoProvider[] {
  const ids = (e.OIDC_PROVIDERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ids.map((id) => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`OIDC_PROVIDERS: invalid provider id "${id}"`);
    const key = (k: string) => `OIDC_${id.toUpperCase().replace(/-/g, '_')}_${k}`;
    const need = (k: string) => {
      const v = e[key(k)];
      if (!v) throw new Error(`Missing env var ${key(k)}`);
      return v;
    };
    return {
      id,
      label: e[key('LABEL')] ?? id.charAt(0).toUpperCase() + id.slice(1),
      issuer: need('ISSUER'),
      clientId: need('CLIENT_ID'),
      clientSecret: need('CLIENT_SECRET'),
      emailClaim: e[key('EMAIL_CLAIM')] ?? 'email',
      allowedDomains: (e[key('ALLOWED_DOMAINS')] ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
    };
  });
}

/** Only loopback redirects are allowed: the desktop app's one-shot listener (or the dev renderer on localhost). */
export function isLoopbackRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) && !u.username && !u.password;
}

/** Picks the account email from ID-token claims; null when missing, unverified or outside the allowed domains. */
export function emailFromClaims(claims: Record<string, unknown>, p: Pick<SsoProvider, 'emailClaim' | 'allowedDomains'>): string | null {
  if (claims.email_verified === false || claims.email_verified === 'false') return null;
  const raw = claims[p.emailClaim] ?? claims.email;
  if (typeof raw !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) return null;
  const email = raw.trim().toLowerCase();
  const domain = email.split('@')[1];
  if (p.allowedDomains.length && !p.allowedDomains.includes(domain)) return null;
  return email;
}

export const providers = parseProviders(process.env);
export const callbackUrl = (id: string) => `${env.publicUrl.replace(/\/+$/, '')}${API_PREFIX}/auth/sso/${id}/callback`;

const clients = new Map<string, Promise<BaseClient>>();

/** Discovery is done lazily and cached; a failed discovery is retried on the next sign-in. */
export function oidcClient(p: SsoProvider): Promise<BaseClient> {
  let c = clients.get(p.id);
  if (!c) {
    c = Issuer.discover(p.issuer).then(
      (issuer) =>
        new issuer.Client({
          client_id: p.clientId,
          client_secret: p.clientSecret,
          redirect_uris: [callbackUrl(p.id)],
          response_types: ['code'],
        }),
    );
    c.catch(() => clients.delete(p.id));
    clients.set(p.id, c);
  }
  return c;
}
