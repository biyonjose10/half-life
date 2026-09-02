# Half-Life

**Published content has a half-life. Half-Life finds the part that has decayed.**

**Live:** https://halflife-engine.vercel.app · **Source:** https://github.com/biyonjose10/half-life

Every tool at this hackathon makes content. This one repairs content that was
already published and has quietly gone wrong.

A creator publishes 200 tutorials about a piece of software. The software ships
a new major version — a utility is renamed, a config file stops being read, a
default changes. Some of those tutorials are now wrong. The comments fill up
with *"this doesn't work anymore."* The creator has no idea which ones.

Half-Life reads what changed, finds every published passage that depended on the
old behaviour, and writes the corrections — each one with the exact stale
sentence, its location, and a citation back to the source of truth.

---

## What it found

Run against **22 real published tutorials** (DEV.to, 2022–2024, every one with a
clickable source URL) and the **real Tailwind CSS v3 → v4 upgrade**:

```
36 documented changes  →  188 candidate passages  →  81 stale passages
                                                     across 19 of 22 tutorials
```

Nothing in the corpus is synthetic. Every finding points at a real article a
judge can open and read.

### The interesting half: silent decay

13 of the 36 changes are **silent** — the old form still works, it just means
something different now:

| v3 | v4 | what happens to a v3 tutorial |
|---|---|---|
| `shadow-sm` | `shadow-xs` | still renders — a *different, smaller* shadow |
| `shadow` | `shadow-sm` | still renders — the wrong shadow |
| `outline-none` | `outline-hidden` | still resolves; v4 redefined `outline-none` |
| `tailwind.config.js` | (not auto-detected) | file still created, silently ignored |

No error. No broken build. The tutorial just quietly teaches the wrong result —
which is exactly the kind of decay nobody ever finds by hand.

---

## Why you can trust the findings

Two design decisions do all the work.

**1. The diff has no model in it.**

Stage 1 derives every fact by string processing over real source files — the
official upgrade guide's rename tables, its annotated before/after code blocks,
its prose sections, and the v4 framework source itself. `stage1-diff.ts` imports
`node:fs`, `node:path`, and its own types. Nothing else.

The engine therefore *cannot invent a change that did not happen*. The worst it
can do is miss one. `npm run verify` enforces this as a structural property, not
a promise:

```
PASS  stage 1 is byte-for-byte reproducible - 25146 bytes, 36 facts
PASS  stage 1 imports no LLM client - imports: node:fs, node:path, ./types
PASS  every fact quote is traceable to its cited line - 36 facts
PASS  every fact pattern compiles as a regex - 36 patterns
```

**2. The model does not get to invent its own evidence.**

When Stage 3 rules a passage stale, it must quote the offending sentence
verbatim. That quote is then checked against the source segment *in code*. A
verdict whose quote cannot be found in the original text is discarded, not
trusted. A finding you can read is a finding you can check.

Severity is derived too, never asserted. A change is `silent` when the old token
still resolves in v4 — detected by it being the *target* of another rename (v3
`shadow` became v4 `shadow-sm`, so `shadow-sm` still resolves and now means
something else), by it still being declared in the v4 utility source, or by the
guide itself stating the old form still works.

---

## The pipeline

| Stage | What it does | Model? |
|---|---|---|
| **1 · Diff** | Extract changed facts from the source of truth | **No** — pure string processing |
| **2 · Retrieve** | Find published passages that depend on each fact | Embeddings only |
| **3 · Adjudicate** | Decide which candidates are genuinely stale | Yes, with verbatim-quote enforcement |
| **4 · Repair** | Rewrite the stale line, draft a pinned comment | Yes, given the new form rather than asked to recall it |

Retrieval is hybrid on purpose. Exact pattern matches are certainties and carry
most of the recall; vector search catches passages that *describe* the old
behaviour without naming it (*"add a subtle shadow to the card"*), which a regex
can never reach.

Stage 2 over-retrieves deliberately — a spare candidate costs one model call,
while a missed passage is unrecoverable. Stage 3 is where the precision comes
back.

## Architecture notes

- **No orchestration framework.** The DAG is linear and the interesting
  behaviour is inside the stages, so LangChain/CrewAI would add indirection
  without removing any. `lib/pipeline/run.ts` wires four typed functions and
  emits events.
- **In-process vector index.** The corpus is ~1k segments. A network round-trip
  per query would add latency and a live failure mode to a search that is one
  pass over a few megabytes. `lib/vector.ts` is a narrow interface if that ever
  needs to change.
- **Streaming by design.** Every stage emits events, forwarded to the browser as
  SSE. Watching the engine work is the point; a spinner would hide it.

## Running it

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local

npm run verify     # prove stage 1 is deterministic and model-free
npm run engine     # full run in the terminal, prints the decay report
npm run dev        # the console UI

npm run index      # rebuild the vector index (only after changing the corpus)
```

The vector index is committed, so a fresh clone can run retrieval without
re-embedding.

## Corpus

```
corpus/truth/upgrade-guide.mdx     official Tailwind v3 → v4 upgrade guide
corpus/truth/v3/corePlugins.js     Tailwind v3.4.17 utility source
corpus/truth/v4/utilities.ts       Tailwind v4.0.0 utility source
corpus/library/assets.json         22 real published tutorials, segmented
corpus/library/index.json          cached embeddings
```

`scripts/corpus/build_library.py` rebuilds the library from the DEV.to public
API. Article selection is by v3 pattern presence; the engine itself re-derives
everything from the truth corpus and never sees that selection.

## Generalising

Nothing in the pipeline is Tailwind-specific except the corpus. Any domain with
a versioned source of truth and a published back-catalogue fits: a framework's
release notes against its tutorial ecosystem, an API's OpenAPI spec against its
integration guides, a product's changelog against its help centre.
