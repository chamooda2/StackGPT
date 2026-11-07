# StackGPT

Community verification layer for AI answers (PoC). See [CLAUDE.md](CLAUDE.md) for the design.

## Database (build step 1)

Requires Docker, Node 22.18+ and pnpm. Postgres listens on host port **5433**.

```sh
cp .env.example .env            # optional; defaults match
docker compose up -d db
docker compose run --rm flyway  # applies api/src/main/resources/db/migration
cd db && pnpm install
pnpm seed                       # idempotent; safe to re-run
pnpm check                      # smoke checks: counts, labelling, FTS, index usage
pnpm test                       # synthetic-attempt generator tests
```

Reset everything: `docker compose down -v`.

## Seed data

- `db/seed/curated/*.json`: hand-curated problems and solutions for both pilot domains
  (`source = 'curated'`). Their **attempts are synthetic**: generated deterministically per
  solution from an evidence profile (`verified`, `partial`, `conflicting`, `outdated`,
  `failing`, `unverified`), stored with `attempts.synthetic = true` from `synthetic-user-*` users.
- `embedding` and `error_sigs` are left empty by the seed; the API backfills them (step 2) so
  the corpus and queries share one embedding model and one extractor.
- Stack Exchange import is **not included yet**: the current API/data-dump terms (storage,
  embeddings, AI use) must be verified first.
