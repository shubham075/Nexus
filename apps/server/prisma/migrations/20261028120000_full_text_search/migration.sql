-- Full-text search (SOT §5.10). Each searchable table gets a generated `search` tsvector + GIN index.
-- Lexemes are indexed twice: 'english' (stemmed, so "engineers" finds "engineering") and 'simple'
-- (unstemmed, so the prefix query `enginee:*` used for search-as-you-type still matches).
-- Weights: A = name/title, B = headline/description/skills, C = body.

-- array_to_string is only STABLE; generated columns need an IMMUTABLE expression.
CREATE FUNCTION nexus_fts_text(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;

CREATE FUNCTION nexus_fts(txt text, w "char") RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT setweight(to_tsvector('english'::regconfig, coalesce(txt, '')), w)
        || setweight(to_tsvector('simple'::regconfig, coalesce(txt, '')), w)
  $$;

ALTER TABLE "User" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("name", 'A') || nexus_fts("headline", 'B')) STORED;
CREATE INDEX "User_search_idx" ON "User" USING GIN ("search");

ALTER TABLE "Skill" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("name", 'B')) STORED;
CREATE INDEX "Skill_search_idx" ON "Skill" USING GIN ("search");

ALTER TABLE "Post" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("body", 'C')) STORED;
CREATE INDEX "Post_search_idx" ON "Post" USING GIN ("search");

ALTER TABLE "Article" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("title", 'A') || nexus_fts("body", 'C')) STORED;
CREATE INDEX "Article_search_idx" ON "Article" USING GIN ("search");

ALTER TABLE "Job" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("title", 'A') || nexus_fts(nexus_fts_text("skills"), 'B') || nexus_fts("description", 'C')) STORED;
CREATE INDEX "Job_search_idx" ON "Job" USING GIN ("search");

ALTER TABLE "Group" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("name", 'A') || nexus_fts("description", 'B')) STORED;
CREATE INDEX "Group_search_idx" ON "Group" USING GIN ("search");

ALTER TABLE "Event" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (nexus_fts("title", 'A') || nexus_fts("description", 'B')) STORED;
CREATE INDEX "Event_search_idx" ON "Event" USING GIN ("search");
