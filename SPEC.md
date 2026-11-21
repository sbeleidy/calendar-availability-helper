# Spec: Shared Availability & When2meet-Style Group Heatmap

## Assumptions

Before implementation begins, this specification assumes:
1. **100% client-side architecture** — No backend or database will be introduced. All participant data is stored locally in `localStorage` so the app continues to deploy as a static SPA on GitHub Pages.
2. **Existing data stays backwards-compatible** — `slotpicker_availability_v1` (`AvailabilityBlock[]`) remains the source of truth for `"Me"`. Existing users will not lose saved blocks or calendars.
3. **English date/time parsing in v1** — The text parser targets English weekday/month names, 12-hour (`2–4 PM`) and 24-hour (`14:00–16:00`) ranges, SlotPicker's own bullet formats, and common North American / European / UTC time zone abbreviations plus IANA IDs.
4. **View separation** — Editing your own availability continues to happen in **Edit My Availability** mode (unchanged UX); comparing overlap happens in **Group Heatmap** mode.

---

## Objective

Enable SlotPicker users to paste other people's availability (from emails, Slack messages, or another SlotPicker export), compare everyone's windows in a toggleable **When2meet-style Group Heatmap** view on the weekly grid, and export the resulting shared availability windows in any time zone.

### User Stories
- **Paste someone's availability**: As a user, I can click **+ Paste Availability**, enter a participant's name (e.g. "Alex"), paste text like `"Tue 2-4 PM EST, Thu 10am-12pm"`, see a live preview of parsed time blocks (with warnings for any unparsed lines), and save them.
- **Find overlapping times visually**: As a user, I can switch to **Group Heatmap** mode to see 15-minute / contiguous overlap shading across all enabled participants (including myself), where darker shading means more people are free.
- **Inspect who is available**: As a user, I can hover over (or focus) any shaded slot in the heatmap to see the exact time range, how many people are free (`k / N`), who is available, and who is unavailable.
- **Run what-if comparisons**: As a user, I can toggle individual participants (including myself) on or off in the sidebar, and filter the heatmap by a minimum overlap threshold (`Everyone` or `≥ K of N`), to see how the shared windows change.
- **Navigate to out-of-week availability**: As a user, if someone pasted availability for a different week, the sidebar tells me and lets me jump to that week in one click.
- **Export shared times**: As a user, when I click **Submit**, I can switch between **My Availability** and **Shared Availability** (with a minimum-overlap selector) and copy a formatted bullet list in any presentation time zone.

---

## Tech Stack

- **Framework**: React `^19.1.0`, React DOM `^19.1.0`
- **Language**: TypeScript `~5.8.3` (strict mode via `tsconfig.app.json`)
- **Build tool**: Vite `^6.3.5` (`base: './'`)
- **UI primitives**: `@base-ui/react` `^1.0.0` (`Dialog`, `Tabs`, `Checkbox`, `Switch`, `Select`, `Popover`)
- **Icons**: `lucide-react` `^0.511.0`
- **Date/Time**: `temporal-polyfill` `^0.3.0` (`globalThis.Temporal`)
- **Styling**: Plain CSS with CSS custom properties (`src/index.css`) supporting `[data-theme='light']` and `[data-theme='dark']`
- **Proposed test runner (Ask First)**: `vitest` for pure utility unit tests (`availabilityParser.ts`, `sharedAvailability.ts`, `temporal.ts`)

---

## Commands

```sh
# Install dependencies
npm ci

# Start local dev server (with /api/ical proxy)
npm run dev

# Type-check and production build
npm run build

# Preview production build locally
npm run preview

# Run unit tests (once Vitest is approved & added)
npm test
```

---

## Project Structure

Existing layout + proposed additions (marked with `+`):

```text
src/
├── App.tsx                                # Top-level state, view mode toggle, participant state & persistence
├── types.ts                               # Add ParticipantAvailability, CalendarViewMode, HeatmapSegment
├── index.css                              # Add mode toggle, participant list, paste dialog, & heatmap styles
├── components/
│   ├── CalendarSidebar.tsx                # Add "Others' Availability" section (or compose ParticipantsSection)
│   ├── WeekCalendarGrid.tsx               # Existing "Edit My Availability" grid (unchanged editing behavior)
│   ├── + HeatmapCalendarGrid.tsx          # When2meet-style group overlap grid, legend, filter, & hover tooltip
│   ├── + AddParticipantDialog.tsx         # Paste-text modal with live parse preview, TZ override, & edit support
│   ├── AvailabilityOutputDialog.tsx       # Add "My Availability" vs "Shared Availability" toggle + min-overlap filter
│   ├── ConnectCalendarDialog.tsx          # Unchanged
│   └── TimeZoneSelect.tsx                 # Reused in AddParticipantDialog
└── utils/
    ├── temporal.ts                        # Extend formatAvailabilityBulletList with optional custom heading
    ├── + availabilityParser.ts            # Pure text-to-AvailabilityBlock[] parser + TZ/date resolution
    ├── + sharedAvailability.ts            # Pure sweep-line overlap & shared-interval computation
    ├── demoData.ts                        # Unchanged
    ├── googleCalendar.ts                  # Unchanged
    └── icsParser.ts                       # Unchanged
tests/                                     # + Unit tests (if Vitest is approved)
├── availabilityParser.test.ts
└── sharedAvailability.test.ts
```

