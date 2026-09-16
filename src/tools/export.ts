/**
 * Export tools for LinkedIn Sales Navigator.
 *
 * Export lead data from lists or search results to JSON/CSV.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureNavigator } from "../browser/navigator.js";
import {
  SEARCH_SELECTORS,
  LIST_SELECTORS,
  URLS,
  WAIT_CONDITIONS,
} from "../browser/selectors.js";
import {
  queryAll,
  queryFirst,
  textOfFirst,
  normalizeWhitespace,
  stripSuffix,
} from "../browser/query.js";
import type { LeadProfile } from "../types/index.js";

/**
 * Collect leads from the current page (search results or list detail).
 */
async function collectLeadsFromPage(): Promise<LeadProfile[]> {
  const nav = await ensureNavigator();
  const page = nav.getPage();

  const resultSelector =
    page.url().includes("/search/")
      ? SEARCH_SELECTORS.RESULT_ITEM
      : LIST_SELECTORS.LIST_LEAD_ITEM;

  const elements = await queryAll(page, resultSelector);
  const leads: LeadProfile[] = [];

  for (const el of elements) {
    try {
      const linkEl = await queryFirst(el, SEARCH_SELECTORS.RESULT_LINK);

      const fullName = (await textOfFirst(el, SEARCH_SELECTORS.RESULT_NAME)) || "Unknown";
      const nameParts = fullName.split(" ");
      const profileLink = (await linkEl?.getAttribute("href")) || "";
      const company = (await textOfFirst(el, SEARCH_SELECTORS.RESULT_COMPANY)) || "";
      const title = (await textOfFirst(el, SEARCH_SELECTORS.RESULT_TITLE)) || "";

      leads.push({
        leadId: profileLink.match(/\/lead\/([^,/?]+)/)?.[1] || "",
        fullName,
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        // Weaker title fallbacks can return the whole lockup subtitle,
        // which appends the company and collapses to ragged whitespace.
        title: normalizeWhitespace(stripSuffix(title, company)),
        company,
        location: (await textOfFirst(el, SEARCH_SELECTORS.RESULT_LOCATION)) || "",
        salesNavUrl: profileLink.startsWith("http")
          ? profileLink
          : `https://www.linkedin.com${profileLink}`,
      });
    } catch {
      continue;
    }
  }

  return leads;
}

/**
 * Collect leads across multiple pages.
 */
async function collectLeadsMultiPage(limit: number): Promise<LeadProfile[]> {
  const nav = await ensureNavigator();
  const page = nav.getPage();
  const allLeads: LeadProfile[] = [];

  while (allLeads.length < limit) {
    const pageLeads = await collectLeadsFromPage();
    allLeads.push(...pageLeads);

    if (allLeads.length >= limit) break;

    // Try to go to next page
    const nextButton = await page.$(SEARCH_SELECTORS.PAGINATION_NEXT);
    if (!nextButton) break;

    const isDisabled = await nextButton.getAttribute("disabled");
    if (isDisabled !== null) break;

    await nextButton.click();
    await page.waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);
    await nav.waitForSelector(
      SEARCH_SELECTORS.RESULTS_CONTAINER,
      WAIT_CONDITIONS.SEARCH_RESULTS_TIMEOUT
    );
    await nav.humanDelay();
  }

  return allLeads.slice(0, limit);
}

/**
 * Convert leads to CSV format.
 */
function leadsToCSV(
  leads: LeadProfile[],
  fields?: (keyof LeadProfile)[]
): string {
  const defaultFields: (keyof LeadProfile)[] = [
    "fullName",
    "firstName",
    "lastName",
    "title",
    "company",
    "location",
    "salesNavUrl",
  ];
  const selectedFields = fields || defaultFields;

  const escapeCSV = (value: unknown): string => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = selectedFields.join(",");
  const rows = leads.map((lead) =>
    selectedFields.map((field) => escapeCSV(lead[field])).join(",")
  );

  return [header, ...rows].join("\n");
}

/**
 * Register export tools with the MCP server.
 */
export function registerExportTools(server: McpServer): void {
  server.tool(
    "linkedin_export_leads",
    "Export leads from LinkedIn Sales Navigator search results or a specific list to JSON or CSV format",
    {
      source: z
        .enum(["current_search", "list"])
        .describe('Export from current search results ("current_search") or a specific list ("list")'),
      listId: z
        .string()
        .optional()
        .describe("List ID to export from (required if source is 'list')"),
      format: z
        .enum(["json", "csv"])
        .optional()
        .default("json")
        .describe("Export format"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Fields to include (default: fullName, firstName, lastName, title, company, location, salesNavUrl)"
        ),
      limit: z
        .number()
        .optional()
        .default(25)
        .describe("Maximum number of leads to export (default: 25, max: 250)"),
    },
    async (params) => {
      try {
        const nav = await ensureNavigator();
        const effectiveLimit = Math.min(params.limit, 250);

        if (params.source === "list") {
          if (!params.listId) {
            throw new Error("listId is required when source is 'list'");
          }
          await nav.navigateTo(`${URLS.LEAD_LISTS}/${params.listId}`);
          await nav
            .getPage()
            .waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);
        }

        // Collect leads
        const leads = await collectLeadsMultiPage(effectiveLimit);

        // Format output
        let output: string;
        if (params.format === "csv") {
          output = leadsToCSV(
            leads,
            params.fields as (keyof LeadProfile)[] | undefined
          );
        } else {
          const exportData = {
            exportedAt: new Date().toISOString(),
            source: params.source,
            totalExported: leads.length,
            leads,
          };
          output = JSON.stringify(exportData, null, 2);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: output,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error exporting leads: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
