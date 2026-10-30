# PrivAudit

**Understand the fine print.** PrivAudit reads a website's privacy policy and turns it into an evidence-backed privacy score, with every finding tied to an exact quotation from the policy itself.

Paste a privacy-policy URL and PrivAudit will:

- score the policy from 0 to 10 across **10 privacy categories** (collection, purposes, sharing, controls, rights, retention, sensitive data, security, transfers and transparency);
- show the **verbatim excerpt** supporting each finding, so you can check every claim yourself;
- run separate **GDPR** and **CCPA/CPRA** disclosure checklists;
- compare up to **three policies** side by side;
- optionally **publish** a report to a public, searchable library for 30 days.

> **PrivAudit assesses what a policy says, not what a company does.** It is not legal advice, a compliance certification, or an audit of real-world behavior. A score of 10 means stronger stated protections under the PrivAudit rubric, not risk-free practices.

Fictional sample reports are built in, so you can explore the full interface without an API key or a database.

## How it works

```text
Policy URL
   │  1. Download    Fetch the page safely: public addresses only, validated redirects, size and time limits
   ▼
HTML page
   │  2. Extract     Keep policy text; remove menus, site headers/footers and scripts.
   │                 For client-rendered sites, read the policy from embedded page data.
   ▼
Policy text
   │  3. Assess      Gemini fills a fixed schema: 10 categories + 8 regional checks, each with a quotation
   ▼
Findings
   │  4. Verify      Every quotation must appear verbatim in the policy. Failed quotations get one
   │                 targeted repair request; anything still unverifiable becomes "unknown"
   ▼
Verified evidence
   │  5. Score       Deterministic weighted scoring in code — the AI never computes the score
   ▼
Report
```

Key design principles:

- **Evidence before numbers.** A category is scored only when supported by an exact policy quotation. Missing or unverifiable evidence is "unknown", never scored as 0 or 10.
- **The AI interprets, code decides.** Gemini extracts findings; validation, quotation checks and scoring are ordinary, testable code.
- **Withhold rather than guess.** No overall score is shown unless at least 80% of the weighted rubric is evidenced, including all five critical categories.
- **Untrusted input.** Policy text is treated strictly as data, never as instructions to the model.

The rubric, weights and scoring rules are documented in [docs/scoring-methodology.md](docs/scoring-methodology.md).

## Tech stack

| Area | Technology |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, TypeScript |
| AI | Google Gemini API (structured JSON output), default model `gemini-3.5-flash-lite` |
| Parsing | Cheerio (HTML), franc (language detection), Zod (validation) |
| Database (optional) | PostgreSQL 17 via Prisma — only needed for the public report library |
| Testing | Node test runner, Playwright, and a live evaluation harness |

## Getting started

### Prerequisites

- **Node.js 24 LTS** and npm
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey) — only for live analysis
- **PostgreSQL 17** — only for publishing to the public library

### Install and run

```bash
npm install
npm run db:generate
cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open <http://127.0.0.1:3000> and choose **Explore sample reports** to try the interface without making any API calls.

### Enable live analysis

Add your key and model to `.env.local` in the project root:

```dotenv
GEMINI_API_KEY=your_private_key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Restart the dev server after changing environment variables. Enter keys directly in the file, never in chats or commits. `.env.local` is git-ignored, and keys stay server-side; never prefix them with `NEXT_PUBLIC_`.

### Enable the public library (optional)

Start PostgreSQL 17 with Docker and apply the migrations:

```bash
docker compose up -d
npm run db:deploy
```

