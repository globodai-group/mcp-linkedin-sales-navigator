#!/usr/bin/env node

/**
 * MCP Server for LinkedIn Sales Navigator
 *
 * Browser automation server that uses Playwright to control
 * LinkedIn Sales Navigator via an authenticated browser session.
 *
 * @see https://github.com/globodai-group/mcp-linkedin-sales-navigator
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchTools } from "./tools/search.js";
import { registerLeadTools } from "./tools/leads.js";
import { registerInMailTools } from "./tools/inmails.js";
import { registerListTools } from "./tools/lists.js";
import { registerExportTools } from "./tools/export.js";
import { configureNavigator, ensureNavigator, closeNavigator } from "./browser/navigator.js";
import type { AuthConfig, BrowserConfig } from "./types/index.js";

/**
 * Read configuration from environment variables.
 */
function getConfig(): { browser: Partial<BrowserConfig>; auth: AuthConfig } {
  const authMethod = (process.env.LSN_AUTH_METHOD || "cdp") as AuthConfig["method"];

  const auth: AuthConfig = {
    method: authMethod,
    cookiesPath: process.env.LSN_COOKIES_PATH,
    cdpEndpoint: process.env.LSN_CDP_ENDPOINT || "http://localhost:9222",
    userDataDir: process.env.LSN_USER_DATA_DIR,
  };

  const browser: Partial<BrowserConfig> = {
    headless: process.env.LSN_HEADLESS === "true",
    viewportWidth: process.env.LSN_VIEWPORT_WIDTH
      ? parseInt(process.env.LSN_VIEWPORT_WIDTH, 10)
      : 1280,
    viewportHeight: process.env.LSN_VIEWPORT_HEIGHT
      ? parseInt(process.env.LSN_VIEWPORT_HEIGHT, 10)
      : 900,
    navigationTimeout: process.env.LSN_NAVIGATION_TIMEOUT
      ? parseInt(process.env.LSN_NAVIGATION_TIMEOUT, 10)
      : 30000,
    actionTimeout: process.env.LSN_ACTION_TIMEOUT
      ? parseInt(process.env.LSN_ACTION_TIMEOUT, 10)
      : 10000,
  };

  return { browser, auth };
}

async function main(): Promise<void> {
  const config = getConfig();

  // Create MCP server
  const server = new McpServer({
    name: "linkedin-sales-navigator",
    version: "0.1.0",
  });

  // Register all tools
  registerSearchTools(server);
  registerLeadTools(server);
  registerInMailTools(server);
  registerListTools(server);
  registerExportTools(server);

  // Make the browser config available to the lazy connection path, so a
  // tool arriving before (or after a failed) startup connection can still
  // connect on its own.
  configureNavigator(config.browser, config.auth);

  // Graceful shutdown
  const shutdown = async () => {
    console.error("[LSN] Shutting down...");
    await closeNavigator();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[LSN] LinkedIn Sales Navigator MCP server started");

  // Warm the browser connection in the background. Failure here is not
  // fatal - the browser may simply not be running yet, and each tool
  // connects on demand via ensureNavigator().
  ensureNavigator().then(
    () => console.error("[LSN] Browser connected and authenticated"),
    (error: unknown) =>
      console.error(
        "[LSN] Browser not connected at startup; tools will connect on first use:",
        error instanceof Error ? error.message : error
      )
  );
}

main().catch((error) => {
  console.error("[LSN] Fatal error:", error);
  process.exit(1);
});
