'use client';

/**
 * The last graceful state.
 *
 * The whole product is a live streaming run, so a client-side throw mid-run
 * would otherwise drop the visitor on the framework's raw error page. Failing
 * visibly and plainly is the same principle the engine itself follows.
 */

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[half-life] unhandled error', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-lg">
        <p className="font-mono text-[11px] font-semibold tracking-[0.22em] text-breaking uppercase">
          The console stopped
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
          Something in the page threw.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-dim">
          The engine runs on the server and streams its results here, so this is a fault in the
          display rather than in the analysis. Running it again usually clears it.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11.5px] text-faint">digest {error.digest}</p>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-phos px-4 py-2.5 font-mono text-[12px] font-semibold tracking-[0.16em] text-void uppercase transition-colors hover:bg-phos/85"
          >
            Try again
          </button>
          {/* A plain anchor on purpose: this renders after the React tree has
              already crashed, and a full page load is the point of the escape
              hatch. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="rounded-md px-4 py-2.5 font-mono text-[12px] text-dim ring-1 ring-line-2 ring-inset transition-colors hover:bg-raised hover:text-ink"
          >
            Reload the console
          </a>
        </div>
      </div>
    </main>
  );
}
