import { describe, expect, it } from "vitest";
import {
  AUTH_SELECTORS,
  INMAIL_SELECTORS,
  LIST_SELECTORS,
  PROFILE_SELECTORS,
  SEARCH_SELECTORS,
} from "../src/browser/selectors.js";

const GROUPS = {
  AUTH_SELECTORS,
  SEARCH_SELECTORS,
  PROFILE_SELECTORS,
  LIST_SELECTORS,
  INMAIL_SELECTORS,
} as const;

/** Per-build CSS-module class, e.g. `_headingText_e3b563`. */
const HASHED_CLASS = /_[a-zA-Z]+_[0-9a-f]{6}/;

function fieldSelectors(value: string | readonly string[]): string[] {
  const parts = typeof value === "string" ? value.split(",") : [...value];
  return parts.map((part) => part.trim()).filter(Boolean);
}

function firstChoice(value: string | readonly string[]): string {
  return fieldSelectors(value)[0] ?? "";
}

describe("selector groups", () => {
  it("are non-empty", () => {
    for (const [groupName, group] of Object.entries(GROUPS)) {
      const keys = Object.keys(group);
      expect(keys.length, `${groupName} has no fields`).toBeGreaterThan(0);
      for (const [field, value] of Object.entries(group)) {
        const selectors = fieldSelectors(value as string | readonly string[]);
        expect(selectors.length, `${groupName}.${field} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("have no duplicate entries within a field", () => {
    for (const [groupName, group] of Object.entries(GROUPS)) {
      for (const [field, value] of Object.entries(group)) {
        const selectors = fieldSelectors(value as string | readonly string[]);
        expect(selectors, `${groupName}.${field} has duplicates`).toEqual(
          [...new Set(selectors)]
        );
      }
    }
  });

  it("does not use a per-build hashed class as the first choice of a field", () => {
    for (const [groupName, group] of Object.entries(GROUPS)) {
      for (const [field, value] of Object.entries(group)) {
        const first = firstChoice(value as string | readonly string[]);
        expect(
          HASHED_CLASS.test(first),
          `${groupName}.${field} first choice looks hashed: ${first}`
        ).toBe(false);
      }
    }
  });
});
