@AGENTS.md

# Half-Life

Hackathon entry for **AI Content Engine Hacks** (Devpost), deadline
**2026-09-08 08:00 EDT / 17:30 IST**. Public repo:
`github.com/biyonjose10/half-life`.

Finds published tutorials that went factually stale when the software they teach
changed versions, and writes the corrections. Demo domain: Tailwind CSS v3 → v4.

## The two invariants — do not break these

These are the project's entire credibility. Everything else is negotiable.

**1. `lib/pipeline/stage1-diff.ts` must never import an LLM client.**
The "what changed" step is pure string processing over real source files, which
is why the engine cannot invent a change that did not happen. This is enforced
structurally, not by prompt discipline. `npm run verify` fails the build if an
LLM import appears. Same lesson as moving Crucible's grading decision into
TypeScript.

**2. A model verdict is never trusted without a checkable quote.**
Stage 3 must quote the offending sentence verbatim, and `containsVerbatim()`
checks that quote against the source segment in code. Verdicts whose quote
cannot be found are discarded. Do not relax this into a similarity score.

Stage 1 is also byte-for-byte reproducible, and `npm run verify` proves it by
running the extraction twice and comparing. Never introduce iteration-order,
time, or randomness dependence into that stage.

## Layout

```
lib/pipeline/stage1-diff.ts       deterministic change extraction (NO LLM)
lib/pipeline/stage2-retrieve.ts   exact + vector retrieval across corpora
lib/pipeline/stage3-adjudicate.ts is this passage actually stale?
lib/pipeline/stage4-repair.ts     rewrite the stale line, draft a pinned comment
lib/pipeline/run.ts               the DAG; emits PipelineEvent
lib/pipeline/types.ts             the contract shared with the UI
lib/gemini.ts                     embeddings + JSON-constrained generation
lib/vector.ts                     in-process cosine index
app/api/run/route.ts              SSE stream of pipeline events
corpus/                           truth corpus + published library
```

## Commands

```bash
npm run verify    # stage 1 determinism + no-LLM boundary + quote traceability
npm run engine    # full run in the terminal, prints the decay report (~75s)
npm run facts     # just stage 1 output
npm run retrieve  # just stages 1-2
npm run index     # rebuild the vector index (only after changing the corpus)
npm run dev       # the console UI
```

`npm run verify` before every commit. It is fast and it guards the invariants.

## Gotchas

- **tsx does not read `.env.local`.** Scripts call `loadEnv()` from
  `lib/load-env.ts`; Next does it automatically for the app.
- **`corpus/` is excluded in tsconfig.** It contains real Tailwind source files
  which are data, not project code — without the exclude, `tsc` tries to compile
  them and fails on unresolved imports.
- **`outputFileTracingIncludes` in `next.config.ts` is load-bearing.** The route
  reads the corpus from disk at request time; Next's tracing only follows static
  imports, so removing it works on localhost and ENOENTs in production.
- **`maxDuration = 300` on the route.** A full run is ~75s, mostly model
  latency. The default function timeout cuts the stream off mid-adjudication.
- **The Gemini key is the shared FairLens/KSP/Crucible one.** It carries a
  service-account binding — never delete or rotate it to make a new one.
- Repo is public. `.env*` is gitignored; keep it that way.

## Corpus provenance

Nothing is synthetic, and that is the answer to "did you build the demo to
pass". The truth corpus is the real Tailwind upgrade guide plus real v3.4.17 and
v4.0.0 framework sources. The library is 22 real DEV.to articles published
2022–2024, each with a clickable URL. `scripts/corpus/build_library.py` rebuilds
it from the DEV.to public API; selection is by v3 pattern presence, and the
engine never sees that selection — it re-derives everything from the truth
corpus.

Four articles were kept as clean controls. If a run reports findings on all 22,
something has broken in adjudication.
