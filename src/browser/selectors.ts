/**
 * CSS and XPath selectors for LinkedIn Sales Navigator pages.
 *
 * ⚠️ LinkedIn frequently updates their DOM structure.
 * These selectors may need updating. When they break,
 * use the browser inspector to find updated selectors.
 *
 * Last verified: 2026-08 (Sales Navigator UI v3, see issue #2)
 *
 * ## Robustness strategy (see issue #2)
 *
 * Sales Navigator's Ember build emits CSS-module class names with a
 * per-build content hash (e.g. `_headingText_e3b563`, `_button_ps32ck`).
 * Those hashes rotate on every deploy and are useless as stable
 * selectors - this is what broke profile lookup, list creation, save
 * lead, and InMail in the first place.
 *
 * Live inspection (2026-08) found that LinkedIn ships its own stable
 * hooks alongside the hashed classes, which we now prefer, in order:
 *
 *   1. `data-anonymize="..."` - a semantic field-type marker LinkedIn's
 *      own PII-masking tooling depends on (`person-name`, `headline`,
 *      `location`, `job-title`, `company-name`, `headshot-photo`, ...).
 *      Can't rotate per-build without breaking LinkedIn's own masking.
 *   2. `data-x--...` / `data-sn-view-name` / `data-control-name` -
 *      internal analytics/QA hooks tied to product behavior, not styling.
 *   3. Semantic HTML / ARIA (`h1`, `aria-label`) - an accessibility
 *      contract, independent of CSS.
 *   4. Shared `artdeco-*` design-system classes - used across *all*
 *      LinkedIn products, far more stable than product-local CSS modules.
 *   5. Playwright's `:has-text()` pseudo-class as a last resort for
 *      controls that expose their action only via visible text.
 *
 * Each selector below is a comma-separated CSS selector *list* (native
 * CSS "OR"), ordered from most to least likely to survive the next
 * LinkedIn deploy. `page.$()` / `page.$$()` / `waitForSelector()` all
 * evaluate the whole list and return the first match, so no extra
 * fallback plumbing is needed at the call site. Legacy pre-2025
 * classnames are kept as the final fallback in case an older UI variant
 * is served (e.g. A/B tests).
 *
 * A few topcard fields (profile headline/location) have no stable
 * selector at all in the current markup - `data-anonymize` is present
 * on some renders of these fields (e.g. inside the message-compose side
 * panel) but absent on the main lead profile topcard. Those are
 * extracted via a small DOM heuristic in `dom-extract.ts` instead of a
 * guessed selector.
 */

export const URLS = {
  BASE: "https://www.linkedin.com/sales",
  SEARCH_LEADS: "https://www.linkedin.com/sales/search/people",
  SEARCH_ACCOUNTS: "https://www.linkedin.com/sales/search/company",
  LEAD_LISTS: "https://www.linkedin.com/sales/lists/people",
  ACCOUNT_LISTS: "https://www.linkedin.com/sales/lists/company",
  HOME: "https://www.linkedin.com/sales/home",
  INBOX: "https://www.linkedin.com/sales/inbox",
  LOGIN: "https://www.linkedin.com/login",
} as const;

export const AUTH_SELECTORS = {
  /** Login page elements (linkedin.com/login, shared across all LinkedIn products - unaffected by Sales Nav's UI). */
  USERNAME_INPUT: "#username",
  PASSWORD_INPUT: "#password",
  LOGIN_BUTTON: 'button[type="submit"]',
  /** Verification/challenge selectors */
  CHALLENGE_PAGE: "#challenge",
  /** Logged-in indicators (Sales Nav shell) */
  SALES_NAV_HEADER: '[data-sn-view-name="feature-global-nav"], .global-header',
  PROFILE_ICON: '[data-x--dropdown-trigger--user], .global-header__me-photo',
} as const;

