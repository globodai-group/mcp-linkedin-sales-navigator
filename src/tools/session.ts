/**
 * Session status tool for LinkedIn Sales Navigator.
 *
 * Explicit initialize/check step (issue #1): triggers the lazy browser
 * connection and reports auth method, connectivity, and authentication.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ensureNavigator,
  getStoredNavigatorConfig,
  isNavigatorReady,
} from "../browser/navigator.js";
import { authFailureHint } from "../config.js";
import type { AuthConfig } from "../types/index.js";

export interface SessionStatus {
  authMethod: AuthConfig["method"] | "unknown";
  browserConnected: boolean;
  authenticated: boolean;
  hint?: string;
  error?: string;
}

/**
 * Probe browser connection and Sales Navigator authentication.
 * Never throws - always returns a structured status object.
 */
export async function probeSessionStatus(): Promise<SessionStatus> {
  const stored = getStoredNavigatorConfig();
  const authMethod = stored?.auth.method ?? "unknown";

  if (!stored) {
    return {
      authMethod: "unknown",
      browserConnected: false,
      authenticated: false,
      hint:
        "Navigator is not configured. Check LSN_AUTH_METHOD and related LSN_* variables.",
      error: "missing_config",
    };
  }

  try {
    const nav = await ensureNavigator();
    let authenticated = false;
    try {
      authenticated = await nav.checkAuth();
    } catch (error) {
      return {
        authMethod,
        browserConnected: nav.isConnected(),
        authenticated: false,
        hint: authFailureHint(stored.auth, error),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      authMethod,
      browserConnected: nav.isConnected() || isNavigatorReady(),
      authenticated,
      hint: authenticated
        ? undefined
        : authFailureHint(
            stored.auth,
            new Error("Not authenticated to LinkedIn Sales Navigator")
          ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // initialize()/ensureNavigator already embed actionable hints
    return {
      authMethod,
      browserConnected: false,
      authenticated: false,
      hint: message.includes("linkedin_session_status")
        ? message
        : authFailureHint(stored.auth, error),
      error: message,
    };
  }
}

/**
 * Register session tools with the MCP server.
 */
export function registerSessionTools(server: McpServer): void {
  server.tool(
    "linkedin_session_status",
    "Check LinkedIn Sales Navigator browser connection and authentication. " +
      "Call this before other tools to verify the session (auth method, browser connected, authenticated). " +
      "Triggers a lazy browser connect if not yet connected.",
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