---

## Architecture & Detailed Design

### 1. Data Model (`src/types.ts`)

```ts
export type CalendarViewMode = 'edit' | 'heatmap';

export interface ParticipantAvailability {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  /** Original pasted text preserved so the user can edit & re-parse later */
  rawText: string;
  /** Fallback IANA time zone used when pasted text omits a time zone */
  defaultTimeZone: string;
  /** Reference week start (YYYY-MM-DD) used for weekday-only lines like "Tue 2-4 PM" */
  referenceWeekStart: string;
  /** Parsed & merged epoch-ms intervals */
  blocks: AvailabilityBlock[];
  updatedAt: number;
}

export interface HeatmapSegment {
  startMs: number;
  endMs: number;
  availableIds: string[];
  unavailableIds: string[];
  count: number;
  total: number;
}
```

- **Persistence**: Save `participants: ParticipantAvailability[]` in `localStorage` under `slotpicker_participants_v1`, and `includeMeInHeatmap: boolean` under `slotpicker_include_me_v1` (default `true`).
- **"Me" representation**: Treated as a virtual participant `{ id: '__me__', name: 'Me', enabled: includeMeInHeatmap, blocks: availabilityBlocks }` when feeding into `sharedAvailability.ts`.

### 2. Text Availability Parser (`src/utils/availabilityParser.ts`)

Pure function signature:

```ts
export interface ParseAvailabilityOptions {
  /** Fallback IANA time zone if text does not specify one */
  defaultTimeZone: string;
  /** YYYY-MM-DD start of the reference week for weekday-only inputs (e.g. "Tue 2-4 PM") */
  referenceWeekStart: string;
}

export interface ParsedLineResult {
  lineNumber: number;
  rawLine: string;
  status: 'parsed' | 'header' | 'ignored' | 'unparsed';
  blocks: AvailabilityBlock[];
  reason?: string;
}

export interface ParseAvailabilityResult {
  blocks: AvailabilityBlock[];
  detectedTimeZone: string | null;
  lines: ParsedLineResult[];
  warnings: string[];
}

export function parseAvailabilityText(
  text: string,
  options: ParseAvailabilityOptions
): ParseAvailabilityResult;
```

**Supported input patterns:**
1. **SlotPicker round-trip formats**:
   - Header time zone detection: `Available Times (America/New_York / EST):` or `**Available Times (America/Los_Angeles / PST):**`
   - Standard & Markdown multi-line:
     ```text
     • Tue, Nov 24:
       - 10:00 AM – 12:00 PM EST
       - 2:00 PM – 4:30 PM EST
     ```
   - Compact single-line:
     ```text
     • Tue, Nov 24: 10:00 AM – 12:00 PM, 2:00 PM – 4:30 PM
     ```
2. **Casual email / Slack formats**:
   - Date formats: `Tue, Nov 24`, `Nov 24`, `November 24`, `11/24`, `11/24/2026`, `2026-11-24`, or weekday-only (`Mon`, `Tue`, `Tues`, `Wed`, `Thu`, `Thurs`, `Fri`, `Sat`, `Sun`, full names).
   - Weekday-only resolution: maps to the matching day inside `referenceWeekStart .. referenceWeekStart + 6 days`.
   - Month+day without year: resolves to the year of `referenceWeekStart` (handling Dec/Jan year boundary within ±6 months).
   - Time ranges: `2-4pm`, `2pm - 4:30pm`, `2:00 PM – 4:00 PM`, `10am to 12pm`, `14:00-16:30`, with implicit meridiem inheritance (`2-4 PM` → `2:00 PM – 4:00 PM`; `10-2 PM` → `10:00 AM – 2:00 PM`).
   - Multiple ranges per line separated by `,`, `;`, or `and`.
   - Time zone abbreviations: `EST`/`EDT` → `America/New_York`, `CST`/`CDT` → `America/Chicago`, `MST`/`MDT` → `America/Denver`, `PST`/`PDT` → `America/Los_Angeles`, `UTC`/`GMT` → `UTC`, `BST` → `Europe/London`, `CET`/`CEST` → `Europe/Paris`, `IST` → `Asia/Kolkata`, `JST` → `Asia/Tokyo`, plus any valid IANA ID (validated via `Temporal.Now.zonedDateTimeISO(tz)`).
