/**
 * Half-Life background service worker.
 *
 * The check lives here, not in the popup, because a full run is ~25s and a
 * popup is destroyed the instant the user clicks anywhere else. Losing the run
 * to a stray click made a working tool feel broken. The popup is now only a
 * view onto a run that outlives it.
 *
 * Run state is per-tab and held twice: in `runs` while this worker is alive,
 * and in chrome.storage.session so a popup opened later still finds something.
 * MV3 workers are evicted without warning and an in-flight fetch dies with
 * them - so on every worker start, any run still marked live is marked
 * interrupted, which is what actually happened, rather than leaving a popup
 * spinning forever on a run that no longer exists.
 */

const ENDPOINT = 'https://halflife-engine.vercel.app/api/check';

/** Authoritative while this worker lives. storage.session is the survivor copy. */
const runs = new Map();
const inFlight = new Set();

const key = (tabId) => `run:${tabId}`;
const LIVE = new Set(['reading', 'running']);

// --- state plumbing ---------------------------------------------------------

/**
 * `seq` orders updates for the popup. It opens by asking for the current state
 * and also subscribes to broadcasts, so without an ordering tag a broadcast in
 * flight can land after - and be overwritten by - the reply to that question.
 */
let seq = 0;

function publish(tabId, state) {
  const stamped = { ...state, seq: ++seq };
  runs.set(tabId, stamped);
  chrome.storage.session.set({ [key(tabId)]: stamped }).catch(() => {});
  // Nobody is listening when the popup is shut, which is the normal case.
  chrome.runtime.sendMessage({ type: 'run-update', tabId, state: stamped }).catch(() => {});
}

function forget(tabId) {
  runs.delete(tabId);
  chrome.storage.session.remove(key(tabId)).catch(() => {});
}

const INTERRUPTED =
  'Chrome shut the extension down before this check finished. ' +
  'Nothing is lost but the run itself - start it again.';

/**
 * A run marked live but absent from `runs` cannot be live: `publish` fills
 * `runs` before the first await, so a run this worker is driving is always
 * there. Its absence means a previous worker was evicted and took the fetch
 * with it. Deciding that here, on read, rather than in a startup sweep, avoids
 * racing the very message that woke the worker up - and answering that message
 * with a stale "running" is exactly the forever-spinner this must not produce.
 */
async function readState(tabId) {
  if (runs.has(tabId)) return runs.get(tabId);

  const stored = (await chrome.storage.session.get(key(tabId)))[key(tabId)] ?? null;
  if (!stored || !LIVE.has(stored.phase)) return stored;

  const dead = { ...stored, phase: 'interrupted', message: INTERRUPTED };
  chrome.storage.session.set({ [key(tabId)]: dead }).catch(() => {});
  return dead;
}

// A run's results describe one particular document. Navigating away invalidates
// them, and the in-page marks went with the old DOM anyway.
chrome.tabs.onRemoved.addListener((tabId) => forget(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && !inFlight.has(tabId)) forget(tabId);
});

/**
 * Any extension API call resets the worker's idle timer. Without this ping a
 * check that outlasts the 30s idle limit can be collected mid-flight - the
 * exact failure this whole file exists to remove.
 */