export const SEARCH_SELECTORS = {
  /** Search input and controls */
  KEYWORD_INPUT: '#global-typeahead-search-input, input[placeholder*="Search"]',
  SEARCH_BUTTON: 'button[data-action="search"]',

  /** Filter panel */
  FILTER_PANEL: ".search-filters-bar",
  FILTER_TITLE: 'button[data-filter="CURRENT_TITLE"]',
  FILTER_COMPANY: 'button[data-filter="CURRENT_COMPANY"]',
  FILTER_LOCATION: 'button[data-filter="REGION"]',
  FILTER_INDUSTRY: 'button[data-filter="INDUSTRY"]',
  FILTER_SENIORITY: 'button[data-filter="SENIORITY_LEVEL"]',
  FILTER_COMPANY_SIZE: 'button[data-filter="COMPANY_HEADCOUNT"]',
  FILTER_FUNCTION: 'button[data-filter="FUNCTION"]',
  FILTER_INPUT: ".search-filter-typeahead input",
  FILTER_APPLY: 'button[data-action="apply"]',

  /**
   * Results list.
   *
   * Verified 2026-08: each result is a `li.artdeco-list__item` inside an
   * `ol.artdeco-list`. Name/location/title/company are tagged with
   * `data-anonymize`, so we no longer depend on the entity-lockup's own
   * (also hashed-per-field-only-when-unlucky) CSS classes for those.
   */
  RESULTS_CONTAINER: ["ol.artdeco-list", ".search-results__result-list"],
  RESULT_ITEM: ["li.artdeco-list__item", "li.search-results__result-item"],
  RESULT_NAME: [
    '[data-anonymize="person-name"]',
    ".artdeco-entity-lockup__title a",
    ".result-lockup__name a",
  ],
  /**
   * NOTE: on search result rows `data-anonymize="job-title"` is *not*
   * the job title - it holds "X years in role / Y years in company"
   * metadata. The actual title uses `data-anonymize="title"` here
   * (confirmed 2026-08; inconsistent with the lead profile page, where
   * `job-title` *is* correct - see PROFILE_TITLE below). Falls back to
   * the free-text blurb when the lead has no structured position.
   *
   * `.artdeco-entity-lockup__subtitle` is an *ancestor* of the title and
   * also contains the company name, so it must stay strictly last and be
   * resolved in order (see `query.ts`).
   */
  RESULT_TITLE: [
    '[data-anonymize="title"]',
    '[data-anonymize="person-blurb"]',
    ".result-lockup__highlight-keyword",
    ".artdeco-entity-lockup__subtitle",
  ],
  RESULT_COMPANY: [
    '[data-anonymize="company-name"]',
    ".artdeco-entity-lockup__subtitle a",
    ".result-lockup__position-company a",
  ],
  RESULT_LOCATION: [
    '[data-anonymize="location"]',
    ".artdeco-entity-lockup__caption",
    ".result-lockup__misc-item",
  ],
  RESULT_LINK: [".artdeco-entity-lockup__title a", ".result-lockup__name a"],

  /** Save/message buttons on a search result row. */
  RESULT_SAVE_BUTTON: '[data-x--save-menu-trigger], button[aria-label^="Save "]',
  RESULT_MESSAGE_BUTTON: 'button[aria-label^="Message "]',

  /** Pagination */
  PAGINATION_CONTAINER: ".search-results__pagination",
  PAGINATION_NEXT: 'button[aria-label="Next"]',
  PAGINATION_PREV: 'button[aria-label="Previous"]',
  /** "<N>M+ results" counter. `_regular-search-count_` CSS-module prefix confirmed 2026-08 (only the trailing hash rotates). */
  TOTAL_RESULTS: '[class*="_regular-search-count_"], .search-results__result-count',

  /** No results */
  NO_RESULTS: ".search-results__no-results",
} as const;

