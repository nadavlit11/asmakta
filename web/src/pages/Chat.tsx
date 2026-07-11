import { useState } from 'react';
import { useI18n } from '../i18n';
import { api, type ChatResponse } from '../api';

export function ChatPage() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ChatResponse | null>(null);
  const [openCite, setOpenCite] = useState<number | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setRes(null);
    setOpenCite(null);
    try {
      setRes(await api.chat(question));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page chat">
      <form
        className="ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input
          className="ask-input"
          value={q}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn primary" disabled={loading}>
          {t('chat.ask')}
        </button>
      </form>

      <div className="hints">
        <span className="hints-label">{t('chat.hintTitle')}:</span>
        {[t('chat.hintAnswerable'), t('chat.hintTrap')].map((h) => (
          <button
            key={h}
            className="chip ghost"
            onClick={() => {
              setQ(h);
              void ask(h);
            }}
          >
            {h}
          </button>
        ))}
      </div>

      {loading && <p className="muted">{t('chat.thinking')}</p>}
      {error && <p className="error-box">{t('common.error')}: {error}</p>}

      {res && (
        <div className="answer">
          {res.refused ? (
            <div className="refusal">
              <span className="refusal-tag">{t('chat.refused')}</span>
              <p>{res.answer}</p>
            </div>
          ) : (
            <>
              <p className="answer-text">{res.answer}</p>
              {res.citations.length > 0 && (
                <div className="cites">
                  <span className="cites-label">{t('chat.citations')}:</span>
                  {res.citations.map((c) => (
                    <button
                      key={c.chunkId}
                      className={openCite === c.chunkId ? 'chip cite active' : 'chip cite'}
                      onClick={() => setOpenCite(openCite === c.chunkId ? null : c.chunkId)}
                    >
                      #{c.chunkId}
                    </button>
                  ))}
                </div>
              )}
              {openCite !== null &&
                (() => {
                  const c = res.citations.find((x) => x.chunkId === openCite);
                  if (!c) return null;
                  return (
                    <div className="cite-card">
                      <div className="cite-card-head">
                        {c.filename}
                        {c.heading ? ` — ${c.heading}` : ''}
                        {c.pageStart ? ` · p.${c.pageStart}` : ''}
                      </div>
                      <p className="cite-quote">{c.quote}</p>
                    </div>
                  );
                })()}
            </>
          )}

          <details className="retrieved">
            <summary>{t('chat.retrieved')} ({res.retrieved.length})</summary>
            {res.retrieved.map((r) => (
              <div key={r.chunkId} className="retrieved-item">
                <span className="sim">{(r.similarity * 100).toFixed(0)}%</span>
                <span className="rfile">{r.filename}{r.heading ? ` — ${r.heading}` : ''}</span>
                <p>{r.content}…</p>
              </div>
            ))}
          </details>

          <p className="meta">
            {res.model} · ${res.costUsd.toFixed(5)} · {res.latencyMs} ms
          </p>
        </div>
      )}
    </section>
  );
}
