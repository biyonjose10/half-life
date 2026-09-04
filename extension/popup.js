/**
 * Half-Life browser extension - popup.
 *
 * This file is only a view. The check itself runs in background.js, so closing
 * the popup no longer throws away ~25s of work; reopening it re-attaches to
 * whatever that run is doing now. See background.js for why the state lives in
 * two places and what happens when Chrome evicts the worker.
 *
 * Why the extension sends text rather than a URL: the page is already in the
 * tab's DOM, so there is nothing to fetch. No CORS, no server reaching out to
 * arbitrary hosts, and it works on drafts and pages behind a login.
 *
 * In-page highlighting is only possible because of an invariant the engine
 * enforces for a different reason: stage 3 discards any finding whose quoted
 * sentence is not present verbatim in the source. Because every quote is real
 * text, it can be found again in the live DOM - and because every mark carries
 * the finding's id, a row here can scroll to its mark there.
 */

/** Citation target, so a quote can be checked at the line it came from. */
const SOURCE_BASE = 'https://github.com/biyonjose10/half-life/blob/main';

const runButton = document.getElementById('run');
const statusEl = document.getElementById('status');
const totalsEl = document.getElementById('totals');
const listEl = document.getElementById('findings');

let tabId = null;
/** See background.js: keeps a late broadcast from being undone by an early reply. */
let lastSeq = -1;

function setStatus(text) {
  statusEl.textContent = text;
}

// --- injected into the page -------------------------------------------------

/**
 * Runs in the tab. Scrolls one mark into view and flashes it.
 *
 * Returns false when the mark is gone - the page was re-rendered or navigated
 * under us - so the popup can say so instead of appearing to do nothing.
 */
function scrollToMark(id) {
  const el = document.querySelector(`mark[data-half-life-id="${id}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('half-life-flash');
  void el.offsetWidth; // reflow, so a second click restarts the animation
  el.classList.add('half-life-flash');
  setTimeout(() => el.classList.remove('half-life-flash'), 1400);
  return true;
}

// --- rendering --------------------------------------------------------------

function clear() {
  listEl.innerHTML = '';
  totalsEl.innerHTML = '';
  totalsEl.className = '';
}

/** Codeblock facts carry several lines of `old`; a chip is one line of space. */
function oneLine(s, max = 60) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function citation(evidence, source) {
  const wrap = document.createElement('div');
  wrap.className = 'cite';

  const head = document.createElement('div');
  head.className = 'cite-head';

  const link = document.createElement('a');
  link.className = 'src';
  link.href = `${SOURCE_BASE}/${evidence.file}#L${evidence.line}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Open this line on GitHub';
  link.textContent = `${evidence.file}:${evidence.line}`;
  head.appendChild(link);

  if (source) {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '/';
    const kind = document.createElement('span');
    kind.textContent = source;
    head.append(sep, kind);
  }

  const quote = document.createElement('pre');
  quote.className = 'ev';
  quote.textContent = evidence.quote;

  wrap.append(head, quote);
  return wrap;
}

function renderRows(rows, located) {
  clear();

  const locatable = new Set(located ?? []);
  const silent = rows.filter((r) => r.severity === 'silent').length;
  const breaking = rows.length - silent;

  totalsEl.className = 'totals';
  totalsEl.innerHTML =
    `<div class="silent"><b>${silent}</b><span>silent</span></div>` +
    `<div class="breaking"><b>${breaking}</b><span>breaking</span></div>`;

  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.severity;

    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = r.severity === 'silent' ? 'Silently wrong' : 'Broken';
    chip.textContent = r.old
      ? `${label} · ${oneLine(r.old)} → ${r.replacement ? oneLine(r.replacement) : 'removed'}`
      : label;

    const quote = document.createElement('p');
    quote.className = 'quote';
    quote.textContent = `"${r.sentence}"`;

    const why = document.createElement('p');
    why.className = 'why';
    why.textContent = r.why;

    li.append(chip, quote, why);

    if (r.fix) {
      const fix = document.createElement('p');
      fix.className = 'fix';
      fix.textContent = `→ ${r.fix}`;
      li.appendChild(fix);
    }

    if (r.evidence) li.appendChild(citation(r.evidence, r.source));

    const jump = document.createElement('p');
    if (locatable.has(r.id)) {
      li.classList.add('link');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      jump.className = 'jump';
      jump.textContent = 'Click to jump to this line in the page ↗';
      li.addEventListener('click', (e) => {
        // The citation link is a real link; let it open its own tab.
        if (e.target.closest('a')) return;
        jumpTo(r.id, jump);
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jumpTo(r.id, jump);
        }
      });
    } else {
      // Stated on the row rather than silently ignoring the click: the sentence
      // is split across syntax-highlighting spans, so there is no single text
      // node to mark.
      jump.className = 'nojump';
      jump.textContent = 'Not markable in the page — the sentence is split across elements';
    }
    li.appendChild(jump);

    listEl.appendChild(li);
  }
}

