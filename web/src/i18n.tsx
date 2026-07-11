import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'he';

const STRINGS = {
  en: {
    appName: 'Asmakta',
    tagline: 'Cited answers, or none.',
    'nav.chat': 'Ask',
    'nav.admin': 'Corpus',
    'nav.evals': 'Evals',
    langToggle: 'עברית',
    'chat.placeholder': 'Ask about Israeli labor rights…',
    'chat.ask': 'Ask',
    'chat.thinking': 'Retrieving and answering…',
    'chat.refused': 'Not in the corpus',
    'chat.sources': 'Sources',
    'chat.citations': 'Citations',
    'chat.retrieved': 'Retrieved chunks',
    'chat.meta': 'model · cost · latency',
    'chat.hintTitle': 'Try',
    'chat.hintAnswerable': 'How many vacation days am I entitled to?',
    'chat.hintTrap': 'What is the minimum wage in France?',
    'admin.title': 'Corpus status',
    'admin.documents': 'Documents',
    'admin.chunks': 'Chunks',
    'admin.indexed': 'Indexed',
    'admin.failedQueue': 'Failed-parse queue',
    'admin.none': 'None',
    'admin.colFile': 'File',
    'admin.colLang': 'Lang',
    'admin.colStatus': 'Status',
    'admin.colChunks': 'Chunks',
    'evals.title': 'Eval report',
    'evals.subtitle': 'Every answer graded for correctness, citation validity, and refusal.',
    'evals.passRate': 'Pass rate',
    'evals.target': 'target',
    'evals.overall': 'Overall',
    'evals.byCategory': 'By category',
    'evals.byLang': 'By language',
    'evals.history': 'History',
    'evals.failures': 'Failing fixtures',
    'evals.judge': 'judge',
    'evals.config': 'Configuration',
    'evals.noRun': 'No completed eval run yet. Run `npm run eval` (needs API keys).',
    'evals.cost': 'cost',
    'common.loading': 'Loading…',
    'common.error': 'Error',
  },
  he: {
    appName: 'אסמכתא',
    tagline: 'תשובות עם אסמכתא, או שאין תשובה.',
    'nav.chat': 'שאלה',
    'nav.admin': 'מאגר',
    'nav.evals': 'הערכות',
    langToggle: 'English',
    'chat.placeholder': 'שאלו על זכויות עובדים בישראל…',
    'chat.ask': 'שאלו',
    'chat.thinking': 'מאחזר ומשיב…',
    'chat.refused': 'לא נמצא במאגר',
    'chat.sources': 'מקורות',
    'chat.citations': 'אסמכתאות',
    'chat.retrieved': 'קטעים שאוחזרו',
    'chat.meta': 'מודל · עלות · זמן',
    'chat.hintTitle': 'נסו',
    'chat.hintAnswerable': 'כמה ימי חופשה מגיעים לי?',
    'chat.hintTrap': 'מה שכר המינימום בצרפת?',
    'admin.title': 'מצב המאגר',
    'admin.documents': 'מסמכים',
    'admin.chunks': 'קטעים',
    'admin.indexed': 'באינדקס',
    'admin.failedQueue': 'תור כשלי פענוח',
    'admin.none': 'אין',
    'admin.colFile': 'קובץ',
    'admin.colLang': 'שפה',
    'admin.colStatus': 'סטטוס',
    'admin.colChunks': 'קטעים',
    'evals.title': 'דוח הערכות',
    'evals.subtitle': 'כל תשובה נבדקת: נכונות, תקינות אסמכתא, וסירוב נכון.',
    'evals.passRate': 'שיעור הצלחה',
    'evals.target': 'יעד',
    'evals.overall': 'כולל',
    'evals.byCategory': 'לפי קטגוריה',
    'evals.byLang': 'לפי שפה',
    'evals.history': 'היסטוריה',
    'evals.failures': 'מקרים שנכשלו',
    'evals.judge': 'שופט',
    'evals.config': 'תצורה',
    'evals.noRun': 'עדיין אין ריצת הערכה שהושלמה. הריצו `npm run eval` (דורש מפתחות API).',
    'evals.cost': 'עלות',
    'common.loading': 'טוען…',
    'common.error': 'שגיאה',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['en'];

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  t: (key: StringKey) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const dir: 'ltr' | 'rtl' = lang === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const value = useMemo<I18n>(
    () => ({ lang, dir, setLang, t: (key) => STRINGS[lang][key] }),
    [lang, dir],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
