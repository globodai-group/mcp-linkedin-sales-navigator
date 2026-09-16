# MCP LinkedIn Sales Navigator

[![CI](https://github.com/globodai-group/mcp-linkedin-sales-navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/globodai-group/mcp-linkedin-sales-navigator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/globodai-mcp-linkedin-sales-navigator)](https://www.npmjs.com/package/globodai-mcp-linkedin-sales-navigator)

**MCP server for LinkedIn Sales Navigator** — Browser automation via Playwright.

> LinkedIn Sales Navigator doesn't provide a public API. This MCP server uses browser automation (Playwright) to control Sales Navigator through an authenticated browser session. It enables AI assistants to search leads, view profiles, manage lists, send InMails, and export data — all through the standard [Model Context Protocol](https://modelcontextprotocol.io/).

## ⚠️ Important Disclaimers

- **This tool requires an active LinkedIn Sales Navigator subscription**
- **Browser automation**: This operates by controlling a real browser — no API hacking
- **Session required**: You must be logged into LinkedIn in the browser instance
- **Rate limiting**: Use responsibly. LinkedIn may restrict accounts that perform excessive automation
- **Terms of Service**: Review LinkedIn's ToS before using automation tools
- **No credentials stored**: This tool never stores or handles LinkedIn passwords

## Features

| Tool | Description |
|------|-------------|
| `linkedin_search_leads` | Search leads with filters (title, company, location, industry, seniority, etc.) |
| `linkedin_get_lead_profile` | Get detailed profile information for a lead |
| `linkedin_save_lead` | Save a lead to a list |
| `linkedin_list_lead_lists` | List all lead lists |
| `linkedin_create_lead_list` | Create a new lead list |
| `linkedin_send_inmail` | Send an InMail message (with dry-run support) |
| `linkedin_export_leads` | Export leads to JSON or CSV format |
| `linkedin_session_status` | Check browser connection and Sales Navigator auth (call this first when debugging) |

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **LinkedIn Sales Navigator** subscription with active session
- A browser with an active LinkedIn login (Chrome recommended)

### Install

```bash
npm install globodai-mcp-linkedin-sales-navigator
```

Or clone and build from source:

```bash
git clone https://github.com/globodai-group/mcp-linkedin-sales-navigator.git
cd mcp-linkedin-sales-navigator
npm install
npm run build
```

### Configuration

The server is configured via environment variables (read in `src/index.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `LSN_AUTH_METHOD` | `cdp` | Auth mode: `cdp` (attach to running Chrome), `session` (Playwright + user data dir), or `cookies` (JSON cookie file) |
| `LSN_CDP_ENDPOINT` | `http://localhost:9222` | CDP HTTP endpoint when `LSN_AUTH_METHOD=cdp` |
| `LSN_COOKIES_PATH` | *(unset)* | Path to exported cookies JSON when `LSN_AUTH_METHOD=cookies` |
| `LSN_USER_DATA_DIR` | *(unset)* | Chrome profile directory when `LSN_AUTH_METHOD=session` |
| `LSN_HEADLESS` | `false` | Set to `true` to run Chromium headless (`session` / `cookies` modes) |
| `LSN_NAVIGATION_TIMEOUT` | `30000` | Page navigation timeout (ms) |
| `LSN_ACTION_TIMEOUT` | `10000` | Click/fill/wait timeout (ms) |
| `LSN_VIEWPORT_WIDTH` | `1280` | Viewport width (px) |
| `LSN_VIEWPORT_HEIGHT` | `900` | Viewport height (px) |

## Authentication Methods

### 1. CDP (Chrome DevTools Protocol) — Recommended

Connect to an already-running Chrome browser with an active LinkedIn session.

Start Chrome with remote debugging:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# If Chrome is installed elsewhere, quote the full path. Node.js 20+ is required.
```

Use PowerShell or Command Prompt. Keep the debugging port free (default `9222`) and match `LSN_CDP_ENDPOINT`.

Then log into LinkedIn Sales Navigator manually. The MCP server connects to this browser.

**Shutdown behavior (CDP):** when the MCP server exits, it **detaches** from your Chrome instance only. It does **not** close your tabs or quit the browser.

```bash
LSN_AUTH_METHOD=cdp LSN_CDP_ENDPOINT=http://localhost:9222 npx globodai-mcp-linkedin-sales-navigator
```

### 2. User Data Directory

Use an existing Chrome profile that's already logged into LinkedIn:

```bash
LSN_AUTH_METHOD=session LSN_USER_DATA_DIR=/path/to/chrome/profile npx globodai-mcp-linkedin-sales-navigator
```

### 3. Cookie-Based

Export your LinkedIn cookies and provide them as a JSON file:

```bash
LSN_AUTH_METHOD=cookies LSN_COOKIES_PATH=/path/to/linkedin-cookies.json npx globodai-mcp-linkedin-sales-navigator
```

## MCP client setup

Use the same `command`, `args`, and `env` block in any MCP client. Replace paths and endpoints for your machine.

### Claude Desktop

Edit the config file:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Example entry:

```json
{
  "mcpServers": {
    "linkedin-sales-navigator": {
      "command": "npx",
      "args": ["-y", "globodai-mcp-linkedin-sales-navigator"],
      "env": {
        "LSN_AUTH_METHOD": "cdp",
        "LSN_CDP_ENDPOINT": "http://localhost:9222"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code

From a shell (adjust env vars as needed):

```bash
claude mcp add linkedin-sales-navigator -- \
  env LSN_AUTH_METHOD=cdp LSN_CDP_ENDPOINT=http://localhost:9222 \
  npx -y globodai-mcp-linkedin-sales-navigator
```

### Generic MCP client

Point the client at the package binary via `npx` or `node /path/to/mcp-linkedin-sales-navigator/dist/index.js`, stdio transport, with the environment variables from the table above.

## Clawdbot / CORTX Integration

This MCP server is designed to work seamlessly with [Clawdbot](https://clawd.bot) browser relay:

```json
{
  "mcpServers": {
    "linkedin-sales-navigator": {
      "command": "npx",
      "args": ["globodai-mcp-linkedin-sales-navigator"],
      "env": {
        "LSN_AUTH_METHOD": "cdp",
        "LSN_CDP_ENDPOINT": "http://localhost:9222"
      }
    }
  }
}
```

When using Clawdbot's browser relay, the AI assistant can directly control a browser tab where you're logged into Sales Navigator — no additional setup needed.

## Tool Examples

### Search for leads

```json
{
  "tool": "linkedin_search_leads",
  "arguments": {
    "title": "VP of Engineering",
    "location": "San Francisco Bay Area",
    "companySize": "201-500",
    "industry": "Computer Software"
  }
}
```

### Get a lead's profile

```json
{
  "tool": "linkedin_get_lead_profile",
  "arguments": {
    "profileUrl": "https://www.linkedin.com/sales/lead/ACwAAAxxxxxx"
  }
}
```

### Send an InMail (with dry run)

```json
{
  "tool": "linkedin_send_inmail",
  "arguments": {
    "profileUrl": "https://www.linkedin.com/sales/lead/ACwAAAxxxxxx",
    "subject": "Quick question about your team",
    "body": "Hi, I noticed your team is growing...",
    "dryRun": true
  }
}
```

### Export leads to CSV

```json
{
  "tool": "linkedin_export_leads",
  "arguments": {
    "source": "current_search",
    "format": "csv",
    "limit": 50
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  AI Assistant (Claude, GPT, etc.)               │
│  ↕ MCP Protocol (stdio)                         │
├─────────────────────────────────────────────────┤
│  MCP Server (this package)                      │
│  ├── Tools (search, leads, inmails, lists, etc.)│
│  ├── Browser Controller (Playwright)            │
│  └── Selectors & Auth                           │
├─────────────────────────────────────────────────┤
│  Playwright → Chromium / Chrome                 │
│  ↕ CDP or Direct                                │
├─────────────────────────────────────────────────┤
│  LinkedIn Sales Navigator (web app)             │
└─────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Development mode (watch)
npm run dev

# Build
npm run build

# Lint
npm run lint

# Type check
npm run typecheck
```

## Selector Maintenance

LinkedIn periodically updates their DOM structure. If tools stop working:

1. Open Sales Navigator in Chrome DevTools
2. Inspect the elements that changed
3. Update selectors in `src/browser/selectors.ts`
4. Submit a PR with the updated selectors

## License

MIT — see [LICENSE](LICENSE)

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by LinkedIn Corporation. LinkedIn and Sales Navigator are trademarks of LinkedIn Corporation. Use this tool responsibly and in accordance with LinkedIn's Terms of Service.
