/**
 * Conservative usage budgets and action pacing for the user's own
 * Sales Navigator activity. This is throttling, not anti-detection:
 * no fingerprinting, UA rotation, or proxies.
 *
 * Counters are local-calendar-day keyed. The persisted file stores
 * only dates, category names, and counts — never URLs or lead data.
 */

import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_USAGE, type UsageConfig } from "../config.js";

export const USAGE_CATEGORIES = [
  "profileViews",
  "searches",
  "saves",
  "inmails",
] as const;

export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

export const CATEGORY_ENV_VAR: Record<UsageCategory, string> = {
  profileViews: "LSN_DAILY_PROFILE_VIEWS",
  searches: "LSN_DAILY_SEARCHES",
  saves: "LSN_DAILY_SAVES",
  inmails: "LSN_DAILY_INMAILS",
};

export const CATEGORY_LABEL: Record<UsageCategory, string> = {
  profileViews: "daily profile views",
  searches: "daily searches",
  saves: "daily saves",
  inmails: "daily InMails",
};

export type UsageCounts = Partial<Record<UsageCategory, number>>;

/** Dates (YYYY-MM-DD) to per-category counts. No other keys are persisted. */
export type UsageData = Record<string, UsageCounts>;

export interface UsageStore {
  load(): UsageData | Promise<UsageData>;
  save(data: UsageData): void | Promise<void>;
}

export interface RateLimitClock {
  now(): number;
}

export interface UsageBudgets {
  profileViews: number;
  searches: number;
  saves: number;
  inmails: number;
}

export interface CategoryUsage {
  used: number;
  cap: number;
  remaining: number | null;
}

export interface UsageToday {
  profileViews: CategoryUsage;
  searches: CategoryUsage;
  saves: CategoryUsage;
  inmails: CategoryUsage;
  minActionIntervalMs: number;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextLocalMidnight(epochMs: number): Date {
  const d = new Date(epochMs);
  d.setHours(24, 0, 0, 0);
  return d;
}

export function formatLocalMidnight(epochMs: number): string {
  const midnight = nextLocalMidnight(epochMs);
  const y = midnight.getFullYear();
  const m = String(midnight.getMonth() + 1).padStart(2, "0");
  const day = String(midnight.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00 (local time)`;
}

function sanitizeCounts(raw: unknown): UsageCounts {
  if (raw === null || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: UsageCounts = {};
  for (const key of USAGE_CATEGORIES) {
    const value = src[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[key] = Math.floor(value);
    }
  }
  return out;
}

export function sanitizeUsageData(raw: unknown): UsageData {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: UsageData = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!DATE_KEY.test(key)) continue;
    out[key] = sanitizeCounts(value);
  }
  return out;
}

export function defaultUsageFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.LSN_USAGE_FILE?.trim();
  if (explicit) return explicit;
  return join(homedir(), ".mcp-linkedin-sales-navigator", "usage.json");
}

export function createMemoryUsageStore(initial: UsageData = {}): UsageStore {
  let data: UsageData = sanitizeUsageData(initial);
  return {
    load() {
      return structuredClone(data);
    },
    save(next: UsageData) {
      data = sanitizeUsageData(next);
    },
  };
}

let missingUsageFileWarned = false;

export function createFileUsageStore(filePath: string): UsageStore {
  return {
    async load() {
      try {
        const raw = await readFile(filePath, "utf8");
        try {
          return sanitizeUsageData(JSON.parse(raw) as unknown);
        } catch {
          console.error(
            "[LSN] Usage file is corrupt; starting counters at zero."
          );
          return {};
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          if (!missingUsageFileWarned) {
            missingUsageFileWarned = true;
            console.error(
              "[LSN] Usage file not found; starting counters at zero."
            );
          }
          return {};
        }
        console.error(
          "[LSN] Usage file is unreadable; starting counters at zero."
        );
        return {};
      }
    },
    async save(data: UsageData) {
      const dir = dirname(filePath);
      try {
        await stat(dir);
      } catch {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
      }
      const clean = sanitizeUsageData(data);
      const tmp = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        await writeFile(tmp, `${JSON.stringify(clean)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await chmod(tmp, 0o600);
        await rename(tmp, filePath);
        await chmod(filePath, 0o600);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
    },
  };
}

export class BudgetExceededError extends Error {
  readonly name = "BudgetExceededError";
  readonly category: UsageCategory;
  readonly cap: number;
  readonly envVar: string;
  readonly resetsAt: string;

