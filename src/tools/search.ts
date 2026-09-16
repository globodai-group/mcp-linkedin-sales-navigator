/**
 * Search tools for LinkedIn Sales Navigator.
 *
 * Provides lead and account search with filters.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureNavigator } from "../browser/navigator.js";
import { SEARCH_SELECTORS, URLS, WAIT_CONDITIONS } from "../browser/selectors.js";
import {
  queryAll,
  queryFirst,
  textOfFirst,
  normalizeWhitespace,
  stripSuffix,
} from "../browser/query.js";
import type { LeadProfile, SearchResult } from "../types/index.js";

/**
 * Parse search results from the current page.
 */
async function parseSearchResults(): Promise<SearchResult> {
  const nav = await ensureNavigator();
  const page = nav.getPage();

  // Wait for results to load
  await nav.waitForSelector(SEARCH_SELECTORS.RESULTS_CONTAINER, WAIT_CONDITIONS.SEARCH_RESULTS_TIMEOUT);

  // Get total results count
  const totalText = await nav.safeTextContent(SEARCH_SELECTORS.TOTAL_RESULTS);
  const totalResults = totalText ? parseInt(totalText.replace(/[^0-9]/g, ""), 10) || 0 : 0;

  // Parse individual results
  const resultElements = await queryAll(page, SEARCH_SELECTORS.RESULT_ITEM);
  const leads: LeadProfile[] = [];

  for (const element of resultElements) {
    try {
      const linkEl = await queryFirst(element, SEARCH_SELECTORS.RESULT_LINK);

      const fullName = (await textOfFirst(element, SEARCH_SELECTORS.RESULT_NAME)) || "Unknown";
      const nameParts = fullName.split(" ");
      const profileLink = (await linkEl?.getAttribute("href")) || "";
      const company = (await textOfFirst(element, SEARCH_SELECTORS.RESULT_COMPANY)) || "";
      const title = (await textOfFirst(element, SEARCH_SELECTORS.RESULT_TITLE)) || "";

      leads.push({
        leadId: extractLeadId(profileLink),
        fullName,
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        // Weaker title fallbacks can return the whole lockup subtitle,
        // which appends the company and collapses to ragged whitespace.
        title: normalizeWhitespace(stripSuffix(title, company)),
        company,
        location: (await textOfFirst(element, SEARCH_SELECTORS.RESULT_LOCATION)) || "",
        salesNavUrl: profileLink.startsWith("http")
          ? profileLink
          : `https://www.linkedin.com${profileLink}`,
      });

      await nav.humanDelay(100, 300);
    } catch {
      // Skip malformed result entries
      continue;
    }
  }

  // Calculate pagination
  const currentPage = getCurrentPage(page.url());
  const totalPages = Math.ceil(totalResults / 25); // 25 results per page

  return { leads, totalResults, currentPage, totalPages };
}

/**
 * Extract lead ID from a Sales Navigator profile URL.
 */
function extractLeadId(url: string): string {
  const match = url.match(/\/lead\/([^,/?]+)/);
  return match ? match[1] : "";
}

/**
 * Get current page number from URL.
 */
function getCurrentPage(url: string): number {
  const match = url.match(/page=(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Build a search URL with filters.
 */
function buildSearchUrl(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();

  if (filters.keywords) params.set("keywords", String(filters.keywords));
  if (filters.title) params.set("titleIncluded", String(filters.title));
  if (filters.company) params.set("companyIncluded", String(filters.company));
  if (filters.location) params.set("geoIncluded", String(filters.location));
  if (filters.industry) params.set("industryIncluded", String(filters.industry));
  if (filters.seniorityLevel) params.set("seniorityIncluded", String(filters.seniorityLevel));
  if (filters.companySize) params.set("companySize", String(filters.companySize));
  if (filters.function) params.set("functionIncluded", String(filters.function));
  if (filters.page && Number(filters.page) > 1) params.set("page", String(filters.page));

  const queryString = params.toString();
  return queryString ? `${URLS.SEARCH_LEADS}?${queryString}` : URLS.SEARCH_LEADS;
}

/**
 * Register search tools with the MCP server.
 */
export function registerSearchTools(server: McpServer): void {
  server.tool(
    "linkedin_search_leads",
    "Search for leads on LinkedIn Sales Navigator with filters (title, company, location, industry, seniority, etc.)",
    {
      keywords: z.string().optional().describe("Search keywords"),
      title: z.string().optional().describe("Job title filter"),
      company: z.string().optional().describe("Company name filter"),
      location: z.string().optional().describe("Geographic location filter"),
      industry: z.string().optional().describe("Industry filter"),
      seniorityLevel: z
        .string()
        .optional()
        .describe('Seniority level (e.g., "VP", "Director", "Manager", "C-Suite")'),
      companySize: z
        .string()
        .optional()
        .describe('Company headcount range (e.g., "51-200", "201-500", "1001-5000")'),
      function: z
        .string()
        .optional()
        .describe('Job function (e.g., "Sales", "Engineering", "Marketing")'),
      page: z.number().optional().default(1).describe("Page number (1-indexed)"),
    },
    async (params) => {
      try {
        const nav = await ensureNavigator();

        // Build and navigate to search URL
        const searchUrl = buildSearchUrl(params);
        await nav.navigateTo(searchUrl);
        await nav.getPage().waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);

        // Parse results
        const results = await parseSearchResults();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching leads: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
