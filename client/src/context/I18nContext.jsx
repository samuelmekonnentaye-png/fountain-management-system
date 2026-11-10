import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import am1 from '../i18n/am.js';
import am2 from '../i18n/am2.js';

const am = { ...am1, ...am2 };

// English strings are the keys; Amharic is looked up from the dictionary (falls back to English).
const I18nContext = createContext(null);
const LANG_KEY = 'fit_lang';

export const COMPANY = {
  en: 'FOUNTAIN INTERNATIONAL TRADING PLC',
  am: 'ፋውንቴን ኢንተርናሽናል ትሬዲንግ ኃ/የተ/የግ/ማህበር',
};

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem(LANG_KEY) || 'am');

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);

  const t = useCallback(
    (key, vars) => {
      let s = lang === 'am' ? am[key] ?? key : key;
      if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
      return s;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
