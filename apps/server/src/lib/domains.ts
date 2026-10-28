import { resolveTxt } from 'node:dns/promises';

/** Company email domains (SOT D22): normalising, matching and DNS TXT verification. Pure apart from DNS. */

export const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/** "https://www.Acme.com/about" → "acme.com". Returns null when it isn't a plausible domain. */
export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return DOMAIN_RE.test(d) ? d : null;
}


/** Dev/e2e only: reads process.env directly so unit tests can import this without the API's env. */
export const dnsStubEnabled = process.env.DNS_STUB === 'true' && process.env.NODE_ENV !== 'production';

/** TXT lookups for company domain verification (SOT D22). Injectable so tests never hit real DNS. */
export type TxtResolver = (domain: string) => Promise<string[]>;

const realResolver: TxtResolver = async (domain) => {
  try {
    return (await resolveTxt(domain)).map((chunks) => chunks.join(''));
  } catch {
    return []; // NXDOMAIN / no TXT / timeout all mean "not verified yet"
  }
};

/** Dev/e2e stub table (DNS_STUB=true), filled through /api/v1/dev/dns. */
export const stubTxt = new Map<string, string[]>();
const stubResolver: TxtResolver = async (domain) => stubTxt.get(domain) ?? [];

let resolver: TxtResolver = dnsStubEnabled ? stubResolver : realResolver;

export function setTxtResolver(r: TxtResolver | null): void {
  resolver = r ?? (dnsStubEnabled ? stubResolver : realResolver);
}

export const TXT_PREFIX = 'nexus-verification=';
export const txtRecordFor = (token: string) => `${TXT_PREFIX}${token}`;

/** True when the domain has a TXT record `nexus-verification=<token>`. */
export async function domainHasToken(domain: string, token: string): Promise<boolean> {
  const records = await resolver(domain);
  return records.some((r) => r.trim() === txtRecordFor(token));
}
