'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mockAssets } from '@/lib/mock-events';
import type { RunSnapshot } from '@/lib/snapshot';
import type {
  Asset,
  Candidate,
  ChangedFact,
  Finding,
  PipelineEvent,
  Repair,
  StageName,
} from '@/lib/pipeline/types';
import {
  openCheckStream,
  openRunStream,
  type RunStreamCallbacks,
  type RunStreamHandle,
  type StreamSource,
} from './run-stream';

export const STAGE_ORDER: StageName[] = ['diff', 'retrieve', 'adjudicate', 'repair'];

export type StageStatus = 'idle' | 'running' | 'done' | 'error';

export interface StageState {
  status: StageStatus;
  done: number;
  total: number;
  ms: number;
}

export type RunStatus = 'idle' | 'running' | 'complete' | 'error';

export type RunMode = 'corpus' | 'document';

export interface RunState {
  status: RunStatus;
  source: StreamSource | null;
  /** Which entry point produced this run - shown so the label is accurate. */
  mode: RunMode;
  stages: Record<StageName, StageState>;
  facts: ChangedFact[];
  /** The library this run checked, streamed by the pipeline at the start. */
  assets: Asset[];
  candidates: Candidate[];
  findings: Finding[];
  repairs: Repair[];
  summary: { staleAssets: number; totalFindings: number } | null;
  error: string | null;
}

const idleStage = (): StageState => ({ status: 'idle', done: 0, total: 0, ms: 0 });

function initialState(): RunState {
  return {
    status: 'idle',
    source: null,
    mode: 'corpus',
    stages: {
      diff: idleStage(),
      retrieve: idleStage(),
      adjudicate: idleStage(),
      repair: idleStage(),
    },
    facts: [],
    assets: [],
    candidates: [],
    findings: [],
    repairs: [],
    summary: null,
    error: null,
  };
}

function reduce(state: RunState, event: PipelineEvent): RunState {
  switch (event.type) {
    case 'stage-start':
      return {
        ...state,
        stages: { ...state.stages, [event.stage]: { ...idleStage(), status: 'running' } },
      };

    case 'stage-progress':
      return {
        ...state,
        stages: {
          ...state.stages,
          [event.stage]: {
            ...state.stages[event.stage],
            status: state.stages[event.stage].status === 'error' ? 'error' : 'running',
            done: event.done,
            total: event.total,
          },
        },
      };

    case 'stage-done':
      return {
        ...state,
        stages: {
          ...state.stages,
          [event.stage]: {
            status: 'done',
            done: event.count,
            total: state.stages[event.stage].total || event.count,
            ms: event.ms,
          },
        },
      };

    case 'facts':
      return { ...state, facts: [...state.facts, ...event.facts] };

    case 'assets':
      return { ...state, assets: event.assets };

    case 'candidates':
      return { ...state, candidates: [...state.candidates, ...event.candidates] };

    case 'finding':
      return { ...state, findings: [...state.findings, event.finding] };

    case 'repair':
      return { ...state, repairs: [...state.repairs, event.repair] };

    case 'retracted':
      // Stage 4 withdrew it: the rewrite matched the original, so the line never
      // needed changing. Remove it rather than showing a fix that fixes nothing.
      return {
        ...state,
        findings: state.findings.filter(
          (f) =>
            !(
              f.assetId === event.assetId &&
              f.segmentIdx === event.segmentIdx &&
              f.factId === event.factId
            ),
        ),
      };

    case 'error':
      return {
        ...state,
        status: 'error',
        error: event.message,
        stages: {
          ...state.stages,
          [event.stage]: { ...state.stages[event.stage], status: 'error' },
        },
      };

    case 'done':
      return {
        ...state,
        status: 'complete',
        summary: { staleAssets: event.staleAssets, totalFindings: event.totalFindings },
      };

    default:
      return state;
  }
}

/** Key for a finding / repair / candidate: the three ids that identify a hit. */
export function hitKey(x: { factId: string; assetId: string; segmentIdx: number }): string {
  return `${x.assetId}#${x.segmentIdx}#${x.factId}`;
}

export interface EngineRun {
  state: RunState;
  /** Numbers the four stage cards display, live. */
  counts: Record<StageName, number>;
  elapsedMs: number;
  factsById: Map<string, ChangedFact>;
  assetsById: Map<string, Asset>;
  repairsByHit: Map<string, Repair>;
  start: () => void;
  /** Run against one document the user supplied, by url. */
  check: (url: string) => void;
  reset: () => void;
  speed: number;
  setSpeed: (n: number) => void;
}

