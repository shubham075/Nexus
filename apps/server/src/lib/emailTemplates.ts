/**
 * Transactional email templates (SOT §8 → Email). Each returns `{ subject, html, text }` for `sendMail`.
 * Inline styles only, light neutral look; every value passed in is HTML-escaped and links must be http(s).
 */

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const APP = 'Nexus';

const C = {
  page: '#f4f4f5', // zinc-100
  card: '#ffffff',
  border: '#e4e4e7', // zinc-200
  text: '#18181b', // zinc-900
  muted: '#52525b', // zinc-600 (4.5:1+ on white)
  button: '#18181b',
  buttonText: '#ffffff',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only absolute http(s) URLs may become links (no javascript:, data:, relative paths). */
function safeUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`Unsafe link in email: ${u.protocol}`);
  return u.toString();
}

/** One line of text: newlines would let a value break out of the subject header. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

const p = (html: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.text}">${html}</p>`;
const small = (html: string) => `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${C.muted}">${html}</p>`;

function button(label: string, url: string): string {
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:6px;background:${C.button}">
<a href="${href}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:${C.buttonText};text-decoration:none;border-radius:6px">${escapeHtml(label)}</a>
</td></tr></table>
${small(`If the button doesn't work, copy this link into your browser:<br><a href="${href}" style="color:${C.text};word-break:break-all">${href}</a>`)}`;
}

function layout(title: string, preheader: string, content: string, footer: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font-size:16px;font-weight:700;color:${C.text}">${APP}</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:8px;padding:32px 28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;color:${C.text}">${escapeHtml(title)}</h1>
${content}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:${C.muted}">${footer}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const AUTOMATED = `This is an automated message from ${APP}.`;

export function verifyEmailTemplate(i: { name: string; url: string; expiresInHours: number }): RenderedMail {
  const url = safeUrl(i.url);
  const subject = `Verify your email for ${APP}`;
  const expires = plural(i.expiresInHours, 'hour');
  const html = layout(
    'Confirm your email address',
    `Confirm your email to finish setting up ${APP}.`,
    p(`Hi ${escapeHtml(i.name)},`) +
      p(`Confirm this email address to finish setting up your ${APP} account.`) +
      button('Verify email', url) +
      small(`This link expires in ${expires}. If you didn't create an account, you can ignore this email.`),
    AUTOMATED,
  );
  const text = `Hi ${oneLine(i.name)},

Confirm this email address to finish setting up your ${APP} account:
${url}

This link expires in ${expires}. If you didn't create an account, you can ignore this email.`;
  return { subject, html, text };
}

export function resetPasswordTemplate(i: { name: string; url: string; expiresInMinutes: number }): RenderedMail {
  const url = safeUrl(i.url);
  const subject = `Reset your ${APP} password`;
  const expires = plural(i.expiresInMinutes, 'minute');
  const html = layout(
    'Reset your password',
    `Someone asked to reset your ${APP} password.`,
    p(`Hi ${escapeHtml(i.name)},`) +
      p(`We received a request to reset the password for your ${APP} account. Choose a new one here:`) +
      button('Reset password', url) +
      small(`This link expires in ${expires} and can be used once. If you didn't ask for this, ignore this email; your password stays the same.`),
    AUTOMATED,
  );
  const text = `Hi ${oneLine(i.name)},

We received a request to reset the password for your ${APP} account. Choose a new one here:
${url}

This link expires in ${expires} and can be used once. If you didn't ask for this, ignore this email; your password stays the same.`;
  return { subject, html, text };
}

export function inviteTemplate(i: { inviterName: string; companyName: string; url: string; expiresInDays: number }): RenderedMail {
  const url = safeUrl(i.url);
  const subject = oneLine(`${i.inviterName} invited you to join ${i.companyName} on ${APP}`);
  const expires = plural(i.expiresInDays, 'day');
  const html = layout(
    `Join ${i.companyName} on ${APP}`,
    `${i.inviterName} invited you to ${i.companyName}.`,
    p(`<strong>${escapeHtml(i.inviterName)}</strong> invited you to join <strong>${escapeHtml(i.companyName)}</strong> on ${APP}.`) +
      button('Accept invitation', url) +
      small(`This invitation expires in ${expires}. If you weren't expecting it, you can ignore this email.`),
    AUTOMATED,
  );
  const text = `${oneLine(i.inviterName)} invited you to join ${oneLine(i.companyName)} on ${APP}.

Accept the invitation:
${url}

This invitation expires in ${expires}. If you weren't expecting it, you can ignore this email.`;
  return { subject, html, text };
}

export interface DigestItem {
  title: string;
  body?: string;
  url?: string;
}

export function notificationDigestTemplate(i: { name: string; items: DigestItem[]; appUrl: string; settingsUrl: string }): RenderedMail {
  const appUrl = safeUrl(i.appUrl);
  const settingsUrl = safeUrl(i.settingsUrl);
  const items = i.items.map((it) => ({ ...it, url: it.url ? safeUrl(it.url) : undefined }));
  const count = plural(items.length, 'new notification');
  const subject = `You have ${count} on ${APP}`;
  const list = items
    .map((it) => {
      const title = it.url
        ? `<a href="${escapeHtml(it.url)}" style="color:${C.text};font-weight:600;text-decoration:underline">${escapeHtml(it.title)}</a>`
        : `<span style="font-weight:600">${escapeHtml(it.title)}</span>`;
      const body = it.body ? `<br><span style="color:${C.muted}">${escapeHtml(it.body)}</span>` : '';
      return `<li style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${C.text}">${title}${body}</li>`;
    })
    .join('\n');
  const html = layout(
    `You have ${count}`,
    `${count} since your last visit.`,
    p(`Hi ${escapeHtml(i.name)}, here's what happened since your last visit:`) +
      `<ul style="margin:0 0 16px;padding:0 0 0 20px">\n${list}\n</ul>` +
      button(`Open ${APP}`, appUrl),
    `${AUTOMATED} <a href="${escapeHtml(settingsUrl)}" style="color:${C.muted}">Change email notification settings</a>`,
  );
  const textItems = items
    .map((it) => `- ${oneLine(it.title)}${it.body ? `\n  ${oneLine(it.body)}` : ''}${it.url ? `\n  ${it.url}` : ''}`)
    .join('\n');
  const text = `Hi ${oneLine(i.name)}, here's what happened since your last visit:

${textItems}

Open ${APP}: ${appUrl}

Change email notification settings: ${settingsUrl}`;
  return { subject, html, text };
}
