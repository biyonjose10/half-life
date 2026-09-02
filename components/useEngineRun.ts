'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mockAssets } from '@/lib/mock-events';
import type {
  Asset,
  Candidate,
  ChangedFact,
  Finding,
  PipelineEvent,
  Repair,
  StageName,
} from '@/lib/pipeline/types';
import { openRunStream, type RunStreamHandle, type StreamSource } from './run-stream';

export const STAGE_ORDER: StageName[] = ['diff', 'retrieve', 'adjudicate', 'repair'];

export type StageStatus = 'idle' | 'running' | 'done' | 'error';

export interface StageState {
  status: StageStatus;
  done: number;
  total: number;
  ms: number;
}

export type RunStatus = 'idle' | 'running' | 'complete' | 'error';

export interface RunState {
  status: RunStatus;
  source: StreamSource | null;
  stages: Record<StageName, StageState>;
  facts: ChangedFact[];
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
    stages: {
      diff: idleStage(),
      retrieve: idleStage(),
      adjudicate: idleStage(),
      repair: idleStage(),
    },
    facts: [],
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

    case 'candidates':
      return { ...state, candidates: [...state.candidates, ...event.candidates] };

    case 'finding':
      return { ...state, findings: [...state.findings, event.finding] };

    case 'repair':
      return { ...state, repairs: [...state.repairs, event.repair] };

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
  reset: () => void;
  speed: number;
  setSpeed: (n: number) => void;
}

export function useEngineRun(): EngineRun {
  const [state, setState] = useState<RunState>(initialState);
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

  const start = useCallback(() => {
    handleRef.current?.cancel();
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState({ ...initialState(), status: 'running' });

    handleRef.current = openRunStream(
      {
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
      },
      { speed },
    );
  }, [speed]);

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

  // No pipeline event carries Asset metadata, so the console resolves asset
  // ids against a local registry. See the note in app/page.tsx.
  const assetsById = useMemo(() => new Map(mockAssets.map((a) => [a.id, a])), []);

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
    reset,
    speed,
    setSpeed,
  };
}
