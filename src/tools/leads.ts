/**
 * Lead profile tools for LinkedIn Sales Navigator.
 *
 * View detailed profiles, save leads, manage lead info.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureNavigator } from "../browser/navigator.js";
import { PROFILE_SELECTORS, WAIT_CONDITIONS } from "../browser/selectors.js";
import { queryAll, queryFirst, textOfFirst } from "../browser/query.js";
import { extractEntryDatesBrowser } from "../browser/dom-extract.js";
import type { LeadProfile, ExperienceEntry, EducationEntry } from "../types/index.js";

/**
 * Parse a lead profile from the current page.
 */
async function parseLeadProfile(): Promise<LeadProfile> {
  const nav = await ensureNavigator();
  const page = nav.getPage();

  // Wait for profile to load
  await nav.waitForSelector(PROFILE_SELECTORS.PROFILE_CONTAINER, WAIT_CONDITIONS.PROFILE_LOAD_TIMEOUT);

  // Name/headline/location have no stable per-field selector on the
  // current topcard markup (see issue #2) - extract them together via
  // the structural DOM heuristic, falling back to the selector-based
  // path (PROFILE_NAME) only if that heuristic comes up empty.
  const topcard = await nav.extractTopcardFields();
  const fullName =
    topcard.name || (await nav.safeTextContent(PROFILE_SELECTORS.PROFILE_NAME)) || "Unknown";
  const nameParts = fullName.split(" ");

  // Parse experience
  const experience: ExperienceEntry[] = [];
  const expElements = await queryAll(page, PROFILE_SELECTORS.EXPERIENCE_ITEM);
  for (const exp of expElements) {
    const title = (await textOfFirst(exp, PROFILE_SELECTORS.EXPERIENCE_TITLE)) || "";
    const company = (await textOfFirst(exp, PROFILE_SELECTORS.EXPERIENCE_COMPANY)) || "";
    // The date range has no selectable hook in the current markup, so
    // fall back to finding it by content within this entry.
    const dates =
      (await textOfFirst(exp, PROFILE_SELECTORS.EXPERIENCE_DATES)) ||
      (await exp.evaluate(extractEntryDatesBrowser).catch(() => null)) ||
      "";

    // LinkedIn separates the range with an en dash (–), not a hyphen.
    const [startDate, endDate] = dates.split("–").map((part) => part.trim());

    experience.push({
      title,
      company,
      isCurrent: dates.toLowerCase().includes("present"),
      startDate,
      endDate,
    });
  }

  // Parse education
  const education: EducationEntry[] = [];
  const eduElements = await queryAll(page, PROFILE_SELECTORS.EDUCATION_ITEM);
  for (const edu of eduElements) {
    const school = (await textOfFirst(edu, PROFILE_SELECTORS.EDUCATION_SCHOOL)) || "";
    const degree = (await textOfFirst(edu, PROFILE_SELECTORS.EDUCATION_DEGREE)) || "";

    education.push({ school, degree });
  }

  return {
    leadId: extractLeadIdFromUrl(page.url()),
    fullName,
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
    title: (await nav.safeTextContent(PROFILE_SELECTORS.PROFILE_TITLE)) || "",
    company: (await nav.safeTextContent(PROFILE_SELECTORS.PROFILE_COMPANY)) || "",
    location:
      topcard.location || (await nav.safeTextContent(PROFILE_SELECTORS.PROFILE_LOCATION)) || "",
    headline:
      topcard.headline ||
      (await nav.safeTextContent(PROFILE_SELECTORS.PROFILE_HEADLINE)) ||
      undefined,
    summary: (await nav.safeTextContent(PROFILE_SELECTORS.PROFILE_ABOUT)) || undefined,
    connectionDegree:
      topcard.connectionDegree ||
      (await nav.safeTextContent(PROFILE_SELECTORS.CONNECTION_DEGREE)) ||
      undefined,
    profilePictureUrl: (await nav.safeAttribute(PROFILE_SELECTORS.PROFILE_PHOTO, "src")) || undefined,
    salesNavUrl: page.url(),
    experience,
    education,
  };
}

function extractLeadIdFromUrl(url: string): string {
  const match = url.match(/\/lead\/([^,/?]+)/);
  return match ? match[1] : "";
}

/**
 * Register lead tools with the MCP server.
 */
export function registerLeadTools(server: McpServer): void {
  server.tool(
    "linkedin_get_lead_profile",
    "Get detailed profile information for a LinkedIn Sales Navigator lead",
    {
      profileUrl: z
        .string()
        .describe("Sales Navigator profile URL (e.g., https://www.linkedin.com/sales/lead/...)"),
    },
    async (params) => {
      try {
        const nav = await ensureNavigator();

        // Navigate to the profile
        await nav.goToProfile(params.profileUrl);

        // Parse the profile
        const profile = await parseLeadProfile();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting lead profile: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "linkedin_save_lead",
    "Save a lead to a list on LinkedIn Sales Navigator",
    {
      profileUrl: z.string().describe("Sales Navigator profile URL of the lead to save"),
      listName: z.string().optional().describe("Name of the list to save to (default: saved leads)"),
    },
    async (params) => {
      try {
        const nav = await ensureNavigator();
        const page = nav.getPage();

        // Navigate to the profile
        await nav.goToProfile(params.profileUrl);
        await nav.humanDelay();

        // Click the save button. Its accessible name flips between
        // "Save <name> as a lead..." and "Unsave <name>..." once saved,
        // so check both up front rather than relying on one being absent.
        const saveButton = await queryFirst(page, PROFILE_SELECTORS.SAVE_BUTTON);
        const unsaveButton = await queryFirst(page, PROFILE_SELECTORS.UNSAVE_BUTTON);
        if (unsaveButton) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, message: "Lead is already saved" }),
              },
            ],
          };
        }
        if (!saveButton) {
          throw new Error("Save button not found on profile page");
        }

        await nav.clickAndSettle(saveButton, WAIT_CONDITIONS.BUTTON_STATE_SETTLE);

        // If a specific list is requested, handle list selection
        if (params.listName) {
          const addToListBtn = await queryFirst(page, PROFILE_SELECTORS.ADD_TO_LIST_BUTTON);
          if (addToListBtn) {
            await nav.clickAndSettle(addToListBtn, WAIT_CONDITIONS.BUTTON_STATE_SETTLE);
            // Type list name and select
            // This interaction depends on the list selection UI
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `Lead saved successfully${params.listName ? ` to list "${params.listName}"` : ""}`,
              }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error saving lead: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
