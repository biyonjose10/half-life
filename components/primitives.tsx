'use client';

import { useEffect, useRef, useState } from 'react';

import type { Severity } from '@/lib/pipeline/types';

/* -------------------------------------------------------------------------
   Count-up
   ------------------------------------------------------------------------- */

/** Eases a counter towards `target` so batched events still read as motion. */
export function useCountUp(target: number, ms = 420): number {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(from + (target - from) * eased);
      displayRef.current = value;
      setDisplay(value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return display;
}

/* -------------------------------------------------------------------------
   Inline `code` rendering for pipeline prose
   ------------------------------------------------------------------------- */

export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split('`');
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="whitespace-pre-wrap rounded-sm bg-sunken px-1 py-px font-mono text-[0.92em] text-ink ring-1 ring-line-2 ring-inset"
          >
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------
   Severity
   ------------------------------------------------------------------------- */

export const SEVERITY_STYLES: Record<
  Severity,
  { chip: string; text: string; rule: string; dot: string; label: string }
> = {
  silent: {
    chip: 'bg-silent/15 text-silent ring-1 ring-silent/50 shadow-[0_0_18px_-6px] shadow-silent/70',
    text: 'text-silent',
    rule: 'bg-silent',
    dot: 'bg-silent',
    label: 'SILENT',
  },
  breaking: {
    chip: 'bg-breaking/10 text-breaking ring-1 ring-breaking/40',
    text: 'text-breaking',
    rule: 'bg-breaking',
    dot: 'bg-breaking',
    label: 'BREAKING',
  },
};

export function SeverityChip({
  severity,
  count,
  size = 'md',
}: {
  severity: Severity;
  count?: number;
  size?: 'sm' | 'md';
}) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-sm font-mono font-semibold tracking-[0.14em] uppercase',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
        s.chip,
      ].join(' ')}
    >
      {severity === 'silent' ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-silent opacity-70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-silent" />
        </span>
      ) : (
        <span className="size-1.5 rounded-full bg-breaking" />
      )}
      {s.label}
      {count !== undefined && <span className="tabular-nums opacity-80">{count}</span>}
    </span>
  );
}

export function CleanChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-clean/10 px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.14em] text-clean uppercase ring-1 ring-clean/35">
      <span className="size-1.5 rounded-full bg-clean" />
      CLEAN
    </span>
  );
}

/* -------------------------------------------------------------------------
   Copy to clipboard
   ------------------------------------------------------------------------- */

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors',
        copied
          ? 'border-phos/50 bg-phos/10 text-phos'
          : 'border-line-2 bg-raised text-dim hover:border-phos/40 hover:text-phos',
      ].join(' ')}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <path
            d="M3 8.5 6.2 12 13 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.8 5.2V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.5c0 .8.6 1.4 1.4 1.4h1.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {copied ? 'Copied' : label}
    </button>
  );
}

/* -------------------------------------------------------------------------
   Misc
   ------------------------------------------------------------------------- */

export function Dot() {
  return <span className="text-line-2">/</span>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10.5px] font-semibold tracking-[0.2em] text-faint uppercase">
      {children}
    </div>
  );
}

export function ExternalIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-3.5 ${className}`} aria-hidden="true">
      <path
        d="M6.5 3.5H3.6c-.6 0-1.1.5-1.1 1.1v7.8c0 .6.5 1.1 1.1 1.1h7.8c.6 0 1.1-.5 1.1-1.1V9.5M9 2.5h4.5V7M13.5 2.5 7.2 8.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
