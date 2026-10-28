import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createMailer, mailConfigFromEnv, MailError } from './mailer';
import { verifyEmailTemplate } from './emailTemplates';

const MAILPIT_SMTP = { host: '127.0.0.1', port: 1026 };
const MAILPIT_API = 'http://127.0.0.1:8026/api/v1';

function capture() {
  const lines: unknown[][] = [];
  return { lines, log: { info: (...a: unknown[]) => lines.push(a), warn: (...a: unknown[]) => lines.push(a) } };
}

const mail = () => ({ to: 'asha@example.com', ...verifyEmailTemplate({ name: 'Asha', url: 'https://nexus.example.com/v?t=1', expiresInHours: 24 }) });

test('config: SMTP_URL is parsed, host/port vars work, nothing set means no SMTP', () => {
  const a = mailConfigFromEnv({ SMTP_URL: 'smtps://me%40x.com:p%40ss@smtp.example.com', MAIL_FROM: 'N <n@x.com>' });
  assert.deepEqual(a.smtp, { host: 'smtp.example.com', port: 465, secure: true, user: 'me@x.com', pass: 'p@ss' });
  assert.equal(a.from, 'N <n@x.com>');
  const b = mailConfigFromEnv({ SMTP_HOST: 'mail.local', SMTP_PORT: '1026' });
  assert.deepEqual(b.smtp, { host: 'mail.local', port: 1026, secure: false, user: undefined, pass: undefined });
  assert.equal(mailConfigFromEnv({}).smtp, null);
  assert.throws(() => mailConfigFromEnv({ SMTP_URL: 'http://x' }));
});

test('without SMTP the mail is logged, not sent', async () => {
  const { lines, log } = capture();
  const res = await createMailer({ smtp: null, from: 'Nexus <n@x.com>', timeoutMs: 1000 }, log).sendMail(mail());
  assert.deepEqual(res, { delivered: false });
  assert.equal(lines.length, 1);
  assert.match(JSON.stringify(lines[0]), /asha@example\.com.*Verify your email/);
});

test('invalid recipients and multi-line subjects are rejected', async () => {
  const m = createMailer({ smtp: null, from: 'n@x.com', timeoutMs: 1000 }, capture().log);
  await assert.rejects(m.sendMail({ ...mail(), to: 'not-an-address' }), (e) => e instanceof MailError && e.code === 'INVALID_MAIL');
  await assert.rejects(m.sendMail({ ...mail(), to: 'a@b.co\r\nBcc: c@d.co' }), MailError);
  await assert.rejects(m.sendMail({ ...mail(), subject: 'a\nb' }), MailError);
});

test('an unreachable SMTP server fails with a retryable MailError', async () => {
  // Port 9 (discard) is closed on dev machines: the connection is refused quickly.
  const m = createMailer({ smtp: { host: '127.0.0.1', port: 9, secure: false }, from: 'n@x.com', timeoutMs: 2000 }, capture().log);
  await assert.rejects(m.sendMail(mail()), (e) => e instanceof MailError && e.code === 'SEND_FAILED' && e.retryable);
});

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host, port, timeout: 500 });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.once('timeout', () => done(false));
  });
}

test('sends through Mailpit when it is running (docker compose up -d)', async (t) => {
  if (!(await reachable(MAILPIT_SMTP.host, MAILPIT_SMTP.port))) {
    t.skip('Mailpit not reachable on 127.0.0.1:1026');
    return;
  }
  const tag = randomUUID();
  const m = createMailer({ smtp: { ...MAILPIT_SMTP, secure: false }, from: 'Nexus <no-reply@nexus.local>', timeoutMs: 5000 });
  const res = await m.sendMail({ ...mail(), subject: `Mailer test ${tag}` });
  m.close();
  assert.equal(res.delivered, true);
  const found = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`subject:"${tag}"`)}`).then((r) => r.json());
  assert.equal(found.messages_count, 1);
  assert.equal(found.messages[0].To[0].Address, 'asha@example.com');
});
