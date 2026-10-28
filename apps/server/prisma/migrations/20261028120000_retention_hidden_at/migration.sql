-- Retention (SOT §11): when content was hidden by moderation, so the purge job can remove it later.
ALTER TABLE "Post" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "Comment" ADD COLUMN "hiddenAt" TIMESTAMP(3);

-- Content hidden before this migration starts its retention clock now.
UPDATE "Post" SET "hiddenAt" = CURRENT_TIMESTAMP WHERE "isHidden";
UPDATE "Comment" SET "hiddenAt" = CURRENT_TIMESTAMP WHERE "isHidden";

CREATE INDEX "Post_hiddenAt_idx" ON "Post"("hiddenAt");
CREATE INDEX "Comment_hiddenAt_idx" ON "Comment"("hiddenAt");
