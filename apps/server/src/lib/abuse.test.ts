import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDisposableEmail, parseDomains } from './abuse';

test('disposable email: built-in list, subdomains, case', () => {
  assert.equal(isDisposableEmail('x@mailinator.com'), true);
  assert.equal(isDisposableEmail('x@EU.Mailinator.COM'), true);
  assert.equal(isDisposableEmail('x@notmailinator.com'), false);
  assert.equal(isDisposableEmail('x@acme.test'), false);
});

test('disposable email: env list replaces the built-in one; empty disables', () => {
  const custom = parseDomains(' spam.example ,Junk.test');
  assert.equal(isDisposableEmail('a@junk.test', custom), true);
  assert.equal(isDisposableEmail('a@mailinator.com', custom), false);
  assert.equal(isDisposableEmail('a@mailinator.com', parseDomains('')), false);
});
