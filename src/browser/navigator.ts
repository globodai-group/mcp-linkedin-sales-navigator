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
import { inspectCurrentAuth, restoreSessionFromCookies } from "./auth.js";
import { AUTH_SELECTORS, URLS, WAIT_CONDITIONS } from "./selectors.js";
import { extractTopcardFieldsBrowser, type TopcardHeuristicResult } from "./dom-extract.js";
import { anyOf, queryFirst, textOfFirst, type SelectorList } from "./query.js";
import type { BrowserConfig, AuthConfig } from "../types/index.js";
import { authFailureHint } from "../config.js";
import {
  assertSalesNavigatorUrl,
  isLinkedInAuthFailureUrl,
  isSalesNavigatorUrl,
} from "./url.js";
import { readFile } from "node:fs/promises";
import { isRateLimitConfigured, paceIfConfigured } from "./rate-limit.js";

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
  private sessionLostHandler: (() => void) | null = null;
  private sessionLostNotified = false;
  private closing = false;
  private browserListenersBound = false;
  /** True when we opened a dedicated tab so tools do not hijack the user's. */
  private ownedWorkingPage = false;
  /** Cached positive auth check for mutating tools (reset on disconnect or auth failure). */
  private authVerified = false;

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
    try {
      if (authConfig.method === "cdp") {
        if (!authConfig.cdpEndpoint) {
          throw new Error("LSN_CDP_ENDPOINT is not set");
        }
        // Connect to an existing browser via CDP. This browser belongs to
        // the user, not to us - never close it (see `close()`).
        this.browser = await chromium.connectOverCDP(authConfig.cdpEndpoint);
        this.isAttachedSession = true;
        const contexts = this.browser.contexts();
        this.context = contexts[0] || (await this.browser.newContext());
      } else if (authConfig.method === "session") {
        if (!authConfig.userDataDir) {
          throw new Error("LSN_USER_DATA_DIR is not set");
        }
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
      } else if (authConfig.method === "cookies") {
        if (!authConfig.cookiesPath) {
          throw new Error("LSN_COOKIES_PATH is not set");
        }
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
        const cookiesJson = await readFile(authConfig.cookiesPath, "utf-8");
        await restoreSessionFromCookies(this.context, cookiesJson);
      } else {
        throw new Error(`Unknown auth method: ${String(authConfig.method)}`);
      }

      if (!this.context) {
        throw new Error("Browser context was not created");
      }

      // Bind an existing tab. Never goto /sales/home here: that reloads
      // the user's current Sales Navigator tab (status probe + warmup).
      await this.bindExistingPage(authConfig.method !== "cdp");
      this.attachLifecycleListeners();
    } catch (error) {
      // Detach/close whatever we opened so a retry can start clean.
      await this.close().catch(() => {});
      throw new Error(authFailureHint(authConfig, error));
    }
  }

  /**
   * Get the active page instance.
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error(
        "Browser is not connected. Call linkedin_session_status to diagnose, " +
          "and check LSN_AUTH_METHOD plus the related LSN_* variables."
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
        "Browser is not connected. Call linkedin_session_status to diagnose, " +
          "and check LSN_AUTH_METHOD plus the related LSN_* variables."
      );
    }
    return this.context;
  }

  /** True when a Playwright page is available. */
  isConnected(): boolean {
    return this.page !== null && this.context !== null;
  }

  /** True when the Playwright client holds a browser or context. */
  isBrowserAttached(): boolean {
    return this.browser !== null || this.context !== null;
  }

  /**
   * Called when Chrome/CDP drops or the page closes so the singleton
   * can drop this instance and reconnect on the next ensureNavigator.
   */
  setSessionLostHandler(handler: (() => void) | null): void {
    this.sessionLostHandler = handler;
  }

  private notifySessionLost(): void {
    if (this.closing || this.sessionLostNotified) return;
    this.sessionLostNotified = true;
    this.sessionLostHandler?.();
  }

  private attachLifecycleListeners(): void {
    if (!this.browserListenersBound) {
      if (this.browser) {
        this.browser.on("disconnected", () => this.notifySessionLost());
        this.browserListenersBound = true;
      } else if (this.context) {
        this.context.on("close", () => this.notifySessionLost());
        this.browserListenersBound = true;
      }
    }
    if (this.page) {
      const page = this.page;
      page.on("close", () => {
        // Ignore close of a tab we already switched away from.
        if (this.page !== page) return;
        this.notifySessionLost();
      });
    }
  }

  private findSalesNavPage(): Page | null {
    const contexts =
      this.browser?.contexts() ?? (this.context ? [this.context] : []);
    for (const ctx of contexts) {
      for (const page of ctx.pages()) {
        if (isSalesNavigatorUrl(page.url())) return page;
      }
    }
    return null;
  }

  private applyPageTimeouts(page: Page): void {
    page.setDefaultTimeout(this.config.actionTimeout!);
    page.setDefaultNavigationTimeout(this.config.navigationTimeout!);
  }

  /**
   * Use an existing tab. Prefer a Sales Navigator tab; otherwise the
   * first open page. Only create a page when the method owns the browser
   * (cookies / session) and none exist. CDP never opens a new tab here.
   */
  private async bindExistingPage(createIfMissing: boolean): Promise<void> {
    if (!this.context) {
      throw new Error("Browser context was not created");
    }
    const salesPage = this.findSalesNavPage();
    if (salesPage) {
      this.page = salesPage;
      this.ownedWorkingPage = false;
    } else {
      const pages = this.context.pages();
      if (pages[0]) {
        this.page = pages[0];
        this.ownedWorkingPage = false;
      } else if (createIfMissing) {
        this.page = await this.context.newPage();
        this.ownedWorkingPage = true;
      } else {
        this.page = null;
      }
    }
    if (this.page) this.applyPageTimeouts(this.page);
  }

  /** True when the active page is a dedicated tab we opened (not the user's). */
  isOwnedWorkingPage(): boolean {
    return this.ownedWorkingPage;
  }

  /**
   * For mutating tools: stay on a Sales Navigator tab, or open a new
   * page so we do not navigate the user's google.com (etc.) tab.
   * Does not goto any URL.
   */
  /** Drop cached authentication so the next tool re-validates the session. */
  resetAuthVerified(): void {
    this.authVerified = false;
  }

  private throwNotAuthenticated(): never {
    const stored = getStoredNavigatorConfig();
    if (!stored) {
      throw new Error(
        "Not authenticated to LinkedIn Sales Navigator. Call linkedin_session_status to diagnose."
      );
    }
    throw new Error(
      authFailureHint(
        stored.auth,
        new Error("Not authenticated to LinkedIn Sales Navigator")
      )
    );
  }

  private async pageShowsAuthFailure(page: Page): Promise<boolean> {
    if (isLinkedInAuthFailureUrl(page.url())) return true;
    const challenge = await page
      .$(AUTH_SELECTORS.CHALLENGE_PAGE)
      .catch(() => null);
    return challenge !== null;
  }

  /**
   * Verify Sales Navigator authentication for mutating tools. Navigates
   * only the dedicated owned tab to /sales/home when needed; never
   * reloads the user's non–Sales Navigator tab.
   */
  async ensureAuthenticatedSession(): Promise<void> {
    if (this.authVerified) return;
    if (!this.page) {
      this.throwNotAuthenticated();
    }
    const page = this.page;
    if (!isSalesNavigatorUrl(page.url())) {
      if (!this.ownedWorkingPage) {
        this.throwNotAuthenticated();
      }
      await page.goto(URLS.HOME, {
        waitUntil: "domcontentloaded",
        timeout: this.config.navigationTimeout,
      });
      if (await this.pageShowsAuthFailure(page)) {
        this.throwNotAuthenticated();
      }
    }
    const ok = await inspectCurrentAuth(page);
    if (!ok) {
      this.throwNotAuthenticated();
    }
    this.authVerified = true;
  }

  async adoptWorkingPage(): Promise<void> {
    const salesPage = this.findSalesNavPage();
    if (salesPage) {
      if (this.page !== salesPage) {
        this.page = salesPage;
        this.ownedWorkingPage = false;
        this.applyPageTimeouts(salesPage);
        this.attachLifecycleListeners();
      }
      return;
    }
    if (this.page && isSalesNavigatorUrl(this.page.url())) return;
    if (this.ownedWorkingPage && this.page) return;
    if (!this.context) return;
    this.page = await this.context.newPage();
    this.ownedWorkingPage = true;
    this.applyPageTimeouts(this.page);
    this.attachLifecycleListeners();
  }

  /**
   * Navigate to a Sales Navigator URL.
   */
  async navigateTo(url: string): Promise<void> {
    await paceIfConfigured();
    const safeUrl = assertSalesNavigatorUrl(url);
    const page = this.getPage();
    await page.goto(safeUrl, { waitUntil: "domcontentloaded" });
    if (await this.pageShowsAuthFailure(page)) {
      this.resetAuthVerified();
      this.throwNotAuthenticated();
    }
    await this.humanDelay(
      WAIT_CONDITIONS.MIN_HUMAN_DELAY,
      WAIT_CONDITIONS.MAX_HUMAN_DELAY
    );
  }

  /**
   * Inspect the current tab only. Never navigates.
   */
  async checkAuth(): Promise<boolean> {
    if (!this.page) return false;
    return inspectCurrentAuth(this.page);
  }

  /**
   * Space actions. Default (no args) enforces LSN_MIN_ACTION_INTERVAL_MS
   * plus 0–50% jitter when the usage limiter is configured. Explicit
   * min/max keep a short in-page delay and do not apply the interval.
   */
  async humanDelay(min?: number, max?: number): Promise<void> {
    if (min === undefined && max === undefined) {
      await paceIfConfigured();
      if (isRateLimitConfigured()) return;
    }
    const lo = min ?? WAIT_CONDITIONS.MIN_HUMAN_DELAY;
    const hi = max ?? WAIT_CONDITIONS.MAX_HUMAN_DELAY;
    const delay = Math.floor(Math.random() * (hi - lo + 1)) + lo;
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
    await this.navigateTo(profileUrl);
    await this.getPage().waitForTimeout(WAIT_CONDITIONS.NAVIGATION_DELAY);
  }

  /**
   * Close the browser and clean up resources.
   */
  async close(): Promise<void> {
    this.closing = true;
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

/** Stored auth/browser config from startup (null before configureNavigator). */
export function getStoredNavigatorConfig(): {
  browser: Partial<BrowserConfig>;
  auth: AuthConfig;
} | null {
  return storedConfig;
}

/** Whether ensureNavigator has completed successfully. */
export function isNavigatorReady(): boolean {
  return navigatorReady && navigatorInstance !== null;
}

export function getNavigator(): SalesNavigator {
  if (!navigatorInstance) {
    navigatorInstance = new SalesNavigator();
  }
  return navigatorInstance;
}

/**
 * Share one in-flight promise across concurrent callers.
 * Assigns `state.current` synchronously before `start` runs.
 */
export function withSingleFlight<T>(
  state: { current: Promise<T> | null },
  start: () => Promise<T>
): Promise<T> {
  if (state.current) return state.current;

  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const shared = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Publish before any await so concurrent callers join this attempt.
  state.current = shared;

  void (async () => {
    try {
      resolve(await start());
    } catch (error) {
      reject(error);
    } finally {
      if (state.current === shared) {
        state.current = null;
      }
    }
  })();

  return shared;
}

/**
 * Attach to the browser without navigating or opening a new tab.
 * Used by linkedin_session_status and startup warmup.
 */
export async function ensureAttached(): Promise<SalesNavigator> {
  if (navigatorInstance && navigatorReady) return navigatorInstance;

  if (!storedConfig) {
    throw new Error(
      "Navigator is not configured at startup. Check LSN_* environment variables " +
        "and call linkedin_session_status to diagnose."
    );
  }

  const { browser, auth } = storedConfig;
  const flight = {
    get current() {
      return pendingInit;
    },
    set current(value: Promise<SalesNavigator> | null) {
      pendingInit = value;
    },
  };

  try {
    return await withSingleFlight(flight, async () => {
      const nav = new SalesNavigator(browser);
      nav.setSessionLostHandler(() => {
        nav.resetAuthVerified();
        if (navigatorInstance === nav) {
          navigatorInstance = null;
          navigatorReady = false;
        }
        void nav.close().catch(() => {});
      });
      try {
        await nav.initialize(auth);
        navigatorInstance = nav;
        navigatorReady = true;
        if (!nav.isBrowserAttached()) {
          navigatorInstance = null;
          navigatorReady = false;
          await nav.close().catch(() => {});
          throw new Error("Browser disconnected during initialization");
        }
        return nav;
      } catch (error) {
        // initialize() also closes, but a throw before that catch (or a
        // future edit that drops it) must not leak a CDP connection.
        await nav.close().catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    // initialize() already wraps with authFailureHint; rethrow as-is
    // unless somehow bare.
    if (error instanceof Error) throw error;
    throw new Error(authFailureHint(auth, error));
  }
}

/**
 * Get a browser-connected navigator for tools, connecting on first use.
 *
 * Attaches without goto /sales/home. If no Sales Navigator tab exists,
 * opens a dedicated page so tool navigation does not hijack the user's
 * current tab. Concurrent callers share a single in-flight attach.
 */
export async function ensureNavigator(): Promise<SalesNavigator> {
  const nav = await ensureAttached();
  await nav.adoptWorkingPage();
  await nav.ensureAuthenticatedSession();
  return nav;
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
    navigatorInstance.resetAuthVerified();
    await navigatorInstance.close();
    navigatorInstance = null;
  }
  navigatorReady = false;
}
