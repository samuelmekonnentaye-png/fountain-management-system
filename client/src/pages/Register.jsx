import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Clock, UserPlus } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { deptName, posName } from '../utils/format.js';
import { ROLES, ROLE_LABEL } from '../utils/roles.js';
import AuthShell from '../components/AuthShell.jsx';

const REQUESTABLE = [ROLES.EMPLOYEE, ROLES.DEPARTMENT_HEAD, ROLES.MANAGER, ROLES.DEPUTY_GM, ROLES.GM];

export default function Register() {
  const { user, register } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const depts = useFetch(() => api.get('/departments').then((r) => r.data.items), []);
  const positions = useFetch(() => api.get('/positions/public').then((r) => r.data.items), []);
  const [form, setForm] = useState({ fullName: '', email: '', jobTitle: '', departmentId: '', positionId: '', requestedRole: ROLES.EMPLOYEE, password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError(t('The two passwords do not match'));
      return;
    }
    setBusy(true);
    try {
      const result = await register({
        fullName: form.fullName, email: form.email, jobTitle: form.jobTitle,
        departmentId: form.departmentId || undefined, positionId: form.positionId || undefined, requestedRole: form.requestedRole, password: form.password,
      });
      if (result.pending) setSubmitted(true);
      else navigate('/', { replace: true });
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <AuthShell title={t('Registration received')}>
        <div className="stack center">
          <Clock size={46} style={{ color: 'var(--blue)', alignSelf: 'center' }} />
          <p>{t('Your account is waiting for approval by the System Admin. You will be able to sign in once it is approved.')}</p>
          <Link className="btn btn-primary" to="/login">{t('Back to sign in')}</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell wide title={t('Request an account')} subtitle={t('Your request goes to the System Admin. You can sign in after it is approved.')}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="fn">{t('Full name')}</label>
            <input id="fn" className="input" required minLength={3} value={form.fullName} onChange={set('fullName')} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="em">{t('Email')}</label>
            <input id="em" className="input" type="email" required value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label htmlFor="jt">{t('Job title')}</label>
            <input id="jt" className="input" value={form.jobTitle} onChange={set('jobTitle')} />
          </div>
          <div className="field">
            <label htmlFor="dp">{t('Department')}</label>
            <select id="dp" className="select" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('Select your department')}</option>
              {(depts.data || []).map((d) => (
                <option key={d._id} value={d._id}>{deptName(d, lang)}</option>
              ))}
            </select>
          </div>
          <div className="field full">
            <label htmlFor="ps">{t('Your position in the organization chart')}</label>
            <select id="ps" className="select" value={form.positionId} onChange={set('positionId')}>
              <option value="">{t('Select your position')}</option>
              {(positions.data || []).map((p) => <option key={p._id} value={p._id}>{posName(p, lang)}</option>)}
            </select>
            <span className="hint">{t('Your superior and your reporting line follow from your position.')}</span>
          </div>
          <div className="field">
            <label htmlFor="rl">{t('Your system role')}</label>
            <select id="rl" className="select" value={form.requestedRole} onChange={set('requestedRole')}>
              {REQUESTABLE.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
            </select>
            <span className="hint">{t('The System Admin checks this before approving.')}</span>
          </div>
          <div className="field">
            <label htmlFor="pw">{t('Password')}</label>
            <input id="pw" className="input" type="password" required minLength={10} autoComplete="new-password"
              value={form.password} onChange={set('password')} />
            <span className="hint">{t('At least 10 characters, with letters and numbers')}</span>
          </div>
          <div className="field">
            <label htmlFor="pw2">{t('Confirm password')}</label>
            <input id="pw2" className="input" type="password" required autoComplete="new-password"
              value={form.confirm} onChange={set('confirm')} />
          </div>
        </div>
        {error && <div className="error-text" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          <UserPlus size={17} /> {busy ? t('Sending…') : t('Send request')}
        </button>
        <p className="center muted small">
          {t('Already registered?')} <Link to="/login">{t('Sign in')}</Link>
        </p>
      </form>
    </AuthShell>
  );
}
