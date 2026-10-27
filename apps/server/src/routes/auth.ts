import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { HttpError, parse } from '../lib/http';
import { authenticate, uid } from '../lib/auth';
import { permissionsOf } from '../rbac';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req) => {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return { token: app.jwt.sign({ sub: user.id }) };
  });

  app.get('/me', { preHandler: authenticate }, async (req) => {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: uid(req) },
      select: {
        id: true, email: true, name: true, headline: true, avatarUrl: true, coverUrl: true, location: true,
        isSuperAdmin: true, mustChangePassword: true,
        memberships: { select: { title: true, isPrimary: true, node: { select: { id: true, name: true, type: true } } } },
      },
    });
    return { ...me, permissions: await permissionsOf(me.id) };
  });

  app.post('/change-password', { preHandler: authenticate }, async (req) => {
    const body = parse(
      z.object({ currentPassword: z.string(), newPassword: z.string().min(8, 'Use at least 8 characters') }),
      req.body,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false },
    });
    return { ok: true };
  });
};
