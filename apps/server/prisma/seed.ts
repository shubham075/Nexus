/**
 * Seeds a demo company with a matrix (multi-parent) hierarchy, system roles, grants,
 * employees and some content, plus a tiny second org ("Globex") that only the tenancy tests use.
 * Idempotent only on an empty DB — run `pnpm db:reset` to start over.
 * Production: SEED_DEMO=false creates only the company (SEED_COMPANY_NAME), its root unit, system roles and the admin.
 */
import { PrismaClient, type OrgNodeType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SYSTEM_ROLES } from '@nexus/shared';

const prisma = new PrismaClient();
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@nexus.local';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'Welcome@123';
const withDemo = process.env.SEED_DEMO !== 'false';
const companyName = process.env.SEED_COMPANY_NAME || 'Nexus Corp';

/**
 * Second org used only by the tenancy e2e tests (no cross-org reads/writes): its own root, roles, two
 * people, a group, event, job, report and audit entry. owner@globex.local holds Super Admin there only.
 */
async function seedTestOrg(passwordHash: string) {
  const orgId = (await prisma.organization.create({ data: { slug: 'globex', name: 'Globex Inc' } })).id;
  const root = await prisma.orgNode.create({ data: { orgId, name: 'Globex Inc', type: 'COMPANY', isRoot: true } });
  const ops = await prisma.orgNode.create({ data: { orgId, name: 'Globex Ops', type: 'TEAM', parentEdges: { create: { parentId: root.id } } } });
  const roles = Object.fromEntries(
    await Promise.all(
      SYSTEM_ROLES.map(async (r) => [r.name, await prisma.role.create({ data: { ...r, orgId, isSystem: true } })] as const),
    ),
  );
  const person = (email: string, name: string, nodeId: string) =>
    prisma.user.create({
      data: { email, name, headline: 'Globex', passwordHash, memberships: { create: { nodeId, isPrimary: true } }, orgMemberships: { create: { orgId } } },
    });
  const owner = await person('owner@globex.local', 'Gina Globex', root.id);
  const staff = await person('staff@globex.local', 'Sam Globex', ops.id);
  await prisma.roleGrant.createMany({
    data: [
      { roleId: roles['Employee'].id, nodeId: root.id },
      { roleId: roles['Super Admin'].id, nodeId: root.id, userId: owner.id },
    ],
  });
  await prisma.group.create({
    data: { orgId, name: 'Globex Insiders', privacy: 'PUBLIC', creatorId: owner.id, nodeId: ops.id, members: { create: { userId: owner.id, role: 'ADMIN' } } },
  });
  await prisma.event.create({ data: { orgId, title: 'Globex Offsite', startsAt: new Date(Date.now() + 9 * 864e5), organizerId: owner.id, nodeId: ops.id } });
  await prisma.job.create({ data: { orgId, title: 'Globex Ops Lead', description: 'Run Globex operations.', posterId: owner.id, nodeId: ops.id } });
  await prisma.report.create({ data: { orgId, reporterId: owner.id, targetUserId: staff.id, reason: 'OTHER', details: 'Globex test report' } });
  await prisma.auditLog.create({ data: { orgId, actorId: owner.id, action: 'globex.seed' } });
}

