import { describe, expect, it } from "vitest";
import {
  LIST_ID_PATTERN,
  assertListId,
  assertSalesNavigatorUrl,
  isSalesNavigatorUrl,
  listIdSchema,
  parseSalesNavigatorUrl,
  salesNavigatorUrlSchema,
} from "../src/browser/url.js";

describe("parseSalesNavigatorUrl", () => {
  it("accepts https www.linkedin.com /sales/ paths", () => {
    const url = parseSalesNavigatorUrl("https://www.linkedin.com/sales/lead/x");
    expect(url.hostname).toBe("www.linkedin.com");
    expect(url.pathname).toBe("/sales/lead/x");
  });

  it("accepts https linkedin.com /sales/ paths", () => {
    expect(isSalesNavigatorUrl("https://linkedin.com/sales/search/people")).toBe(
      true
    );
  });

  it("trims surrounding whitespace", () => {
    expect(
      assertSalesNavigatorUrl("  https://www.linkedin.com/sales/lead/x  ")
    ).toBe("https://www.linkedin.com/sales/lead/x");
  });

  it("rejects hosts that only contain /sales/ in the path", () => {
    expect(() =>
      assertSalesNavigatorUrl("https://evil.test/sales/lead/x")
    ).toThrow(/hostname/);
    expect(() => assertSalesNavigatorUrl("http://127.0.0.1/sales/")).toThrow(
      /https/
    );
    expect(() =>
      assertSalesNavigatorUrl("https://www.linkedin.com.evil.test/sales/lead/x")
    ).toThrow(/hostname/);
  });

  it("rejects http on a valid host", () => {
    expect(() =>
      assertSalesNavigatorUrl("http://www.linkedin.com/sales/lead/x")
    ).toThrow(/https/);
  });

  it("rejects path traversal that leaves /sales/", () => {
    expect(() =>
      assertSalesNavigatorUrl("https://www.linkedin.com/sales/../../../evil")
    ).toThrow(/pathname/);
  });

  it("rejects credentials in the URL", () => {
    expect(() =>
      assertSalesNavigatorUrl("https://user:pass@www.linkedin.com/sales/lead/x")
    ).toThrow(/credentials/);
  });

  it("rejects a pathname that is only /sales without a trailing segment", () => {
    expect(isSalesNavigatorUrl("https://www.linkedin.com/sales")).toBe(false);
  });
});

describe("salesNavigatorUrlSchema", () => {
  it("accepts a valid profile URL", () => {
    const parsed = salesNavigatorUrlSchema.safeParse(
      "https://www.linkedin.com/sales/lead/x"
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects evil.test before any navigation", () => {
    const parsed = salesNavigatorUrlSchema.safeParse(
      "https://evil.test/sales/lead/x"
    );
    expect(parsed.success).toBe(false);
  });
});

describe("assertListId", () => {
  it("accepts alphanumeric tokens", () => {
    expect(assertListId("abc-123_X")).toBe("abc-123_X");
    expect(LIST_ID_PATTERN.test("abc-123_X")).toBe(true);
  });

  it("rejects path traversal and reserved characters", () => {
    expect(() => assertListId("../../inbox")).toThrow(/listId/);
    expect(() => assertListId("foo/bar")).toThrow(/listId/);
    expect(() => assertListId("foo?x=1")).toThrow(/listId/);
    expect(() => assertListId("")).toThrow(/listId/);
  });

  it("rejects traversal via the zod schema", () => {
    expect(listIdSchema.safeParse("../../inbox").success).toBe(false);
    expect(listIdSchema.safeParse("ok-list_1").success).toBe(true);
  });
});
