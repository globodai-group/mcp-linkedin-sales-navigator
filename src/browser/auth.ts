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
import type { AuthConfig } from "../types/index.js";

/**
 * Check whether the current page (no navigation) shows an
 * authenticated Sales Navigator session, without navigating away from
 * wherever the page currently is.
 */
async function checkAuthIndicators(page: Page): Promise<boolean> {
  // Sales Navigator is an Ember SPA whose global nav renders several
  // seconds *after* the page reaches `networkidle` (measured ~4s on a
  // live session). The previous implementation probed with an instant
  // `page.$()` at that point, so it consistently found nothing and
  // reported an authenticated session as logged-out - the tools then
  // refused to start at all (issue #2).
  //
  // `waitForSelector` is the actual fix. The retry loop on top covers
  // the SPA performing a further client-side navigation mid-check,
  // which would otherwise reject the pending wait.
  const ATTEMPTS = 3;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Redirected to login/authwall - conclusive, no point retrying.
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
      return false;
    }

    // A logged-in session shows either the global nav header or the
    // profile icon. `waitForSelector` (rather than an instant
    // `page.$()`) also covers the case where the SPA simply hasn't
    // rendered them yet.
    for (const selector of [
      AUTH_SELECTORS.SALES_NAV_HEADER,
      AUTH_SELECTORS.PROFILE_ICON,
    ]) {
      const found = await page
        .waitForSelector(selector, {
          timeout: WAIT_CONDITIONS.PROFILE_LOAD_TIMEOUT,
        })
        .catch(() => null);
      if (found) return true;
    }

    // Nothing found - let any in-flight client-side navigation settle
    // before trying once more.
    await page.waitForTimeout(WAIT_CONDITIONS.ACTION_DELAY).catch(() => {});
  }

  return false;
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
    waitUntil: "networkidle",
    timeout: WAIT_CONDITIONS.SEARCH_RESULTS_TIMEOUT,
  });

  // Wait for the page to settle
  await page.waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);

  // Check indicators on the page we just loaded rather than calling
  // `isAuthenticated()`, which would navigate to the same URL a second
  // time (see issue #2).
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
