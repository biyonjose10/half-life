/**
 * Minimal Gemini client - embeddings and JSON-constrained generation.
 *
 * Deliberately hand-rolled rather than pulling in an SDK: the pipeline needs
 * exactly two calls, and a thin client keeps the failure modes visible. Every
 * error throws with the HTTP status and body, because a demo that hangs reads
 * as broken while one that fails loudly reads as honest.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const EMBED_MODEL = 'gemini-embedding-001';
export const CHAT_MODEL = 'gemini-2.5-flash';

/** Kept small so the cached index stays a few MB rather than tens. */
export const EMBED_DIM = 768;

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set - copy it into .env.local');
  return key;
}

async function post<T>(url: string, body: unknown, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 4) {
      // Exponential backoff. Free-tier rate limits are the most likely thing
      // to bite during a live demo, so this retries rather than dying.
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      return post<T>(url, body, attempt + 1);
    }
  }
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// embeddings
// ---------------------------------------------------------------------------

type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

interface BatchEmbedResponse {
  embeddings: { values: number[] }[];
}

/**
 * Embeds texts in batches. Returns unit-length vectors so similarity is a
 * plain dot product downstream.
 */
export async function embedTexts(
  texts: string[],
  taskType: EmbedTask = 'RETRIEVAL_DOCUMENT',
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  const BATCH = 50;

  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const body = {
      requests: slice.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: text.slice(0, 8000) }] },
        taskType,
        outputDimensionality: EMBED_DIM,
      })),
    };
    const json = await post<BatchEmbedResponse>(
      `${BASE}/${EMBED_MODEL}:batchEmbedContents?key=${apiKey()}`,
      body,
    );
    for (const e of json.embeddings) out.push(normalise(e.values));
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length);
  }
  return out;
}

/**
 * gemini-embedding-001 does not return unit vectors when outputDimensionality
 * is reduced, so normalise explicitly - otherwise cosine scores drift.
 */
export function normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const mag = Math.sqrt(sum) || 1;
  return v.map((x) => x / mag);
}

// ---------------------------------------------------------------------------
// JSON-constrained generation
// ---------------------------------------------------------------------------

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Calls the model with a response schema so the reply parses or throws.
 * `schema` is an OpenAPI-subset object as accepted by responseSchema.
 */
export async function generateJSON<T>(
  prompt: string,
  schema: Record<string, unknown>,
  opts: { temperature?: number; system?: string } = {},
): Promise<T> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  const json = await post<GenerateResponse>(
    `${BASE}/${CHAT_MODEL}:generateContent?key=${apiKey()}`,
    body,
  );
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 300)}`);
  }
}
