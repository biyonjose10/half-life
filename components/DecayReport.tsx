'use client';

import { useMemo, useState } from 'react';

import type { Asset, ChangedFact, Finding, Repair, Severity } from '@/lib/pipeline/types';

import { FindingRow } from './FindingRow';
import { ageSince, formatDate } from './format';
import { CleanChip, ExternalIcon, SeverityChip } from './primitives';
import { hitKey } from './useEngineRun';

type Filter = 'all' | 'silent' | 'breaking';

interface AssetGroup {
  assetId: string;
  asset?: Asset;
  stale: Finding[];
  cleared: Finding[];
  silent: number;
  breaking: number;
  score: number;
}

function severityOf(finding: Finding, factsById: Map<string, ChangedFact>): Severity {
  return factsById.get(finding.factId)?.severity ?? 'breaking';
}

function group(
  findings: Finding[],
  factsById: Map<string, ChangedFact>,
  assetsById: Map<string, Asset>,
): AssetGroup[] {
  const byAsset = new Map<string, AssetGroup>();

  for (const finding of findings) {
    let g = byAsset.get(finding.assetId);
    if (!g) {
      g = {
        assetId: finding.assetId,
        asset: assetsById.get(finding.assetId),
        stale: [],
        cleared: [],
        silent: 0,
        breaking: 0,
        score: 0,
      };
      byAsset.set(finding.assetId, g);
    }
    if (finding.verdict === 'STALE') {
      g.stale.push(finding);
      if (severityOf(finding, factsById) === 'silent') g.silent += 1;
      else g.breaking += 1;
    } else {
      g.cleared.push(finding);
    }
  }

  const groups = [...byAsset.values()];
  for (const g of groups) {
    // Silent findings weigh more: they are the ones nothing else will catch.
    g.score = g.silent * 3 + g.breaking * 2;
    g.stale.sort((a, b) => {
      const sa = severityOf(a, factsById) === 'silent' ? 0 : 1;
      const sb = severityOf(b, factsById) === 'silent' ? 0 : 1;
      return sa - sb || b.confidence - a.confidence;
    });
  }

  groups.sort((a, b) => {
    const aClean = a.stale.length === 0;
    const bClean = b.stale.length === 0;
    if (aClean !== bClean) return aClean ? 1 : -1;
    return (
      b.score - a.score ||
      b.stale.length - a.stale.length ||
      (a.asset?.publishedAt ?? '').localeCompare(b.asset?.publishedAt ?? '')
    );
  });

  return groups;
}

function AssetCard({
  group: g,
  factsById,
  repairsByHit,
  expanded,
  toggle,
  filter,
  repairStarted,
}: {
  group: AssetGroup;
  factsById: Map<string, ChangedFact>;
  repairsByHit: Map<string, Repair>;
  expanded: Set<string>;
  toggle: (key: string) => void;
  filter: Filter;
  repairStarted: boolean;
}) {
  const clean = g.stale.length === 0;
  const accent = clean ? 'border-l-clean/70' : g.silent > 0 ? 'border-l-silent' : 'border-l-breaking';

  const visible =
    filter === 'all'
      ? g.stale
      : g.stale.filter((f) => severityOf(f, factsById) === filter);

  const title = g.asset?.title ?? g.assetId;

  return (
    <article className={`overflow-hidden rounded-lg border border-line border-l-2 bg-panel ${accent}`}>
      <header className="flex flex-wrap items-start gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1 basis-[22rem]">
          {g.asset?.url ? (
            <a
              href={g.asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1.5 text-[15px] leading-snug font-medium text-ink underline-offset-4 transition-colors hover:text-phos hover:underline sm:text-base"
            >
              {title}
              <ExternalIcon className="mt-1 shrink-0 opacity-60" />
            </a>
          ) : (
            <span className="text-[15px] leading-snug font-medium text-ink sm:text-base">{title}</span>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11.5px] text-faint">
            <span className="text-dim">{g.assetId}</span>
            <span className="text-line-2">/</span>
            {g.asset && (
              <>
                <span>published {formatDate(g.asset.publishedAt)}</span>
                <span className="text-line-2">/</span>
                <span>{ageSince(g.asset.publishedAt)} old</span>
                <span className="text-line-2">/</span>
              </>
            )}
            <span>
              {g.stale.length + g.cleared.length} candidate
              {g.stale.length + g.cleared.length === 1 ? '' : 's'} adjudicated
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {clean ? (
            <CleanChip />
          ) : (
            <>
              {g.silent > 0 && <SeverityChip severity="silent" count={g.silent} />}
              {g.breaking > 0 && <SeverityChip severity="breaking" count={g.breaking} />}
            </>
          )}
        </div>
      </header>

      {clean ? (
        <p className="border-t border-line px-4 py-3.5 text-[13px] leading-relaxed text-faint sm:px-5">
          {g.cleared.length} candidate{g.cleared.length === 1 ? '' : 's'} retrieved and checked
          against the change set. None of them depend on behaviour that moved — this tutorial is
          still correct on v4.
        </p>
      ) : visible.length === 0 ? (
        <p className="border-t border-line px-4 py-3.5 font-mono text-[12px] text-faint sm:px-5">
          No {filter} findings on this asset.
        </p>
      ) : (
        <ul>
          {visible.map((finding) => {
            const key = hitKey(finding);
            return (
              <FindingRow
                key={key}
                finding={finding}
                fact={factsById.get(finding.factId)}
                segment={g.asset?.segments.find((s) => s.idx === finding.segmentIdx)}
                repair={repairsByHit.get(key)}
                expanded={expanded.has(key)}
                onToggle={() => toggle(key)}
                awaitingRepair={repairStarted}
              />
            );
          })}
        </ul>
      )}
    </article>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone = 'neutral',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'neutral' | 'silent' | 'breaking';
}) {
  const toneRing =
    tone === 'silent'
      ? 'text-silent ring-silent/40'
      : tone === 'breaking'
        ? 'text-breaking ring-breaking/35'
        : 'text-dim ring-line-2';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-2 rounded-sm px-2.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] uppercase ring-1 ring-inset transition-colors',
        active ? 'bg-raised text-ink ring-phos/45' : `bg-transparent hover:bg-raised ${toneRing}`,
      ].join(' ')}
    >
      {label}
      <span className="tabular-nums opacity-75">{count}</span>
    </button>
  );
}

