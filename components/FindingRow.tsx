'use client';

import type { ChangedFact, Finding, Repair, Segment, Severity } from '@/lib/pipeline/types';

import { highlightRegex, splitOnMatches } from './format';
import { CopyButton, FieldLabel, RichText, SEVERITY_STYLES, SeverityChip } from './primitives';

/** Repo root for citation links, so a quote can be checked at its source line. */
const SOURCE_BASE = 'https://github.com/biyonjose10/half-life/blob/main';


function firstLine(s: string): string {
  const [head, ...rest] = s.split('\n');
  return rest.length ? `${head} …` : head;
}

export function factLabel(fact: ChangedFact): string {
  if (fact.new) return `${firstLine(fact.old)}  →  ${firstLine(fact.new)}`;
  return `${firstLine(fact.old)}  →  removed`;
}

function oneLine(s: string, max = 150): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function Verbatim({
  text,
  fact,
  severity,
  tone = 'default',
}: {
  text: string;
  fact?: ChangedFact;
  severity: Severity;
  tone?: 'default' | 'fixed';
}) {
  const parts = splitOnMatches(text, fact ? highlightRegex(fact) : null);
  const markClass =
    severity === 'silent'
      ? 'bg-silent/25 text-silent ring-1 ring-silent/40'
      : 'bg-breaking/20 text-breaking ring-1 ring-breaking/40';

  return (
    <div
      className={`hl-scroll overflow-x-auto rounded-md border bg-sunken ${
        tone === 'fixed' ? 'border-phos/25' : 'border-line'
      }`}
    >
      <pre className="w-max min-w-full px-3.5 py-3 font-mono text-[12.5px] leading-[1.75] whitespace-pre text-dim">
        {tone === 'fixed'
          ? text
          : parts.map(([chunk, hit], i) =>
              hit ? (
                <mark key={i} className={`rounded-xs px-0.5 font-semibold ${markClass}`}>
                  {chunk}
                </mark>
              ) : (
                <span key={i}>{chunk}</span>
              ),
            )}
      </pre>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-1 w-14 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full bg-phos/80"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-dim">{value.toFixed(2)}</span>
    </span>
  );
}

export function FindingRow({
  finding,
  fact,
  segment,
  repair,
  expanded,
  onToggle,
  awaitingRepair,
}: {
  finding: Finding;
  fact?: ChangedFact;
  segment?: Segment;
  repair?: Repair;
  expanded: boolean;
  onToggle: () => void;
  awaitingRepair: boolean;
}) {
  const severity: Severity = fact?.severity ?? 'breaking';
  const s = SEVERITY_STYLES[severity];
  const rowId = `${finding.assetId}-${finding.segmentIdx}-${finding.factId}`;

  return (
    <li className="animate-rise border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`detail-${rowId}`}
        className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised/70 sm:px-5"
      >
        <span
          className={`mt-1 shrink-0 text-faint transition-transform group-hover:text-dim ${
            expanded ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 12 12" className="size-3">
            <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SeverityChip severity={severity} size="sm" />
            {fact && (
              <span className="font-mono text-[13px] font-medium text-ink">
                {factLabel(fact)}
              </span>
            )}
            <span className="font-mono text-[11.5px] text-faint">
              {segment?.heading ? `§ ${segment.heading}` : 'no heading'} · segment {finding.segmentIdx}
            </span>
          </span>
          <span className="mt-1.5 block truncate font-mono text-[12px] text-faint">
            {oneLine(finding.staleSentence)}
          </span>
        </span>
      </button>

      {expanded && (
        <div id={`detail-${rowId}`} className="animate-rise px-4 pb-5 sm:px-5">
          <div className={`space-y-4 border-l-2 pl-4 ${severity === 'silent' ? 'border-silent/60' : 'border-breaking/50'}`}>
            <div>
              <FieldLabel>Verbatim, from the published page</FieldLabel>
              <Verbatim text={finding.staleSentence} fact={fact} severity={severity} />
            </div>

            {severity === 'silent' && (
              <div className="rounded-md border border-silent/35 bg-silent/[0.07] px-3.5 py-3">
                <div className={`mb-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase ${s.text}`}>
                  Why silent is worse than breaking
                </div>
                <p className="text-[13px] leading-relaxed text-dim">
                  A breaking change stops the build, so the reader knows to go looking. This one
                  compiles, renders, and looks finished — the tutorial keeps its authority while
                  teaching a result that no longer happens. Nothing in the reader&apos;s toolchain
                  will ever raise it.
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>What changed</FieldLabel>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-dim">
                  {fact ? <RichText text={fact.detail} /> : finding.factId}
                </p>
              </div>
              <div>
                <FieldLabel>Why this severity</FieldLabel>
                <p className="text-[13px] leading-relaxed text-dim">
                  {fact ? <RichText text={fact.severityReason} /> : '—'}
                </p>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <FieldLabel>Adjudicator note</FieldLabel>
                <Confidence value={finding.confidence} />
              </div>
              <p className="text-[13px] leading-relaxed text-dim">
                <RichText text={finding.why} />
              </p>
            </div>

            {fact && (
              <div>
                <FieldLabel>Evidence</FieldLabel>
                <div className="rounded-md border border-line bg-sunken">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3.5 py-2 font-mono text-[11.5px] text-faint">
                    <span className="text-phos/80">source of truth</span>
                    <span className="text-line-2">/</span>
                    {/* The whole claim is "check it yourself", so the citation
                        has to be one click from the line it names, not a
                        string the reader has to take on trust. */}
                    <a
                      href={`${SOURCE_BASE}/${fact.evidence.file}#L${fact.evidence.line}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-dim underline decoration-line-2 underline-offset-2 transition-colors hover:text-phos hover:decoration-phos"
                      title="Open this line on GitHub"
                    >
                      {fact.evidence.file}:{fact.evidence.line}
                    </a>
                    <span className="text-line-2">/</span>
                    <span>{fact.source}</span>
                  </div>
                  <div className="hl-scroll overflow-x-auto">
                    <pre className="w-max min-w-full px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre text-ink">
                      {fact.evidence.quote}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {repair ? (
              <div className="space-y-3 rounded-md border border-phos/25 bg-phos/[0.04] p-3.5">
                <div>
                  <FieldLabel>Corrected line</FieldLabel>
                  <Verbatim text={repair.corrected} severity={severity} tone="fixed" />
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <FieldLabel>Pinned comment for the creator</FieldLabel>
                    <CopyButton text={repair.pinnedComment} label="Copy comment" />
                  </div>
                  <p className="rounded-md border border-line bg-sunken px-3.5 py-3 text-[13px] leading-relaxed text-dim">
                    <RichText text={repair.pinnedComment} />
                  </p>
                </div>
              </div>
            ) : awaitingRepair ? (
              <div className="flex items-center gap-2.5 rounded-md border border-dashed border-line-2 px-3.5 py-3 font-mono text-[11.5px] tracking-[0.1em] text-faint uppercase">
                <span className="size-1.5 animate-blip rounded-full bg-phos" />
                Generating patch…
              </div>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}
