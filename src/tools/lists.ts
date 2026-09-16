/**
 * Lead list management tools for LinkedIn Sales Navigator.
 *
 * Create, view, and manage lead lists.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureNavigator } from "../browser/navigator.js";
import { LIST_SELECTORS, WAIT_CONDITIONS } from "../browser/selectors.js";
import { queryAll, queryFirst, textOfFirst } from "../browser/query.js";
import type { LeadList } from "../types/index.js";

/**
 * Parse lead lists from the lists page.
 */
async function parseLeadLists(): Promise<LeadList[]> {
  const nav = await ensureNavigator();
  const page = nav.getPage();

  await nav.waitForSelector(LIST_SELECTORS.LISTS_CONTAINER, WAIT_CONDITIONS.SEARCH_RESULTS_TIMEOUT);

  const listElements = await queryAll(page, LIST_SELECTORS.LIST_ITEM);
  const lists: LeadList[] = [];

  for (const listEl of listElements) {
    try {
      const name = (await textOfFirst(listEl, LIST_SELECTORS.LIST_NAME)) || "Unnamed List";
      const countText = (await textOfFirst(listEl, LIST_SELECTORS.LIST_COUNT)) || "0";
      const leadCount = parseInt(countText.replace(/[^0-9]/g, ""), 10) || 0;

      // Extract list ID from link or data attribute
      const linkEl = await listEl.$("a");
      const href = await linkEl?.getAttribute("href");
      const id = href?.match(/\/lists\/people\/([^/?]+)/)?.[1] || "";

      lists.push({ id, name, leadCount });
    } catch {
      continue;
    }
  }

  return lists;
}

/**
 * Register list tools with the MCP server.
 */
export function registerListTools(server: McpServer): void {
  server.tool(
    "linkedin_list_lead_lists",
    "List all lead lists in LinkedIn Sales Navigator",
    {},
    async () => {
      try {
        const nav = await ensureNavigator();

        // Navigate to lists page
        await nav.goToLists();

        // Parse lists
        const lists = await parseLeadLists();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ lists, total: lists.length }, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing lead lists: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "linkedin_create_lead_list",
    "Create a new lead list in LinkedIn Sales Navigator",
    {
      name: z.string().describe("Name for the new lead list"),
    },
    async (params) => {
      try {
        const nav = await ensureNavigator();
        const page = nav.getPage();

        // Navigate to lists page
        await nav.goToLists();
        await nav.humanDelay();

        // Click create list button (opens the "Create lead list" modal)
        const createButton = await queryFirst(page, LIST_SELECTORS.CREATE_LIST_BUTTON);
        if (!createButton) {
          throw new Error("Create list button not found");
        }
        await nav.clickAndSettle(createButton);

        // Enter list name
        const nameInput = await queryFirst(page, LIST_SELECTORS.LIST_NAME_INPUT);
        if (!nameInput) {
          throw new Error("List name input not found");
        }
        await nameInput.fill(params.name);
        // The modal's "Create" button starts disabled and only enables
        // once the name field's async validation clears (issue #2:
        // clicking it immediately after fill() hit it while still
        // disabled and the click silently did nothing).
        await nav.getPage().waitForTimeout(WAIT_CONDITIONS.BUTTON_STATE_SETTLE);

        // Save list
        const saveButton = await queryFirst(page, LIST_SELECTORS.LIST_SAVE_BUTTON);
        if (!saveButton) {
          throw new Error("Save list button not found");
        }
        const isDisabled = await saveButton.evaluate(
          (el) => (el as HTMLButtonElement).disabled
        );
        if (isDisabled) {
          throw new Error(
            "Create button is still disabled after entering the list name - " +
              "the name may be empty, too long, or duplicate an existing list."
          );
        }
        await nav.clickAndSettle(saveButton, 1500);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `Lead list "${params.name}" created successfully`,
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
              text: `Error creating lead list: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
