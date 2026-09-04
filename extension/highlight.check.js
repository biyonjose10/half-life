/**
 * The cross-element matching used by the extension highlighter.
 *
 * Kept as a plain node script because the extension has no build step and no
 * test runner - it is loaded unpacked. This mirrors the flatten-and-locate half
 * of `highlightPage` in background.js; the DOM half cannot be exercised without
 * a browser, and is not covered here.
 *
 *   node extension/highlight.check.js
 *
 * Named .check.js rather than .test.js on purpose: vitest claims *.test.*, and
 * a plain script that calls process.exit is a failure to a test runner.
 */

// Mirrors the flatten+locate half of highlightPage over simulated text nodes,
// which is the part that changed. A syntax highlighter splits one line into
// many nodes; that is the case this must handle.
function flatten(nodeValues, blockAfter = new Set()) {
  let flat = ''; const where = []; let lastWasSpace = true;
  nodeValues.forEach((raw, nodeIndex) => {
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const isSpace = ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
      if (isSpace) { if (lastWasSpace) continue; flat += ' '; where.push({nodeIndex, offset:i}); lastWasSpace = true; }
      else { flat += ch.toLowerCase(); where.push({nodeIndex, offset:i}); lastWasSpace = false; }
    }
    if (blockAfter.has(nodeIndex) && !lastWasSpace) { flat += ' '; where.push({nodeIndex, offset: raw.length}); lastWasSpace = true; }
  });
  return { flat, where };
}
const norm = s => s.replace(/\s+/g,' ').trim().toLowerCase();

function locate(nodeValues, sentence, blockAfter) {
  const { flat, where } = flatten(nodeValues, blockAfter);
  const needle = norm(sentence);
  const at = flat.indexOf(needle);
  if (at === -1) return null;
  const end = at + needle.length - 1;
  return { start: where[at], end: where[end] };
}
function reconstruct(nodeValues, span) {
  let out = '';
  for (let i = span.start.nodeIndex; i <= span.end.nodeIndex; i++) {
    const from = i === span.start.nodeIndex ? span.start.offset : 0;
    const to = i === span.end.nodeIndex ? span.end.offset + 1 : nodeValues[i].length;
    out += nodeValues[i].slice(from, to);
  }
  return out;
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = norm(got) === norm(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) { console.log('   got  ' + JSON.stringify(got)); console.log('   want ' + JSON.stringify(want)); fail++; } else pass++;
};

// 1. the old behaviour: entirely inside one node
check('single text node',
  reconstruct(['Give the card a shadow-sm utility class.'],
    locate(['Give the card a shadow-sm utility class.'], 'a shadow-sm utility')), 'a shadow-sm utility');

// 2. the failing case: one line split across syntax-highlight spans
const spans = ['<div ', 'class', '=', '"', 'rounded-lg', ' ', 'shadow-sm', '"', '>'];
check('split across 9 spans',
  reconstruct(spans, locate(spans, 'rounded-lg shadow-sm')), 'rounded-lg shadow-sm');

// 3. whitespace differs between page and quote
const ws = ['Open the  tailwind.config.js\n', '  file in your project'];
check('irregular whitespace across nodes',
  reconstruct(ws, locate(ws, 'Open the tailwind.config.js file in your project')),
  'Open the  tailwind.config.js\n  file in your project');

// 4. a block boundary must separate words that have no whitespace between
// them, or the last word of one paragraph fuses with the first of the next and
// invents a token that is on neither line.
const blocks = ['npm install', 'npx tailwindcss init'];
const fused = flatten(blocks, new Set()).flat;
const separated = flatten(blocks, new Set([0])).flat;
const ok4 = fused.includes('installnpx') && !separated.includes('installnpx') && separated.includes('install npx');
console.log((ok4 ? 'PASS  ' : 'FAIL  ') + 'block boundary stops adjacent blocks fusing into a fake token');
if (ok4) pass++; else { fail++; console.log('   fused: ' + JSON.stringify(fused)); console.log('   separated: ' + JSON.stringify(separated)); }

// 5. a quote that is not present
console.log((locate(spans, 'this text does not appear') === null ? 'PASS  ' : 'FAIL  ') + 'absent quote returns nothing');
locate(spans, 'this text does not appear') === null ? pass++ : fail++;

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
