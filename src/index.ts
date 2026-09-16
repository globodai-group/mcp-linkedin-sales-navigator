#!/usr/bin/env node

/**
 * MCP Server for LinkedIn Sales Navigator
 *
 * Browser automation server that uses Playwright to control
 * LinkedIn Sales Navigator via an authenticated browser session.
 *
 * @see https://github.com/globodai-group/mcp-linkedin-sales-navigator
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchTools } from "./tools/search.js";
import { registerLeadTools } from "./tools/leads.js";
import { registerInMailTools } from "./tools/inmails.js";
import { registerListTools } from "./tools/lists.js";
import { registerExportTools } from "./tools/export.js";
import { registerSessionTools } from "./tools/session.js";
import { configureNavigator, ensureAttached, closeNavigator } from "./browser/navigator.js";
import { parseConfig } from "./config.js";

const require = createRequire(import.meta.url);

function readPackageVersion(): string {
  try {
    const pkg = require("../package.json") as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const { config, errors } = parseConfig(process.env);

  for (const message of errors) {
    console.error(`[LSN] Config: ${message}`);
  }
  if (errors.length > 0) {
    console.error(
      `[LSN] ${errors.length} config issue(s) detected; tools may fail until LSN_* env vars are fixed. Call linkedin_session_status to diagnose.`
    );
  }

  // Create MCP server
  const server = new McpServer({
    name: "linkedin-sales-navigator",
    version: readPackageVersion(),
  });

  // Register all tools
  registerSessionTools(server);
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

  // Warm the browser attachment in the background without navigating.
  // Failure here is not fatal - the browser may simply not be running yet,
  // and each tool connects on demand via ensureNavigator().
  ensureAttached().then(
    () => console.error("[LSN] Browser attached"),
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
