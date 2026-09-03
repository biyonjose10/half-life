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
3. Keep the popup open while it runs (~20–30s)

Stale lines are marked in the page: **amber** for silent decay, **red** for
breaking. Hover a mark for why it is stale and what to replace it with. The
popup lists every finding, and says how many it could not locate on screen.

A page nobody chose in advance is the honest test. One known-good example:
<https://dev.to/lordsage/how-install-tailwind-css-on-a-next-js-project-a-step-by-step-guide-1p6d>
— it tells you to edit the `purge` property in `tailwind.config.js`, which v4
no longer reads.

## How it works

The popup reads the tab's text through `activeTab` and POSTs it to
`/api/check` on the deployed engine, which runs the same four stages as the
full corpus run.

**It sends text, not a URL.** The page is already in the tab's DOM, so there is
nothing to fetch: no CORS, no server reaching out to arbitrary hosts, and it
works on drafts and pages behind a login.

**Why in-page highlighting is possible at all.** Stage 3 discards any finding
whose quoted sentence is not present verbatim in the source — a rule added to
stop the model inventing evidence for its own findings. Because every quote is
therefore real text, it can be found again in the live DOM.

## Limits, stated rather than hidden

- A sentence split across syntax-highlighting spans cannot be marked, because
  matching is confined to a single text node. The popup reports how many
  findings it could not locate rather than quietly showing fewer.
- Chrome blocks extensions on `chrome://` pages and the Web Store.
- Closing the popup cancels an in-flight check.
- Only Tailwind v3 → v4 is in the truth corpus today. Any other version
  boundary needs its own corpus; nothing in the pipeline is Tailwind-specific.
