/**
 * Browser navigation controller for LinkedIn Sales Navigator.
 *
 * Manages the Playwright browser instance and provides
 * high-level methods for interacting with Sales Navigator pages.
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  isAuthenticated,
  restoreSessionFromCookies,
  navigateToSalesNavigator,
} from "./auth.js";
import { URLS, WAIT_CONDITIONS } from "./selectors.js";
import { extractTopcardFieldsBrowser, type TopcardHeuristicResult } from "./dom-extract.js";
import { anyOf, queryFirst, textOfFirst, type SelectorList } from "./query.js";
import type { BrowserConfig, AuthConfig } from "../types/index.js";
import { readFile } from "node:fs/promises";

export class SalesNavigator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserConfig;
  /**
   * True when we attached to a browser we don't own (CDP). We must then
   * only *detach* on close - closing the page/context/browser would
   * destroy the user's own browser session and tabs (see issue #2).
   */
  private isAttachedSession = false;

  constructor(config: Partial<BrowserConfig> = {}) {
    this.config = {
      headless: false,
      viewportWidth: 1280,
      viewportHeight: 900,
      navigationTimeout: 30000,
      actionTimeout: 10000,
      ...config,
    };
  }

  /**
   * Initialize the browser and connect to Sales Navigator.
   */
  async initialize(authConfig: AuthConfig): Promise<void> {
    if (authConfig.method === "cdp" && authConfig.cdpEndpoint) {
      // Connect to an existing browser via CDP. This browser belongs to
      // the user, not to us - never close it (see `close()`).
      this.browser = await chromium.connectOverCDP(authConfig.cdpEndpoint);
      this.isAttachedSession = true;
      const contexts = this.browser.contexts();
      this.context = contexts[0] || (await this.browser.newContext());
    } else if (authConfig.method === "session" && authConfig.userDataDir) {
      // Launch with existing user data directory
      this.context = await chromium.launchPersistentContext(
        authConfig.userDataDir,
        {
          headless: this.config.headless,
          viewport: {
            width: this.config.viewportWidth!,
            height: this.config.viewportHeight!,
          },
        }
      );
    } else {
      // Default: launch fresh browser
      this.browser = await chromium.launch({
        headless: this.config.headless,
      });
      this.context = await this.browser.newContext({
        viewport: {
          width: this.config.viewportWidth!,
          height: this.config.viewportHeight!,
        },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      });
    }

    // Restore cookies if provided
    if (authConfig.method === "cookies" && authConfig.cookiesPath) {
      const cookiesJson = await readFile(authConfig.cookiesPath, "utf-8");
      await restoreSessionFromCookies(this.context, cookiesJson);
    }

    // Get or create a page
    const pages = this.context.pages();
    this.page = pages[0] || (await this.context.newPage());

    // Set default timeouts
    this.page.setDefaultTimeout(this.config.actionTimeout!);
    this.page.setDefaultNavigationTimeout(this.config.navigationTimeout!);

    // Verify authentication
    const isAuthed = await navigateToSalesNavigator(this.page);
    if (!isAuthed) {
      throw new Error(
        "Not authenticated to LinkedIn Sales Navigator. " +
          "Please ensure you have an active LinkedIn session. " +
          "Use cookie-based auth or connect via CDP to an authenticated browser."
      );
    }
  }

  /**
   * Get the active page instance.
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error(
        "Browser not initialized. Call initialize() first."
      );
    }
    return this.page;
  }

  /**
   * Get the browser context.
   */
  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error(
        "Browser not initialized. Call initialize() first."
      );
    }
    return this.context;
  }

  /**
   * Navigate to a Sales Navigator URL.
   */
  async navigateTo(url: string): Promise<void> {
    const page = this.getPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await this.humanDelay();
  }

  /**
   * Check if still authenticated.
   */
  async checkAuth(): Promise<boolean> {
    return isAuthenticated(this.getPage());
  }

  /**
   * Add a random human-like delay between actions.
   * Helps avoid detection and rate limiting.
   */
  async humanDelay(
    min: number = WAIT_CONDITIONS.MIN_HUMAN_DELAY,
    max: number = WAIT_CONDITIONS.MAX_HUMAN_DELAY
  ): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.getPage().waitForTimeout(delay);
  }

  /**
   * Safely extract text content from an element.
   *
   * Accepts a prioritised selector list, resolved in order (see
   * `query.ts` for why a comma-separated CSS list cannot express that).
   */
  async safeTextContent(selectors: SelectorList): Promise<string | null> {
    try {
      return await textOfFirst(this.getPage(), selectors);
    } catch {
      return null;
    }
  }

  /**
   * Safely extract an attribute from an element.
   */
  async safeAttribute(
    selectors: SelectorList,
    attribute: string
  ): Promise<string | null> {
    try {
      const element = await queryFirst(this.getPage(), selectors);
      if (!element) return null;
      return await element.getAttribute(attribute);
    } catch {
      return null;
    }
  }

  /**
   * Wait for any of the given selectors to appear on the page.
   * Priority is irrelevant when only existence matters, so this can use
   * a single combined selector.
   */
  async waitForSelector(
    selectors: SelectorList,
    timeout?: number
  ): Promise<boolean> {
    try {
      await this.getPage().waitForSelector(anyOf(selectors), {
        timeout: timeout || this.config.actionTimeout,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click a button/element and wait out its async enabled/disabled or
   * label transition before continuing (see issue #2: several tools
   * clicked a button while it was still mid-transition and the click
   * was silently swallowed by LinkedIn's Ember re-render).
   */
  async clickAndSettle(
    handle: { click: () => Promise<void> },
    settleMs: number = WAIT_CONDITIONS.BUTTON_STATE_SETTLE
  ): Promise<void> {
    await handle.click();
    await this.getPage().waitForTimeout(settleMs);
  }

  /**
   * Extract lead topcard fields (name/headline/location/connection
   * degree) via the structural DOM heuristic in `dom-extract.ts`.
   *
   * Use this instead of PROFILE_SELECTORS.PROFILE_HEADLINE/LOCATION,
   * which have no stable selector on the current lead profile markup.
   */
  async extractTopcardFields(): Promise<TopcardHeuristicResult> {
    try {
      return await this.getPage().evaluate(extractTopcardFieldsBrowser);
    } catch {
      return { name: null, headline: null, location: null, connectionDegree: null };
    }
  }

  /**
   * Navigate to the search page.
   */
  async goToSearch(): Promise<void> {
    await this.navigateTo(URLS.SEARCH_LEADS);
    await this.getPage().waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);
  }

  /**
   * Navigate to lead lists.
   */
  async goToLists(): Promise<void> {
    await this.navigateTo(URLS.LEAD_LISTS);
    await this.getPage().waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);
  }

  /**
   * Navigate to a specific lead profile.
   */
  async goToProfile(profileUrl: string): Promise<void> {
    // Ensure it's a Sales Navigator URL
    if (!profileUrl.includes("/sales/")) {
      throw new Error("URL must be a Sales Navigator profile URL");
    }
    await this.navigateTo(profileUrl);
    await this.getPage().waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);
  }

  /**
   * Close the browser and clean up resources.
   */
  async close(): Promise<void> {
    try {
      if (this.isAttachedSession) {
        // CDP: the browser, its context and its tabs belong to the user.
        // Closing any of them would kill their real browsing session
        // (issue #2) - just drop our references and disconnect the
        // Playwright client.
        this.page = null;
        this.context = null;
        if (this.browser) {
          await this.browser.close().catch(() => {});
          this.browser = null;
        }
        return;
      }

      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Singleton instance for the MCP server.
 */
let navigatorInstance: SalesNavigator | null = null;
let navigatorReady = false;
let pendingInit: Promise<SalesNavigator> | null = null;
let storedConfig: {
  browser: Partial<BrowserConfig>;
  auth: AuthConfig;
} | null = null;

/**
 * Record the configuration to use for lazy initialization.
 * Called once at server startup, before any tool runs.
 */
export function configureNavigator(
  browserConfig: Partial<BrowserConfig>,
  authConfig: AuthConfig
): void {
  storedConfig = { browser: browserConfig, auth: authConfig };
}

export function getNavigator(): SalesNavigator {
  if (!navigatorInstance) {
    navigatorInstance = new SalesNavigator();
  }
  return navigatorInstance;
}

/**
 * Get a browser-connected navigator, connecting on first use.
 *
 * Startup connection is best-effort: the browser may not be running yet
 * when the MCP server starts, and a tool call can arrive before the
 * startup attempt finishes. Without this, every tool failed for the rest
 * of the process with "Browser not initialized" and never retried - the
 * lazy path the startup code claimed to have, but did not implement.
 *
 * Concurrent callers share a single in-flight attempt; a failed attempt
 * is not cached, so the next call retries.
 */
export async function ensureNavigator(): Promise<SalesNavigator> {
  if (navigatorInstance && navigatorReady) return navigatorInstance;
  if (pendingInit) return pendingInit;

  if (!storedConfig) {
    throw new Error(
      "Navigator is not configured. configureNavigator() must be called at server startup."
    );
  }

  const { browser, auth } = storedConfig;
  pendingInit = (async () => {
    const nav = new SalesNavigator(browser);
    await nav.initialize(auth);
    navigatorInstance = nav;
    navigatorReady = true;
    return nav;
  })();

  try {
    return await pendingInit;
  } finally {
    pendingInit = null;
  }
}

export async function initializeNavigator(
  browserConfig: Partial<BrowserConfig>,
  authConfig: AuthConfig
): Promise<SalesNavigator> {
  configureNavigator(browserConfig, authConfig);
  return ensureNavigator();
}

export async function closeNavigator(): Promise<void> {
  if (navigatorInstance) {
    await navigatorInstance.close();
    navigatorInstance = null;
  }
  navigatorReady = false;
}
