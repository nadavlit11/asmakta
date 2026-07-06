/** Ingestion pipeline types. See docs/plan.md §3. */

export type Lang = 'he' | 'en' | 'mixed';
export type DocStatus = 'pending' | 'parsing' | 'chunking' | 'embedding' | 'indexed' | 'failed';

export const SUPPORTED_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  markdown: 'text/markdown',
} as const;

export interface RawDocument {
  corpusId: number;
  version: number;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  declaredLang?: Lang;
}

export interface ParsedPage {
  pageNumber: number;
  text: string;
}

export interface ParsedDocument {
  /** Full plain text (pages joined when present). */
  text: string;
  /** Present for PDFs — enables page-level citations. */
  pages?: ParsedPage[];
  detectedLang: Lang;
  charCount: number;
}

export interface ChunkStrategy {
  targetTokens: number; // default 350
  overlapTokens: number; // default 60
  splitOn: 'heading' | 'paragraph' | 'recursive'; // default 'recursive'
  respectSentences: boolean; // default true
}

export const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = {
  targetTokens: 350,
  overlapTokens: 60,
  splitOn: 'recursive',
  respectSentences: true,
};

export interface ChunkContext {
  documentId: number;
  corpusId: number;
  corpusVersion: number;
}

export interface Chunk {
  documentId: number;
  corpusId: number;
  corpusVersion: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
  lang: 'he' | 'en';
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[]; // length EMBEDDING_DIM (1024)
}

export type Parser = (doc: RawDocument) => Promise<ParsedDocument>;
