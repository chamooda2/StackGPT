// Smoke checks for step 1: counts, synthetic labelling, FTS, and index usage. Exits 1 on failure.
import { client } from './db.ts';

const db = client();
await db.connect();
let ok = true;
const fail = (m: string) => { ok = false; console.log(`FAIL ${m}`); };
const pass = (m: string) => console.log(`ok   ${m}`);

try {
  const { rows: counts } = await db.query(
    `select p.domain, count(distinct p.id)::int problems, count(s.id)::int solutions
     from problems p left join solutions s on s.problem_id = p.id group by 1 order by 1`,
  );
  console.table(counts);
  for (const d of ['programming', 'electronics'])
    counts.some(c => c.domain === d && c.problems > 0) ? pass(`${d} has problems`) : fail(`${d} has no problems`);

  const { rows: [a] } = await db.query(
    `select count(*)::int total,
            count(*) filter (where a.synthetic)::int synthetic,
            count(*) filter (where u.token like 'synthetic-%' and not a.synthetic)::int unlabelled
     from attempts a join users u on u.id = a.user_id`,
  );
  console.table([a]);
  a.total > 0 ? pass('attempts seeded') : fail('no attempts');
  a.unlabelled === 0 ? pass('all synthetic-user attempts flagged synthetic') : fail(`${a.unlabelled} unlabelled synthetic attempts`);

  const { rows: fts } = await db.query(
    `select p.title, round(ts_rank(p.fts, q)::numeric, 3) rank
     from problems p, websearch_to_tsquery('english', 'pip externally managed environment') q
     where p.fts @@ q order by rank desc limit 3`,
  );
  console.table(fts);
  fts.length ? pass('full-text search returns hits') : fail('full-text search returned nothing');

  const plan = async (sql: string, idx: string) => {
    await db.query('begin');
    await db.query('set local enable_seqscan = off');
    const { rows } = await db.query(`explain ${sql}`);
    await db.query('rollback');
    const txt = rows.map(r => r['QUERY PLAN']).join('\n');
    txt.includes(idx) ? pass(`planner uses ${idx}`) : fail(`planner ignores ${idx}:\n${txt}`);
  };
  const vec = `('[' || array_to_string(array_fill(0.1::float4, array[384]), ',') || ']')::vector`;
  await plan(`select id from problems where error_sigs @> array['ModuleNotFoundError']`, 'problems_error_sigs_gin');
  await plan(`select id from problems where fts @@ websearch_to_tsquery('english', 'docker')`, 'problems_fts_gin');
  await plan(`select id from problems where env @> '{"os":"windows"}'`, 'problems_env_gin');
  await plan(`select id from problems order by embedding <=> ${vec} limit 5`, 'problems_embedding_hnsw');
  await plan(`select id from solutions order by embedding <=> ${vec} limit 5`, 'solutions_embedding_hnsw');
} finally {
  await db.end();
}
process.exit(ok ? 0 : 1);
