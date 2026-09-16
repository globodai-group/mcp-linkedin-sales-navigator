/**
 * Pure configuration parsing for LinkedIn Sales Navigator MCP server.
 *
 * Validates LSN_* environment variables and returns a typed config plus
 * any validation errors (caller logs them to stderr; stdout is MCP stdio).
 */

import type { AuthConfig, BrowserConfig } from "./types/index.js";

export type AuthMethod = AuthConfig["method"];

export interface LsnConfig {
  auth: AuthConfig;
  browser: BrowserConfig;
}

const AUTH_METHODS: readonly AuthMethod[] = ["cdp", "cookies", "session"];

/** First line of an error only (Playwright appends multi-line Call logs). */
function summarizeCause(cause?: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  const raw = cause instanceof Error ? cause.message : String(cause);
  const first = raw.split("\n")[0]?.trim();
  return first || undefined;
}

function parseBoolean(
  raw: string | undefined,
  envName: string,
  errors: string[]
): boolean {
  if (raw === undefined || raw === "") return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  errors.push(
    `${envName} must be "true" or "false" (got ${JSON.stringify(raw)})`
  );
  return false;
}

function parsePositiveInt(
  raw: string | undefined,
  envName: string,
  fallback: number,
  errors: string[]
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    errors.push(`${envName} must be a number (got ${JSON.stringify(raw)})`);
    return fallback;
  }
  if (value <= 0) {
    errors.push(`${envName} must be a positive number (got ${value})`);
    return fallback;
  }
  return value;
}

/**
 * Parse and validate LSN_* env vars.
 *
 * Always returns a usable config object (with safe fallbacks) plus an
 * `errors` array. Callers should log errors to stderr and continue so the
 * MCP server can still answer tools/list and linkedin_session_status.
 */
export function parseConfig(env: NodeJS.ProcessEnv): {
  config: LsnConfig;
  errors: string[];
} {
  const errors: string[] = [];

  const rawMethod = env.LSN_AUTH_METHOD?.trim();
  let method: AuthMethod = "cdp";
  if (rawMethod) {
    if ((AUTH_METHODS as readonly string[]).includes(rawMethod)) {
      method = rawMethod as AuthMethod;
    } else {
      errors.push(
        `LSN_AUTH_METHOD must be one of ${AUTH_METHODS.join(", ")} (got ${JSON.stringify(rawMethod)})`
      );
    }
  }

  const cookiesPath = env.LSN_COOKIES_PATH?.trim() || undefined;
  const cdpEndpoint = env.LSN_CDP_ENDPOINT?.trim() || undefined;
  const userDataDir = env.LSN_USER_DATA_DIR?.trim() || undefined;

  if (method === "cdp" && !cdpEndpoint) {
    errors.push(
      'LSN_CDP_ENDPOINT is required when LSN_AUTH_METHOD is "cdp" (e.g. http://localhost:9222)'
    );
  }
  if (method === "cookies" && !cookiesPath) {
    errors.push(
      'LSN_COOKIES_PATH is required when LSN_AUTH_METHOD is "cookies"'
    );
  }
  if (method === "session" && !userDataDir) {
    errors.push(
      'LSN_USER_DATA_DIR is required when LSN_AUTH_METHOD is "session"'
    );
  }

  const auth: AuthConfig = {
    method,
    cookiesPath,
    cdpEndpoint,
    userDataDir,
  };

  const browser: BrowserConfig = {
    headless: parseBoolean(env.LSN_HEADLESS, "LSN_HEADLESS", errors),
    viewportWidth: parsePositiveInt(
      env.LSN_VIEWPORT_WIDTH,
      "LSN_VIEWPORT_WIDTH",
      1280,
      errors
    ),
    viewportHeight: parsePositiveInt(
      env.LSN_VIEWPORT_HEIGHT,
      "LSN_VIEWPORT_HEIGHT",
      900,
      errors
    ),
    navigationTimeout: parsePositiveInt(
      env.LSN_NAVIGATION_TIMEOUT,
      "LSN_NAVIGATION_TIMEOUT",
      30000,
      errors
    ),
    actionTimeout: parsePositiveInt(
      env.LSN_ACTION_TIMEOUT,
      "LSN_ACTION_TIMEOUT",
      10000,
      errors
    ),
  };

  return { config: { auth, browser }, errors };
}

/**
 * Actionable hint for a connection/auth failure, keyed by auth method.
 */
export function authFailureHint(auth: AuthConfig, cause?: unknown): string {
  const detail = summarizeCause(cause);
  const lower = (detail ?? "").toLowerCase();
  const authFailed =
    lower.includes("not authenticated") ||
    lower.includes("logged out") ||
    lower.includes("authwall");

  const suffix = [
    detail && !authFailed ? `Detail: ${detail}` : undefined,
    "Call linkedin_session_status to diagnose.",
  ]
    .filter(Boolean)
    .join(" ");

  switch (auth.method) {
    case "cdp":
      if (authFailed) {
        return [
          "Connected via CDP but not authenticated to Sales Navigator.",
          "Log into LinkedIn Sales Navigator in the Chrome instance exposed by LSN_CDP_ENDPOINT.",
          "Call linkedin_session_status to diagnose.",
        ].join(" ");
      }
      return [
        `CDP endpoint unreachable${auth.cdpEndpoint ? ` (${auth.cdpEndpoint})` : ""}.`,
        "Check LSN_CDP_ENDPOINT and start Chrome with --remote-debugging-port.",
        suffix,
      ]
        .filter(Boolean)
        .join(" ");
    case "cookies":
      if (authFailed) {
        return [
          `Cookies loaded but session is not authenticated (li_at missing/expired)${auth.cookiesPath ? ` (${auth.cookiesPath})` : ""}.`,
          "Check LSN_COOKIES_PATH and re-export a fresh cookies JSON.",
          "Call linkedin_session_status to diagnose.",
        ].join(" ");
      }
      return [
        `Cookies file missing or invalid${auth.cookiesPath ? ` (${auth.cookiesPath})` : ""}.`,
        "Check LSN_COOKIES_PATH for a valid JSON cookie array including li_at.",
        suffix,
      ]
        .filter(Boolean)
        .join(" ");
    case "session":
      return [
        `User data dir not logged in to Sales Navigator${auth.userDataDir ? ` (${auth.userDataDir})` : ""}.`,
        "Check LSN_USER_DATA_DIR points at a Chrome profile already signed into Sales Navigator.",
        suffix,
      ]
        .filter(Boolean)
        .join(" ");
    default:
      return [
        "Browser connection or authentication failed.",
        "Check LSN_AUTH_METHOD and related LSN_* variables.",
        suffix,
      ]
        .filter(Boolean)
        .join(" ");
  }
}
