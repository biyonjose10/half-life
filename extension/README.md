# Half-Life browser extension

Checks whether the tutorial you are currently reading has gone stale, and marks
the offending lines in the page itself.

## Load it (about two minutes)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this `extension/` folder
4. Pin "Half-Life" to the toolbar so the icon is visible

No build step, no store listing. Chrome will show it as an unpacked extension.

## Use it

1. Open any Tailwind CSS tutorial — ideally one written for v3, so 2022–2024
2. Click the Half-Life icon → **Check this page**
3. Close the popup if you like; the run continues without it (~20–30s)

Stale lines are marked in the page: **amber** for silent decay, **red** for
breaking. Hover a mark for why it is stale and what to replace it with. The
popup lists every finding, and says how many it could not locate on screen.

Click a finding to scroll to its mark in the page and flash it. Findings that
could not be marked say so on the row instead of being silently inert.

Each finding shows the line from the truth corpus it was derived from — the
verbatim quote plus `file:line`, linked to that line on GitHub. Nothing here
asks to be taken on trust.

A page nobody chose in advance is the honest test. One known-good example:
<https://dev.to/lordsage/how-install-tailwind-css-on-a-next-js-project-a-step-by-step-guide-1p6d>
— it tells you to edit the `purge` property in `tailwind.config.js`, which v4
no longer reads.

## How it works

`background.js` reads the tab's text through `activeTab` and POSTs it to
`/api/check` on the deployed engine, which runs the same four stages as the
full corpus run. The popup is only a view: it asks the worker for the current
state when it opens, subscribes to updates, and can be closed and reopened
mid-run. Results are kept per tab and discarded when that tab navigates.

**Why the run is not in the popup.** A popup is destroyed the moment the user
clicks anywhere else, and a check takes ~25s. Losing the run to a stray click
made a working tool feel broken.

**Out of scope is not the same as clean.** The truth corpus holds exactly one
version boundary — Tailwind v3 → v4. On a page with no Tailwind signal at all
the extension says it has nothing to check against, rather than reporting
"no stale passages found", which would be a true sentence carrying a verdict it
never earned.

**It sends text, not a URL.** The page is already in the tab's DOM, so there is
nothing to fetch: no CORS, no server reaching out to arbitrary hosts, and it
works on drafts and pages behind a login.

**Why in-page highlighting is possible at all.** Stage 3 discards any finding
whose quoted sentence is not present verbatim in the source — a rule added to
stop the model inventing evidence for its own findings. Because every quote is
therefore real text, it can be found again in the live DOM.

## Limits, stated rather than hidden

- Matching runs across element boundaries, so a line broken into spans by a
  syntax highlighter is still marked - one mark per fragment, sharing the
  finding's id. A finding that still cannot be placed says so on its row rather
  than being silently inert.
- Chrome blocks extensions on `chrome://` pages and the Web Store.
- Chrome can evict an MV3 service worker at any time, and an in-flight fetch
  dies with it. A ping keeps the worker alive across a normal run; if it is
  killed anyway, the popup says the run was interrupted and offers to re-run.
  It never leaves a spinner up for a run that no longer exists.
- The Tailwind signal check is a set of cheap text patterns, deliberately
  generous. A false positive costs one wasted run; a false negative would hide
  a real answer, so the patterns err toward running.
- Only Tailwind v3 → v4 is in the truth corpus today. Any other version
  boundary needs its own corpus; nothing in the pipeline is Tailwind-specific.