Set `DATABASE_URL` in `.env.local` to the local connection shown in `.env.example`, or to your own PostgreSQL instance. The Docker credentials are for loopback-only local development, never production. Alternatively, `npm run db:local` starts Prisma's local development database. Don't run it alongside Docker on the same port.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For live analysis | Server-side Gemini API key |
| `GEMINI_MODEL` | For live analysis | Gemini model ID, e.g. `gemini-3.5-flash-lite` |
| `DATABASE_URL` | For publishing | PostgreSQL connection string; omit to run without the library |
| `APP_ORIGIN` | In production | Exact browser origin including port, e.g. `https://privaudit.example.com` |
| `PUBLIC_LAUNCH_APPROVED` | In production | Must be `true` to enable live analysis in production (see [Launch checklist](#launch-checklist)) |

### Gemini costs and quotas

A typical analysis uses about 4,000–14,000 tokens; very large policies use up to about 45,000. Free-tier access, quotas and model availability depend on your Google project and region, so verify them in AI Studio and on [Google's pricing page](https://ai.google.dev/gemini-api/docs/pricing). **Free-tier submissions may be used by Google to improve its products**; paid-tier submissions are not. Rate-limit errors (HTTP 429) are never retried. Transient server errors and network failures are retried up to twice, with backoff.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint |
| `npm run browser:install` | Install the Playwright browser for end-to-end tests |
| `npm run test:e2e` | Browser and HTTP API tests (no AI calls) |
| `npm run test:db` | Database integration tests; use a disposable database |
| `npm run eval:policies` | Live evaluation against real privacy policies |
| `npm run db:deploy` | Apply database migrations |
| `npm run reports:purge` | Delete expired public reports; schedule hourly |
| `npm run reports:remove -- <report-id>` | Operator removal of a published report |

Development and production builds use Webpack.

## Testing and evaluation

- **Unit tests** cover URL safety, HTML and embedded-data extraction, quotation matching, scoring, the Gemini request contract, retries and quotation repair. All provider calls are mocked.
- **Browser and API tests** use synthetic reports, mocked analysis responses and a dummy API key. Never configure a real key in test environments.
- **Live evaluation** (`npm run eval:policies`) runs the real pipeline against six public privacy policies: DuckDuckGo, Mozilla, Apple, Google, Microsoft and the client-rendered Myntra. Each pipeline stage is checked separately against the criteria in [evals/policies.json](evals/policies.json):
  - **Download:** the complete page is received.
  - **Extract:** required headings and passages from start to end are present, and site boilerplate is absent.
  - **AI:** quotations are verbatim, critical categories are evidenced, a score is produced, and analysis finishes within 120 seconds.

  ```bash
  npm run eval:policies -- --stage extract           # no AI calls
  npm run eval:policies -- --only google,microsoft   # selected policies
  ```

  The AI stage makes live Gemini requests using your key and quota. Model output varies, so run it several times before trusting a change. Passing checks confirm that the evidence is genuine and complete. They do not confirm that every judgment is correct, so review the findings manually.

## Project structure

```text
src/
  app/                 Pages and API routes (analyses, reports, publishing)
  components/          Dashboard UI
  lib/
    fetch-policy.ts    Safe download and policy text extraction
    gemini.ts          Gemini requests, structured schema, retries, quotation repair
    schema.ts          Validation, quotation verification, report building
    rubric.ts          Categories, weights and deterministic scoring
    analyze.ts         End-to-end analysis pipeline
    jobs.ts            In-memory background analysis queue
    reports.ts         Public library storage, search, expiry and removal
docs/                  Scoring methodology
evals/                 Live evaluation fixtures and pass criteria
prisma/                Database schema and migrations
scripts/               Evaluation and operator scripts
tests/                 Browser, API and database integration tests
```

## Data handling and limits

- **Supported pages:** public, English, HTML privacy policies. PDFs, login-protected pages, bot-challenged pages and policies loaded only by later network requests are not supported. URLs with credentials, custom ports or query strings are rejected.
- **Size limits:** the downloaded page can be up to 1 MB and the extracted policy text up to 320 KB. Oversized policies are rejected, never silently truncated.
- **Privacy of submissions:** unpublished results live in server memory for at most 20 minutes and in the browser tab; refreshes or restarts can clear them. Analysis sends policy text to Google Gemini, whose processing and retention terms apply.
- **Publishing** requires explicit consent and stores findings and short excerpts, not full policies. Reports expire 30 days after analysis. The expired-report purge runs at startup and hourly. Publishing returns a one-time removal credential, and only its hash is stored. Search engines are discouraged from indexing reports, but public material can still be copied.
- **Usage limits:** v1.0 has no per-user or daily cap on analyses. Each user can have three pending jobs, the server runs two at a time, and publishing and removal are rate-limited. Add access control and a spending cap before sharing the app widely.
- Sensitive-content screening before publication is limited and is not a guarantee. Review every excerpt before publishing.

## Launch checklist

Run PrivAudit as a long-running Node server, not as request-scoped serverless functions, because analyses run as background jobs. In production, live analysis stays disabled until `PUBLIC_LAUNCH_APPROVED=true`. Setting that flag records an operator decision; it does not prove the items below are done.

- [ ] Configure PostgreSQL, the exact `APP_ORIGIN`, HTTPS, migrations, secrets and bounded backup retention. Test the hourly purge and the removal process.
- [ ] Apply network egress controls that block internal networks and cloud metadata services. The app's own DNS and redirect checks don't replace network policy.
- [ ] Add access control or abuse protection: per-IP limits, bot challenges and a shared spending budget.
- [ ] Verify model pricing, Gemini data terms, your privacy notice and user consent wording. Review results on representative real policies with qualified reviewers.
- [ ] Review dependencies and logging, and add a Content Security Policy suited to your host.

## Not included in v1.0

Accounts, saved history, compliance certification, verification of companies' actual behavior, and a permanent public archive.
