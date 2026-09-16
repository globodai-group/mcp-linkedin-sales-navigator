import { describe, expect, it, beforeEach } from "vitest";
import {
  SalesNavigator,
  configureNavigator,
  closeNavigator,
  withSingleFlight,
} from "../src/browser/navigator.js";
import { AUTH_SELECTORS } from "../src/browser/selectors.js";

type NavInternals = SalesNavigator & {
  page: {
    url: () => string;
    goto: (url: string, opts?: unknown) => Promise<void>;
    waitForTimeout: (ms: number) => Promise<void>;
    $: (selector: string) => Promise<unknown>;
    waitForSelector: (selector: string, opts?: unknown) => Promise<unknown>;
  } | null;
  authVerified: boolean;
  ownedWorkingPage: boolean;
};

function fakePage(initialUrl: string, overrides: Partial<NavInternals["page"]> = {}) {
  let url = initialUrl;
  return {
    url: () => url,
    goto: async (next: string) => {
      url = next;
    },
    waitForTimeout: async () => {},
    $: async (selector: string) =>
      selector === AUTH_SELECTORS.CHALLENGE_PAGE ? null : null,
    waitForSelector: async () => null,
    ...overrides,
  };
}

describe("SalesNavigator authentication gating", () => {
  beforeEach(async () => {
    await closeNavigator();
    configureNavigator(
      {},
      { method: "cdp", cdpEndpoint: "http://127.0.0.1:9222" }
    );
  });

  it("navigateTo clears cached auth and throws on login redirect URL", async () => {
    const nav = new SalesNavigator() as NavInternals;
    nav.authVerified = true;
    nav.page = fakePage("about:blank", {
      goto: async () => {},
    });
    let currentUrl = "https://www.linkedin.com/login";
    nav.page!.url = () => currentUrl;
    nav.page!.goto = async () => {
      currentUrl = "https://www.linkedin.com/login";
    };
    nav.ownedWorkingPage = true;

    await expect(
      nav.navigateTo("https://www.linkedin.com/sales/home")
    ).rejects.toThrow(/linkedin_session_status/);
    expect(nav.authVerified).toBe(false);
  });

  it("navigateTo clears cached auth when challenge selector is present", async () => {
    const nav = new SalesNavigator() as NavInternals;
    nav.authVerified = true;
    nav.page = fakePage("https://www.linkedin.com/sales/home", {
      $: async (selector: string) =>
        selector === AUTH_SELECTORS.CHALLENGE_PAGE ? {} : null,
    });
    nav.ownedWorkingPage = true;

    await expect(
      nav.navigateTo("https://www.linkedin.com/sales/lead-lists")
    ).rejects.toThrow(/Not authenticated/i);
    expect(nav.authVerified).toBe(false);
  });

  it("ensureAuthenticatedSession caches a positive check", async () => {
    const nav = new SalesNavigator() as NavInternals;
    let markerWaits = 0;
    nav.page = fakePage("https://www.linkedin.com/sales/home", {
      waitForSelector: async () => {
        markerWaits += 1;
        return {};
      },
    });
    nav.ownedWorkingPage = false;

    await nav.ensureAuthenticatedSession();
    expect(nav.authVerified).toBe(true);
    expect(markerWaits).toBe(1);

    await nav.ensureAuthenticatedSession();
    expect(markerWaits).toBe(1);
  });

  it("resetAuthVerified forces re-validation", async () => {
    const nav = new SalesNavigator() as NavInternals;
    let markerWaits = 0;
    nav.page = fakePage("https://www.linkedin.com/sales/home", {
      waitForSelector: async () => {
        markerWaits += 1;
        return {};
      },
    });
    nav.ownedWorkingPage = false;
    nav.authVerified = true;

    nav.resetAuthVerified();
    await nav.ensureAuthenticatedSession();
    expect(markerWaits).toBe(1);
  });
});

describe("withSingleFlight", () => {
  it("lets concurrent callers share one in-flight start", async () => {
    const state: { current: Promise<string> | null } = { current: null };
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const start = async () => {
      starts += 1;
      await gate;
      return "ok";
    };

    const p1 = withSingleFlight(state, start);
    const p2 = withSingleFlight(state, start);
    const p3 = withSingleFlight(state, start);
    expect(starts).toBe(1);
    expect(state.current).not.toBeNull();

    release();
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(["ok", "ok", "ok"]);
    expect(starts).toBe(1);
    expect(state.current).toBeNull();
  });
});