  constructor(opts: {
    category: UsageCategory;
    cap: number;
    used: number;
    resetsAt: string;
  }) {
    const envVar = CATEGORY_ENV_VAR[opts.category];
    super(
      `${CATEGORY_LABEL[opts.category]} budget reached (${opts.used} used / cap ${opts.cap}). ` +
        `Resets at ${opts.resetsAt}. ` +
        `Set ${envVar} to a higher positive integer, or 0 for unlimited.`
    );
    this.category = opts.category;
    this.cap = opts.cap;
    this.envVar = envVar;
    this.resetsAt = opts.resetsAt;
  }
}

export function budgetErrorResult(error: BudgetExceededError): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text", text: error.message }],
    isError: true,
  };
}

function emptyCategory(cap: number): CategoryUsage {
  return { used: 0, cap, remaining: cap === 0 ? null : cap };
}

export function emptyUsageToday(
  budgets: UsageBudgets,
  minActionIntervalMs: number
): UsageToday {
  return {
    profileViews: emptyCategory(budgets.profileViews),
    searches: emptyCategory(budgets.searches),
    saves: emptyCategory(budgets.saves),
    inmails: emptyCategory(budgets.inmails),
    minActionIntervalMs,
  };
}

function remainingFor(used: number, cap: number): number | null {
  if (cap === 0) return null;
  return Math.max(0, cap - used);
}