export function DecayReport({
  findings,
  factsById,
  assetsById,
  repairsByHit,
  repairStarted,
  adjudicating,
}: {
  findings: Finding[];
  factsById: Map<string, ChangedFact>;
  assetsById: Map<string, Asset>;
  repairsByHit: Map<string, Repair>;
  repairStarted: boolean;
  adjudicating: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showClean, setShowClean] = useState(true);
  /**
   * Explicit open/closed choices only. The default-open row is derived during
   * render rather than written into state by an effect, which would cascade a
   * second render every time the report grows mid-run.
   */
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  const groups = useMemo(
    () => group(findings, factsById, assetsById),
    [findings, factsById, assetsById],
  );

  const totals = useMemo(() => {
    let silent = 0;
    let breaking = 0;
    for (const g of groups) {
      silent += g.silent;
      breaking += g.breaking;
    }
    const stale = groups.filter((g) => g.stale.length > 0);
    return {
      silent,
      breaking,
      all: silent + breaking,
      staleAssets: stale.length,
      cleanAssets: groups.length - stale.length,
    };
  }, [groups]);

  // The worst finding on the worst asset opens by default, so the report never
  // lands on a wall of collapsed rows. The reader can still close it.
  const defaultOpen = useMemo(() => {
    const top = groups.find((g) => g.stale.length > 0);
    return top ? hitKey(top.stale[0]) : null;
  }, [groups]);

  const isOpen = (key: string, state: Map<string, boolean> = overrides) =>
    state.has(key) ? state.get(key)! : key === defaultOpen;

  const expanded = useMemo(() => {
    const open = new Set<string>();
    if (defaultOpen && overrides.get(defaultOpen) !== false) open.add(defaultOpen);
    for (const [key, value] of overrides) if (value) open.add(key);
    return open;
  }, [defaultOpen, overrides]);

  const toggle = (key: string) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(key, !isOpen(key, prev));
      return next;
    });

  const visibleGroups = groups.filter((g) => {
    if (g.stale.length === 0) return filter === 'all' && showClean;
    if (filter === 'all') return true;
    return g.stale.some((f) => severityOf(f, factsById) === filter);
  });

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h2 className="font-mono text-[13px] font-semibold tracking-[0.24em] text-ink uppercase">
            Decay report
          </h2>
          <p className="mt-1.5 text-[13px] text-faint">
            {totals.all > 0
              ? `${totals.all} confirmed findings across ${totals.staleAssets} tutorial${
                  totals.staleAssets === 1 ? '' : 's'
                } · ${totals.cleanAssets} checked and clean · ordered by silent-failure risk`
              : adjudicating
                ? 'Adjudicating retrieved candidates…'
                : 'Findings appear here as the adjudicator confirms them.'}
          </p>
        </div>

        {totals.all > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={totals.all} />
            <FilterChip
              active={filter === 'silent'}
              onClick={() => setFilter('silent')}
              label="Silent"
              count={totals.silent}
              tone="silent"
            />
            <FilterChip
              active={filter === 'breaking'}
              onClick={() => setFilter('breaking')}
              label="Breaking"
              count={totals.breaking}
              tone="breaking"
            />
            <button
              type="button"
              onClick={() => setShowClean((v) => !v)}
              aria-pressed={showClean}
              className={`inline-flex items-center gap-2 rounded-sm px-2.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] uppercase ring-1 ring-inset transition-colors ${
                showClean ? 'bg-raised text-clean ring-clean/45' : 'text-faint ring-line-2 hover:bg-raised'
              }`}
            >
              Clean
              <span className="tabular-nums opacity-75">{totals.cleanAssets}</span>
            </button>
          </div>
        )}
      </div>

      {totals.silent > 0 && (
        <div className="mt-5 flex flex-col gap-2.5 rounded-lg border border-silent/30 bg-silent/[0.055] px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
          <span className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.18em] text-silent uppercase">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-silent opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-silent" />
            </span>
            {totals.silent} silent
          </span>
          <p className="text-[13px] leading-relaxed text-dim">
            A <span className="font-semibold text-silent">silent</span> finding is one where the v3
            class name still exists in v4 and now means something else — <code className="rounded-sm bg-sunken px-1 py-px font-mono text-[0.92em] text-ink ring-1 ring-line-2 ring-inset">shadow-sm</code>{' '}
            is now the shadow v3 called <code className="rounded-sm bg-sunken px-1 py-px font-mono text-[0.92em] text-ink ring-1 ring-line-2 ring-inset">shadow</code>. The
            tutorial still compiles, so no build error, no linter, and no reader ever flags it. That
            is why these rank above the breaking ones.
          </p>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {visibleGroups.map((g) => (
          <AssetCard
            key={g.assetId}
            group={g}
            factsById={factsById}
            repairsByHit={repairsByHit}
            expanded={expanded}
            toggle={toggle}
            filter={filter}
            repairStarted={repairStarted}
          />
        ))}
      </div>
    </section>
  );
}