3. **Error handling**: Never throws on messy input. Non-empty lines that cannot be parsed are returned with `status: 'unparsed'` and surfaced as non-blocking warnings in `AddParticipantDialog` so the user can edit the text before saving.

### 3. Overlap & Heatmap Engine (`src/utils/sharedAvailability.ts`)

Uses a sweep-line algorithm over all enabled participants' merged `AvailabilityBlock` endpoints:
- Collect all unique boundary timestamps (`startMs`, `endMs`) across enabled participants within `[rangeStartMs, rangeEndMs]` (or globally for export).
- Sort boundaries ascending; for each elementary interval `[t_i, t_{i+1}]`, determine which enabled participants cover it.
- Coalesce adjacent elementary intervals that have the exact same set of `availableIds` into a single `HeatmapSegment`.
- `computeSharedAvailabilityBlocks(participants, minCount)`: filters segments with `count >= minCount` and runs `mergeAvailabilityBlocks` to produce clean `AvailabilityBlock[]` ready for `formatAvailabilityBulletList`.

### 4. UI / UX Design

- **Topbar Mode Switcher** (`src/App.tsx`):
  - Segmented toggle (`@base-ui/react/tabs` or styled button group):
    - **My Calendar** (`edit` mode)
    - **Group Heatmap** (`heatmap` mode, showing enabled participant badge e.g. `3`)
- **Sidebar — "Others' Availability"** (`src/components/CalendarSidebar.tsx`):
  - Button: **+ Paste Availability** → opens `AddParticipantDialog`.
  - List of participants:
    - **"Me"** row (shown when ≥ 1 other participant exists, or always in heatmap mode) with checkbox to include/exclude self from overlap.
    - Each pasted participant row: checkbox (`@base-ui/react/checkbox`), name, subtle badge showing blocks in current week (or a clickable `"Jump"` button if all their blocks fall in another week), Edit button (pencil icon → re-opens `AddParticipantDialog`), and Remove (`X`) button.
- **Paste / Edit Participant Dialog** (`src/components/AddParticipantDialog.tsx`):
  - Name field (required; defaults to `"Person N"` if left blank on save, or validates non-empty).
  - Assumed time zone (`TimeZoneSelect`) — auto-updates with a subtle `"Detected from text"` badge when the parser finds a time zone in the pasted text, while allowing manual override.
  - Reference week indicator (defaults to currently viewed week, with `←` / `→` week arrows if pasting for next week).
  - Multi-line `<textarea>` with placeholder showing an example.
  - Live parsed preview box (updates as you type/paste): shows parsed blocks grouped by day in `displayTimeZone`, plus yellow warning pills for any unparsed lines.
- **Group Heatmap View** (`src/components/HeatmapCalendarGrid.tsx`):
  - Reuses the exact same 64px time gutter, `6 AM – 10 PM` (`HOUR_HEIGHT = 56px`), day header layout, and `displayTimeZone` projection as `WeekCalendarGrid`.
  - **Heatmap toolbar / legend bar** directly above the grid:
    - Intensity legend: `0/N` … `N/N` color ramp.
    - Minimum overlap filter pills: `All (N/N)`, `≥ N-1`, …, `Any (≥ 1)`. Segments below the threshold are dimmed (`opacity: 0.18`) so qualifying shared slots pop immediately.
    - Optional **"Show my busy events"** switch (off by default to keep the When2meet view clean).
  - **Visual encoding**:
    - Intensity scale derived from `count / total` using CSS custom properties (works in both light and dark themes).
    - Full-overlap segments (`count === total` and `total >= 2`) get a crisp border + subtle `★ All free` / `N/N` label when tall enough (`height >= 28px`).
  - **Hover / Focus Tooltip**:
    - Displays time range (`2:00 PM – 3:30 PM`), count (`3 of 4 available`), green-checked list of available participants, and muted list of unavailable participants.
    - Flips left on the rightmost 2 columns (same `alignRight` logic as `WeekCalendarGrid.tsx`).
  - **Empty state**: If no other participants have been added yet, displays a clean centered banner over the grid with a **+ Paste Someone's Availability** CTA button.
- **Submit / Export Dialog** (`src/components/AvailabilityOutputDialog.tsx`):
  - When ≥ 1 other participant exists, show a source toggle:
    - **My Availability** (existing behavior)
    - **Shared Availability** (shows min-overlap selector: `Everyone (N/N)` down to `At least 2 of N`, plus a note listing which participants are included).
  - Uses `computeSharedAvailabilityBlocks` + `formatAvailabilityBulletList` so `Standard`, `Compact`, `Markdown`, and `Present times in` time zone conversion all work identically.

---

## Code Style

