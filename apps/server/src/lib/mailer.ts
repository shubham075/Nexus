import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Transactional email (SOT §8 → Email). SMTP via nodemailer, configured by env:
 * `SMTP_URL` (smtp:// or smtps://user:pass@host:port) or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_SECURE`,
 * plus `MAIL_FROM` and `SMTP_TIMEOUT_MS`. With no SMTP configured the mail is logged instead of sent (dev).
 * Reads `process.env` directly (not `env.ts`) so it can be used and tested without the API's required vars.
 */

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  /** false when no SMTP is configured and the mail was only logged. */
  delivered: boolean;
  messageId?: string;
}

export type MailErrorCode = 'INVALID_MAIL' | 'SEND_FAILED';

export class MailError extends Error {
  /** True for timeouts, connection failures and 4xx SMTP replies: the same mail may succeed later. */
  readonly retryable: boolean;
  constructor(readonly code: MailErrorCode, message: string, opts: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'MailError';
    this.retryable = opts.retryable ?? false;
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 465 / smtps://). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean;
  user?: string;
  pass?: string;
}

export interface MailConfig {
  smtp: SmtpConfig | null;
  from: string;
  timeoutMs: number;
}

type Logger = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

export function mailConfigFromEnv(e: NodeJS.ProcessEnv = process.env): MailConfig {
  const timeoutMs = Number(e.SMTP_TIMEOUT_MS || 10_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('SMTP_TIMEOUT_MS must be a whole number > 0');
  return { smtp: smtpFromEnv(e), from: e.MAIL_FROM || 'Nexus <no-reply@nexus.local>', timeoutMs };
}

function smtpFromEnv(e: NodeJS.ProcessEnv): SmtpConfig | null {
  if (e.SMTP_URL) {
    const u = new URL(e.SMTP_URL);
    if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('SMTP_URL must start with smtp:// or smtps://');
    const secure = u.protocol === 'smtps:';
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : secure ? 465 : 587,
      secure,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      pass: u.password ? decodeURIComponent(u.password) : undefined,
    };
  }
  if (!e.SMTP_HOST) return null;
  const port = Number(e.SMTP_PORT || 587);
  return {
    host: e.SMTP_HOST,
    port,
    secure: e.SMTP_SECURE ? e.SMTP_SECURE === 'true' : port === 465,
    user: e.SMTP_USER || undefined,
    pass: e.SMTP_PASS || undefined,
  };
}

const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function validate(mail: Mail): string[] {
  const to = (Array.isArray(mail.to) ? mail.to : [mail.to]).map((a) => a.trim());
  if (!to.length || to.some((a) => !ADDRESS.test(a))) throw new MailError('INVALID_MAIL', 'Invalid recipient address');
  if (!mail.subject || /[\r\n]/.test(mail.subject)) throw new MailError('INVALID_MAIL', 'Subject must be one non-empty line');
  if (!mail.html || !mail.text) throw new MailError('INVALID_MAIL', 'Mail needs both html and text bodies');
  return to;
}

const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EDNS']);

export function createMailer(config: MailConfig, log: Logger = console) {
  let transport: Transporter | null = null;
  const getTransport = () =>
    (transport ??= nodemailer.createTransport({
      host: config.smtp!.host,
      port: config.smtp!.port,
      secure: config.smtp!.secure,
      auth: config.smtp!.user ? { user: config.smtp!.user, pass: config.smtp!.pass } : undefined,
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
    }));

  async function sendMail(mail: Mail): Promise<SendResult> {
    const to = validate(mail);
    if (!config.smtp) {
      // Production logs keep the body out: it carries verification / reset links.
      const body = process.env.NODE_ENV === 'production' ? undefined : mail.text;
      log.warn({ mail: { from: config.from, to, subject: mail.subject, text: body } }, 'SMTP not configured; mail logged, not sent');
      return { delivered: false };
    }
    try {
      const info = await getTransport().sendMail({ from: config.from, to, subject: mail.subject, html: mail.html, text: mail.text });
      return { delivered: true, messageId: info.messageId };
    } catch (err) {
      const e = err as { code?: string; responseCode?: number; message?: string };
      const retryable =
        RETRYABLE_CODES.has(e.code ?? '') || (e.responseCode !== undefined && e.responseCode >= 400 && e.responseCode < 500);
      throw new MailError('SEND_FAILED', `Mail to ${to.join(', ')} failed: ${e.message ?? String(err)}`, { retryable, cause: err });
    }
  }

  return { sendMail, close: () => transport?.close() };
}

let defaultMailer: ReturnType<typeof createMailer> | null = null;

/** Sends with the env-configured mailer (created on first use). Throws `MailError`. */
export function sendMail(mail: Mail): Promise<SendResult> {
  defaultMailer ??= createMailer(mailConfigFromEnv());
  return defaultMailer.sendMail(mail);
}
