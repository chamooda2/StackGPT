# StackGPT

Community verification layer for AI answers (PoC). See [CLAUDE.md](CLAUDE.md) for the design.

Under each finished ChatGPT answer, StackGPT adds a **Check this answer** badge. On click it finds
similar previously-solved problems, tells you whether the answer's fix has community evidence
(verified, conflicting, outdated, mixed, mostly failing or unverified), warns when reports suggest it
won't fit your setup, and lets you report whether it worked.

## Quickstart

Requires Docker, JDK 25, Node 22.18+ and pnpm.

```sh
docker compose up -d db && docker compose run --rm flyway   # Postgres + schema
cd db && pnpm install && pnpm seed && cd ..                   # curated problems + synthetic evidence
cd api && ./mvnw spring-boot:run                              # API on :8080 (separate terminal)
cd extension && pnpm install && pnpm build                    # then load extension/.output/chrome-mv3
cd demo && pnpm install && pnpm demo                          # scripted end-to-end demo
```

On Windows use `.\mvnw.cmd`. Load the extension at `chrome://extensions` → Developer mode →
**Load unpacked**.

## Demo (build step 6)

`pnpm demo` (in `demo/`) runs the built extension in your Chrome against the running API through four
scenarios, prints PASS/FAIL per scenario and saves a screenshot of each panel to `demo/out/`:

| Scenario | ChatGPT answer | Expected badge |
|---|---|---|
| pip `externally-managed-environment` | create a venv | `Verified fix · N of M worked` |
| Galaxy A14 won't super fast charge | enable Super fast charging | `Conflicting results · … · may not fit your setup` |
| NumPy 2 breaks pandas | pin `numpy<2` | `Outdated fix · …` |
| MX Master scroll wheel only in Chrome | (no stored fix) | `New fix · no community evidence yet`; after reporting "Worked" it is shared and re-checks as `Unverified · 1 of 1 worked` |

ChatGPT needs a login, so the pages are stand-ins in ChatGPT's current DOM layout, served at
`https://chatgpt.com/c/demo-…` by request interception; the extension runs on them unchanged. The demo
uses its own anonymous token and deletes that user and everything it wrote at the end, so your own
reports are untouched. `pnpm demo:show` shows the browser and slows it down for presenting.

**Live on chatgpt.com**: ask the same questions and click the badge. Good prompts:

```
pip install fails on Ubuntu 24.04 with error: externally-managed-environment. How do I fix it?
My Samsung Galaxy A14 won't super fast charge even though I bought a 25W Samsung charger. How do I enable it?
import pandas crashes: A module that was compiled using NumPy 1.x cannot be run in NumPy 2.0.0. What should I do?
```

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

## Community reports and trust (build step 5)

| Endpoint | Body | Notes |
|---|---|---|
| `POST /v1/attempts` | `{solutionId, outcome: worked\|partial\|failed, env?, note?}` | one per user per solution; posting again replaces it |
| `POST /v1/votes` | `{solutionId, helpful}` | helpfulness, kept separate from outcomes |
| `POST /v1/flags` | `{solutionId, kind: outdated\|misleading}` | once per user and kind |
| `POST /v1/solutions` | `{problemId \| problem:{title, body}, body, steps?, code?}` | embedded immediately, so searchable at once |
| `GET /v1/solutions/{id}` | | |

Writes need `X-StackGPT-Token`: a random 64-hex token the extension creates on first use and keeps in
`chrome.storage.local`. The API stores only its SHA-256. Every write returns the solution's updated
outcomes, trust, votes, flags and the caller's own report.

**Trust status** per solution (partial counts as half a success), first rule that applies:
`unverified` (< 5 reports) → `outdated` (≥ 3 outdated flags, or worked before but ≥ 60% of the last 180
days' reports failed, or no success in 2 years) → `conflicting` (one OS / OS version / device / package
version segment works ≥ 70%, another ≤ 30%, each ≥ 3 reports) → `verified` (Wilson 95% lower bound ≥ 0.7
and a success within a year) → `failing` (Wilson upper bound < 0.5) → `partial`. Seeded synthetic reports
are counted but always reported (`trust.synthetic`, "demo data" in the panel).

In the panel each fix has Worked / Partly / Didn't work (+ optional note), Helpful, and Flag buttons.
"Did ChatGPT's answer work?" reports on the fix the answer matches; for a novel answer it first shares
the question and answer as a new fix (the button says so).

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