export const PROFILE_SELECTORS = {
  /**
   * Lead profile page ("topcard").
   *
   * `#profile-card-section` is a plain DOM id and `data-sn-view-name`
   * is LinkedIn's own internal view-tracking hook - both confirmed
   * stable 2026-08, unlike the CSS-module `_card_<hash>` class next to them.
   */
  PROFILE_CONTAINER: [
    "#profile-card-section",
    '[data-sn-view-name="feature-lead-top-card"]',
    ".profile-topcard",
  ],
  /** `h1` is a11y-only page-title text ("Sales Navigator Lead Page") unless it also carries this attribute. */
  PROFILE_NAME: [
    "h1[data-x--lead--name]",
    '[data-anonymize="person-name"]',
    ".profile-topcard-person-entity__name",
  ],
  PROFILE_TITLE: ['[data-anonymize="job-title"]', ".profile-topcard__summary-position"],
  PROFILE_COMPANY: ['[data-anonymize="company-name"]', ".profile-topcard__summary-company"],
  /** Not present as data-anonymize on the topcard itself (only in side panels) - see dom-extract.ts fallback. */
  PROFILE_LOCATION: ['[data-anonymize="location"]', ".profile-topcard__summary-location"],
  PROFILE_HEADLINE: [
    "[data-x--lead-profile-card--headline]",
    '[data-anonymize="headline"]',
    ".profile-topcard__headline",
  ],
  PROFILE_ABOUT: [
    '[data-sn-view-name="feature-about-lead"] p',
    ".profile-topcard__summary-content",
  ],
  PROFILE_PHOTO: [
    'img[data-anonymize="headshot-photo"]',
    ".profile-topcard-person-entity__image img",
  ],

  /** Connection info */
  CONNECTION_DEGREE: ".profile-topcard__connection-degree",
  SHARED_CONNECTIONS: '[data-sn-view-name="shared-in-common"], .profile-topcard__shared-connections',

  /**
   * Action buttons - keyed off `data-x--...` hooks / `aria-label`, not
   * the `data-action` attributes that have been removed from the
   * current markup entirely.
   */
  SAVE_BUTTON: [
    "[data-x--lead-save-cta]",
    "[data-x--save-menu-trigger]",
    'button[aria-label^="Save "]',
  ],
  UNSAVE_BUTTON: ['button[aria-label^="Unsave "]', 'button[aria-label^="Remove "]'],
  /** "Message" wording when free-to-contact, "InMail" when it will consume a credit - match either. */
  SEND_INMAIL_BUTTON: [
    'button[aria-label^="Message "]',
    'button[aria-label*="InMail" i]',
    'button:has-text("Message")',
  ],
  ADD_TO_LIST_BUTTON: [
    "[data-x--lead-save-cta]",
    "[data-x--save-menu-trigger]",
    'button:has-text("Save to list")',
  ],

  /**
   * Experience section. Each entry is an `<li>` with a fully random
   * per-instance class (no stable prefix at all, unlike the topcard's
   * CSS modules) - scoped via Playwright's `:has()` on the
   * `data-anonymize="job-title"` anchor instead of the `<li>`'s own class.
   */
  EXPERIENCE_SECTION: [
    '[data-sn-view-name="feature-lead-experience"]',
    "[data-x--lead--experience-section]",
    ".profile-experience",
  ],
  EXPERIENCE_ITEM: [
    '[data-sn-view-name="feature-lead-experience"] li:has([data-anonymize="job-title"])',
    ".profile-experience__card",
  ],
  EXPERIENCE_TITLE: ['[data-anonymize="job-title"]', ".profile-experience__title"],
  EXPERIENCE_COMPANY: ['[data-anonymize="company-name"]', ".profile-experience__company"],
  /**
   * Date ranges are rendered as a single "<start>–<end>" span with a
   * fully random per-instance class and no `data-anonymize` marker, so
   * there is nothing to select on. `extractEntryDatesBrowser()` in
   * `dom-extract.ts` finds them by content (a 4-digit year) instead;
   * this selector only covers the legacy markup.
   */
  EXPERIENCE_DATES: [".profile-experience__dates", "time"],

  /** Education section - same random-per-instance `<li>` class situation as experience. */
  EDUCATION_SECTION: ['[data-sn-view-name="feature-lead-education"]', ".profile-education"],
  EDUCATION_ITEM: [
    '[data-sn-view-name="feature-lead-education"] li:has([data-anonymize="education-name"])',
    ".profile-education__card",
  ],
  EDUCATION_SCHOOL: ['[data-anonymize="education-name"]', ".profile-education__school"],
  /**
   * No `data-anonymize` marker exists for degree at all - it's the
   * first plain `<span>` inside the entry, after the school link.
   * Best-effort; a missing match is treated as absent data rather than
   * an error (see `tools/leads.ts`).
   */
  EDUCATION_DEGREE: [".profile-education__degree", "span"],
} as const;

