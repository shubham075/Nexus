import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { prisma } from './db';
import { hashtagTerm, prefixQuery, searchPostIds, searchTableIds, searchUserIds } from './search';

test('prefixQuery ANDs every word as a prefix and drops punctuation', () => {
  assert.equal(prefixQuery('Senior  eng'), 'senior:* & eng:*');
  assert.equal(prefixQuery('#Design'), 'design:*');
  assert.equal(prefixQuery("o'brien & (x | y)"), 'o:* & brien:* & x:* & y:*');
  assert.equal(prefixQuery('  !!! '), null);
});

test('hashtagTerm only recognises a single #tag', () => {
  assert.equal(hashtagTerm('#Design_Ops'), 'design_ops');
  assert.equal(hashtagTerm('design'), null);
  assert.equal(hashtagTerm('#design systems'), null);
});

// Ranking/prefix behaviour against a migrated database. Rows use a random word so they can't clash
// with seed data and are deleted afterwards. Skipped when DATABASE_URL is not set.
describe('full-text search (database)', { skip: !process.env.DATABASE_URL && 'DATABASE_URL not set' }, () => {
  const w = `qz${randomBytes(4).toString('hex')}`; // e.g. qz1a2b3c4d
  const userIds: string[] = [];
  let tagId = '';

  const mkUser = async (name: string, headline?: string, skills: string[] = []) => {
    const u = await prisma.user.create({
      data: { email: `${randomBytes(6).toString('hex')}@fts.test`, passwordHash: 'x', name, headline, skills: { create: skills.map((s) => ({ name: s })) } },
    });
    userIds.push(u.id);
    return u.id;
  };

  before(async () => {
    await prisma.$connect();
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }); // cascades to posts, skills, jobs
    if (tagId) await prisma.hashtag.delete({ where: { id: tagId } });
    await prisma.$disconnect();
  });

  test('people: name outranks headline outranks skill; inactive users hidden', async () => {
    const bySkill = await mkUser('Skill Person', 'Analyst', [`${w}ology`]);
    const byHeadline = await mkUser('Headline Person', `Lead ${w} engineer`);
    const byName = await mkUser(`Ada ${w}`);
    const inactive = await mkUser(`Gone ${w}`);
    await prisma.user.update({ where: { id: inactive }, data: { isActive: false } });

    assert.deepEqual(await searchUserIds(prefixQuery(w)!, 10), [byName, byHeadline, bySkill]);
  });

  test('prefix of a word matches (search-as-you-type), multi-word queries AND', async () => {
    const author = await mkUser('Author');
    const both = await prisma.post.create({ data: { authorId: author, body: `Shipping the ${w}alpha release today` } });
    await prisma.post.create({ data: { authorId: author, body: `Nothing to see, only ${w}beta` } });

    const partial = await searchPostIds(prefixQuery(`${w}alp`)!, null, 10);
    assert.deepEqual(partial, [both.id]);
    const anded = await searchPostIds(prefixQuery(`${w} shipp`)!, null, 10);
    assert.deepEqual(anded, [both.id]);
    assert.equal((await searchPostIds(prefixQuery(`${w} nomatchzz`)!, null, 10)).length, 0);
  });

  test('english stemming: plural query finds singular text', async () => {
    const author = await mkUser('Stem Author');
    const p = await prisma.post.create({ data: { authorId: author, body: `${w}gamma deployment notes` } });
    assert.deepEqual(await searchPostIds(prefixQuery(`${w}gamma deployments`)!, null, 10), [p.id]);
  });

  test('posts: more occurrences rank higher; hidden posts excluded; article titles searched', async () => {
    const author = await mkUser('Ranker');
    const once = await prisma.post.create({ data: { authorId: author, body: `${w}delta mentioned once among many other words here` } });
    const thrice = await prisma.post.create({ data: { authorId: author, body: `${w}delta ${w}delta ${w}delta` } });
    await prisma.post.create({ data: { authorId: author, body: `${w}delta hidden`, isHidden: true } });
    const article = await prisma.article.create({ data: { authorId: author, title: `${w}epsilon guide`, body: 'Long form' } });
    const articlePost = await prisma.post.create({ data: { authorId: author, kind: 'ARTICLE', articleId: article.id, body: '' } });

    assert.deepEqual(await searchPostIds(prefixQuery(`${w}delta`)!, null, 10), [thrice.id, once.id]);
    assert.deepEqual(await searchPostIds(prefixQuery(`${w}epsilon`)!, null, 10), [articlePost.id]);
  });

  test('#hashtag queries find tagged posts', async () => {
    const author = await mkUser('Tagger');
    const tag = await prisma.hashtag.create({ data: { tag: `${w}tag` } });
    tagId = tag.id;
    const p = await prisma.post.create({
      data: { authorId: author, body: `Loving #${w}tag`, hashtags: { create: { hashtagId: tag.id } } },
    });
    const q = `#${w}ta`;
    assert.deepEqual(await searchPostIds(prefixQuery(q)!, hashtagTerm(q), 10), [p.id]);
  });

  test('jobs: title match outranks description match; closed jobs filtered by caller', async () => {
    const poster = await mkUser('Recruiter');
    const inTitle = await prisma.job.create({ data: { posterId: poster, title: `${w}zeta developer`, description: 'Build things' } });
    const inDesc = await prisma.job.create({ data: { posterId: poster, title: 'Developer', description: `Work on ${w}zeta` } });
    await prisma.job.create({ data: { posterId: poster, title: `${w}zeta closed`, description: '', status: 'CLOSED' } });
    const { Prisma } = await import('@prisma/client');

    const ids = await searchTableIds('Job', prefixQuery(`${w}zeta`)!, 10, { filter: Prisma.sql`t.status = 'OPEN'` });
    assert.deepEqual(ids, [inTitle.id, inDesc.id]);
  });
});
