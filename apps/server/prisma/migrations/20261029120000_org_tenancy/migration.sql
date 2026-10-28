-- Phase 2a tenancy core (SOT §14): organizations + orgId on company-scoped tables.
-- Existing data becomes the first organization (D23), so current databases keep working.

-- CreateEnum
CREATE TYPE "JoinPolicy" AS ENUM ('AUTO', 'APPROVAL', 'INVITE');
CREATE TYPE "OrgMemberStatus" AS ENUM ('ACTIVE', 'PENDING', 'LEFT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "about" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "joinPolicy" "JoinPolicy" NOT NULL DEFAULT 'INVITE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgMember" (
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrgMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "isOrgAdmin" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMember_pkey" PRIMARY KEY ("orgId","userId")
);

CREATE TABLE "OrgDomain" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgDomain_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable first, backfilled below)
ALTER TABLE "AuditLog" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Event" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Group" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Job" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Newsletter" ADD COLUMN "orgId" TEXT;
ALTER TABLE "OrgNode" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Report" ADD COLUMN "orgId" TEXT;
ALTER TABLE "Role" ADD COLUMN "orgId" TEXT;

-- Backfill: one organization named after the company root, holding every user and every company row.
-- A fresh (empty) database gets no organization here; the seed creates its own.
INSERT INTO "Organization" ("id", "slug", "name")
SELECT 'org_default',
       COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(n."name"), '[^a-z0-9]+', '-', 'g')), ''), 'company'),
       n."name"
FROM (
  SELECT COALESCE((SELECT "name" FROM "OrgNode" ORDER BY "isRoot" DESC, "createdAt" ASC LIMIT 1), 'Company') AS "name"
) n
WHERE EXISTS (SELECT 1 FROM "User") OR EXISTS (SELECT 1 FROM "OrgNode") OR EXISTS (SELECT 1 FROM "Role");

INSERT INTO "OrgMember" ("orgId", "userId", "isOrgAdmin", "joinedAt")
SELECT o."id", u."id", u."isSuperAdmin", u."createdAt" FROM "User" u CROSS JOIN "Organization" o WHERE o."id" = 'org_default';

UPDATE "OrgNode"    SET "orgId" = 'org_default';
UPDATE "Role"       SET "orgId" = 'org_default';
UPDATE "AuditLog"   SET "orgId" = 'org_default';
UPDATE "Report"     SET "orgId" = 'org_default';
UPDATE "Group"      SET "orgId" = 'org_default';
UPDATE "Event"      SET "orgId" = 'org_default';
UPDATE "Job"        SET "orgId" = 'org_default';
UPDATE "Newsletter" SET "orgId" = 'org_default';

ALTER TABLE "AuditLog" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "OrgNode" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Report" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Role" ALTER COLUMN "orgId" SET NOT NULL;

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";
DROP INDEX "Report_status_createdAt_idx";
DROP INDEX "Role_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "OrgMember_userId_idx" ON "OrgMember"("userId");
CREATE UNIQUE INDEX "OrgDomain_domain_key" ON "OrgDomain"("domain");
CREATE INDEX "OrgDomain_orgId_idx" ON "OrgDomain"("orgId");
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
CREATE INDEX "OrgNode_orgId_idx" ON "OrgNode"("orgId");
CREATE INDEX "Report_orgId_status_createdAt_idx" ON "Report"("orgId", "status", "createdAt");
CREATE UNIQUE INDEX "Role_orgId_name_key" ON "Role"("orgId", "name");

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgDomain" ADD CONSTRAINT "OrgDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgNode" ADD CONSTRAINT "OrgNode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Role" ADD CONSTRAINT "Role_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Group" ADD CONSTRAINT "Group_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Newsletter" ADD CONSTRAINT "Newsletter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