let heartbeat = null;
function holdWorker(hold, tabId) {
  if (hold) {
    inFlight.add(tabId);
    if (!heartbeat) heartbeat = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  } else {
    inFlight.delete(tabId);
    if (!inFlight.size && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }
}

// --- injected into the page -------------------------------------------------

/** Runs in the tab. Returns the readable text of the page. */
function extractPage() {
  const drop = 'script, style, noscript, svg, nav, footer, header, aside, form';
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  const clone = root.cloneNode(true);
  clone.querySelectorAll(drop).forEach((n) => n.remove());
  return {
    text: clone.innerText.replace(/\n{3,}/g, '\n\n').trim(),
    title: document.title,
    url: location.href,
  };
}

/**
 * Runs in the tab. Marks each stale sentence where it appears.
 *
 * Matching is whitespace-normalised and confined to a single text node, so a
 * sentence broken across syntax-highlighting spans will not be found. That is
 * reported honestly rather than papered over - the popup always lists every
 * finding, and says on the row itself when it could not be located.
 *
 * Each mark carries `data-half-life-id`, the finding's index in the popup list.
 * That id is the only link between the two views; returning the ids that
 * actually landed is what lets the popup mark the rows it cannot jump to.
 */
function highlightPage(hits) {
  document.querySelectorAll('mark[data-half-life]').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent));
  });

  if (!document.getElementById('half-life-style')) {
    const style = document.createElement('style');
    style.id = 'half-life-style';
    style.textContent = [
      'mark[data-half-life] {',
      '  background: rgba(245,181,68,0.22);',
      '  border-bottom: 2px solid #f5b544;',
      '  color: inherit;',
      '  padding: 0 1px;',
      '  border-radius: 2px;',
      '  scroll-margin: 30vh;',
      '}',
      'mark[data-half-life="breaking"] {',
      '  background: rgba(242,85,90,0.20);',
      '  border-bottom-color: #f2555a;',
      '}',
      'mark[data-half-life].half-life-flash { animation: half-life-flash 1.2s ease-out 1; }',
      '@keyframes half-life-flash {',
      '  0%   { box-shadow: 0 0 0 0 rgba(74,222,128,0); }',
      '  12%  { box-shadow: 0 0 0 5px rgba(74,222,128,0.85); background: rgba(74,222,128,0.38); }',
      '  100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }',
      '}',
    ].join('\n');
    document.documentElement.appendChild(style);
  }

  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const located = [];

  for (const hit of hits) {
    const needle = norm(hit.sentence);
    if (needle.length < 8) continue;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.trim().length < 4) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest('script, style, mark[data-half-life]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return norm(node.nodeValue).includes(needle)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const node = walker.nextNode();
    if (!node) continue;

    // Map the normalised match back to offsets in the raw text node. Built in
    // one linear pass: `flat` is the normalised text, `offsets[i]` is where
    // character i came from in the original.
    const raw = node.nodeValue;
    let flat = '';
    const offsets = [];
    let lastWasSpace = true;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const isSpace = ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
      if (isSpace) {
        if (lastWasSpace) continue;
        flat += ' ';
        offsets.push(i);
        lastWasSpace = true;
      } else {
        flat += ch.toLowerCase();
        offsets.push(i);
        lastWasSpace = false;
      }
    }

    const at = flat.indexOf(needle);
    if (at === -1) continue;
    const start = offsets[at];
    const end = offsets[at + needle.length - 1] + 1;

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const mark = document.createElement('mark');
    mark.setAttribute('data-half-life', hit.severity);
    mark.setAttribute('data-half-life-id', String(hit.id));
    mark.title =
      (hit.severity === 'silent' ? 'Silently wrong' : 'Broken') +
      ' — ' +
      hit.why +
      (hit.fix ? '\n\nFix: ' + hit.fix : '');
    try {
      range.surroundContents(mark);
      located.push(hit.id);
    } catch {
      /* the range straddled elements; leave this one unmarked */
    }
  }

  const first = document.querySelector('mark[data-half-life]');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return located;
}

// --- is this page even in scope? --------------------------------------------

/**
 * The truth corpus holds exactly one version boundary: Tailwind v3 -> v4. On a
 * page about anything else the engine has nothing to compare against, and
 * "no stale passages found" is a true sentence that reads as a verdict it has
 * not earned. These signals are deliberately generous: a false positive costs
 * one wasted run, a false negative would hide a real answer.
 */
const TAILWIND_SIGNALS = [
  /tailwind/i,
  /@apply\b/,
  /\btw-[a-z]/,
  /\b(?:bg|text|border|ring|from|via|to|divide|outline|decoration|accent|caret|fill|stroke|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d00)\b/,
  /\b(?:sm|md|lg|xl|2xl):(?:[a-z]+-)+[a-z0-9]/,
  /\b(?:px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|space-[xy])-(?:\d{1,2}|px|auto)\b/,
  /\b(?:rounded|shadow|ring)-(?:sm|md|lg|xl|2xl|3xl|full|none)\b/,
  // Not `flex-wrap`: that is plain CSS, and matching it would call a CSS
  // tutorial a Tailwind page.
  /\bflex-(?:col|row)\b/,
];

function hasTailwindSignal(text) {
  return TAILWIND_SIGNALS.some((re) => re.test(text));
}

// --- the check --------------------------------------------------------------

