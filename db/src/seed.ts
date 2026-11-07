// Loads db/seed/curated/*.json into Postgres. Idempotent: upserts by (source, source_id),
// removes curated rows no longer in the files, and regenerates all synthetic attempts.
import { readdir, readFile } from 'node:fs/promises';
import { client } from './db.ts';
import { genAttempts, type Attempt, type Env, type Evidence } from './evidence.ts';

type Sol = { id: string; body: string; steps?: string[]; code?: string; created?: string; evidence: Evidence };
type Prob = { id: string; title: string; body: string; env?: Env; tags?: string[]; created: string; solutions: Sol[] };
type SeedFile = { domain: 'programming' | 'electronics'; problems: Prob[] };

const DIR = new URL('../seed/curated/', import.meta.url);
const POOL = 40;
const DAY = 864e5;
const SRC = 'curated';
const AUTHOR = 'StackGPT curators';
const LICENSE = 'StackGPT PoC curated content; attempts are synthetic';
const TOKENS = Array.from({ length: POOL }, (_, i) => `synthetic-user-${String(i + 1).padStart(2, '0')}`);

const names = (await readdir(DIR)).filter(n => n.endsWith('.json')).sort();
const files: SeedFile[] = await Promise.all(names.map(async n => JSON.parse(await readFile(new URL(n, DIR), 'utf8'))));

// Plan everything (and fail on bad data) before touching the DB.
const now = Date.now();
const ids = new Set<string>();
const plan = files.flatMap(f =>
  f.problems.map(p => {
    for (const id of [p.id, ...p.solutions.map(s => s.id)]) {
      if (ids.has(id)) throw new Error(`duplicate id ${id}`);
      ids.add(id);
    }
    const pAt = Date.parse(p.created);
    if (Number.isNaN(pAt)) throw new Error(`${p.id}: bad created date`);
    const sols = p.solutions.map(s => {
      const at = s.created ? Date.parse(s.created) : pAt + DAY;
      const att: Attempt[] = genAttempts(s.id, s.evidence, p.env ?? {}, Math.floor((now - at) / DAY), POOL);
      return { s, at, att };
    });
    return { domain: f.domain, p, pAt, sols };
  }),
);

const db = client();
await db.connect();
try {
  await db.query('begin');
  const { rows: users } = await db.query<{ id: string; token: string }>(
    `insert into users (token) select unnest($1::text[])
     on conflict (token) do update set token = excluded.token returning id, token`,
    [TOKENS],
  );
  const uid = new Map(users.map(u => [u.token, u.id]));

  await db.query('delete from attempts where synthetic');
  await db.query(`delete from problems where source = $1 and source_id <> all($2::text[])`, [SRC, plan.map(x => x.p.id)]);
  await db.query(`delete from solutions where source = $1 and source_id <> all($2::text[])`, [
    SRC,
    plan.flatMap(x => x.sols.map(y => y.s.id)),
  ]);

  let nAtt = 0;
  for (const { domain, p, pAt, sols } of plan) {
    // Changed text invalidates derived columns; the API backfills them.
    const { rows: [{ id: pid }] } = await db.query<{ id: string }>(
      `insert into problems (domain, title, body, env, tags, source, source_id, author, license, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (source, source_id) do update set
         domain = excluded.domain, title = excluded.title, body = excluded.body, env = excluded.env,
         tags = excluded.tags, author = excluded.author, license = excluded.license, created_at = excluded.created_at,
         embedding  = case when (problems.title, problems.body) is distinct from (excluded.title, excluded.body) then null else problems.embedding end,
         error_sigs = case when (problems.title, problems.body) is distinct from (excluded.title, excluded.body) then '{}' else problems.error_sigs end
       returning id`,
      [domain, p.title, p.body, p.env ?? {}, p.tags ?? [], SRC, p.id, AUTHOR, LICENSE, new Date(pAt)],
    );
    for (const { s, at, att } of sols) {
      const { rows: [{ id: sid }] } = await db.query<{ id: string }>(
        `insert into solutions (problem_id, body, steps, code, source, source_id, author, license, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (source, source_id) do update set
           problem_id = excluded.problem_id, body = excluded.body, steps = excluded.steps, code = excluded.code,
           author = excluded.author, license = excluded.license, created_at = excluded.created_at,
           embedding = case when (solutions.body, solutions.steps, solutions.code) is distinct from (excluded.body, excluded.steps, excluded.code) then null else solutions.embedding end
         returning id`,
        [pid, s.body, JSON.stringify(s.steps ?? []), s.code ?? null, SRC, s.id, AUTHOR, LICENSE, new Date(at)],
      );
      await db.query(
        `insert into attempts (solution_id, user_id, outcome, env, synthetic, created_at)
         select $1, u, o, e::jsonb, true, now() - make_interval(days => d)
         from unnest($2::bigint[], $3::text[], $4::text[], $5::int[]) as t(u, o, e, d)`,
        [
          sid,
          att.map(a => uid.get(TOKENS[a.user])),
          att.map(a => a.outcome),
          att.map(a => JSON.stringify(a.env)),
          att.map(a => a.daysAgo),
        ],
      );
      nAtt += att.length;
    }
  }
  await db.query('commit');
  const nSol = plan.reduce((s, x) => s + x.sols.length, 0);
  console.log(`seeded ${plan.length} problems, ${nSol} solutions, ${nAtt} synthetic attempts from ${names.length} files`);
} catch (err) {
  await db.query('rollback');
  throw err;
} finally {
  await db.end();
}