export function useEngineRun(snapshot?: RunSnapshot | null): EngineRun {
  // The console opens on a recorded run so a visit costs nothing and renders
  // instantly. It is marked `cached` so the UI never implies it just happened.
  const [state, setState] = useState<RunState>(() =>
    snapshot
      ? {
          ...initialState(),
          status: 'complete',
          source: 'cached',
          facts: snapshot.facts,
          assets: snapshot.assets,
          findings: snapshot.findings,
          repairs: snapshot.repairs,
          summary: {
            staleAssets: new Set(snapshot.findings.map((f) => f.assetId)).size,
            totalFindings: snapshot.findings.length,
          },
          stages: {
            diff: { status: 'done', done: snapshot.facts.length, total: snapshot.facts.length, ms: 0 },
            retrieve: {
              status: 'done',
              done: snapshot.candidates ?? 0,
              total: snapshot.candidates ?? 0,
              ms: 0,
            },
            adjudicate: {
              status: 'done',
              done: snapshot.findings.length,
              total: snapshot.findings.length,
              ms: 0,
            },
            repair: {
              status: 'done',
              done: snapshot.repairs.length,
              total: snapshot.repairs.length,
              ms: 0,
            },
          },
        }
      : initialState(),
  );
  const [speed, setSpeed] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const handleRef = useRef<RunStreamHandle | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => () => handleRef.current?.cancel(), []);

  // Elapsed clock, only while a run is in flight.
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
    return () => clearInterval(id);
  }, [state.status]);

  /** Shared by both entry points: reset state and wire the stream callbacks. */
  const begin = useCallback((mode: RunMode): RunStreamCallbacks => {
    handleRef.current?.cancel();
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState({ ...initialState(), status: 'running', mode });

    return {
      onEvent: (event) => setState((prev) => reduce(prev, event)),
      onSource: (source) => setState((prev) => ({ ...prev, source })),
      onEnd: (reason, message) => {
        setElapsedMs(Date.now() - startedAtRef.current);
        if (reason === 'error') {
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: message ?? 'The run ended unexpectedly.',
          }));
        } else if (reason === 'complete') {
          setState((prev) => (prev.status === 'error' ? prev : { ...prev, status: 'complete' }));
        }
      },
    };
  }, []);

  /** Check one document the user chose, rather than the committed corpus. */
  const check = useCallback(
    (url: string) => {
      handleRef.current = openCheckStream({ url: url.trim() }, begin('document'));
    },
    [begin],
  );

  /** Run against the committed corpus. */
  const start = useCallback(() => {
    handleRef.current = openRunStream(begin('corpus'), { speed });
  }, [begin, speed]);

  const reset = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    setElapsedMs(0);
    setState(initialState());
  }, []);

  const staleCount = useMemo(
    () => state.findings.filter((f) => f.verdict === 'STALE').length,
    [state.findings],
  );

  const counts = useMemo<Record<StageName, number>>(
    () => ({
      diff: Math.max(state.facts.length, state.stages.diff.done),
      retrieve: Math.max(state.candidates.length, state.stages.retrieve.done),
      adjudicate: staleCount,
      repair: state.repairs.length,
    }),
    [state.facts.length, state.candidates.length, state.repairs.length, state.stages, staleCount],
  );

  const factsById = useMemo(
    () => new Map(state.facts.map((f) => [f.id, f])),
    [state.facts],
  );

  // The pipeline streams the library it actually checked, so the report can
  // describe any document - including a live page the engine has never seen.
  // The mock fixture is only the fallback for mock mode, which emits no
  // `assets` event.
  /**
   * The mock fixture is a fallback for mock mode ONLY.
   *
   * It used to fill in whenever `assets` was empty, which became wrong the
   * moment the report started seeding a card per known asset: during the gap
   * before a live run's `assets` event lands, the report would render 22
   * fabricated tutorials as "checked and clean". Inventing checked content is
   * the one failure this project cannot have.
   */
  const assetsById = useMemo(() => {
    const source =
      state.assets.length > 0 ? state.assets : state.source === 'mock' ? mockAssets : [];
    return new Map(source.map((a) => [a.id, a]));
  }, [state.assets, state.source]);

  const repairsByHit = useMemo(
    () => new Map(state.repairs.map((r) => [hitKey(r), r])),
    [state.repairs],
  );

  return {
    state,
    counts,
    elapsedMs,
    factsById,
    assetsById,
    repairsByHit,
    start,
    check,
    reset,
    speed,
    setSpeed,
  };
}
