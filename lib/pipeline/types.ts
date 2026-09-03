/**
 * Shared types for the Half-Life pipeline.
 *
 * The pipeline runs in five stages. Stage 1 is deterministic and must never
 * import an LLM client - see stage1-diff.ts for why that boundary matters.
 */

// ---------------------------------------------------------------------------
// Stage 1 - change extraction (deterministic)
// ---------------------------------------------------------------------------

export type ChangeKind = 'renamed' | 'removed' | 'behaviour-changed';

/**
 * `silent` is the interesting one: the old token still resolves in the new
 * version but now means something different, so published content keeps
 * "working" while quietly teaching the wrong result.
 */
export type Severity = 'silent' | 'breaking';

export interface Evidence {
  /** Repo-relative path of the source-of-truth file this was derived from. */
  file: string;
  line: number;
  /** Verbatim text from that file. Never paraphrased. */
  quote: string;
}

export type FactSource =
  | 'upgrade-guide-rename-table'
  | 'upgrade-guide-removal-table'
  | 'upgrade-guide-codeblock'
  | 'upgrade-guide-prose';

export interface ChangedFact {
  /** Stable across runs: derived from content, never from iteration order. */
  id: string;
  kind: ChangeKind;
  /** The token as it appears in v3 content. */
  old: string;
  /** The v4 replacement, or null when nothing replaces it. */
  new: string | null;
  /** Human-readable description of the change. */
  detail: string;
  severity: Severity;
  /** Why we judged the severity - shown in the UI so the call is auditable. */
  severityReason: string;
  source: FactSource;
  evidence: Evidence;
  /** Regex used to find this fact in published content, as a string. */
  pattern: string;
}

// ---------------------------------------------------------------------------
// Library corpus - the published content being checked
// ---------------------------------------------------------------------------

export interface Segment {
  idx: number;
  heading: string;
  kind: 'prose' | 'code';
  text: string;
}

export interface Asset {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  type: 'article' | 'video';
  segments: Segment[];
}

// ---------------------------------------------------------------------------
// Stage 2 - cross-corpus retrieval
// ---------------------------------------------------------------------------

export type MatchMethod = 'exact' | 'semantic';

export interface Candidate {
  factId: string;
  assetId: string;
  segmentIdx: number;
  /** How the segment was surfaced. Exact matches are certainties. */
  method: MatchMethod;
  /** 1 for exact matches; cosine similarity for semantic ones. */
  score: number;
  /** The segment text, trimmed to a readable window around the hit. */
  snippet: string;
}

// ---------------------------------------------------------------------------
// Stage 3 - adjudication (LLM)
// ---------------------------------------------------------------------------

export interface Finding {
  factId: string;
  assetId: string;
  segmentIdx: number;
  verdict: 'STALE' | 'FINE';
  confidence: number;
  /**
   * Must appear verbatim in the segment. Verified in code after the model
   * responds - a quote that is not found is discarded, not trusted.
   */
  staleSentence: string;
  why: string;
}

// ---------------------------------------------------------------------------
// Stage 4 - repair (LLM, grounded)
// ---------------------------------------------------------------------------

export interface Repair {
  factId: string;
  assetId: string;
  segmentIdx: number;
  /** Rewritten line, correct under the new version. */
  corrected: string;
  /** Ready-to-post note for the creator's audience. */
  pinnedComment: string;
}

// ---------------------------------------------------------------------------
// Pipeline events (streamed to the UI over SSE)
// ---------------------------------------------------------------------------

export type StageName = 'diff' | 'retrieve' | 'adjudicate' | 'repair';

export type PipelineEvent =
  | { type: 'stage-start'; stage: StageName }
  | { type: 'stage-progress'; stage: StageName; done: number; total: number }
  | { type: 'stage-done'; stage: StageName; count: number; ms: number }
  | { type: 'facts'; facts: ChangedFact[] }
  /**
   * The library being checked, sent once at the start. Findings carry only
   * ids, so without this the UI cannot show a title, date or source link.
   *
   * Segment *text* is stripped before sending - the corpus is over half a
   * megabyte and the UI reads nothing from a segment but its heading.
   */
  | { type: 'assets'; assets: Asset[] }
  | { type: 'candidates'; candidates: Candidate[] }
  | { type: 'finding'; finding: Finding }
  | { type: 'repair'; repair: Repair }
  | { type: 'error'; stage: StageName; message: string }
  | { type: 'done'; staleAssets: number; totalFindings: number };
