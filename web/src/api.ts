// Thin API client. VITE_API_BASE lets the built app point at a remote API;
// in dev, Vite proxies /api and /health to the Fastify backend.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? `POST ${path} -> ${res.status}`);
  return json;
}

// ---- types (mirror the API shapes) ----

export interface Citation {
  chunkId: number;
  documentId?: number;
  filename?: string;
  pageStart?: number;
  heading?: string;
  quote?: string;
}

export interface RetrievedItem {
  chunkId: number;
  similarity: number;
  filename: string;
  heading?: string;
  content: string;
}

export interface ChatResponse {
  refused: boolean;
  answer: string;
  citations: Citation[];
  retrieved: RetrievedItem[];
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  model: string;
}

export interface CorpusStatus {
  slug: string;
  name: string;
  activeVersion: number;
  documents: number;
  chunks: number;
  indexed: number;
  failed: { id: number; filename: string; error: string | null }[];
}

export interface DocumentItem {
  id: number;
  filename: string;
  sourceLang: string;
  status: string;
  error: string | null;
  chunkCount: number;
  indexedAt: string | null;
}

export interface CategoryTally {
  passed: number;
  total: number;
}

export interface EvalRun {
  id: number;
  gitSha: string | null;
  answeringModel: string;
  judgeModel: string;
  embeddingModel: string;
  config: { topK: number; minSimilarity: number; rerank: boolean };
  total: number;
  passed: number;
  failed: number;
  passRate: number | null;
  byCategory: Record<string, CategoryTally> | null;
  costUsd: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface ResultDetail {
  fixtureId: number;
  question: string;
  category: string;
  lang: string;
  refused: boolean;
  verdict: string;
  answerCorrect: boolean;
  citationValid: boolean;
  refusalCorrect: boolean;
  judgeRationale: string | null;
}

export const api = {
  chat: (question: string, rerank = false) => post<ChatResponse>('/api/chat', { question, rerank }),
  corpusStatus: (slug = 'labor-rights') => get<CorpusStatus>(`/api/corpus/${slug}/status`),
  documents: (slug = 'labor-rights') => get<DocumentItem[]>(`/api/documents?corpus=${slug}`),
  latestEval: () => get<{ run: EvalRun | null }>('/api/eval/latest'),
  evalRuns: () => get<{ runs: EvalRun[] }>('/api/eval/runs'),
  evalRun: (id: number) => get<{ run: EvalRun; results: ResultDetail[] }>(`/api/eval/runs/${id}`),
};