Follow existing repository conventions:
- Functional React components with explicit TypeScript prop interfaces (`ComponentNameProps`).
- Pure, side-effect-free date/time helpers in `src/utils/` using `globalThis.Temporal` (`Temporal.PlainDate`, `Temporal.ZonedDateTime`, `Temporal.Instant`).
- Headless accessible primitives from `@base-ui/react/*` styled via semantic class names in `src/index.css` using CSS custom properties (`--bg-surface`, `--text-primary`, `--avail-bg`, etc.).

Example utility style (matching `src/utils/temporal.ts`):

```ts
export function computeSharedAvailabilityBlocks(
  participants: Array<{ id: string; enabled: boolean; blocks: AvailabilityBlock[] }>,
  minCount: number
): AvailabilityBlock[] {
  const active = participants.filter((p) => p.enabled);
  if (active.length === 0 || minCount <= 0) return [];
  const segments = computeHeatmapSegments(active);
  const qualifying = segments
    .filter((seg) => seg.count >= minCount)
    .map((seg) => ({ id: `shared:${seg.startMs}-${seg.endMs}`, startMs: seg.startMs, endMs: seg.endMs }));
  return mergeAvailabilityBlocks(qualifying);
}
```

---

## Testing Strategy

- **Unit tests (Vitest — pending approval to add devDependency)**:
  - `tests/availabilityParser.test.ts`:
    - Round-trip parsing of all 3 SlotPicker output formats (`standard`, `compact`, `markdown`).
    - Casual email/Slack formats (`Tue 2-4pm EST`, `Nov 24 10:00 AM - 12:30 PM, 3-5pm`, 24-hour times, cross-midnight ranges).
    - Time zone conversion accuracy (DST-aware IANA zones vs. fixed abbreviations) and fallback to `defaultTimeZone`.
    - Graceful handling of greetings/signatures/unparseable lines without throwing.
  - `tests/sharedAvailability.test.ts`:
    - Sweep-line correctness for 0, 1, 2, and 5+ participants, partial overlaps, touching boundaries, and disabled participants.
    - `computeSharedAvailabilityBlocks` filtering at `minCount = N`, `N - 1`, and `1`, verifying adjacent segments merge cleanly.
- **Build & type verification**: `npm run build` (`tsc -b && vite build`) must pass with zero errors.
- **Manual UI verification**: Light & dark modes, weekend toggle, Monday-start toggle, time zone switching, hover tooltips on edge columns, and Submit dialog copy output.

---

## Boundaries

- **Always**:
  - Run `npm run build` (and `npm test` once configured) before committing.
  - Keep all time calculations in epoch ms + `Temporal.ZonedDateTime` (never `new Date().getHours()`).
  - Support both light and dark themes via CSS variables in `src/index.css`.
  - Preserve existing `localStorage` keys and backwards compatibility for `"Me"` availability blocks.
- **Ask first**:
  - Adding `vitest` (or any other npm dependency) to `package.json`.
  - Modifying `.github/workflows/deploy.yml` or adding a PR preview workflow.
  - Changing the default `localStorage` schema for existing keys (`slotpicker_availability_v1`, `slotpicker_calendars_v1`).
- **Never**:
  - Introduce a backend server, external API calls, or send pasted user text to any third-party service.
  - Break or remove existing Google OAuth, iCal, or single-user drag-to-highlight workflows.

---

## Success Criteria

1. A user can paste SlotPicker output (all 3 formats) or casual email availability (e.g. `"Tue 2-4 PM EST"`) for 2+ people, preview the parsed blocks, and save them locally with persistence across page reloads.
2. Switching to **Group Heatmap** mode renders a When2meet-style overlap grid where shading intensity reflects `count / total` enabled participants, and hovering/focusing any segment accurately lists available and unavailable participants.
3. Toggling participants on/off in the sidebar or changing the minimum-overlap filter updates the heatmap immediately without losing data.
4. Switching the topbar time zone re-projects both `"Me"` and all pasted participants' blocks accurately in the heatmap.
5. In the **Submit** dialog, selecting **Shared Availability** with a chosen minimum overlap produces an accurate, copyable bullet list in any target time zone and format (`Standard`, `Compact`, `Markdown`).
6. `npm run build` succeeds cleanly with zero TypeScript errors, and all parser/overlap unit tests pass.

---

## Resolved Decisions

1. **Vitest**: Approved — add `vitest` as a devDependency for automated unit tests on `availabilityParser.ts`, `sharedAvailability.ts`, and `temporal.ts`.
2. **PR Preview Workflow**: Approved — set up GitHub Pages PR previews (`pr-preview.yml` + `gh-pages` branch) so changes can be previewed live on PRs before merging.
3. **Editing pasted blocks**: Approved — re-editing a participant's pasted text is sufficient for v1.
