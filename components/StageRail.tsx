'use client';

import { Fragment } from 'react';

import type { StageName } from '@/lib/pipeline/types';

import { formatMs } from './format';
import { useCountUp } from './primitives';
import { STAGE_ORDER, type RunState, type StageState } from './useEngineRun';

interface StageMeta {
  index: string;
  title: string;
  unit: string;
  blurb: string;
}

const STAGE_META: Record<StageName, StageMeta> = {
  diff: {
    index: '01',
    title: 'Diff',
    unit: 'changes found',
    blurb: 'Deterministic extraction from the upgrade guide and the v4 utility source.',
  },
  retrieve: {
    index: '02',
    title: 'Retrieve',
    unit: 'candidates',
    blurb: 'Every changed token matched back against 22 published tutorials.',
  },
  adjudicate: {
    index: '03',
    title: 'Adjudicate',
    unit: 'confirmed stale',
    blurb: 'Each candidate judged against its quote. Unverifiable quotes are dropped.',
  },
  repair: {
    index: '04',
    title: 'Repair',
    unit: 'patches',
    blurb: 'A corrected line and a ready-to-post note, grounded in the cited change.',
  },
};

function StatusPill({ status }: { status: StageState['status'] }) {
  const map = {
    idle: { text: 'text-faint', ring: 'ring-line-2', dot: 'bg-faint', label: 'Idle' },
    running: { text: 'text-phos', ring: 'ring-phos/40', dot: 'bg-phos animate-blip', label: 'Running' },
    done: { text: 'text-ink', ring: 'ring-line-2', dot: 'bg-phos', label: 'Done' },
    error: { text: 'text-breaking', ring: 'ring-breaking/50', dot: 'bg-breaking', label: 'Error' },
  }[status];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase ring-1 ring-inset ${map.text} ${map.ring}`}
    >
      <span className={`size-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function StageCard({
  stage,
  state,
  count,
  accent,
}: {
  stage: StageName;
  state: StageState;
  count: number;
  accent: boolean;
}) {
  const meta = STAGE_META[stage];
  const shown = useCountUp(count);
  const running = state.status === 'running';
  const done = state.status === 'done';
  const pct = state.total > 0 ? Math.min(100, (state.done / state.total) * 100) : running ? 0 : 0;

  return (
    <div
      className={[
        'relative flex flex-col overflow-hidden rounded-lg border bg-panel p-4 transition-colors duration-300 sm:p-5',
        running ? 'border-phos/35' : done ? 'border-line-2' : 'border-line',
      ].join(' ')}
    >
      {running && <div className="hl-shimmer absolute inset-x-0 top-0 h-px" />}
      {accent && done && <div className="absolute inset-x-0 top-0 h-px bg-silent/70" />}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[11px] tracking-[0.2em] text-faint">{meta.index}</span>
          <span className="font-mono text-[13px] font-semibold tracking-[0.18em] text-ink uppercase">
            {meta.title}
          </span>
        </div>
        <StatusPill status={state.status} />
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-faint">{meta.blurb}</p>

      <div className="mt-5 flex items-baseline gap-2.5">
        <span
          className={[
            'font-mono text-[44px] leading-none font-semibold tabular-nums tracking-tight transition-colors sm:text-5xl',
            state.status === 'idle' ? 'text-line-2' : running ? 'text-phos' : 'text-ink',
          ].join(' ')}
        >
          {count < 0 ? '—' : shown}
        </span>
        <span className="text-[13px] text-dim">{meta.unit}</span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken ring-1 ring-line ring-inset">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-out ${
              state.status === 'error' ? 'bg-breaking' : done ? 'bg-phos/70' : 'bg-phos'
            }`}
            style={{ width: `${done ? 100 : pct}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
          {done
            ? state.ms > 0
              ? formatMs(state.ms)
              : '' /* recorded run: no per-stage timing was stored */
            : state.total > 0
              ? `${state.done}/${state.total}`
              : '—'}
        </span>
      </div>
    </div>
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <div className="hidden items-center justify-center px-1 lg:flex" aria-hidden="true">
      <svg viewBox="0 0 24 16" className={`h-4 w-6 transition-colors ${active ? 'text-phos' : 'text-line-2'}`}>
        <path
          d="M1 8h18m0 0-5-5m5 5-5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function StageRail({
  state,
  counts,
  hasSilent,
}: {
  state: RunState;
  counts: Record<StageName, number>;
  hasSilent: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:gap-x-1">
      {STAGE_ORDER.map((stage, i) => (
        <Fragment key={stage}>
          {i > 0 && <Arrow active={state.stages[stage].status !== 'idle'} />}
          <StageCard
            stage={stage}
            state={state.stages[stage]}
            count={counts[stage]}
            accent={stage === 'adjudicate' && hasSilent}
          />
        </Fragment>
      ))}
    </div>
  );
}
