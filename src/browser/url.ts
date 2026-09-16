/**
 * Validation for user-supplied Sales Navigator URLs and list IDs.
 *
 * Navigation must never follow a host that merely contains "/sales/"
 * (e.g. https://evil.test/sales/ or http://127.0.0.1/sales/).
 */

import { z } from "zod";

const SALES_NAV_HOSTS = new Set(["www.linkedin.com", "linkedin.com"]);

export const LIST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class InvalidSalesNavigatorUrlError extends Error {
  constructor(
    message = "URL must be an https Sales Navigator URL on www.linkedin.com or linkedin.com with a pathname starting with /sales/"
  ) {
    super(message);
    this.name = "InvalidSalesNavigatorUrlError";
  }
}

export class InvalidListIdError extends Error {
  constructor(
    message = "listId must contain only letters, numbers, underscores, and hyphens"
  ) {
    super(message);
    this.name = "InvalidListIdError";
  }
}

/**
 * Parse and accept only https LinkedIn Sales Navigator URLs.
 */
export function parseSalesNavigatorUrl(value: string): URL {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidSalesNavigatorUrlError("Invalid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new InvalidSalesNavigatorUrlError(
      "URL must use https://www.linkedin.com/sales/... or https://linkedin.com/sales/..."
    );
  }

  if (!SALES_NAV_HOSTS.has(parsed.hostname)) {
    throw new InvalidSalesNavigatorUrlError(
      "URL hostname must be www.linkedin.com or linkedin.com"
    );
  }

  if (parsed.username || parsed.password) {
    throw new InvalidSalesNavigatorUrlError("URL must not include credentials");
  }

  if (!parsed.pathname.startsWith("/sales/")) {
    throw new InvalidSalesNavigatorUrlError(
      "URL pathname must start with /sales/"
    );
  }

  return parsed;
}

export function assertSalesNavigatorUrl(value: string): string {
  parseSalesNavigatorUrl(value);
  return value.trim();
}

export function isSalesNavigatorUrl(value: string): boolean {
  try {
    parseSalesNavigatorUrl(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Login / checkpoint / authwall URLs. Used to fail auth checks without
 * waiting for Sales Navigator chrome that will never render.
 */
export function isLinkedInAuthFailureUrl(url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the raw string
  }
  const lower = path.toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/checkpoint") ||
    lower.includes("/authwall") ||
    lower.includes("/uas/")
  );
}

export function assertListId(listId: string): string {
  if (!LIST_ID_PATTERN.test(listId)) {
    throw new InvalidListIdError();
  }
  return listId;
}

export const salesNavigatorUrlSchema = z.string().superRefine((value, ctx) => {
  try {
    parseSalesNavigatorUrl(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        error instanceof Error
          ? error.message
          : "Invalid Sales Navigator URL",
    });
  }
});

export const listIdSchema = z.string().regex(LIST_ID_PATTERN, {
  message: "listId must contain only letters, numbers, underscores, and hyphens",
});
