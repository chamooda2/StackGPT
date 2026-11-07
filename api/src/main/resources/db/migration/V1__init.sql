-- StackGPT schema v1.
-- Index complexity (n = rows, k = matches):
--   HNSW (cosine): approx. top-k search ~O(log n); build ~O(n log n); space O(n*m).
--   GIN (fts, text[], jsonb): lookup ~O(log n + k).
-- embedding / error_sigs are nullable/empty at seed time; the API backfills them with its
-- Embedder and ProblemExtractor so corpus and queries share one model and one extractor.

create extension if not exists vector;

create table users (
  id         bigserial primary key,
  token      text not null unique,
  created_at timestamptz not null default now()
);

create table problems (
  id         bigserial primary key,
  domain     text not null check (domain in ('programming', 'electronics')),
  title      text not null,
  body       text not null,
  error_sigs text[] not null default '{}',
  env        jsonb not null default '{}',
  tags       text[] not null default '{}',
  embedding  vector(384),
  fts        tsvector generated always as (
               setweight(to_tsvector('english', title), 'A') ||
               setweight(to_tsvector('english', body), 'B')) stored,
  source     text not null,
  source_id  text not null,
  source_url text,
  author     text,
  license    text,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

create table solutions (
  id          bigserial primary key,
  problem_id  bigint not null references problems (id) on delete cascade,
  body        text not null,
  steps       jsonb not null default '[]',
  code        text,
  embedding   vector(384),
  score       int,                              -- source score (e.g. SE votes): weak proxy evidence only
  is_accepted boolean not null default false,
  source      text not null,
  source_id   text not null,
  source_url  text,
  author      text,
  license     text,
  created_at  timestamptz not null default now(),
  unique (source, source_id)
);

create table attempts (
  id          bigserial primary key,
  solution_id bigint not null references solutions (id) on delete cascade,
  user_id     bigint not null references users (id) on delete cascade,
  outcome     text not null check (outcome in ('worked', 'partial', 'failed')),
  env         jsonb not null default '{}',
  note        text,
  synthetic   boolean not null default false,  -- seeded demo data, never counted as real evidence silently
  created_at  timestamptz not null default now(),
  unique (solution_id, user_id)
);

create table votes (
  solution_id bigint not null references solutions (id) on delete cascade,
  user_id     bigint not null references users (id) on delete cascade,
  helpful     boolean not null,
  created_at  timestamptz not null default now(),
  primary key (solution_id, user_id)
);

create table flags (
  id          bigserial primary key,
  solution_id bigint not null references solutions (id) on delete cascade,
  user_id     bigint not null references users (id) on delete cascade,
  kind        text not null check (kind in ('outdated', 'misleading')),
  created_at  timestamptz not null default now(),
  unique (solution_id, user_id, kind)
);

create index problems_embedding_hnsw on problems using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index solutions_embedding_hnsw on solutions using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index problems_fts_gin on problems using gin (fts);
create index problems_error_sigs_gin on problems using gin (error_sigs);
create index problems_env_gin on problems using gin (env jsonb_path_ops);
create index problems_domain_idx on problems (domain);
create index solutions_problem_idx on solutions (problem_id);
create index attempts_user_idx on attempts (user_id);
create index votes_user_idx on votes (user_id);
