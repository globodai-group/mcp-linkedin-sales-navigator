# Security Policy

## Reporting a Vulnerability

Please report security issues **privately** via [GitHub Security Advisories](https://github.com/globodai-group/mcp-linkedin-sales-navigator/security/advisories/new) for this repository. Do not open a public issue for undisclosed vulnerabilities.

Include enough detail for us to reproduce the problem (version, configuration, steps). We will acknowledge receipt and work on a fix according to severity.

## Sensitive data

This project automates a logged-in browser session. **Never** paste the following into issues, pull requests, or public chat:

- LinkedIn cookies (including `li_at`)
- Session tokens, JWTs, or exported cookie JSON
- Chrome user-data directories or profile paths that contain credentials
- Screenshots or logs that show authentication headers or cookie values

Redact secrets before sharing MCP client logs. If you accidentally exposed session data, rotate it by signing out of LinkedIn and signing in again.

## Scope

Reports about LinkedIn's own infrastructure or Terms of Service enforcement are outside this repository's scope; use LinkedIn's official channels for those concerns.
