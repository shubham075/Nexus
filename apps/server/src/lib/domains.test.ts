import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainHasToken, emailDomain, normalizeDomain, setTxtResolver, txtRecordFor } from './domains';

test('normalizeDomain strips scheme, www, path and case; rejects junk', () => {
  assert.equal(normalizeDomain('https://www.Acme.com/about'), 'acme.com');
  assert.equal(normalizeDomain('mail.acme.co.uk.'), 'mail.acme.co.uk');
  for (const bad of ['', 'localhost', 'acme', '-acme.com', 'acme..com', 'a b.com']) assert.equal(normalizeDomain(bad), null, bad);
});

test('emailDomain lowercases the part after the last @', () => {
  assert.equal(emailDomain('Jo@Acme.COM'), 'acme.com');
});

test('domainHasToken uses the injected resolver and needs an exact record', async () => {
  const seen: string[] = [];
  setTxtResolver(async (d) => {
    seen.push(d);
    return d === 'acme.com' ? ['v=spf1 -all', ` ${txtRecordFor('tok123')} `] : [];
  });
  try {
    assert.equal(await domainHasToken('acme.com', 'tok123'), true);
    assert.equal(await domainHasToken('acme.com', 'tok12'), false);
    assert.equal(await domainHasToken('other.com', 'tok123'), false);
    assert.deepEqual(seen, ['acme.com', 'acme.com', 'other.com']);
  } finally {
    setTxtResolver(null);
  }
});
