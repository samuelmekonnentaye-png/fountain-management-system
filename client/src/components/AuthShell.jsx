import { Languages } from 'lucide-react';
import { useI18n, COMPANY } from '../context/I18nContext.jsx';
import { LogoMark } from './Logo.jsx';

export default function AuthShell({ title, subtitle, wide, children }) {
  const { lang, setLang } = useI18n();
  return (
    <div className="auth-page">
      <span className="auth-orb o1" />
      <span className="auth-orb o2" />
      <span className="auth-orb o3" />
      <button className="btn btn-ghost btn-sm lang-float" onClick={() => setLang(lang === 'am' ? 'en' : 'am')}>
        <Languages size={16} /> {lang === 'am' ? 'English' : 'አማርኛ'}
      </button>
      <div className={`auth-card glass ${wide ? 'wide' : ''}`}>
        <div className="logo">
          <LogoMark />
          <div className="logo-text">
            <strong>FOUNTAIN</strong>
            <span>{lang === 'am' ? COMPANY.am : 'INTERNATIONAL TRADING PLC'}</span>
          </div>
        </div>
        <div className="auth-title">
          <h1 style={{ fontSize: '1.35rem' }}>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
