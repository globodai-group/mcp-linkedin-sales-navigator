import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import {
  BudgetExceededError,
  CATEGORY_ENV_VAR,
  configureRateLimit,
  createFileUsageStore,
  createMemoryUsageStore,
  defaultUsageFilePath,
  getUsageLimiter,
  recordInMailAttempt,
  resetRateLimitForTests,
  sanitizeUsageData,
  UsageLimiter,
} from "../src/browser/rate-limit.js";

const CDP = { LSN_CDP_ENDPOINT: "http://127.0.0.1:9222" };

function budgets(overrides: Partial<{
  profileViews: number;
  searches: number;
  saves: number;
  inmails: number;
}> = {}) {
  return {
    profileViews: 80,
    searches: 30,
    saves: 50,
    inmails: 15,
    ...overrides,
  };
}

function mutableClock(start: number) {
  let now = start;
  return {
    now: () => now,
    set: (next: number) => {
      now = next;
    },
    add: (ms: number) => {
      now += ms;
    },
  };
}

afterEach(() => {
  resetRateLimitForTests();
});

describe("parseConfig usage vars", () => {
  it("applies documented defaults", () => {
    const { config, errors } = parseConfig(CDP);
    expect(errors).toEqual([]);
    expect(config.usage).toMatchObject({
      dailyProfileViews: 80,
      dailySearches: 30,
      dailySaves: 50,
      dailyInmails: 15,
      minActionIntervalMs: 4000,
    });
    expect(config.usage.usageFile).toBeUndefined();
  });

  it("treats 0 as unlimited / no pacing", () => {
    const { config, errors } = parseConfig({
      ...CDP,
      LSN_DAILY_PROFILE_VIEWS: "0",
      LSN_DAILY_SEARCHES: "0",
      LSN_DAILY_SAVES: "0",
      LSN_DAILY_INMAILS: "0",
      LSN_MIN_ACTION_INTERVAL_MS: "0",
    });
    expect(errors).toEqual([]);
    expect(config.usage.dailyProfileViews).toBe(0);
    expect(config.usage.dailySearches).toBe(0);
    expect(config.usage.dailySaves).toBe(0);
    expect(config.usage.dailyInmails).toBe(0);
    expect(config.usage.minActionIntervalMs).toBe(0);
  });

  it("rejects invalid values and keeps defaults", () => {
    const { config, errors } = parseConfig({
      ...CDP,
      LSN_DAILY_PROFILE_VIEWS: "fast",
      LSN_DAILY_SEARCHES: "-3",
      LSN_DAILY_SAVES: "nope",
      LSN_DAILY_INMAILS: "-1",
      LSN_MIN_ACTION_INTERVAL_MS: "abc",
    });
    expect(config.usage.dailyProfileViews).toBe(80);
    expect(config.usage.dailySearches).toBe(30);
    expect(config.usage.dailySaves).toBe(50);
    expect(config.usage.dailyInmails).toBe(15);
    expect(config.usage.minActionIntervalMs).toBe(4000);
    expect(errors.some((line) => line.includes("LSN_DAILY_PROFILE_VIEWS"))).toBe(
      true
    );
    expect(errors.some((line) => line.includes("LSN_DAILY_SEARCHES"))).toBe(true);
    expect(errors.some((line) => line.includes("LSN_DAILY_SAVES"))).toBe(true);
    expect(errors.some((line) => line.includes("LSN_DAILY_INMAILS"))).toBe(true);
    expect(
      errors.some((line) => line.includes("LSN_MIN_ACTION_INTERVAL_MS"))
    ).toBe(true);
  });

  it("accepts LSN_USAGE_FILE", () => {
    const { config, errors } = parseConfig({
      ...CDP,
      LSN_USAGE_FILE: " /tmp/lsn-usage.json ",
    });
    expect(errors).toEqual([]);
    expect(config.usage.usageFile).toBe("/tmp/lsn-usage.json");
  });
});

