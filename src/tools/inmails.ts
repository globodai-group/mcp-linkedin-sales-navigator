/**
 * InMail tools for LinkedIn Sales Navigator.
 *
 * Send InMails and manage messaging.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureNavigator } from "../browser/navigator.js";
import { INMAIL_SELECTORS, PROFILE_SELECTORS, WAIT_CONDITIONS } from "../browser/selectors.js";
import { queryFirst } from "../browser/query.js";
import type { InMailResult } from "../types/index.js";

/**
 * Register InMail tools with the MCP server.
 */
export function registerInMailTools(server: McpServer): void {
  server.tool(
    "linkedin_send_inmail",
    "Send an InMail message to a lead on LinkedIn Sales Navigator. Requires available InMail credits.",
    {
      profileUrl: z
        .string()
        .describe("Sales Navigator profile URL of the recipient"),
      subject: z
        .string()
        .max(200)
        .describe("InMail subject line (max 200 characters)"),
      body: z
        .string()
        .max(1900)
        .describe("InMail message body (max 1900 characters)"),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, compose the InMail but don't send it (for review)"),
    },
    async (params) => {
      try {
        const nav = await ensureNavigator();
        const page = nav.getPage();

        // Navigate to profile
        await nav.goToProfile(params.profileUrl);
        await nav.humanDelay();

        // Click the InMail/Message button. Its accessible name reads
        // "Message <name>" when free-to-contact and mentions "InMail"
        // when it will consume a credit - SEND_INMAIL_BUTTON matches both.
        const inmailButton = await queryFirst(page, PROFILE_SELECTORS.SEND_INMAIL_BUTTON);
        if (!inmailButton) {
          throw new Error(
            "InMail/Message button not found. The lead may not accept InMails or you may be out of credits."
          );
        }

        await nav.clickAndSettle(inmailButton);

        // Wait for compose modal
        const modalAppeared = await nav.waitForSelector(
          INMAIL_SELECTORS.COMPOSE_MODAL,
          WAIT_CONDITIONS.PROFILE_LOAD_TIMEOUT
        );
        if (!modalAppeared) {
          throw new Error("InMail compose modal did not appear");
        }

        // Fill in subject
        const subjectInput = await queryFirst(page, INMAIL_SELECTORS.SUBJECT_INPUT);
        if (subjectInput) {
          await subjectInput.fill(params.subject);
          await nav.humanDelay(200, 500);
        }

        // Fill in body
        const bodyInput = await queryFirst(page, INMAIL_SELECTORS.BODY_INPUT);
        if (bodyInput) {
          await bodyInput.fill(params.body);
          await nav.humanDelay(300, 700);
        }

        // Check for dry run
        if (params.dryRun) {
          const result: InMailResult = {
            success: true,
            error: "Dry run - InMail composed but not sent. Review in browser.",
          };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Send the InMail
        const sendButton = await queryFirst(page, INMAIL_SELECTORS.SEND_BUTTON);
        if (!sendButton) {
          throw new Error("Send button not found in compose modal");
        }

        await nav.clickAndSettle(sendButton, 1500);
        await nav.humanDelay(1000, 2000);

        // Primary success signal: the compose form closes once the
        // message is away. This is far more reliable than looking for
        // an error element, because the compose panel also renders
        // unrelated notices (e.g. the CRM "you are disconnected"
        // alert) that are present whether or not the send succeeded.
        const composeGone = !(await queryFirst(page, INMAIL_SELECTORS.COMPOSE_MODAL));

        const successEl = await queryFirst(page, INMAIL_SELECTORS.SEND_SUCCESS);
        const errorEl = composeGone
          ? null
          : await queryFirst(page, INMAIL_SELECTORS.SEND_ERROR);

        if (errorEl) {
          const errorText = await errorEl.textContent();
          const result: InMailResult = {
            success: false,
            error: errorText?.trim() || "Failed to send InMail",
          };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: true,
          };
        }

        // Check remaining credits. The label reads "InMail credits: N left",
        // so pull the number out rather than parsing from the start.
        const creditsText = await nav.safeTextContent(INMAIL_SELECTORS.CREDITS_COUNT);
        const creditsMatch = creditsText?.match(/InMail credits:\s*(\d+)/i) ?? creditsText?.match(/\d+/);
        const remainingCredits = creditsMatch ? parseInt(creditsMatch[creditsMatch.length - 1], 10) : undefined;

        const result: InMailResult = {
          success: composeGone || !!successEl || !errorEl,
          remainingCredits,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error sending InMail: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
