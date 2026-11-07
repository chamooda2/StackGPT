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

## API (build step 2)

Requires JDK 25 (Maven comes via the wrapper). Listens on port 8080.

```sh
cd api
./mvnw spring-boot:run          # Windows: .\mvnw.cmd spring-boot:run
./mvnw test                     # unit tests + retrieval eval (eval skips if the DB isn't seeded/backfilled)
```

On startup and every 30 s the API backfills `embedding` / `error_sigs` (and `env` where empty) for
rows the seed left blank, using the in-process bge-small-en-v1.5 model.

```sh
curl -X POST localhost:8080/v1/verify -H 'Content-Type: application/json' \
  -d '{"platform":"chatgpt","question":"pip install says error: externally-managed-environment on Ubuntu 24.04"}'
```

## Extension (build step 3)

WXT + Preact, Manifest V3, content script on `https://chatgpt.com/*`.

```sh
cd extension && pnpm install
pnpm build                      # -> extension/.output/chrome-mv3
pnpm test                       # adapter fixture test, completion detection, panel
pnpm dev                        # Chrome with the extension loaded and hot reload
```

Load manually: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/.output/chrome-mv3`.
With the API running, open a ChatGPT conversation: each finished answer gets a **Check with StackGPT**
badge. Nothing is sent until you click it; the background worker then calls the API and the panel
shows the raw matches. To use another API URL, build with `WXT_API_BASE=http://host:port` set in the
shell (the manifest's host permission follows it).

All chatgpt.com DOM assumptions live in `extension/src/lib/chatgpt.ts`.

## Context matching and answer alignment (build step 4)

- **ContextMatcher**: per problem, a weighted environment fit (OS, device, language, OS/package versions)
  that nudges ranking by at most ±10%; an OS you name that differs from the problem's is a hard conflict
  (flagged and demoted). The browser's OS is only a weak hint. Per solution: outcomes "in setups like
  yours", fixes whose reports all come from another OS, and fixes that mostly fail in your setup while
  working elsewhere (e.g. model-specific).
- **SolutionAligner**: embeds the answer's steps + code (prose if neither) and compares it with stored
  solutions of the top related problems: `matches` (≥ 0.78), `partial` (≥ 0.70) or `novel`.
- Matches below 0.70 question similarity are dropped unless an error signature matched exactly.
- Thresholds were calibrated on the seeded corpus; `VerifyEvalTest` prints the similarities behind them.

### API response

`/v1/verify` returns the extracted query (statement, error signatures, env facets merged with `envHints`) and
the top 10 problems fused by RRF from vector, full-text and error-signature search, each with its
per-list ranks, cosine similarity, solutions and raw attempt counts (synthetic ones counted separately).

## Seed data

- `db/seed/curated/*.json`: hand-curated problems and solutions for both pilot domains
  (`source = 'curated'`). Their **attempts are synthetic**: generated deterministically per
  solution from an evidence profile (`verified`, `partial`, `conflicting`, `outdated`,
  `failing`, `unverified`), stored with `attempts.synthetic = true` from `synthetic-user-*` users.
- `embedding` and `error_sigs` are left empty by the seed; the API backfills them (step 2) so
  the corpus and queries share one embedding model and one extractor.
- Stack Exchange import is **not included yet**: the current API/data-dump terms (storage,
  embeddings, AI use) must be verified first.
