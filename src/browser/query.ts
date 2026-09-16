/**
 * Ordered selector resolution.
 *
 * Several fields need a *prioritised* list of selectors: try the most
 * reliable hook first, fall back to progressively weaker ones.
 *
 * A comma-separated CSS list does NOT express that priority. Per the CSS
 * spec, `querySelector("a, b")` returns the first element in *document
 * order* matching either selector - not the first element matching the
 * first-listed selector. On Sales Navigator that difference is not
 * academic: a search result's title is
 * `[data-anonymize="title"]`, but its ancestor also matches
 * `.artdeco-entity-lockup__subtitle`, so the comma form returned the
 * ancestor and yielded "Founder and Managing Director\n\n Vatsa
 * Solutions" instead of the title alone.
 *
 * These helpers evaluate each selector in turn and return the first that
 * matches, which is what the fallback ordering actually intends.
 */

import type { ElementHandle } from "playwright";

/** A single selector, or a prioritised list of them (highest priority first). */
export type SelectorList = string | readonly string[];

type Queryable = {
  $(selector: string): Promise<ElementHandle<SVGElement | HTMLElement> | null>;
  $$(selector: string): Promise<ElementHandle<SVGElement | HTMLElement>[]>;
};

export function toSelectorArray(selectors: SelectorList): readonly string[] {
  return typeof selectors === "string" ? [selectors] : selectors;
}

/**
 * A single CSS selector matching any of the candidates. Only valid where
 * *existence* matters and priority does not - e.g. `waitForSelector`.
 */
export function anyOf(selectors: SelectorList): string {
  return toSelectorArray(selectors).join(", ");
}

/** First element matching the highest-priority selector that matches at all. */
export async function queryFirst(
  scope: Queryable,
  selectors: SelectorList
): Promise<ElementHandle<SVGElement | HTMLElement> | null> {
  for (const selector of toSelectorArray(selectors)) {
    const element = await scope.$(selector).catch(() => null);
    if (element) return element;
  }
  return null;
}

/** All elements matching the highest-priority selector that matches at all. */
export async function queryAll(
  scope: Queryable,
  selectors: SelectorList
): Promise<ElementHandle<SVGElement | HTMLElement>[]> {
  for (const selector of toSelectorArray(selectors)) {
    const elements = await scope.$$(selector).catch(() => []);
    if (elements.length > 0) return elements;
  }
  return [];
}

/** Collapse the ragged whitespace LinkedIn's templates leave behind. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Drop a trailing occurrence of `suffix` (e.g. the company name). */
export function stripSuffix(text: string, suffix: string): string {
  if (!suffix) return text;
  const trimmed = text.trimEnd();
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : text;
}

/** Trimmed text of the first matching element, or null. */
export async function textOfFirst(
  scope: Queryable,
  selectors: SelectorList
): Promise<string | null> {
  const element = await queryFirst(scope, selectors);
  if (!element) return null;
  const text = await element.textContent().catch(() => null);
  return text?.trim() || null;
}