async function main() {
  if (await prisma.user.count()) {
    console.log('Database already seeded — skipping. Use `pnpm db:reset` to reseed.');
    return;
  }

  // ───────── Organization (SOT §14) ─────────
  const slug = withDemo ? 'nexus' : companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
  const org = await prisma.organization.create({ data: { slug, name: companyName, industry: withDemo ? 'Software' : undefined } });
  const orgId = org.id;

  // ───────── Hierarchy (DAG) ─────────
  const node = (name: string, type: OrgNodeType, description?: string, isRoot = false) =>
    prisma.orgNode.create({ data: { orgId, name, type, description, isRoot } });
  const co = await node(companyName, 'COMPANY', 'The whole company', true);

  if (!withDemo) {
    await Promise.all(SYSTEM_ROLES.map((r) => prisma.role.create({ data: { ...r, orgId, isSystem: true } })));
    await prisma.user.create({
      data: {
        email: adminEmail, name: 'Administrator', headline: 'Platform Administrator', passwordHash: await bcrypt.hash(adminPassword, 10),
        isSuperAdmin: true, memberships: { create: [{ nodeId: co.id, title: 'Platform Admin', isPrimary: true }] },
        orgMemberships: { create: { orgId, isOrgAdmin: true } },
      },
    });
    console.log(`Seeded ${companyName} (no demo data). Admin: ${adminEmail} / (SEED_ADMIN_PASSWORD).`);
    return;
  }
  const eng = await node('Engineering', 'DIVISION');
  const prod = await node('Product', 'DIVISION');
  const people = await node('People & HR', 'DIVISION');
  const sales = await node('Sales', 'DIVISION');
  const backend = await node('Backend Platform', 'TEAM');
  const web = await node('Web Experience', 'TEAM');
  const mobile = await node('Mobile Squad', 'TEAM', 'Reports to both Engineering and Product');
  const design = await node('Design', 'DEPARTMENT');
  const talent = await node('Talent Acquisition', 'TEAM');
  const security = await node('Security Guild', 'GUILD', 'Cross-functional security champions');
  const blr = await node('Bengaluru Office', 'LOCATION');

  const edges: [string, string][] = [
    [co.id, eng.id], [co.id, prod.id], [co.id, people.id], [co.id, sales.id], [co.id, blr.id],
    [eng.id, backend.id], [eng.id, web.id], [eng.id, mobile.id], [prod.id, mobile.id], [prod.id, design.id],
    [people.id, talent.id], [eng.id, security.id], [prod.id, security.id],
  ];
  await prisma.orgEdge.createMany({ data: edges.map(([parentId, childId]) => ({ parentId, childId })) });

  // ───────── Roles ─────────
  const roles = Object.fromEntries(
    await Promise.all(
      SYSTEM_ROLES.map(async (r) => [r.name, await prisma.role.create({ data: { ...r, orgId, isSystem: true } })] as const),
    ),
  );

  // ───────── Users ─────────
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const demoHash = await bcrypt.hash(demoPassword, 10);
  const admin = await prisma.user.create({
    data: {
      email: adminEmail, name: 'Ava Admin', headline: 'Platform Administrator', passwordHash: adminHash, isSuperAdmin: true,
      location: 'Bengaluru', memberships: { create: [{ nodeId: people.id, title: 'Platform Admin', isPrimary: true }] },
      orgMemberships: { create: { orgId, isOrgAdmin: true } },
    },
  });

  const demo: { email: string; name: string; headline: string; nodes: string[]; title: string; skills: string[] }[] = [
    { email: 'priya@nexus.local', name: 'Priya Sharma', headline: 'VP Engineering', nodes: [eng.id], title: 'VP Engineering', skills: ['Leadership', 'Distributed Systems'] },
    { email: 'rahul@nexus.local', name: 'Rahul Verma', headline: 'Senior Backend Engineer', nodes: [backend.id, security.id], title: 'Senior Engineer', skills: ['Go', 'PostgreSQL', 'Kubernetes'] },
    { email: 'meera@nexus.local', name: 'Meera Iyer', headline: 'Mobile Lead', nodes: [mobile.id], title: 'Mobile Lead', skills: ['React Native', 'Swift'] },
    { email: 'arjun@nexus.local', name: 'Arjun Nair', headline: 'Product Manager', nodes: [prod.id], title: 'Product Manager', skills: ['Roadmapping', 'User Research'] },
    { email: 'sara@nexus.local', name: 'Sara Khan', headline: 'Product Designer', nodes: [design.id], title: 'Product Designer', skills: ['Figma', 'Design Systems'] },
    { email: 'vikram@nexus.local', name: 'Vikram Rao', headline: 'Talent Partner', nodes: [talent.id], title: 'Recruiter', skills: ['Hiring', 'Interviewing'] },
    { email: 'neha@nexus.local', name: 'Neha Gupta', headline: 'Frontend Engineer', nodes: [web.id], title: 'Engineer', skills: ['React', 'TypeScript'] },
    { email: 'karan@nexus.local', name: 'Karan Mehta', headline: 'Account Executive', nodes: [sales.id], title: 'Account Executive', skills: ['Negotiation', 'CRM'] },
    { email: 'divya@nexus.local', name: 'Divya Pillai', headline: 'HR Business Partner', nodes: [people.id], title: 'HRBP', skills: ['People Ops'] },
  ];
  const users: Record<string, string> = {};
  for (const d of demo) {
    const u = await prisma.user.create({
      data: {
        email: d.email, name: d.name, headline: d.headline, passwordHash: demoHash, location: 'Bengaluru',
        about: `${d.headline} at Nexus Corp.`,
        memberships: { create: d.nodes.map((nodeId, i) => ({ nodeId, title: d.title, isPrimary: i === 0 })) },
        orgMemberships: { create: { orgId } },
        skills: { create: d.skills.map((name) => ({ name })) },
        experiences: { create: [{ title: d.title, company: 'Nexus Corp', startDate: new Date('2022-04-01') }] },
      },
    });
    users[d.email.split('@')[0]] = u.id;
  }

  // ───────── Grants (SOT §4.3) ─────────
  await prisma.roleGrant.createMany({
    data: [
      { roleId: roles['Employee'].id, nodeId: co.id }, // everybody, inherited down the whole DAG
      { roleId: roles['HR Admin'].id, nodeId: people.id, userId: users.divya },
      { roleId: roles['HR Admin'].id, nodeId: co.id, userId: users.divya },
      { roleId: roles['Manager'].id, nodeId: eng.id, userId: users.priya },
      { roleId: roles['Moderator'].id, nodeId: eng.id, userId: users.priya },
      { roleId: roles['Manager'].id, nodeId: mobile.id, userId: users.meera },
      { roleId: roles['Recruiter'].id, nodeId: co.id, userId: users.vikram },
      { roleId: roles['Manager'].id, nodeId: prod.id, userId: users.arjun },
    ],
  });

  // ───────── Network ─────────
  const pairs: [string, string][] = [
    ['priya', 'rahul'], ['priya', 'meera'], ['priya', 'neha'], ['arjun', 'meera'], ['arjun', 'sara'],
    ['rahul', 'neha'], ['vikram', 'divya'], ['karan', 'arjun'],
  ];
  for (const [a, b] of pairs) {
    await prisma.connection.create({ data: { requesterId: users[a], addresseeId: users[b], status: 'ACCEPTED', respondedAt: new Date() } });
    await prisma.follow.createMany({
      data: [{ followerId: users[a], followeeId: users[b] }, { followerId: users[b], followeeId: users[a] }],
    });
  }
  await prisma.connection.create({ data: { requesterId: users.sara, addresseeId: admin.id, message: 'Hi Ava, would love to connect!' } });

  // ───────── Content ─────────
  const tag = async (t: string) => prisma.hashtag.upsert({ where: { tag: t }, create: { tag: t }, update: {} });
  const welcome = await prisma.post.create({
    data: {
      authorId: admin.id, kind: 'TEXT', isPinned: true,
      body: 'Welcome to Nexus — our internal professional network! 🎉 Share wins, ask questions and find your next internal role. #announcement #welcome',
    },
  });
  for (const t of ['announcement', 'welcome']) await prisma.postHashtag.create({ data: { postId: welcome.id, hashtagId: (await tag(t)).id } });

  const p2 = await prisma.post.create({
    data: {
      authorId: users.rahul, kind: 'TEXT',
      body: `Our new event pipeline cut p99 latency by 40%. Huge thanks to @[Neha Gupta](${users.neha}) for the dashboard work! #engineering #performance`,
    },
  });
  for (const t of ['engineering', 'performance']) await prisma.postHashtag.create({ data: { postId: p2.id, hashtagId: (await tag(t)).id } });
  await prisma.reaction.createMany({
    data: [
      { userId: users.priya, postId: p2.id, type: 'CELEBRATE' },
      { userId: users.neha, postId: p2.id, type: 'LOVE' },
      { userId: users.arjun, postId: p2.id, type: 'INSIGHTFUL' },
    ],
  });
  await prisma.comment.create({ data: { postId: p2.id, authorId: users.priya, body: 'Fantastic work team 👏' } });

  await prisma.post.create({
    data: {
      authorId: users.arjun, kind: 'POLL', body: 'Help us plan the next offsite! #culture',
      poll: {
        create: {
          question: 'Where should the Q1 offsite be?', endsAt: new Date(Date.now() + 7 * 864e5),
          options: { create: [{ text: 'Goa', sortOrder: 0 }, { text: 'Coorg', sortOrder: 1 }, { text: 'Jaipur', sortOrder: 2 }] },
        },
      },
    },
  });
  await prisma.post.create({ data: { authorId: users.divya, kind: 'CELEBRATION', celebration: 'WELCOME', body: `Please welcome @[Sara Khan](${users.sara}) to the Design team! 🎨` } });

  const group = await prisma.group.create({
    data: {
      orgId, name: 'Frontend Guild', description: 'All things web & mobile UI', privacy: 'PUBLIC', creatorId: users.neha,
      members: { create: [{ userId: users.neha, role: 'ADMIN' }, { userId: users.meera, role: 'MEMBER' }, { userId: users.sara, role: 'MEMBER' }] },
    },
  });
  await prisma.post.create({ data: { authorId: users.neha, groupId: group.id, body: 'Kicking off our monthly UI review — bring your demos!' } });

  const event = await prisma.event.create({
    data: {
      orgId, title: 'Engineering All-Hands', description: 'Quarterly roadmap and demos.', startsAt: new Date(Date.now() + 5 * 864e5),
      isOnline: true, link: 'https://meet.example.com/all-hands', organizerId: users.priya, nodeId: eng.id,
      rsvps: { create: [{ userId: users.priya, status: 'GOING' }, { userId: users.rahul, status: 'GOING' }] },
    },
  });
  await prisma.post.create({ data: { authorId: users.priya, kind: 'EVENT', eventId: event.id, body: `Join us: ${event.title}` } });

  const job = await prisma.job.create({
    data: {
      orgId, title: 'Senior Mobile Engineer', description: 'Build the next generation of our mobile apps with the Mobile Squad.',
      location: 'Bengaluru', workplace: 'HYBRID', skills: ['React Native', 'TypeScript'], posterId: users.vikram, nodeId: mobile.id,
    },
  });
  await prisma.post.create({ data: { authorId: users.vikram, kind: 'JOB', jobId: job.id, body: `We're hiring: ${job.title}` } });

  await seedTestOrg(demoHash);

  console.log(`Seeded. Admin: ${adminEmail} / (SEED_ADMIN_PASSWORD). Demo users: *@nexus.local / (SEED_DEMO_PASSWORD).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