export interface UsageLimiterOptions {
  store: UsageStore;
  budgets: UsageBudgets;
  minActionIntervalMs: number;
  clock?: RateLimitClock;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class UsageLimiter {
  private readonly store: UsageStore;
  private readonly budgets: UsageBudgets;
  private readonly minActionIntervalMs: number;
  private readonly clock: RateLimitClock;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private mutateChain: Promise<void> = Promise.resolve();
  private paceChain: Promise<void> = Promise.resolve();
  private lastActionAt = 0;

  constructor(options: UsageLimiterOptions) {
    this.store = options.store;
    this.budgets = options.budgets;
    this.minActionIntervalMs = options.minActionIntervalMs;
    this.clock = options.clock ?? { now: () => Date.now() };
    this.random = options.random ?? Math.random;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private capFor(category: UsageCategory): number {
    return this.budgets[category];
  }

  private async runSerialized<T>(op: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.mutateChain;
    this.mutateChain = next;
    await previous.catch(() => {});
    try {
      return await op();
    } finally {
      release();
    }
  }

  private async todayCounts(): Promise<{ date: string; counts: UsageCounts }> {
    const date = localDateKey(this.clock.now());
    const data = sanitizeUsageData(await this.store.load());
    return { date, counts: { ...(data[date] ?? {}) } };
  }

  private async persistToday(date: string, counts: UsageCounts): Promise<void> {
    await this.store.save({ [date]: counts });
  }

  private throwIfOver(category: UsageCategory, used: number): void {
    const cap = this.capFor(category);
    if (cap === 0) return;
    if (used >= cap) {
      throw new BudgetExceededError({
        category,
        cap,
        used,
        resetsAt: formatLocalMidnight(this.clock.now()),
      });
    }
  }

  async assertWithinBudget(category: UsageCategory): Promise<void> {
    await this.runSerialized(async () => {
      const { counts } = await this.todayCounts();
      this.throwIfOver(category, counts[category] ?? 0);
    });
  }

  async recordAttempt(category: UsageCategory): Promise<void> {
    await this.runSerialized(async () => {
      const { date, counts } = await this.todayCounts();
      const used = counts[category] ?? 0;
      this.throwIfOver(category, used);
      counts[category] = used + 1;
      await this.persistToday(date, counts);
    });
  }

  async recordInMailAttempt(dryRun: boolean): Promise<void> {
    if (dryRun) return;
    await this.recordAttempt("inmails");
  }

  async getUsageToday(): Promise<UsageToday> {
    return this.runSerialized(async () => {
      const { counts } = await this.todayCounts();
      const snapshot = (category: UsageCategory): CategoryUsage => {
        const used = counts[category] ?? 0;
        const cap = this.capFor(category);
        return { used, cap, remaining: remainingFor(used, cap) };
      };
      return {
        profileViews: snapshot("profileViews"),
        searches: snapshot("searches"),
        saves: snapshot("saves"),
        inmails: snapshot("inmails"),
        minActionIntervalMs: this.minActionIntervalMs,
      };
    });
  }

  async pace(): Promise<void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.paceChain;
    this.paceChain = next;
    await previous.catch(() => {});
    try {
      const interval = this.minActionIntervalMs;
      const jitter = Math.floor(interval * this.random() * 0.5);
      const required = interval + jitter;
      const elapsed = this.clock.now() - this.lastActionAt;
      const wait = this.lastActionAt === 0 ? 0 : Math.max(0, required - elapsed);
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.lastActionAt = this.clock.now();
    } finally {
      release();
    }
  }
}

let limiter: UsageLimiter | null = null;

export function configureRateLimit(
  usage: UsageConfig,
  deps: {
    store?: UsageStore;
    clock?: RateLimitClock;
    random?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): UsageLimiter {
  const store =
    deps.store ??
    createFileUsageStore(usage.usageFile ?? defaultUsageFilePath());
  limiter = new UsageLimiter({
    store,
    budgets: {
      profileViews: usage.dailyProfileViews,
      searches: usage.dailySearches,
      saves: usage.dailySaves,
      inmails: usage.dailyInmails,
    },
    minActionIntervalMs: usage.minActionIntervalMs,
    clock: deps.clock,
    random: deps.random,
    sleep: deps.sleep,
  });
  return limiter;
}

export function resetRateLimitForTests(): void {
  limiter = null;
  missingUsageFileWarned = false;
}

export function isRateLimitConfigured(): boolean {
  return limiter !== null;
}

export function getUsageLimiter(): UsageLimiter {
  if (!limiter) {
    throw new Error(
      "Usage limiter is not configured. Call configureRateLimit at startup."
    );
  }
  return limiter;
}

export async function assertWithinBudget(category: UsageCategory): Promise<void> {
  await getUsageLimiter().assertWithinBudget(category);
}

export async function recordAttempt(category: UsageCategory): Promise<void> {
  await getUsageLimiter().recordAttempt(category);
}

export async function recordInMailAttempt(dryRun: boolean): Promise<void> {
  await getUsageLimiter().recordInMailAttempt(dryRun);
}

export async function consumeSearchPage(): Promise<void> {
  await getUsageLimiter().recordAttempt("searches");
}

export async function readUsageToday(): Promise<UsageToday> {
  if (!limiter) {
    return emptyUsageToday(
      {
        profileViews: DEFAULT_USAGE.dailyProfileViews,
        searches: DEFAULT_USAGE.dailySearches,
        saves: DEFAULT_USAGE.dailySaves,
        inmails: DEFAULT_USAGE.dailyInmails,
      },
      DEFAULT_USAGE.minActionIntervalMs
    );
  }
  return limiter.getUsageToday();
}

export async function paceIfConfigured(): Promise<void> {
  if (!limiter) return;
  await limiter.pace();
}
