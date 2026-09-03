/**
 * Half-Life browser extension.
 *
 * Reads the page you are on, sends its text to the engine, and marks the lines
 * that have gone stale - in the page itself, not just in this popup.
 *
 * Why sending text rather than a URL: the page is already in the tab's DOM, so
 * there is nothing to fetch. No CORS, no server reaching out to arbitrary
 * hosts, and it works on drafts and pages behind a login.
 *
 * In-page highlighting is only possible because of an invariant the engine
 * enforces for a different reason: stage 3 discards any finding whose quoted
 * sentence is not present verbatim in the source. Because every quote is real
 * text, it can be found again in the live DOM.
 */

const ENDPOINT = 'https://halflife-engine.vercel.app/api/check';

const runButton = document.getElementById('run');
const statusEl = document.getElementById('status');
const totalsEl = document.getElementById('totals');
const listEl = document.getElementById('findings');

function setStatus(text) {
  statusEl.textContent = text;
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
 * finding, whether or not it could be located on screen.
 */
function highlightPage(hits) {
  document.querySelectorAll('mark[data-half-life]').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent));
  });

  if (!document.getElementById('half-life-style')) {
    const style = document.createElement('style');
    style.id = 'half-life-style';
    style.textContent = `
      mark[data-half-life] {
        background: rgba(245,181,68,0.22);
        border-bottom: 2px solid #f5b544;
        color: inherit;
        padding: 0 1px;
        border-radius: 2px;
      }
      mark[data-half-life="breaking"] {
        background: rgba(242,85,90,0.20);
        border-bottom-color: #f2555a;
      }
    `;
    document.documentElement.appendChild(style);
  }

  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  let located = 0;

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
    mark.title = `${hit.severity === 'silent' ? 'Silently wrong' : 'Broken'} — ${hit.why}${
      hit.fix ? `\n\nFix: ${hit.fix}` : ''
    }`;
    try {
      range.surroundContents(mark);
      located++;
    } catch {
      /* the range straddled elements; leave this one unmarked */
    }
  }

  const first = document.querySelector('mark[data-half-life]');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return located;
}

// --- the check --------------------------------------------------------------

function render(findings, factsById, repairsByKey) {
  listEl.innerHTML = '';
  totalsEl.innerHTML = '';

  const rows = findings.map((f) => {
    const fact = factsById.get(f.factId);
    return {
      severity: fact?.severity === 'silent' ? 'silent' : 'breaking',
      sentence: f.staleSentence,
      why: f.why,
      old: fact?.old ?? '',
      replacement: fact?.new ?? null,
      fix: repairsByKey.get(`${f.assetId}#${f.segmentIdx}#${f.factId}`)?.corrected ?? '',
    };
  });

  const silent = rows.filter((r) => r.severity === 'silent').length;
  const breaking = rows.length - silent;

  if (!rows.length) {
    listEl.innerHTML = '<li class="empty">No stale passages found on this page.</li>';
    return rows;
  }

  totalsEl.className = 'totals';
  totalsEl.innerHTML =
    `<div class="silent"><b>${silent}</b><span>silent</span></div>` +
    `<div class="breaking"><b>${breaking}</b><span>breaking</span></div>`;

  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.severity;
    li.innerHTML =
      `<span class="chip">${r.severity === 'silent' ? 'Silently wrong' : 'Broken'} · ${
        r.old
      }${r.replacement ? ` → ${r.replacement}` : ''}</span>` +
      `<p class="quote"></p><p class="why"></p>` +
      (r.fix ? '<p class="fix"></p>' : '');
    li.querySelector('.quote').textContent = `"${r.sentence}"`;
    li.querySelector('.why').textContent = r.why;
    if (r.fix) li.querySelector('.fix').textContent = `→ ${r.fix}`;
    listEl.appendChild(li);
  }
  return rows;
}

async function check() {
  runButton.disabled = true;
  listEl.innerHTML = '';
  totalsEl.innerHTML = '';
  setStatus('Reading the page…');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('No active tab.');
    runButton.disabled = false;
    return;
  }

  let page;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
    });
    page = injected.result;
  } catch {
    setStatus('Cannot read this page. Chrome blocks extensions on internal pages and the Web Store.');
    runButton.disabled = false;
    return;
  }

  if (!page || page.text.length < 200) {
    setStatus('There is not enough text on this page to check.');
    runButton.disabled = false;
    return;
  }

  setStatus('Checking against what changed in v4…\nKeep this popup open while it runs.');

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
          setStatus(`Checking… ${findings.length} stale passage${findings.length === 1 ? '' : 's'} so far.`);
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

    const rows = render(findings, facts, repairs);

    if (!rows.length) {
      setStatus(
        errorNote
          ? `No stale passages found — but the run was incomplete:\n${errorNote}`
          : 'This page is still correct for v4.',
      );
      runButton.disabled = false;
      return;
    }

    const [marked] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: highlightPage,
      args: [rows.map(({ sentence, severity, why, fix }) => ({ sentence, severity, why, fix }))],
    });

    const located = marked?.result ?? 0;
    setStatus(
      `${rows.length} stale passage${rows.length === 1 ? '' : 's'}. ` +
        `Marked ${located} in the page` +
        (located < rows.length ? ` — ${rows.length - located} could not be located in the DOM.` : '.') +
        (errorNote ? `\nRun was incomplete: ${errorNote}` : ''),
    );
  } catch (err) {
    setStatus('');
    const p = document.createElement('div');
    p.className = 'err';
    p.textContent = err instanceof Error ? err.message : String(err);
    listEl.appendChild(p);
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', check);
