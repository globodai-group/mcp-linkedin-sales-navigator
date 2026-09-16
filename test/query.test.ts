import { describe, expect, it } from "vitest";
import {
  anyOf,
  normalizeWhitespace,
  queryAll,
  queryFirst,
  stripSuffix,
  textOfField,
  textOfFirst,
  toSelectorArray,
} from "../src/browser/query.js";

type FakeNode = {
  id: string;
  text?: string;
  matches: (selector: string) => boolean;
  children?: FakeNode[];
};

class FakeElement {
  constructor(readonly node: FakeNode) {}

  async $(selector: string): Promise<FakeElement | null> {
    return firstMatch(this.node.children ?? [], selector);
  }

  async $$(selector: string): Promise<FakeElement[]> {
    return allMatches(this.node.children ?? [], selector);
  }

  async textContent(): Promise<string | null> {
    return this.node.text ?? null;
  }
}

class FakePage {
  constructor(private readonly roots: FakeNode[]) {}

  async $(selector: string): Promise<FakeElement | null> {
    return firstMatch(this.roots, selector);
  }

  async $$(selector: string): Promise<FakeElement[]> {
    return allMatches(this.roots, selector);
  }
}

/** Document-order walk. Comma lists match the first node that hits any part. */
function firstMatch(roots: FakeNode[], selector: string): FakeElement | null {
  const parts = selector.split(",").map((part) => part.trim());
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (parts.some((part) => node.matches(part))) {
      return new FakeElement(node);
    }
    if (node.children) stack.unshift(...node.children);
  }
  return null;
}

function allMatches(roots: FakeNode[], selector: string): FakeElement[] {
  const parts = selector.split(",").map((part) => part.trim());
  const found: FakeElement[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (parts.some((part) => node.matches(part))) {
      found.push(new FakeElement(node));
    }
    if (node.children) stack.unshift(...node.children);
  }
  return found;
}

/** Search-result lockup: ancestor subtitle wraps the real title (PR #3 trap). */
function searchResultLockup(): FakePage {
  return new FakePage([
    {
      id: "lockup",
      matches: () => false,
      children: [
        {
          id: "subtitle",
          text: "Founder and Managing Director\n\n Vatsa Solutions",
          matches: (selector) => selector === ".artdeco-entity-lockup__subtitle",
          children: [
            {
              id: "title",
              text: "Founder and Managing Director",
              matches: (selector) => selector === '[data-anonymize="title"]',
            },
          ],
        },
      ],
    },
  ]);
}

const TITLE_THEN_SUBTITLE = [
  '[data-anonymize="title"]',
  ".artdeco-entity-lockup__subtitle",
] as const;

describe("toSelectorArray / anyOf", () => {
  it("wraps a single selector", () => {
    expect(toSelectorArray(".only")).toEqual([".only"]);
  });

  it("keeps a prioritised list in order", () => {
    expect(toSelectorArray(TITLE_THEN_SUBTITLE)).toEqual([...TITLE_THEN_SUBTITLE]);
  });

  it("joins candidates for existence-only waits", () => {
    expect(anyOf(TITLE_THEN_SUBTITLE)).toBe(
      '[data-anonymize="title"], .artdeco-entity-lockup__subtitle'
    );
  });
});

describe("queryFirst", () => {
  it("returns the first selector when that element is present", async () => {
    const page = searchResultLockup();
    const found = await queryFirst(page, TITLE_THEN_SUBTITLE);
    expect(found).not.toBeNull();
    expect((found as FakeElement).node.id).toBe("title");
  });

  it("falls through to a later selector when earlier ones miss", async () => {
    const page = new FakePage([
      {
        id: "blurb",
        text: "Open to work",
        matches: (selector) => selector === '[data-anonymize="person-blurb"]',
      },
    ]);
    const found = await queryFirst(page, [
      '[data-anonymize="title"]',
      '[data-anonymize="person-blurb"]',
      ".artdeco-entity-lockup__subtitle",
    ]);
    expect((found as FakeElement).node.id).toBe("blurb");
  });

  it("returns null when no selector matches", async () => {
    const page = new FakePage([
      { id: "unrelated", matches: (selector) => selector === ".other" },
    ]);
    await expect(queryFirst(page, TITLE_THEN_SUBTITLE)).resolves.toBeNull();
  });

  it("does not let an ancestor matching a lower-priority selector win", async () => {
    const page = searchResultLockup();

    // CSS document-order trap: comma list returns the ancestor first.
    const commaHit = await page.$(anyOf(TITLE_THEN_SUBTITLE));
    expect((commaHit as FakeElement).node.id).toBe("subtitle");

    const prioritised = await queryFirst(page, TITLE_THEN_SUBTITLE);
    expect((prioritised as FakeElement).node.id).toBe("title");
    expect(prioritised).not.toBe(commaHit);
    expect(await (prioritised as FakeElement).textContent()).toBe(
      "Founder and Managing Director"
    );
  });

  it("treats a rejected $ as a miss and continues", async () => {
    const page = {
      async $(_selector: string) {
        throw new Error("detached");
      },
      async $$() {
        return [];
      },
    };
    await expect(queryFirst(page, TITLE_THEN_SUBTITLE)).resolves.toBeNull();
  });
});