async function jumpTo(id, noteEl) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrollToMark,
      args: [id],
    });
    if (res?.result === false) {
      noteEl.className = 'nojump';
      noteEl.textContent = 'That mark is gone — the page changed. Run the check again.';
    }
  } catch {
    noteEl.className = 'nojump';
    noteEl.textContent = 'Cannot reach the page any more. Run the check again.';
  }
}

function renderOutOfScope() {
  clear();
  const li = document.createElement('li');
  li.className = 'empty scope';
  li.innerHTML =
    '<b>Nothing to check this page against.</b>' +
    '<p>No Tailwind CSS signal in this page: no <code>tailwind</code>, no ' +
    '<code>@tailwind</code>, no <code>tailwind.config</code>, no Tailwind utility ' +
    'classes.</p>' +
    '<p>The only version boundary in the truth corpus is Tailwind v3 → v4, so the ' +
    'engine has nothing to compare this page with.</p>' +
    '<p class="hedge">This is <em>not</em> the same as “checked and clean”. The page ' +
    'was not checked.</p>';
  listEl.appendChild(li);
}

// --- state ------------------------------------------------------------------

function apply(state) {
  if (state && typeof state.seq === 'number') {
    if (state.seq < lastSeq) return;
    lastSeq = state.seq;
  }

  if (!state) {
    clear();
    runButton.disabled = false;
    runButton.textContent = 'Check this page';
    setStatus('Reads the page you are on and checks it against what actually changed in v4.');
    return;
  }

  const running = state.phase === 'reading' || state.phase === 'running';
  runButton.disabled = running;
  runButton.textContent = running
    ? 'Checking…'
    : state.phase === 'interrupted'
      ? 'Run the check again'
      : 'Check this page again';

  if (running) {
    clear();
    setStatus(state.message);
    return;
  }

  if (state.phase === 'no-signal') {
    renderOutOfScope();
    setStatus('Checked nothing. See below.');
    return;
  }

  if (state.phase === 'error') {
    clear();
    setStatus('');
    const p = document.createElement('div');
    p.className = 'err';
    p.textContent = state.message;
    listEl.appendChild(p);
    return;
  }

  if (state.phase === 'interrupted' || state.phase === 'blocked') {
    clear();
    setStatus(state.message);
    return;
  }

  // done
  const rows = state.rows ?? [];
  if (!rows.length) {
    clear();
    listEl.innerHTML = '<li class="empty">No stale passages found on this page.</li>';
    setStatus(
      state.note
        ? `Checked against Tailwind v3 → v4 — but the run was incomplete:\n${state.note}`
        : 'Checked against Tailwind v3 → v4. This page is still correct.',
    );
    return;
  }

  renderRows(rows, state.located);
  const located = (state.located ?? []).length;
  setStatus(
    `${rows.length} stale passage${rows.length === 1 ? '' : 's'}. ` +
      `Marked ${located} in the page` +
      (located < rows.length ? ` — ${rows.length - located} could not be located in the DOM.` : '.') +
      (state.note ? `\nRun was incomplete: ${state.note}` : ''),
  );
}

// Live updates from a run that may well have started before this popup existed.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'run-update' && msg.tabId === tabId) apply(msg.state);
});

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  clear();
  setStatus('Reading the page…');
  // A restarted worker counts from zero again, so a stale high-water mark from
  // the previous worker would swallow every update of this run.
  lastSeq = -1;
  const reply = await chrome.runtime.sendMessage({ type: 'start', tabId });
  if (reply?.state) apply(reply.state);
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    runButton.disabled = true;
    setStatus('No active tab.');
    return;
  }
  tabId = tab.id;
  const reply = await chrome.runtime.sendMessage({ type: 'state', tabId });
  apply(reply?.state ?? null);
})();
