-- Phase 2c: post visibility (SOT §14.2).

-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC', 'CONNECTIONS', 'ORG');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "visibility" "PostVisibility" NOT NULL DEFAULT 'ORG';

-- CreateTable
CREATE TABLE "PostAudienceNode" (
    "postId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,

    CONSTRAINT "PostAudienceNode_pkey" PRIMARY KEY ("postId","nodeId")
);

-- CreateIndex
CREATE INDEX "PostAudienceNode_nodeId_idx" ON "PostAudienceNode"("nodeId");

-- CreateIndex
CREATE INDEX "Post_orgId_createdAt_idx" ON "Post"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAudienceNode" ADD CONSTRAINT "PostAudienceNode_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAudienceNode" ADD CONSTRAINT "PostAudienceNode_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "OrgNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An ORG post with no orgId takes the org of its group/event/job, else its author's first active org.
-- Runs on insert so share posts created by other routes (events, jobs, articles) get an audience org too.
CREATE FUNCTION post_default_org() RETURNS trigger AS $$
BEGIN
  IF NEW."visibility" = 'ORG' AND NEW."orgId" IS NULL THEN
    NEW."orgId" := COALESCE(
      (SELECT "orgId" FROM "Group" WHERE id = NEW."groupId"),
      (SELECT "orgId" FROM "Event" WHERE id = NEW."eventId"),
      (SELECT "orgId" FROM "Job" WHERE id = NEW."jobId"),
      (SELECT m."orgId" FROM "OrgMember" m WHERE m."userId" = NEW."authorId" AND m.status = 'ACTIVE' ORDER BY m."joinedAt" LIMIT 1)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER post_default_org BEFORE INSERT ON "Post" FOR EACH ROW EXECUTE FUNCTION post_default_org();

-- Backfill: every existing post becomes ORG in its group/event/job org or its author's primary org,
-- so single mode keeps showing exactly what it showed before.
UPDATE "Post" p SET "orgId" = COALESCE(
  (SELECT "orgId" FROM "Group" WHERE id = p."groupId"),
  (SELECT "orgId" FROM "Event" WHERE id = p."eventId"),
  (SELECT "orgId" FROM "Job" WHERE id = p."jobId"),
  (SELECT m."orgId" FROM "OrgMember" m WHERE m."userId" = p."authorId" AND m.status = 'ACTIVE' ORDER BY m."joinedAt" LIMIT 1)
);