describe("UsageLimiter budgets", () => {
  it("resets counters on local day rollover", async () => {
    const clock = mutableClock(Date.parse("2026-09-17T22:00:00"));
    const limiter = new UsageLimiter({
      store: createMemoryUsageStore(),
      budgets: budgets({ searches: 5 }),
      minActionIntervalMs: 0,
      clock,
    });

    await limiter.recordAttempt("searches");
    await limiter.recordAttempt("searches");
    expect((await limiter.getUsageToday()).searches.used).toBe(2);

    clock.set(Date.parse("2026-09-18T00:01:00"));
    const nextDay = await limiter.getUsageToday();
    expect(nextDay.searches.used).toBe(0);
    expect(nextDay.searches.remaining).toBe(5);
    await limiter.recordAttempt("searches");
    expect((await limiter.getUsageToday()).searches.used).toBe(1);
  });

  it("throws when a positive cap is reached", async () => {
    const clock = mutableClock(Date.parse("2026-09-17T10:00:00"));
    const limiter = new UsageLimiter({
      store: createMemoryUsageStore(),
      budgets: budgets({ profileViews: 2 }),
      minActionIntervalMs: 0,
      clock,
    });

    await limiter.recordAttempt("profileViews");
    await limiter.recordAttempt("profileViews");
    await expect(limiter.recordAttempt("profileViews")).rejects.toBeInstanceOf(
      BudgetExceededError
    );
    await expect(limiter.assertWithinBudget("profileViews")).rejects.toMatchObject({
      name: "BudgetExceededError",
      envVar: CATEGORY_ENV_VAR.profileViews,
      cap: 2,
    });

    try {
      await limiter.recordAttempt("profileViews");
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      const message = (error as BudgetExceededError).message;
      expect(message).toContain("cap 2");
      expect(message).toContain("LSN_DAILY_PROFILE_VIEWS");
      expect(message).toContain("2026-09-18T00:00 (local time)");
      expect(message).toContain("0 for unlimited");
    }
  });

  it("treats cap 0 as unlimited", async () => {
    const limiter = new UsageLimiter({
      store: createMemoryUsageStore(),
      budgets: budgets({ inmails: 0 }),
      minActionIntervalMs: 0,
    });

    for (let i = 0; i < 40; i += 1) {
      await limiter.recordAttempt("inmails");
    }
    const today = await limiter.getUsageToday();
    expect(today.inmails.used).toBe(40);
    expect(today.inmails.cap).toBe(0);
    expect(today.inmails.remaining).toBeNull();
  });

  it("does not count dry-run InMail attempts", async () => {
    const store = createMemoryUsageStore();
    configureRateLimit(
      {
        dailyProfileViews: 80,
        dailySearches: 30,
        dailySaves: 50,
        dailyInmails: 15,
        minActionIntervalMs: 0,
      },
      { store }
    );

    await recordInMailAttempt(true);
    await recordInMailAttempt(true);
    expect((await store.load()).constructor).toBe(Object);
    expect(Object.values(await store.load()).every((counts) => !counts.inmails)).toBe(
      true
    );

    await recordInMailAttempt(false);
    const data = await store.load();
    const counts = Object.values(data)[0];
    expect(counts?.inmails).toBe(1);
  });
});

describe("usage store", () => {
  it("fails closed when the singleton limiter is not configured", () => {
    expect(() => getUsageLimiter()).toThrow(/not configured/);
  });

  it("warns once on stderr when the usage file is missing", async () => {
    const filePath = join(
      tmpdir(),
      `lsn-usage-missing-${Date.now()}-${process.pid}.json`
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const store = createFileUsageStore(filePath);

    await expect(store.load()).resolves.toEqual({});
    await expect(store.load()).resolves.toEqual({});
    expect(
      stderr.mock.calls.filter((args) =>
        String(args[0]).includes("Usage file not found")
      )
    ).toHaveLength(1);
    expect(stdout).not.toHaveBeenCalled();

    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("recovers from a corrupt file and warns on stderr", async () => {
    const dir = join(tmpdir(), `lsn-usage-${Date.now()}-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "usage.json");
    await writeFile(filePath, "{not-json", "utf8");

    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const store = createFileUsageStore(filePath);

    await expect(store.load()).resolves.toEqual({});
    expect(stderr).toHaveBeenCalled();
    expect(
      stderr.mock.calls.some((args) =>
        String(args[0]).includes("Usage file is corrupt")
      )
    ).toBe(true);
    expect(stdout).not.toHaveBeenCalled();

    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("writes only dates and category counts, atomically with 0600", async () => {
    const dir = join(tmpdir(), `lsn-usage-ok-${Date.now()}-${process.pid}`);
    const filePath = join(dir, "usage.json");
    const store = createFileUsageStore(filePath);
    await store.save({
      "2026-09-17": { searches: 2, profileViews: 1 },
    });

    const fileStat = await stat(filePath);
    expect(fileStat.mode & 0o777).toBe(0o600);
    const dirStat = await stat(dir);
    expect(dirStat.mode & 0o777).toBe(0o700);

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toMatch(/linkedin\.com|http|lead|@/i);
    expect(JSON.parse(raw)).toEqual({
      "2026-09-17": { searches: 2, profileViews: 1 },
    });
  });

  it("drops unknown keys so lead data cannot persist", () => {
    expect(
      sanitizeUsageData({
        "2026-09-17": {
          searches: 1,
          profileUrl: "https://www.linkedin.com/sales/lead/secret",
        },
        extra: { name: "Ada" },
      })
    ).toEqual({ "2026-09-17": { searches: 1 } });
  });

  it("honors LSN_USAGE_FILE for the default path", () => {
    expect(defaultUsageFilePath({ LSN_USAGE_FILE: "/tmp/custom-usage.json" })).toBe(
      "/tmp/custom-usage.json"
    );
  });
});

describe("action pacing", () => {
  it("serializes concurrent pace calls and applies interval plus jitter", async () => {
    const clock = mutableClock(1_000_000);
    const sleeps: number[] = [];
    const limiter = new UsageLimiter({
      store: createMemoryUsageStore(),
      budgets: budgets(),
      minActionIntervalMs: 4000,
      clock,
      random: () => 0.5,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.add(ms);
      },
    });

    await Promise.all([limiter.pace(), limiter.pace()]);
    // 4000 + 50% * 0.5 jitter = 5000; first call does not wait.
    expect(sleeps).toEqual([5000]);
  });
});
