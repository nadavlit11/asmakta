-- Asmakta initial schema. See docs/plan.md §2 for rationale.
-- Applied by src/db/migrate.ts. Safe to re-run (guarded by schema_migrations).

CREATE EXTENSION IF NOT EXISTS vector;

-- A corpus is a named collection with an ACTIVE version pointer, enabling
-- re-ingestion/versioning + instant rollback.
CREATE TABLE corpora (
    id             bigserial PRIMARY KEY,
    slug           text NOT NULL UNIQUE,
    name           text NOT NULL,
    active_version int  NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id          bigserial PRIMARY KEY,
    corpus_id   bigint NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    version     int    NOT NULL,
    filename    text   NOT NULL,
    mime_type   text   NOT NULL,
    source_lang text   NOT NULL,               -- 'he' | 'en' | 'mixed'
    sha256      text   NOT NULL,
    status      text   NOT NULL DEFAULT 'pending', -- pending|parsing|chunking|embedding|indexed|failed
    error       text,
    page_count  int,
    char_count  int,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    indexed_at  timestamptz,
    UNIQUE (corpus_id, version, sha256)
);
CREATE INDEX documents_status_idx ON documents (status);
CREATE INDEX documents_corpus_version_idx ON documents (corpus_id, version);

CREATE TABLE chunks (
    id             bigserial PRIMARY KEY,
    document_id    bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    corpus_id      bigint NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    corpus_version int    NOT NULL,
    chunk_index    int    NOT NULL,
    content        text   NOT NULL,
    token_count    int    NOT NULL,
    page_start     int,
    page_end       int,
    heading        text,
    lang           text   NOT NULL,            -- 'he' | 'en'
    embedding      vector(1024) NOT NULL,      -- voyage-4-lite, 1024-dim
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- HNSW index for cosine distance on NORMALIZED embeddings. vector_cosine_ops
-- only accelerates the <=> operator (pairing is load-bearing).
CREATE INDEX chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX chunks_document_idx ON chunks (document_id);
CREATE INDEX chunks_corpus_version_idx ON chunks (corpus_id, corpus_version);

CREATE TABLE eval_fixtures (
    id                 bigserial PRIMARY KEY,
    corpus_id          bigint NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
    question           text   NOT NULL,
    lang               text   NOT NULL,        -- 'he' | 'en'
    category           text   NOT NULL,        -- 'answerable' | 'trap' | 'multi_hop'
    is_answerable      boolean NOT NULL,
    gold_answer        text,
    expected_doc_ids   bigint[],
    expected_chunk_ids bigint[],
    notes              text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eval_runs (
    id              bigserial PRIMARY KEY,
    corpus_id       bigint NOT NULL REFERENCES corpora(id),
    corpus_version  int    NOT NULL,
    git_sha         text,
    answering_model text   NOT NULL,
    judge_model     text   NOT NULL,
    embedding_model text   NOT NULL,
    config          jsonb  NOT NULL,           -- { topK, minSimilarity, rerank, rerankTopN }
    total           int    NOT NULL DEFAULT 0,
    passed          int    NOT NULL DEFAULT 0,
    failed          int    NOT NULL DEFAULT 0,
    pass_rate       numeric,
    by_category     jsonb,
    cost_usd        numeric NOT NULL DEFAULT 0,
    status          text   NOT NULL DEFAULT 'running', -- running|completed|failed
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX eval_runs_started_idx ON eval_runs (started_at DESC);

CREATE TABLE eval_results (
    id                  bigserial PRIMARY KEY,
    run_id              bigint NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    fixture_id          bigint NOT NULL REFERENCES eval_fixtures(id),
    refused             boolean NOT NULL,
    answer              text,
    citations           jsonb,                 -- [{ chunkId, quote? }]
    retrieved_chunk_ids bigint[],
    answer_correct      boolean NOT NULL,
    citation_valid      boolean NOT NULL,
    refusal_correct     boolean NOT NULL,
    verdict             text    NOT NULL,      -- 'pass' | 'fail'
    judge_rationale     text,
    latency_ms          int,
    cost_usd            numeric,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eval_results_run_idx ON eval_results (run_id);

-- Seed the demo corpus row.
INSERT INTO corpora (slug, name, active_version)
VALUES ('labor-rights', 'Israeli Labor & Employment Rights', 1)
ON CONFLICT (slug) DO NOTHING;
