import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import { errMsg } from '../api/client.js';
import AuthShell from '../components/AuthShell.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null); // { tone, text }

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  // The server sends a code for account problems so the message can be shown in the user's language.
  const explain = (err) => {
    const code = err.response?.data?.code;
    const message = errMsg(err);
    if (code === 'ACCOUNT_PENDING') {
      return { tone: 'info', text: t('Your account is waiting for approval by the System Admin. You will be able to sign in once it is approved.') };
    }
    if (code === 'ACCOUNT_REJECTED') {
      const reason = message.split('Reason: ')[1];
      return { tone: 'bad', text: t('Your registration was not approved.') + (reason ? ` ${t('Reason')}: ${reason}` : '') };
    }
    if (code === 'ACCOUNT_DISABLED') {
      return { tone: 'bad', text: t('This account has been deactivated. Contact the system administrator.') };
    }
    return { tone: 'bad', text: message };
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await login(email, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setProblem(explain(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('Sign in')} subtitle={t('Work Plan & Performance Reporting System')}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">{t('Email')}</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">{t('Password')}</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        {problem && <div className={`alert alert-${problem.tone}`} role="alert">{problem.text}</div>}
        <button className="btn btn-primary" disabled={busy}>
          <LogIn size={17} /> {busy ? t('Signing in…') : t('Sign in')}
        </button>
        <p className="center muted small">
          {t('New here?')} <Link to="/register">{t('Request an account')}</Link>
        </p>
      </form>
    </AuthShell>
  );
}
