/**
 * Session status tool for LinkedIn Sales Navigator.
 *
 * Explicit initialize/check step (issue #1): triggers the lazy browser
 * connection and reports auth method, connectivity, and authentication.
 * Never navigates or reloads the user's own tab; may open an owned
 * dedicated tab (same path as other tools) when no Sales Navigator tab
 * exists.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ensureAttached,
  getStoredNavigatorConfig,
} from "../browser/navigator.js";
import { authFailureHint } from "../config.js";
import {
  isLinkedInAuthFailureUrl,
  isSalesNavigatorUrl,
} from "../browser/url.js";
import { URLS } from "../browser/selectors.js";
import type { AuthConfig } from "../types/index.js";
import { readUsageToday, type UsageToday } from "../browser/rate-limit.js";

export interface SessionStatus {
  authMethod: AuthConfig["method"] | "unknown";
  browserConnected: boolean;
  authenticated: boolean;
  hint?: string;
  error?: string;
  usageToday?: UsageToday;
}

function notOnSalesNavHint(auth: AuthConfig): string {
  if (auth.method === "cdp") {
    return [
      "Browser is connected but Sales Navigator authentication could not be verified.",
      "Log into LinkedIn Sales Navigator in the Chrome instance exposed by LSN_CDP_ENDPOINT.",
      "Call linkedin_session_status to diagnose.",
    ].join(" ");
  }
  return [
    "Browser is connected but Sales Navigator authentication could not be verified.",
    "Open https://www.linkedin.com/sales/home and retry.",
    "Call linkedin_session_status to diagnose.",
  ].join(" ");
}

/**
 * Probe browser connection and Sales Navigator authentication.
 * Never throws - always returns a structured status object.
 * Never navigates the user's own tab; when no Sales Navigator tab
 * exists, uses the same owned dedicated page tools use.
 */
export async function probeSessionStatus(): Promise<SessionStatus> {
  const stored = getStoredNavigatorConfig();
  const authMethod = stored?.auth.method ?? "unknown";

  const usageToday = await readUsageToday();

  if (!stored) {
    return {
      authMethod: "unknown",
      browserConnected: false,
      authenticated: false,
      hint:
        "Navigator is not configured. Check LSN_AUTH_METHOD and related LSN_* variables.",
      error: "missing_config",
      usageToday,
    };
  }

  try {
    const nav = await ensureAttached();
    const browserConnected = nav.isBrowserAttached();
    if (!browserConnected) {
      return {
        authMethod,
        browserConnected: false,
        authenticated: false,
        hint: authFailureHint(stored.auth, new Error("Browser is not attached")),
        error: "connection_failed",
        usageToday,
      };
    }

    // Align with tools: bind an existing Sales Navigator tab when present,
    // otherwise open an owned dedicated page (never hijack the user's tab).
    await nav.adoptWorkingPage();

    if (!nav.isConnected()) {
      return {
        authMethod,
        browserConnected: true,
        authenticated: false,
        hint: notOnSalesNavHint(stored.auth),
        error: "not_on_sales_nav",
        usageToday,
      };
    }

    const page = nav.getPage();
    const urlBefore = page.url();

    // Fast path: already on Sales Navigator — inspect without navigating.
    if (isSalesNavigatorUrl(urlBefore)) {
      if (isLinkedInAuthFailureUrl(urlBefore)) {
        return {
          authMethod,
          browserConnected: true,
          authenticated: false,
          hint: authFailureHint(
            stored.auth,
            new Error("Not authenticated to LinkedIn Sales Navigator")
          ),
          error: "auth_failed",
          usageToday,
        };
      }

      const authenticated = await nav.checkAuth();
      return {
        authMethod,
        browserConnected: true,
        authenticated,
        hint: authenticated
          ? undefined
          : authFailureHint(
              stored.auth,
              new Error("Not authenticated to LinkedIn Sales Navigator")
            ),
        error: authenticated ? undefined : "auth_failed",
        usageToday,
      };
    }

    // No Sales Navigator tab: navigate only the owned dedicated page to HOME
    // (same path ensureAuthenticatedSession uses for tools).
    if (!nav.isOwnedWorkingPage()) {
      return {
        authMethod,
        browserConnected: true,
        authenticated: false,
        hint: notOnSalesNavHint(stored.auth),
        error: "not_on_sales_nav",
        usageToday,
      };
    }

    await page.goto(URLS.HOME, {
      waitUntil: "domcontentloaded",
      timeout: stored.browser.navigationTimeout ?? 30000,
    });

    if (isLinkedInAuthFailureUrl(page.url())) {
      return {
        authMethod,
        browserConnected: true,
        authenticated: false,
        hint: authFailureHint(
          stored.auth,
          new Error("Not authenticated to LinkedIn Sales Navigator")
        ),
        error: "auth_failed",
        usageToday,
      };
    }

    const authenticated = await nav.checkAuth();
    return {
      authMethod,
      browserConnected: true,
      authenticated,
      hint: authenticated
        ? undefined
        : authFailureHint(
            stored.auth,
            new Error("Not authenticated to LinkedIn Sales Navigator")
          ),
      error: authenticated ? undefined : "auth_failed",
      usageToday,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const alreadyHinted = message.includes("linkedin_session_status");
    const lower = message.toLowerCase();
    const authFailed =
      lower.includes("not authenticated") ||
      lower.includes("connected via cdp but not authenticated") ||
      lower.includes("cookies loaded but session is not authenticated") ||
      lower.includes("user data dir not logged in");

    return {
      authMethod,
      // initialize() closes any partial session on failure, so the browser
      // is not connected afterward; auth_failed still distinguishes why.
      browserConnected: false,
      authenticated: false,
      hint: alreadyHinted ? message : authFailureHint(stored.auth, error),
      error: authFailed ? "auth_failed" : "connection_failed",
      usageToday,
    };
  }
}

/**
 * Register session tools with the MCP server.
 */
export function registerSessionTools(server: McpServer): void {
  server.tool(
    "linkedin_session_status",
    "Check LinkedIn Sales Navigator browser connection, authentication, and today's usage budgets. " +
      "Call this before other tools to verify the session (auth method, browserConnected, authenticated, usageToday). " +
      "Attaches to the existing browser if needed. Never navigates the user's own tab; opens an owned dedicated tab when no Sales Navigator tab exists (same as other tools).",
    {},
    async () => {
      try {
        const status = await probeSessionStatus();
        const ok = status.browserConnected && status.authenticated;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(status, null, 2),
            },
          ],
          ...(ok ? {} : { isError: true }),
        };
      } catch (error) {
        // Must never surface an unhandled rejection from this tool.
        const message = error instanceof Error ? error.message : String(error);
        const fallback: SessionStatus = {
          authMethod: getStoredNavigatorConfig()?.auth.method ?? "unknown",
          browserConnected: false,
          authenticated: false,
          hint: `${message} Call linkedin_session_status again after fixing LSN_* configuration.`,
          error: message,
          usageToday: await readUsageToday(),
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(fallback, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