async function startRun(tabId) {
  holdWorker(true, tabId);
  publish(tabId, { phase: 'reading', message: 'Reading the page…', rows: [], located: [] });

  let page;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPage,
    });
    page = injected.result;
  } catch {
    holdWorker(false, tabId);
    publish(tabId, {
      phase: 'blocked',
      message:
        'Cannot read this page. Chrome blocks extensions on internal pages and the Web Store.',
      rows: [],
      located: [],
    });
    return;
  }

  if (!page || page.text.length < 200) {
    holdWorker(false, tabId);
    publish(tabId, {
      phase: 'blocked',
      message: 'There is not enough text on this page to check.',
      rows: [],
      located: [],
    });
    return;
  }

  if (!hasTailwindSignal(page.text)) {
    holdWorker(false, tabId);
    publish(tabId, { phase: 'no-signal', message: '', rows: [], located: [] });
    return;
  }

  publish(tabId, {
    phase: 'running',
    message:
      'Checking against what changed in v4…\nThis keeps running if you close the popup.',
    rows: [],
    located: [],
  });

  const facts = new Map();
  const repairs = new Map();
  const findings = [];

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: page.text, title: page.title, url: page.url }),
    });

    if (!res.ok || !res.body) {
      let message = `The engine returned HTTP ${res.status}.`;
      try {
        const body = await res.json();
        if (body.error) message = body.error;
      } catch {
        /* keep the status message */
      }
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let errorNote = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const line = buffer
          .slice(0, split)
          .split('\n')
          .find((l) => l.startsWith('data: '));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (event.type === 'facts') {
          for (const f of event.facts) facts.set(f.id, f);
        } else if (event.type === 'finding') {
          findings.push(event.finding);
          publish(tabId, {
            phase: 'running',
            message: `Checking… ${findings.length} stale passage${
              findings.length === 1 ? '' : 's'
            } so far.`,
            rows: [],
            located: [],
          });
        } else if (event.type === 'repair') {
          const r = event.repair;
          repairs.set(`${r.assetId}#${r.segmentIdx}#${r.factId}`, r);
        } else if (event.type === 'error') {
          // Surfaced, never swallowed: a check that silently degraded and then
          // reported nothing stale is the failure this tool exists to prevent.
          errorNote = event.message;
        }
      }
    }

    const rows = findings.map((f, i) => {
      const fact = facts.get(f.factId);
      return {
        id: i,
        severity: fact?.severity === 'silent' ? 'silent' : 'breaking',
        sentence: f.staleSentence,
        why: f.why,
        old: fact?.old ?? '',
        replacement: fact?.new ?? null,
        fix: repairs.get(`${f.assetId}#${f.segmentIdx}#${f.factId}`)?.corrected ?? '',
        // The citation is the credibility claim, not decoration: every verdict
        // traces to a line in a real source file the reader can open.
        evidence: fact?.evidence ?? null,
        source: fact?.source ?? '',
      };
    });

    if (!rows.length) {
      holdWorker(false, tabId);
      publish(tabId, { phase: 'done', message: '', rows: [], located: [], note: errorNote });
      return;
    }

    let located = [];
    try {
      const [marked] = await chrome.scripting.executeScript({
        target: { tabId },
        func: highlightPage,
        args: [
          rows.map(({ id, sentence, severity, why, fix }) => ({ id, sentence, severity, why, fix })),
        ],
      });
      located = marked?.result ?? [];
    } catch {
      // The tab navigated or closed while the check ran. The findings still
      // stand; they just have nowhere left to be marked.
    }

    holdWorker(false, tabId);
    publish(tabId, { phase: 'done', message: '', rows, located, note: errorNote });
  } catch (err) {
    holdWorker(false, tabId);
    publish(tabId, {
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
      rows: [],
      located: [],
    });
  }
}

// --- popup protocol ---------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'start') {
    const existing = runs.get(msg.tabId);
    // Re-attach rather than start a second run over the top of a live one.
    if (existing && LIVE.has(existing.phase)) {
      sendResponse({ state: existing });
    } else {
      startRun(msg.tabId);
      sendResponse({ state: runs.get(msg.tabId) ?? null });
    }
    return false;
  }

  if (msg?.type === 'state') {
    readState(msg.tabId).then((state) => sendResponse({ state }));
    return true;
  }

  return false;
});
