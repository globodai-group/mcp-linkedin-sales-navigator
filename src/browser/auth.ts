/**
 * Authentication module for LinkedIn Sales Navigator.
 *
 * Supports:
 * - Existing browser session via CDP (Chrome DevTools Protocol)
 * - Cookie-based session restoration
 * - User data directory with existing login
 *
 * ⚠️ This module does NOT store or handle credentials directly.
 * Authentication relies on an already-authenticated browser session.
 */

import { type Page, type BrowserContext } from "playwright";
import { AUTH_SELECTORS, URLS, WAIT_CONDITIONS } from "./selectors.js";
import { anyOf } from "./query.js";
import {
  isLinkedInAuthFailureUrl,
  isSalesNavigatorUrl,
} from "./url.js";
import type { AuthConfig } from "../types/index.js";

/** Combined presence check: header or profile icon, order does not matter. */
const LOGGED_IN_MARKERS = anyOf([
  AUTH_SELECTORS.SALES_NAV_HEADER,
  AUTH_SELECTORS.PROFILE_ICON,
]);

/** Bound for the logged-in marker wait (one retry may add a short extra wait). */
const AUTH_MARKER_TIMEOUT_MS = 8000;

/**
 * Check whether the current page (no navigation) shows an
 * authenticated Sales Navigator session, without navigating away from
 * wherever the page currently is.
 */
async function checkAuthIndicators(page: Page): Promise<boolean> {
  // Fail fast: login / checkpoint / authwall means the session is dead.
  if (isLinkedInAuthFailureUrl(page.url())) return false;

  const challenge = await page.$(AUTH_SELECTORS.CHALLENGE_PAGE).catch(() => null);
  if (challenge) return false;

  // Sales Navigator is an Ember SPA whose global nav can render a few
  // seconds after DOMContentLoaded. One combined wait covers any
  // logged-in marker; a single retry handles a mid-check client-side
  // navigation without stacking 10s waits per selector.
  const urlBefore = page.url();
  const found = await page
    .waitForSelector(LOGGED_IN_MARKERS, { timeout: AUTH_MARKER_TIMEOUT_MS })
    .catch(() => null);
  if (found) return true;
  if (isLinkedInAuthFailureUrl(page.url())) return false;

  // At most one retry, and only if the document actually changed.
  if (page.url() === urlBefore) return false;
  const retry = await page
    .waitForSelector(LOGGED_IN_MARKERS, { timeout: 2000 })
    .catch(() => null);
  return retry !== null;
}

/**
 * Inspect the current page only. Never navigates.
 *
 * Returns false immediately on login/checkpoint/authwall or when the
 * tab is not a Sales Navigator URL (so a google.com tab does not wait 8s).
 */
export async function inspectCurrentAuth(page: Page): Promise<boolean> {
  const url = page.url();
  if (isLinkedInAuthFailureUrl(url)) return false;
  if (!isSalesNavigatorUrl(url)) return false;
  return checkAuthIndicators(page);
}

/**
 * Check if the current page has an active LinkedIn Sales Navigator
 * session, navigating to the Sales Navigator home page first.
 *
 * Prefer `navigateToSalesNavigator()` when you also need the initial
 * navigation - it reuses this same indicator check without triggering a
 * second full-page reload of an already-loaded SPA page.
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    await page.goto(URLS.HOME, {
      waitUntil: "domcontentloaded",
      timeout: WAIT_CONDITIONS.PROFILE_LOAD_TIMEOUT,
    });
    return await checkAuthIndicators(page);
  } catch {
    return false;
  }
}

/**
 * Restore a LinkedIn session from exported cookies.
 */
export async function restoreSessionFromCookies(
  context: BrowserContext,
  cookiesJson: string
): Promise<void> {
  const cookies = JSON.parse(cookiesJson);

  if (!Array.isArray(cookies)) {
    throw new Error("Cookies must be a JSON array of cookie objects");
  }

  // Validate cookie format
  for (const cookie of cookies) {
    if (!cookie.name || !cookie.domain) {
      throw new Error(
        "Each cookie must have at least 'name' and 'domain' fields"
      );
    }
  }

  await context.addCookies(cookies);
}

/**
 * Wait for the user to manually complete authentication.
 * Useful when 2FA or CAPTCHA is required.
 */
export async function waitForManualAuth(
  page: Page,
  timeoutMs: number = 120000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const authenticated = await isAuthenticated(page);
    if (authenticated) return true;

    // Wait 2 seconds before checking again
    await page.waitForTimeout(2000);
  }

  return false;
}

/**
 * Navigate to Sales Navigator and verify access.
 */
export async function navigateToSalesNavigator(page: Page): Promise<boolean> {
  await page.goto(URLS.HOME, {
    waitUntil: "domcontentloaded",
    timeout: WAIT_CONDITIONS.SEARCH_RESULTS_TIMEOUT,
  });

  // Check indicators on the page we just loaded rather than calling
  // `isAuthenticated()`, which would navigate to the same URL a second
  // time (see issue #2). The combined marker wait covers SPA paint;
  // skip networkidle + a fixed delay so an expired /sales/ session
  // fails in ~8s instead of ~77s.
  if (isLinkedInAuthFailureUrl(page.url())) return false;
  return checkAuthIndicators(page);
}

/**
 * Validate the authentication configuration.
 */
export function validateAuthConfig(config: AuthConfig): void {
  switch (config.method) {
    case "cookies":
      if (!config.cookiesPath) {
        throw new Error(
          "cookiesPath is required for cookie-based authentication"
        );
      }
      break;
    case "cdp":
      if (!config.cdpEndpoint) {
        throw new Error(
          "cdpEndpoint is required for CDP-based authentication"
        );
      }
      break;
    case "session":
      if (!config.userDataDir) {
        throw new Error(
          "userDataDir is required for session-based authentication"
        );
      }
      break;
    default:
      throw new Error(`Unknown auth method: ${config.method}`);
  }
}
