import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { generators } from 'openid-client';
import { passwordProblem } from '@nexus/shared';
import { prisma } from '../lib/db';
import { HttpError, badRequest, notFound, parse } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { limits } from '../lib/rateLimit';
import { createSession, newSecret, revokeSessions, revokeUserSessions, rotateSession, sha256 } from '../lib/sessions';
import { callbackUrl, emailFromClaims, isLoopbackRedirect, oidcClient, providers } from '../lib/sso';
import { permissionsOf } from '../rbac';
import { env } from '../lib/env';
import { orgsOf } from '../lib/org';

const SSO_START_TTL = 10 * 60_000;
const SSO_CODE_TTL = 2 * 60_000;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', { config: { rateLimit: limits.login } }, async (req) => {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return createSession(app, req, user.id, 'password');
  });

  app.post('/refresh', { config: { rateLimit: limits.refresh } }, async (req) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(1).max(200) }), req.body);
    return rotateSession(app, refreshToken);
  });

  /** Works with an expired access token: the refresh token alone identifies the session. */
  app.post('/logout', async (req) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().max(200).optional() }), req.body);
    const fromRefresh = refreshToken ? await sessionIdFor(refreshToken) : null;
    if (fromRefresh) await revokeSessions({ id: fromRefresh });
    try {
      const { sid } = await req.jwtVerify<{ sub: string; sid?: string }>();
      if (sid) await revokeSessions({ id: sid });
    } catch {
      /* no or expired access token */
    }
    return { ok: true };
  });

  /** Me inside the active org (X-Org-Id): its units and permissions, plus my orgs and the tenancy mode (SOT §14). */
  app.get('/me', { preHandler: authenticate }, async (req) => {
    const org = req.orgId;
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
      select: {
        id: true, email: true, name: true, headline: true, avatarUrl: true, coverUrl: true, location: true,
        isSuperAdmin: true, mustChangePassword: true,
        memberships: { where: { node: { orgId: org ?? '' } }, select: { title: true, isPrimary: true, node: { select: { id: true, name: true, type: true } } } },
      },
    });
    return {
      ...me,
      permissions: org ? await permissionsOf(me.id, org) : [],
      tenancy: env.tenancy,
      orgs: await orgsOf(me.id),
      activeOrgId: org,
    };
  });


  app.post('/change-password', { preHandler: authenticate, config: { rateLimit: limits.changePassword } }, async (req) => {
    const body = parse(z.object({ currentPassword: z.string(), newPassword: z.string() }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const problem = passwordProblem(body.newPassword);
    if (problem) throw new HttpError(400, 'WEAK_PASSWORD', problem);
    if (body.newPassword === body.currentPassword) throw new HttpError(400, 'WEAK_PASSWORD', 'Choose a password different from the current one');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false },
    });
    // Other devices are signed out; this one keeps its session.
    await revokeUserSessions(user.id, req.user.sid);
    return { ok: true };
  });

  // ───────── SSO (OIDC), SOT §8 ─────────
  app.get('/sso/providers', async () => providers.map((p) => ({ id: p.id, label: p.label })));

  /** Opened in the system browser by the desktop app; redirects to the IdP. */
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/sso/:id/start',
    { config: { rateLimit: limits.sso } },
    async (req, reply) => {
      const p = providers.find((x) => x.id === req.params.id);
      if (!p) throw notFound('SSO provider');
      const q = parse(
        z.object({
          redirect_uri: z.string().refine(isLoopbackRedirect, 'redirect_uri must be a loopback http URL'),
          code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'code_challenge must be an S256 challenge'),
        }),
        req.query,
      );
      const client = await oidcClient(p).catch((e) => {
        req.log.error(e, 'OIDC discovery failed');
        throw new HttpError(502, 'SSO_UNAVAILABLE', `${p.label} sign-in is unavailable right now`);
      });
      const state = newSecret();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      await prisma.ssoRequest.create({
        data: {
          id: state,
          provider: p.id,
          redirectUri: q.redirect_uri,
          challenge: q.code_challenge,
          nonce,
          codeVerifier,
          expiresAt: new Date(Date.now() + SSO_START_TTL),
        },
      });
      const url = client.authorizationUrl({
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: generators.codeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return reply.redirect(url);
    },
  );

  /** IdP → server. Ends by redirecting the browser to the desktop app's loopback listener. */
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/sso/:id/callback', async (req, reply) => {
    const p = providers.find((x) => x.id === req.params.id);
    if (!p) throw notFound('SSO provider');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const pending = state ? await prisma.ssoRequest.findUnique({ where: { id: state } }) : null;
    if (!pending || pending.provider !== p.id || pending.expiresAt < new Date() || pending.codeHash) {
      throw badRequest('This sign-in link has expired. Start again from the Nexus app.');
    }
    const back = (params: Record<string, string>) => {
      const u = new URL(pending.redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return reply.redirect(u.toString());
    };
    const fail = async (message: string) => {
      await prisma.ssoRequest.delete({ where: { id: state } }).catch(() => {});
      return back({ error: 'sso_failed', message });
    };

    let email: string | null;
    try {
      const client = await oidcClient(p);
      const params = client.callbackParams(req.raw);
      if (params.error) return fail(params.error_description ?? `${p.label} sign-in was cancelled`);
      const tokens = await client.callback(callbackUrl(p.id), params, { state, nonce: pending.nonce, code_verifier: pending.codeVerifier });
      email = emailFromClaims(tokens.claims() as Record<string, unknown>, p);
    } catch (e) {
      req.log.warn(e, 'OIDC callback failed');
      return fail(`${p.label} sign-in failed. Please try again.`);
    }
    if (!email) return fail(`Your ${p.label} account has no verified work email that Nexus accepts.`);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
    // No self sign-up: only invited, active accounts.
    if (!user || !user.isActive) return fail(`No active Nexus account for ${email}. Ask your administrator for an invite.`);

    const code = newSecret();
    await prisma.ssoRequest.update({
      where: { id: state },
      data: { userId: user.id, codeHash: sha256(code), expiresAt: new Date(Date.now() + SSO_CODE_TTL) },
    });
    return back({ code });
  });

  /** Desktop app → server: one-time code + PKCE verifier → normal token pair. */
  app.post('/sso/exchange', { config: { rateLimit: limits.sso } }, async (req) => {
    const body = parse(z.object({ code: z.string().min(1).max(200), codeVerifier: z.string().min(43).max(128) }), req.body);
    const pending = await prisma.ssoRequest.findUnique({ where: { codeHash: sha256(body.code) } });
    // Single use, whatever the outcome.
    if (pending) await prisma.ssoRequest.delete({ where: { id: pending.id } }).catch(() => {});
    if (!pending?.userId || pending.expiresAt < new Date() || sha256(body.codeVerifier) !== pending.challenge) {
      throw new HttpError(401, 'SSO_FAILED', 'Sign-in could not be completed. Please try again.');
    }
    const user = await prisma.user.findUnique({ where: { id: pending.userId } });
    if (!user?.isActive) throw new HttpError(401, 'SSO_FAILED', 'Account disabled');
    if (user.mustChangePassword) {
      // Retire the admin-issued temporary password: this user signs in with SSO (SOT §8).
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newSecret(), 10), mustChangePassword: false },
      });
    }
    return createSession(app, req, user.id, `sso:${pending.provider}`);
  });
};

async function sessionIdFor(refreshToken: string): Promise<string | null> {
  const s = await prisma.authSession.findUnique({ where: { refreshHash: sha256(refreshToken) }, select: { id: true } });
  return s?.id ?? null;
}
