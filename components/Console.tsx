'use client';

import { useMemo, useState } from 'react';

import { DecayReport } from './DecayReport';
import { formatMs } from './format';
import { StageRail } from './StageRail';
import { useEngineRun } from './useEngineRun';

const SPEEDS = [1, 2, 4];

function Metric({
  value,
  label,
  tone = 'ink',
}: {
  value: string | number;
  label: string;
  tone?: 'ink' | 'silent' | 'breaking' | 'phos';
}) {
  const toneClass = {
    ink: 'text-ink',
    silent: 'text-silent',
    breaking: 'text-breaking',
    phos: 'text-phos',
  }[tone];

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={`font-mono text-xl leading-none font-semibold tabular-nums sm:text-2xl ${toneClass}`}>
        {value}
      </span>
      <span className="font-mono text-[10.5px] tracking-[0.16em] text-faint uppercase">{label}</span>
    </div>
  );
}

export function Console() {
  const {
    state,
    counts,
    elapsedMs,
    factsById,
    assetsById,
    repairsByHit,
    start,
    check,
    speed,
    setSpeed,
  } = useEngineRun();

  const running = state.status === 'running';
  const [url, setUrl] = useState('');

  const severityTotals = useMemo(() => {
    let silent = 0;
    let breaking = 0;
    for (const f of state.findings) {
      if (f.verdict !== 'STALE') continue;
      if (factsById.get(f.factId)?.severity === 'silent') silent += 1;
      else breaking += 1;
    }
    return { silent, breaking };
  }, [state.findings, factsById]);

  const staleAssets = useMemo(
    () =>
      new Set(state.findings.filter((f) => f.verdict === 'STALE').map((f) => f.assetId)).size,
    [state.findings],
  );

  const buttonLabel =
    state.status === 'idle' ? 'Run engine' : running ? 'Running' : 'Run again';

  return (
    <div className="relative min-h-screen">
      <div className="hl-field pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-24 sm:px-6 lg:px-8">
        {/* ---------------------------------------------------------------- */}
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 border-b border-line py-8 sm:py-10">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="relative flex size-2.5" aria-hidden="true">
                <span
                  className={`absolute inline-flex size-full rounded-full bg-phos ${running ? 'animate-ping opacity-70' : 'opacity-0'}`}
                />
                <span className="relative inline-flex size-2.5 rounded-full bg-phos" />
              </span>
              <h1 className="font-mono text-2xl font-semibold tracking-[0.28em] text-ink uppercase sm:text-[28px]">
                Half-Life
              </h1>
              <span className="rounded-sm bg-raised px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.14em] text-dim ring-1 ring-line-2 ring-inset">
                Tailwind v3 → v4
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-dim sm:text-[15px]">
              Published tutorials do not get retracted when the framework moves underneath them.
              This engine reads the real upgrade guide and the v4 source, extracts what actually
              changed, and finds which published pages are still teaching the old behaviour.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-sm ring-1 ring-line-2 ring-inset">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={running}
                  onClick={() => setSpeed(s)}
                  aria-pressed={speed === s}
                  className={`px-2.5 py-2 font-mono text-[11px] font-semibold tabular-nums transition-colors disabled:opacity-40 ${
                    speed === s ? 'bg-raised text-phos' : 'text-faint hover:text-dim'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={start}
              disabled={running}
              className={[
                'relative inline-flex items-center gap-2.5 overflow-hidden rounded-md px-5 py-3 font-mono text-[13px] font-semibold tracking-[0.16em] uppercase transition-colors',
                running
                  ? 'cursor-progress bg-raised text-phos ring-1 ring-phos/40 ring-inset'
                  : 'bg-phos text-void hover:bg-phos/85',
              ].join(' ')}
            >
              {running && <span className="hl-shimmer absolute inset-x-0 top-0 h-px" />}
              <span
                className={`size-2 rounded-full ${running ? 'animate-blip bg-phos' : 'bg-void/70'}`}
                aria-hidden="true"
              />
              {buttonLabel}
            </button>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line py-3.5 font-mono text-[11.5px] text-faint">
          <span>
            <span className="text-dim">truth corpus</span> corpus/truth/upgrade-guide.mdx +
            v4/utilities.ts
          </span>
          <span className="hidden text-line-2 sm:inline">/</span>
          <span>
            {state.mode === 'document' ? (
              <>
                <span className="text-dim">checking</span> one live page
              </>
            ) : (
              <>
                <span className="text-dim">library corpus</span> {assetsById.size} published DEV.to
                tutorials
              </>
            )}
          </span>
          <span className="ml-auto flex items-center gap-4">
            {state.source && (
              <span
                className={
                  state.source === 'live' ? 'text-phos' : 'text-silent/90'
                }
              >
                {state.source !== 'live'
                  ? 'stream mock replay'
                  : state.mode === 'document'
                    ? 'stream /api/check'
                    : 'stream /api/run'}
              </span>
            )}
            <span className="tabular-nums text-dim">
              {elapsedMs > 0 ? formatMs(Math.round(elapsedMs)) : '0 ms'}
            </span>
          </span>
        </div>

        {/* ----------------------------------------------------------------
            Point the engine at something nobody picked in advance. Same four
            stages, same facts - just a library of one. */}
        <form
          className="mt-5 flex flex-wrap items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && !running) check(url);
          }}
        >
          <label htmlFor="check-url" className="sr-only">
            URL of a tutorial to check
          </label>
          <input
            id="check-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={running}
            placeholder="https://…  check any tutorial on the web"
            className="min-w-0 flex-1 basis-72 rounded-md border border-line-2 bg-void px-3.5 py-2.5 font-mono text-[13px] text-ink placeholder:text-faint focus:border-phos/60 focus:outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={running || !url.trim()}
            className="rounded-md px-4 py-2.5 font-mono text-[11px] font-semibold tracking-[0.16em] text-dim uppercase ring-1 ring-line-2 ring-inset transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Check this page
          </button>
        </form>

        {/* ---------------------------------------------------------------- */}
        <div className="mt-6">
          <StageRail state={state} counts={counts} hasSilent={severityTotals.silent > 0} />
        </div>

        {state.error && (
          <div className="mt-4 rounded-lg border border-breaking/40 bg-breaking/[0.07] px-4 py-3 text-[13px] text-breaking sm:px-5">
            {state.error}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {state.status === 'idle' ? (
          <section className="mt-10 rounded-lg border border-line bg-panel px-5 py-8 sm:px-8 sm:py-10">
            <div className="max-w-3xl">
              <div className="font-mono text-[11px] font-semibold tracking-[0.22em] text-phos uppercase">
                Standing by
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-dim sm:text-base">
                The interesting failures are not the loud ones. When Tailwind v4 renamed its shadow
                scale, v3&apos;s <Token>shadow</Token> became v4&apos;s <Token>shadow-sm</Token> — so
                a two-year-old tutorial telling you to add <Token>shadow-sm</Token> still compiles,
                still renders, and now produces a different shadow than the screenshots beside it.
                No error. No warning. Just a quietly wrong tutorial with a year of accumulated
                authority.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-dim sm:text-base">
                Press <span className="font-mono text-[13px] font-semibold tracking-[0.12em] text-phos uppercase">Run engine</span>{' '}
                to watch the four stages work.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="mt-8 rounded-lg border border-line bg-panel px-4 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-5 sm:gap-x-10">
                  <Metric value={counts.diff} label="changes" />
                  <Metric value={counts.retrieve} label="candidates" />
                  <Metric
                    value={severityTotals.silent}
                    label="silent"
                    tone={severityTotals.silent ? 'silent' : 'ink'}
                  />
                  <Metric
                    value={severityTotals.breaking}
                    label="breaking"
                    tone={severityTotals.breaking ? 'breaking' : 'ink'}
                  />
                  <Metric value={staleAssets} label="stale tutorials" />
                  <Metric value={counts.repair} label="patches" tone="phos" />
                </div>

                <div className="font-mono text-[11.5px] tracking-[0.14em] uppercase">
                  {state.status === 'complete' ? (
                    <span className="inline-flex items-center gap-2 text-phos">
                      <span className="size-1.5 rounded-full bg-phos" />
                      Run complete in {formatMs(Math.round(elapsedMs))}
                    </span>
                  ) : state.status === 'error' ? (
                    <span className="inline-flex items-center gap-2 text-breaking">
                      <span className="size-1.5 rounded-full bg-breaking" />
                      Run failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-dim">
                      <span className="size-1.5 animate-blip rounded-full bg-phos" />
                      Engine running
                    </span>
                  )}
                </div>
              </div>
            </section>

            <DecayReport
              findings={state.findings}
              factsById={factsById}
              assetsById={assetsById}
              repairsByHit={repairsByHit}
              repairStarted={state.stages.repair.status !== 'idle'}
              adjudicating={state.stages.adjudicate.status === 'running'}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Token({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-[0.88em] text-silent ring-1 ring-line-2 ring-inset">
      {children}
    </code>
  );
}
