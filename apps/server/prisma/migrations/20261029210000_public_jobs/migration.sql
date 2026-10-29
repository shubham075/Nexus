-- Phase 2d: public jobs on company pages (SOT §14.4)
ALTER TABLE "Job" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Job_isPublic_status_createdAt_idx" ON "Job"("isPublic", "status", "createdAt");
