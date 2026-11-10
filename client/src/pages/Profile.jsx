import { useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import api, { TOKEN_KEY, errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { deptName } from '../utils/format.js';
import { PageHead, RolesBadges } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, jobTitle: user.jobTitle || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.patch('/auth/me', form);
      setUser(r.data.user);
      toast.success(t('Profile updated'));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) {
      toast.error(t('The two passwords do not match'));
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      localStorage.setItem(TOKEN_KEY, r.data.token);
      setUser(r.data.user);
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success(t('Password changed'));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHead title={t('My profile')} subtitle={user.email} />
      {user.mustChangePassword && (
        <div className="alert alert-warn" role="alert">
          {t('For your security, choose a new password before you continue.')}
        </div>
      )}
      <div className="grid cols-2">
        <form className="glass card stack" onSubmit={saveProfile}>
          <h2>{t('Personal details')}</h2>
          <div className="field">
            <label>{t('Full name')}</label>
            <input className="input" required minLength={3} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('Job title')}</label>
            <input className="input" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </div>
          <div className="row wrap">
            <RolesBadges user={user} />
            {user.department && <span className="badge badge-neutral">{deptName(user.department, lang)}</span>}
          </div>
          <p className="muted small">{t('Your role and department are managed by the System Admin.')}</p>
          <div className="field">
            <label>{t('Language')}</label>
            <select className="select" value={lang} onChange={(e) => { setLang(e.target.value); api.patch('/auth/me', { preferredLanguage: e.target.value }).catch(() => {}); }}>
              <option value="en">English</option>
              <option value="am">አማርኛ</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy}><Save size={16} /> {t('Save changes')}</button>
        </form>

        <form className="glass card stack" onSubmit={changePassword}>
          <h2>{t('Change password')}</h2>
          <div className="field">
            <label>{t('Current password')}</label>
            <input className="input" type="password" required autoComplete="current-password" value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('New password')}</label>
            <input className="input" type="password" required minLength={10} autoComplete="new-password" value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <span className="hint">{t('At least 10 characters, with letters and numbers')}</span>
          </div>
          <div className="field">
            <label>{t('Confirm new password')}</label>
            <input className="input" type="password" required autoComplete="new-password" value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy}><KeyRound size={16} /> {t('Change password')}</button>
        </form>
      </div>
    </div>
  );
}
