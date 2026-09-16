import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const CDP = { LSN_CDP_ENDPOINT: "http://127.0.0.1:9222" };

describe("parseConfig defaults", () => {
  it("uses cdp, headless false, and numeric viewport/timeout fallbacks", () => {
    const { config } = parseConfig({});
    expect(config.auth.method).toBe("cdp");
    expect(config.auth.cdpEndpoint).toBeUndefined();
    expect(config.auth.cookiesPath).toBeUndefined();
    expect(config.auth.userDataDir).toBeUndefined();
    expect(config.browser.headless).toBe(false);
    expect(config.browser.viewportWidth).toBe(1280);
    expect(config.browser.viewportHeight).toBe(900);
    expect(config.browser.navigationTimeout).toBe(30000);
    expect(config.browser.actionTimeout).toBe(10000);
  });

  it("reports missing CDP endpoint when method defaults to cdp", () => {
    const { errors } = parseConfig({});
    expect(errors.some((line) => line.includes("LSN_CDP_ENDPOINT"))).toBe(true);
  });

  it("accepts an explicit CDP endpoint with no errors", () => {
    const { config, errors } = parseConfig(CDP);
    expect(errors).toEqual([]);
    expect(config.auth.method).toBe("cdp");
    expect(config.auth.cdpEndpoint).toBe("http://127.0.0.1:9222");
  });
});

describe("LSN_AUTH_METHOD", () => {
  it("rejects an unknown method and keeps the cdp default", () => {
    const { config, errors } = parseConfig({ LSN_AUTH_METHOD: "oauth" });
    expect(config.auth.method).toBe("cdp");
    expect(errors.some((line) => line.includes("LSN_AUTH_METHOD"))).toBe(true);
    expect(errors.some((line) => line.includes("oauth"))).toBe(true);
  });

  it("trims a valid method", () => {
    const { config, errors } = parseConfig({
      LSN_AUTH_METHOD: " cookies ",
      LSN_COOKIES_PATH: "/tmp/lsn-test-cookies.json",
    });
    expect(errors).toEqual([]);
    expect(config.auth.method).toBe("cookies");
    expect(config.auth.cookiesPath).toBe("/tmp/lsn-test-cookies.json");
  });

  it("requires cookies path and session user-data dir", () => {
    const cookies = parseConfig({ LSN_AUTH_METHOD: "cookies" });
    expect(cookies.errors.some((line) => line.includes("LSN_COOKIES_PATH"))).toBe(true);

    const session = parseConfig({ LSN_AUTH_METHOD: "session" });
    expect(session.errors.some((line) => line.includes("LSN_USER_DATA_DIR"))).toBe(true);
  });
});

describe("cdp without endpoint", () => {
  it("errors when method is cdp and LSN_CDP_ENDPOINT is missing", () => {
    const { errors } = parseConfig({ LSN_AUTH_METHOD: "cdp" });
    expect(errors).toContain(
      'LSN_CDP_ENDPOINT is required when LSN_AUTH_METHOD is "cdp" (e.g. http://localhost:9222)'
    );
  });

  it("treats a blank endpoint as missing", () => {
    const { errors, config } = parseConfig({
      LSN_AUTH_METHOD: "cdp",
      LSN_CDP_ENDPOINT: "   ",
    });
    expect(config.auth.cdpEndpoint).toBeUndefined();
    expect(errors.some((line) => line.includes("LSN_CDP_ENDPOINT"))).toBe(true);
  });
});

describe("non-numeric timeout", () => {
  it("keeps the default and records an error", () => {
    const { config, errors } = parseConfig({
      ...CDP,
      LSN_NAVIGATION_TIMEOUT: "fast",
      LSN_ACTION_TIMEOUT: "nope",
    });
    expect(config.browser.navigationTimeout).toBe(30000);
    expect(config.browser.actionTimeout).toBe(10000);
    expect(errors.some((line) => line.includes("LSN_NAVIGATION_TIMEOUT"))).toBe(true);
    expect(errors.some((line) => line.includes("LSN_ACTION_TIMEOUT"))).toBe(true);
  });

  it("rejects zero and negative timeouts", () => {
    const { config, errors } = parseConfig({
      ...CDP,
      LSN_NAVIGATION_TIMEOUT: "0",
      LSN_ACTION_TIMEOUT: "-5",
    });
    expect(config.browser.navigationTimeout).toBe(30000);
    expect(config.browser.actionTimeout).toBe(10000);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("accepts a positive integer timeout", () => {
    const { config, errors } = parseConfig({
      ...CDP,
      LSN_NAVIGATION_TIMEOUT: "45000",
    });
    expect(errors).toEqual([]);
    expect(config.browser.navigationTimeout).toBe(45000);
  });
});

describe("LSN_HEADLESS", () => {
  it("is false when unset or empty", () => {
    expect(parseConfig(CDP).config.browser.headless).toBe(false);
    expect(parseConfig({ ...CDP, LSN_HEADLESS: "" }).config.browser.headless).toBe(false);
  });

  it('parses "true" and "false"', () => {
    expect(parseConfig({ ...CDP, LSN_HEADLESS: "true" }).config.browser.headless).toBe(true);
    expect(parseConfig({ ...CDP, LSN_HEADLESS: "false" }).config.browser.headless).toBe(false);
  });

  it("rejects other values and falls back to false", () => {
    const { config, errors } = parseConfig({ ...CDP, LSN_HEADLESS: "1" });
    expect(config.browser.headless).toBe(false);
    expect(errors.some((line) => line.includes("LSN_HEADLESS"))).toBe(true);
  });
});
