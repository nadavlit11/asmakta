import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { api, type CorpusStatus, type DocumentItem } from '../api';

export function AdminPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<CorpusStatus | null>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, d] = await Promise.all([api.corpusStatus(), api.documents()]);
        if (!alive) return;
        setStatus(s);
        setDocs(d);
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
  if (!status) return null;

  return (
    <section className="page admin">
      <h2>{t('admin.title')} — {status.name}</h2>
      <div className="stat-row">
        <Stat label={t('admin.documents')} value={status.documents} />
        <Stat label={t('admin.chunks')} value={status.chunks} />
        <Stat label={t('admin.indexed')} value={status.indexed} />
        <Stat label="v" value={status.activeVersion} />
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>{t('admin.colFile')}</th>
            <th>{t('admin.colLang')}</th>
            <th>{t('admin.colStatus')}</th>
            <th>{t('admin.colChunks')}</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.filename}</td>
              <td>{d.sourceLang}</td>
              <td>
                <span className={`badge ${d.status}`}>{d.status}</span>
              </td>
              <td>{d.chunkCount}</td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                {t('admin.none')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>{t('admin.failedQueue')}</h3>
      {status.failed.length === 0 ? (
        <p className="muted">{t('admin.none')}</p>
      ) : (
        <ul className="failed-list">
          {status.failed.map((f) => (
            <li key={f.id}>
              <strong>{f.filename}</strong> — <span className="err">{f.error}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
