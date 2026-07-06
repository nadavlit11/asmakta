import { useState } from 'react';
import { useI18n, type StringKey } from './i18n';
import { ChatPage } from './pages/Chat';
import { AdminPage } from './pages/Admin';
import { EvalReportPage } from './pages/EvalReport';

type Tab = 'chat' | 'admin' | 'evals';

const TABS: { id: Tab; key: StringKey }[] = [
  { id: 'chat', key: 'nav.chat' },
  { id: 'evals', key: 'nav.evals' },
  { id: 'admin', key: 'nav.admin' },
];

export function App() {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <span className="brand-name">{t('appName')}</span>
          <span className="brand-tag">{t('tagline')}</span>
        </div>
        <nav className="tabs">
          {TABS.map((x) => (
            <button key={x.id} className={tab === x.id ? 'tab active' : 'tab'} onClick={() => setTab(x.id)}>
              {t(x.key)}
            </button>
          ))}
          <button className="lang" onClick={() => setLang(lang === 'en' ? 'he' : 'en')}>
            {t('langToggle')}
          </button>
        </nav>
      </header>

      <main className="content">
        {tab === 'chat' && <ChatPage />}
        {tab === 'evals' && <EvalReportPage />}
        {tab === 'admin' && <AdminPage />}
      </main>
    </div>
  );
}