export const LIST_SELECTORS = {
  /** Lead lists page */
  LISTS_CONTAINER: ['[data-sn-view-name="lead-list-hub"]', ".lists-container"],
  LIST_ITEM: ["[data-x--list-hub--row]", ".lists-nav__list-item"],
  LIST_NAME: ["[data-x--list-hub--list-name]", ".lists-nav__list-name"],
  /** The saved-lead count cell of a list-hub row (confirmed 2026-08). */
  LIST_COUNT: ["td.list-hub__saved-entities--width", ".lists-nav__list-count"],
  CREATE_LIST_BUTTON: [
    "[data-x--list-nav--create-list-dropdown-trigger]",
    'button[data-action="create-list"]',
    'button:has-text("Create lead list")',
  ],
  LIST_NAME_INPUT: ["[data-x--text-input-field]", 'input[data-action="list-name"]'],
  LIST_SAVE_BUTTON: [
    "[data-x--lists--create-modal-save-button]",
    'button[data-action="save-list"]',
    'button:has-text("Create")',
  ],

  /** List detail view */
  LIST_LEADS: ".list-detail__results",
  LIST_LEAD_ITEM: ".list-detail__result-item",
} as const;

export const INMAIL_SELECTORS = {
  /** InMail/message compose modal. `data-x-conversation-widget="compose-form"` confirmed 2026-08. */
  COMPOSE_MODAL: ['[data-x-conversation-widget="compose-form"]', ".compose-form"],
  SUBJECT_INPUT: ['[aria-label="Subject (required)"]', 'input[name="subject"]'],
  BODY_INPUT: [
    '[aria-label^="Type your message"]',
    'textarea[name="body"]',
    ".compose-form__message-field",
  ],
  SEND_BUTTON: [
    '[data-x-conversation-widget="compose-form"] button:has-text("Send")',
    '.compose-form button:has-text("Send")',
  ],
  /** `data-control-name="overlay.close_overlay"` is a long-standing LinkedIn-wide tracking attribute, not Sales-Nav-specific. */
  CANCEL_BUTTON: [
    '[data-control-name="overlay.close_overlay"]',
    'button[data-action="cancel"]',
    'button:has-text("Cancel")',
  ],

  /**
   * InMail credits. Rendered as plain text ("InMail credits: 149 left")
   * in the Sales Navigator inbox header, with no dedicated class, so
   * it is matched on content rather than by selector.
   */
  CREDITS_INDICATOR: ".inmail-credits-indicator",
  CREDITS_COUNT: [
    '*:text-matches("InMail credits:\\\\s*\\\\d+")',
    ".inmail-credits-indicator__count",
  ],

  /**
   * Confirmation.
   *
   * Do NOT use a bare `[role="alert"]` here. The compose panel
   * permanently renders a CRM notice ("Unable to log because you are
   * disconnected. Connect to CRM") with that role, entirely unrelated
   * to sending. Treating it as a send error reported successfully
   * delivered InMails as failures.
   *
   * Send success is therefore determined by the compose form closing
   * (see `tools/inmails.ts`), not by hunting for an error element.
   */
  SEND_SUCCESS: ".compose-form__success",
  SEND_ERROR: [
    '[data-x-conversation-widget="compose-form"] .compose-form__error',
    ".compose-form .compose-form__error",
  ],
} as const;

/**
 * Wait conditions for page loads
 */
export const WAIT_CONDITIONS = {
  /** Time to wait after navigation (ms) */
  NAVIGATION_DELAY: 2000,
  /** Time to wait between actions to appear human (ms) */
  ACTION_DELAY: 1000,
  /** Time to wait for search results to load (ms) */
  SEARCH_RESULTS_TIMEOUT: 15000,
  /** Time to wait for profile to load (ms) */
  PROFILE_LOAD_TIMEOUT: 10000,
  /** Minimum random delay between actions (ms) */
  MIN_HUMAN_DELAY: 500,
  /** Maximum random delay between actions (ms) */
  MAX_HUMAN_DELAY: 2000,
  /**
   * Extra settle time after clicking a button whose enabled/disabled
   * state or label changes asynchronously (e.g. Save -> Saved, list
   * modal Create button enabling once the name field is non-empty).
   * See issue #2: several tools clicked a button while it was still
   * mid-transition and the click was swallowed.
   */
  BUTTON_STATE_SETTLE: 800,
} as const;
