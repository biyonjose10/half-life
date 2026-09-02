import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * There is a stray package.json further up the tree (the home directory), so
   * Turbopack infers the wrong workspace root and warns. Pin it here.
   */
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },

  /**
   * The engine reads its two corpora from disk at request time. Next's file
   * tracing only follows static imports, so without this the corpus is absent
   * from the deployed bundle and the run fails with ENOENT in production while
   * working perfectly on localhost.
   */
  outputFileTracingIncludes: {
    '/api/run': ['./corpus/**/*'],
  },
};

export default nextConfig;
