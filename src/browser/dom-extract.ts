/**
 * Structural DOM-heuristic fallbacks for LinkedIn Sales Navigator fields
 * that have no stable selector in the current markup (see issue #2).
 *
 * The lead profile topcard's headline and location are rendered inside
 * per-build CSS-module hashed elements with no `data-anonymize` marker
 * on this page (unlike search results, where they are tagged - see
 * `selectors.ts`). Rather than guess a class name that will rot on the
 * next deploy, `extractTopcardFieldsBrowser` locates the topcard by
 * walking up from two independently stable anchors - the profile name
 * heading and the "Save" button - and then reads plain text by
 * position, the same way a human falls back to the inspector once
 * selectors stop working.
 *
 * This function is passed directly to Playwright's `page.evaluate()`,
 * which serializes it and runs it in the page's own context. It must
 * stay self-contained (browser globals only, no imports).
 */

export interface TopcardHeuristicResult {
  name: string | null;
  headline: string | null;
  location: string | null;
  connectionDegree: string | null;
}

/** Runs inside the browser via `page.evaluate(extractTopcardFieldsBrowser)`. */
export function extractTopcardFieldsBrowser(): TopcardHeuristicResult {
  const nameEl =
    document.querySelector("h1[data-x--lead--name]") ||
    document.querySelector('[data-anonymize="person-name"]') ||
    Array.from(document.querySelectorAll("h1")).find(
      (h) => !h.classList.contains("a11y-text")
    ) ||
    null;

  if (!nameEl) {
    return { name: null, headline: null, location: null, connectionDegree: null };
  }

  const name = nameEl.textContent?.trim() || null;

  // Locate the topcard as the smallest ancestor of the name that also
  // contains the Save button, instead of trusting a container class.
  const saveBtn = document.querySelector(
    '[data-x--lead-save-cta], [data-x--save-menu-trigger], button[aria-label^="Save "]'
  );

  let topcard: Element = nameEl;
  if (saveBtn) {
    let candidate: Element | null = nameEl;
    while (candidate && !candidate.contains(saveBtn)) {
      candidate = candidate.parentElement;
    }
    if (candidate) topcard = candidate;
  } else {
    // No Save button visible (e.g. already saved and layout differs) -
    // fall back to a fixed number of ancestor levels.
    for (let i = 0; i < 5 && topcard.parentElement; i++) {
      topcard = topcard.parentElement;
    }
  }

  // Plain leaf text nodes inside the topcard, in document order,
  // skipping button/link labels (those are actions, not profile data)
  // and accessibility-only text. An element counts as a text "leaf"
  // even if it has icon children (e.g. the location pin `<svg>`), as
  // long as none of its children are themselves text-bearing elements.
  const isIconOnly = (el: Element) =>
    // SVG elements live in the SVG namespace and report a lowercase
    // `tagName` ("svg"), unlike HTML elements ("DIV") - compare
    // case-insensitively or this silently never matches.
    Array.from(el.children).every((c) => /^(svg|img)$/i.test(c.tagName));
  const leaves = Array.from(topcard.querySelectorAll("*")).filter(
    (el) =>
      (el.children.length === 0 || isIconOnly(el)) &&
      !!el.textContent?.trim() &&
      !el.closest("button") &&
      !el.classList.contains("a11y-text")
  );
  const texts = leaves.map((el) => el.textContent!.trim());

  const nameIndex = texts.findIndex((t) => t === name);
  const degreePattern = /^(1st|2nd|3rd\+?)$/i;

  const afterName = nameIndex >= 0 ? nameIndex + 1 : 0;
  const connectionDegree = degreePattern.test(texts[afterName] || "")
    ? texts[afterName]
    : null;

  const CHROME_LABELS = new Set(["CRM", "First time view", "Viewed"]);
  // "123 connections", "500+ connections" etc. sit right after location
  // in DOM order - once seen, location (if any) has already been read.
  const connectionsCountPattern = /^\d[\d,]*\+?\s*connections?$/i;
  let headline: string | null = null;
  let location: string | null = null;

  for (let i = afterName; i < texts.length; i++) {
    const t = texts[i];
    if (!t || CHROME_LABELS.has(t) || degreePattern.test(t) || /^Viewed:/.test(t)) {
      continue;
    }
    if (!headline) {
      headline = t;
      continue;
    }
    if (connectionsCountPattern.test(t) || /mutual connection|recent post/i.test(t)) {
      break;
    }
    // Location: whatever plain text block immediately follows the
    // headline, as long as it doesn't look like a headline itself
    // (LinkedIn headlines use "|" as a section separator; locations
    // never do) and isn't excessively long. Not all locations contain
    // a comma (e.g. a single country name), so that's not required.
    if (!location && !t.includes("|") && t.length < 80) {
      location = t;
      continue;
    }
  }

  return { name, headline, location, connectionDegree };
}

/**
 * Find the date range ("Aug 2008–Present", "2001–2004", ...) inside a
 * single experience or education entry.
 *
 * The date span carries a fully random per-instance class name and no
 * `data-anonymize` marker, so there is no selector to target it with.
 * We identify it by content instead: the shortest leaf element in the
 * entry containing a 4-digit year.
 *
 * Runs in the browser via `elementHandle.evaluate(extractEntryDatesBrowser)`.
 */
export function extractEntryDatesBrowser(entry: Element): string | null {
  const candidates = Array.from(entry.querySelectorAll("*")).filter(
    (el) => el.children.length === 0 && /\b\d{4}\b/.test(el.textContent || "")
  );
  if (candidates.length === 0) return null;

  // Prefer the most specific (shortest) match - a parent block would
  // otherwise drag in surrounding prose.
  candidates.sort(
    (a, b) => (a.textContent || "").trim().length - (b.textContent || "").trim().length
  );
  return candidates[0].textContent?.trim() || null;
}