describe("queryAll", () => {
  it("returns every match of the highest-priority selector only", async () => {
    const page = new FakePage([
      {
        id: "t1",
        matches: (selector) => selector === '[data-anonymize="title"]',
      },
      {
        id: "t2",
        matches: (selector) => selector === '[data-anonymize="title"]',
      },
      {
        id: "sub",
        matches: (selector) => selector === ".artdeco-entity-lockup__subtitle",
      },
    ]);
    const found = await queryAll(page, TITLE_THEN_SUBTITLE);
    expect(found.map((el) => (el as FakeElement).node.id)).toEqual(["t1", "t2"]);
  });

  it("falls through when the first selector matches nothing", async () => {
    const page = new FakePage([
      {
        id: "sub",
        matches: (selector) => selector === ".artdeco-entity-lockup__subtitle",
      },
    ]);
    const found = await queryAll(page, TITLE_THEN_SUBTITLE);
    expect(found.map((el) => (el as FakeElement).node.id)).toEqual(["sub"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const page = new FakePage([]);
    await expect(queryAll(page, TITLE_THEN_SUBTITLE)).resolves.toEqual([]);
  });
});

describe("textOfFirst", () => {
  it("returns trimmed text of the prioritised match", async () => {
    const page = searchResultLockup();
    await expect(textOfFirst(page, TITLE_THEN_SUBTITLE)).resolves.toBe(
      "Founder and Managing Director"
    );
  });

  it("returns null when no element matches", async () => {
    await expect(textOfFirst(new FakePage([]), TITLE_THEN_SUBTITLE)).resolves.toBeNull();
  });

  it("returns null for whitespace-only text", async () => {
    const page = new FakePage([
      {
        id: "title",
        text: "   \n",
        matches: (selector) => selector === '[data-anonymize="title"]',
      },
    ]);
    await expect(textOfFirst(page, TITLE_THEN_SUBTITLE)).resolves.toBeNull();
  });

  it("skips empty matches when requireText is set and tries the next selector", async () => {
    const page = new FakePage([
      {
        id: "title",
        text: "  ",
        matches: (selector) => selector === '[data-anonymize="title"]',
      },
      {
        id: "blurb",
        text: "Open to work",
        matches: (selector) => selector === '[data-anonymize="person-blurb"]',
      },
    ]);
    const selectors = [
      '[data-anonymize="title"]',
      '[data-anonymize="person-blurb"]',
    ] as const;
    await expect(textOfFirst(page, selectors)).resolves.toBeNull();
    await expect(textOfFirst(page, selectors, { requireText: true })).resolves.toBe(
      "Open to work"
    );
    await expect(textOfField(page, selectors)).resolves.toBe("Open to work");
  });
});

describe("normalizeWhitespace / stripSuffix", () => {
  it("collapses ragged LinkedIn template whitespace", () => {
    expect(normalizeWhitespace("Founder\n\n  Vatsa")).toBe("Founder Vatsa");
  });

  it("drops a trailing company suffix", () => {
    expect(stripSuffix("Founder and Managing Director Vatsa Solutions", "Vatsa Solutions")).toBe(
      "Founder and Managing Director "
    );
  });

  it("leaves the text unchanged when the suffix is empty or absent", () => {
    expect(stripSuffix("Founder", "")).toBe("Founder");
    expect(stripSuffix("Founder", "Other Co")).toBe("Founder");
  });
});
