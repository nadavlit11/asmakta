import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { api, type EvalRun, type ResultDetail, type CategoryTally } from '../api';

const TARGET = 0.9; // mirrors EVAL_TARGET_PASS_RATE; the API also enforces it in the gate.

export function EvalReportPage() {
  const { t } = useI18n();
  const [latest, setLatest] = useState<EvalRun | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [results, setResults] = useState<ResultDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ run }, { runs: history }] = await Promise.all([api.latestEval(), api.evalRuns()]);
        if (!alive) return;
        setLatest(run);
        setRuns(history);
        if (run) {
          const detail = await api.evalRun(run.id);
          if (alive) setResults(detail.results.filter((r) => r.verdict === 'fail'));
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <p className="muted">{t('common.loading')}</p>;
  if (error) return <p className="error-box">{t('common.error')}: {error}</p>;

  if (!latest) {
    return (
      <section className="page evals">
        <h2>{t('evals.title')}</h2>
        <p className="muted">{t('evals.noRun')}</p>
      </section>
    );
  }

  const rate = latest.passRate ?? 0;
  const pass = rate >= TARGET;
  const cats = Object.entries(latest.byCategory ?? {}).filter(([k]) => !k.startsWith('lang:'));
  const langs = Object.entries(latest.byCategory ?? {}).filter(([k]) => k.startsWith('lang:'));

  return (
    <section className="page evals">
      <h2>{t('evals.title')}</h2>
      <p className="muted">{t('evals.subtitle')}</p>

      <div className="hero">
        <div className={pass ? 'gauge pass' : 'gauge fail'}>
          <div className="gauge-num">{(rate * 100).toFixed(0)}%</div>
          <div className="gauge-sub">
            {t('evals.passRate')} · {t('evals.target')} {(TARGET * 100).toFixed(0)}%
          </div>
        </div>
        <div className="hero-meta">
          <div>{latest.passed}/{latest.total} {t('evals.overall')}</div>
          <div className="mono">{latest.answeringModel} → {latest.judgeModel}</div>
          <div className="mono">
            topK {latest.config.topK} · sim ≥ {latest.config.minSimilarity} · rerank {String(latest.config.rerank)}
          </div>
          <div className="mono">{t('evals.cost')} ${latest.costUsd.toFixed(4)}{latest.gitSha ? ` · ${latest.gitSha}` : ''}</div>
        </div>
      </div>

      <div className="bars-grid">
        <BarGroup title={t('evals.byCategory')} entries={cats} />
        <BarGroup title={t('evals.byLang')} entries={langs.map(([k, v]) => [k.replace('lang:', ''), v])} />
      </div>

      {runs.length > 1 && (
        <div className="history">
          <h3>{t('evals.history')}</h3>
          <div className="spark">
            {runs.slice().reverse().map((r) => {
              const h = Math.round((r.passRate ?? 0) * 100);
              return (
                <div key={r.id} className="spark-bar" title={`#${r.id}: ${h}%`}>
                  <div className={h >= TARGET * 100 ? 'spark-fill pass' : 'spark-fill fail'} style={{ height: `${h}%` }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="failures">
          <h3>{t('evals.failures')} ({results.length})</h3>
          {results.map((r) => (
            <div key={r.fixtureId} className="failure">
              <div className="failure-q">
                <span className={`badge ${r.category}`}>{r.category}/{r.lang}</span> {r.question}
              </div>
              <div className="failure-flags mono">
                ans:{flag(r.answerCorrect)} cite:{flag(r.citationValid)} refuse:{flag(r.refusalCorrect)}
              </div>
              {r.judgeRationale && <div className="failure-judge">{t('evals.judge')}: {r.judgeRationale}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function flag(ok: boolean): string {
  return ok ? '✓' : '✗';
}

function BarGroup({ title, entries }: { title: string; entries: [string, CategoryTally][] }) {
  return (
    <div className="bar-group">
      <h3>{title}</h3>
      {entries.map(([key, tally]) => {
        const pct = tally.total ? (tally.passed / tally.total) * 100 : 0;
        return (
          <div key={key} className="bar-row">
            <span className="bar-label">{key}</span>
            <div className="bar-track">
              <div className={pct >= 90 ? 'bar-fill pass' : 'bar-fill fail'} style={{ width: `${pct}%` }} />
            </div>
            <span className="bar-val mono">{tally.passed}/{tally.total}</span>
          </div>
        );
      })}
    </div>
  );
}
