import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  inviteTemplate,
  notificationDigestTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from './emailTemplates';

const EVIL = `<script>alert("x")</script>&'`;
const URL_ = 'https://nexus.example.com/verify?token=abc&next=/feed';

function assertEscaped(html: string) {
  assert.ok(!html.includes('<script>'), 'raw <script> in html');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'), 'escaped value missing');
}

test('escapeHtml escapes all five special characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('verify email escapes the name and links the url in html and text', () => {
  const m = verifyEmailTemplate({ name: EVIL, url: URL_, expiresInHours: 24 });
  assertEscaped(m.html);
  assert.ok(m.html.includes('href="https://nexus.example.com/verify?token=abc&amp;next=/feed"'));
  assert.ok(m.text.includes(URL_));
  assert.ok(m.text.includes('24 hours'));
  assert.ok(m.html.startsWith('<!doctype html>') && m.html.includes('<html lang="en">'));
});

test('reset password escapes the name and includes the link', () => {
  const m = resetPasswordTemplate({ name: EVIL, url: 'https://nexus.example.com/reset?t=1', expiresInMinutes: 30 });
  assertEscaped(m.html);
  assert.ok(m.html.includes('href="https://nexus.example.com/reset?t=1"'));
  assert.ok(m.text.includes('https://nexus.example.com/reset?t=1'));
});

test('invite escapes inviter and company and keeps the subject on one line', () => {
  const m = inviteTemplate({ inviterName: `Eve\r\nBcc: x@y.z`, companyName: EVIL, url: URL_, expiresInDays: 7 });
  assertEscaped(m.html);
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.ok(m.html.includes('Accept invitation'));
  assert.ok(m.text.includes(URL_));
});

test('digest escapes every item and links item urls', () => {
  const m = notificationDigestTemplate({
    name: 'Asha',
    items: [
      { title: EVIL, body: EVIL, url: 'https://nexus.example.com/posts/1' },
      { title: 'Ravi commented' },
    ],
    appUrl: 'https://nexus.example.com',
    settingsUrl: 'https://nexus.example.com/settings',
  });
  assertEscaped(m.html);
  assert.equal(m.subject, 'You have 2 new notifications on Nexus');
  assert.ok(m.html.includes('href="https://nexus.example.com/posts/1"'));
  assert.ok(m.html.includes('href="https://nexus.example.com/settings"'));
  assert.ok(m.text.includes('https://nexus.example.com/posts/1'));
});

test('non-http links are refused', () => {
  assert.throws(() => verifyEmailTemplate({ name: 'A', url: 'javascript:alert(1)', expiresInHours: 1 }));
  assert.throws(() => resetPasswordTemplate({ name: 'A', url: '/relative', expiresInMinutes: 1 }));
  assert.throws(() =>
    notificationDigestTemplate({ name: 'A', items: [{ title: 't', url: 'data:text/html,x' }], appUrl: 'https://a.b', settingsUrl: 'https://a.b' }),
  );
});
