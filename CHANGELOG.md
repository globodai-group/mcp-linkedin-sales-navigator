# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-17

### Added

- `linkedin_session_status` tool for lazy connection checks and actionable diagnostics
- Conservative daily usage budgets and action pacing (`LSN_DAILY_*`, `LSN_MIN_ACTION_INTERVAL_MS`)
- Startup configuration validation
- Unit tests
- Issue and pull request templates
- Expanded documentation (`README`, `CONTRIBUTING`, `SECURITY`, this changelog)

### Changed

- Dependency updates within current major versions

### Fixed

- Resilient Sales Navigator selectors with prioritised fallbacks (`data-anonymize`, semantic hooks, `artdeco`, text matchers)
- Auth check waits for the Sales Navigator shell instead of probing too early
- CDP shutdown detaches from the user's browser only; it no longer closes their tabs
- Lazy browser connection recovers from a failed startup (retries on each tool call)
- Delivered InMails no longer reported as failures

Thanks [@benjaminfrombe](https://github.com/benjaminfrombe) ([#3](https://github.com/globodai-group/mcp-linkedin-sales-navigator/pull/3)).

Closes [#1](https://github.com/globodai-group/mcp-linkedin-sales-navigator/issues/1) (reported by [@Jeff-VTR](https://github.com/Jeff-VTR)) and [#2](https://github.com/globodai-group/mcp-linkedin-sales-navigator/issues/2) (reported by [@axelquack](https://github.com/axelquack)).

## [0.1.0] - 2026-02-05

### Added

- Initial MCP server for LinkedIn Sales Navigator (browser automation via Playwright)
