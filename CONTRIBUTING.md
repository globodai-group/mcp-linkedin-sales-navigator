# Contributing

Thanks for helping improve this MCP server. This document covers local setup and how to submit changes.

## Setup

Requirements:

- **Node.js** 20 or newer
- **npm** (comes with Node)

```bash
git clone https://github.com/globodai-group/mcp-linkedin-sales-navigator.git
cd mcp-linkedin-sales-navigator
npm install
npx playwright install chromium
npm run build
```

## Build, lint, and test

```bash
npm run build      # compile TypeScript to dist/
npm run lint       # ESLint on src/
npm run typecheck  # tsc --noEmit
npm test           # unit tests (Vitest)
```

Run the full set before opening a pull request.

## Reporting broken selectors

LinkedIn changes the Sales Navigator DOM frequently. When a tool fails because the UI moved:

1. Open an issue using the **Bug report** template.
2. Include:
   - **Page** (e.g. lead profile, search results, list hub, InMail compose)
   - **Tool name** (e.g. `linkedin_search_leads`)
   - **OS and Node version**
   - **Auth method** (`cdp`, `session`, or `cookies`) — not your cookies or profile paths
   - A **redacted HTML snippet** (structure and `data-*` attributes only; no personal data, no cookie values)
3. Never attach cookie files, `li_at` values, or full page dumps with PII.

Maintainers update `src/browser/selectors.ts`, `src/browser/query.ts`, and `src/browser/dom-extract.ts` following the strategy documented in [README.md](README.md#selector-maintenance).

## Pull requests

- Branch from the latest `dev`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) in English.
- Keep changes focused; mention related issues (`refs #2`, `closes #1`).
- Fill out the pull request template checklist.

**Target branch:** open PRs against **`dev`**. Maintainers promote `dev` → `rec` → `main`; do not open PRs directly to `main` unless asked by a maintainer.

## Code of conduct

Be respectful in issues and reviews. We reserve the right to close contributions that violate LinkedIn's Terms of Service or encourage abuse of automation.
