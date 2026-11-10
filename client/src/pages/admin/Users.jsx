import { useState } from 'react';
import { KeyRound, Pencil, Plus, Search } from 'lucide-react';
import api, { errMsg } from '../../api/client.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch, useDebounced } from '../../hooks/useFetch.js';
import { deptName, fmtDate, posName } from '../../utils/format.js';
import { ROLE_LABEL, ROLE_LIST } from '../../utils/roles.js';
import { Badge, ErrorBox, Modal, PageHead, PageLoader, Pagination, RolesBadges } from '../../components/ui.jsx';
import RecipientPicker from '../../components/RecipientPicker.jsx';

const EMPTY = { fullName: '', email: '', password: '', employeeId: '', roles: ['employee'], departmentId: '', positionId: '', manager: [], jobTitle: '', isActive: true };

export default function Users() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [resetting, setResetting] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);

  const depts = useFetch(() => api.get('/departments').then((r) => r.data.items), []);
  const positions = useFetch(() => api.get('/positions').then((r) => r.data.items), []);
  const { data, loading, error, reload } = useFetch(
    () => api.get('/users', { params: { q: dq || undefined, role: role || undefined, page } }).then((r) => r.data),
    [dq, role, page]
  );

  const openNew = () => { setForm(EMPTY); setEditing('new'); };
  const openEdit = (u) => {
    setForm({
      fullName: u.fullName, email: u.email, password: '', employeeId: u.employeeId || '', roles: u.roles,
      departmentId: u.department?._id || '', positionId: u.position?._id || '', manager: u.manager ? [u.manager] : [], jobTitle: u.jobTitle || '', isActive: u.isActive,
    });
    setEditing(u);
  };
  const toggleRole = (r) =>
    setForm((f) => {
      const roles = f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r];
      return { ...f, roles };
    });

  const save = async () => {
    setBusy(true);
    try {
      const common = {
        fullName: form.fullName, employeeId: form.employeeId, roles: form.roles, departmentId: form.departmentId, positionId: form.positionId,
        managerId: form.manager[0]?._id || null, jobTitle: form.jobTitle,
      };
      if (editing === 'new') {
        await api.post('/users', { ...common, email: form.email, password: form.password });
        toast.success(t('User created. They must change the password at first sign-in.'));
      } else {
        await api.patch(`/users/${editing._id}`, { ...common, isActive: form.isActive });
        toast.success(t('User updated'));
      }
      setEditing(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${resetting._id}/reset-password`, { newPassword: newPw });
      toast.success(t('Password reset. The user must choose a new one at next sign-in.'));
      setResetting(null);
      setNewPw('');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page">
      <PageHead title={t('Users')} subtitle={t('Create accounts, assign roles, departments and managers, deactivate leavers.')}
        actions={<button className="btn btn-primary" onClick={openNew}><Plus size={16} /> {t('New user')}</button>} />
      <div className="row wrap">
        <div style={{ position: 'relative', minWidth: 240 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
          <input className="input" style={{ paddingLeft: 36 }} placeholder={t('Search by name, email or employee ID')} value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">{t('All roles')}</option>
          {ROLE_LIST.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card" style={{ padding: 8 }}>
        {loading && !data ? <PageLoader /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('Name')}</th><th>{t('Roles')}</th><th>{t('Position')}</th><th>{t('Department')}</th><th>{t('Manager')}</th><th>{t('Last sign-in')}</th><th>{t('Status')}</th><th /></tr>
              </thead>
              <tbody>
                {(data?.items || []).map((u) => (
                  <tr key={u._id}>
                    <td><strong>{u.fullName}</strong><div className="muted small">{u.email}{u.employeeId ? ` · ${u.employeeId}` : ''}</div></td>
                    <td><RolesBadges user={u} /></td>
                    <td>{posName(u.position, lang) || '–'}</td>
                    <td>{deptName(u.department, lang) || '–'}</td>
                    <td>{u.manager?.fullName || <span className="muted">{t('From the chart')}</span>}</td>
                    <td className="muted nowrap">{u.lastLoginAt ? fmtDate(u.lastLoginAt, lang) : '–'}</td>
                    <td>{u.isActive ? <Badge tone="good">{t('Active')}</Badge> : <Badge tone="bad">{t('Deactivated')}</Badge>}</td>
                    <td className="right nowrap">
                      <button className="icon-btn" onClick={() => openEdit(u)} aria-label={t('Edit')}><Pencil size={17} /></button>
                      <button className="icon-btn" onClick={() => { setResetting(u); setNewPw(''); }} aria-label={t('Reset password')}><KeyRound size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
      </section>

      {editing && (
        <Modal title={editing === 'new' ? t('New user') : t('Edit user')} onClose={() => setEditing(null)} wide
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{t('Save')}</button>
          </>}>
          <div className="form-grid">
            <div className="field"><label>{t('Full name')}</label><input className="input" value={form.fullName} onChange={set('fullName')} /></div>
            <div className="field"><label>{t('Employee ID')}</label><input className="input" value={form.employeeId} onChange={set('employeeId')} /></div>
            <div className="field full"><label>{t('Email')}</label><input className="input" type="email" value={form.email} onChange={set('email')} disabled={editing !== 'new'} /></div>
            {editing === 'new' && (
              <div className="field full">
                <label>{t('Temporary password')}</label>
                <input className="input" type="text" value={form.password} onChange={set('password')} />
                <span className="hint">{t('At least 10 characters, with letters and numbers')}</span>
              </div>
            )}
            <div className="field full">
              <label>{t('Roles')}</label>
              <div className="check-grid">
                {ROLE_LIST.map((r) => (
                  <label key={r}><input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} /> {t(ROLE_LABEL[r])}</label>
                ))}
              </div>
            </div>
            <div className="field"><label>{t('Department')}</label>
              <select className="select" value={form.departmentId} onChange={set('departmentId')}>
                <option value="">{t('No department')}</option>
                {(depts.data || []).map((d) => <option key={d._id} value={d._id}>{deptName(d, lang)}</option>)}
              </select>
            </div>
            <div className="field full"><label>{t('Position in the organization chart')}</label>
              <select className="select" value={form.positionId} onChange={set('positionId')}>
                <option value="">{t('No position')}</option>
                {(positions.data || []).map((p) => <option key={p._id} value={p._id}>{posName(p, lang)}</option>)}
              </select>
              <span className="hint">{t('The superior is taken from the chart: the person who holds the position above.')}</span>
            </div>
            <div className="field full"><label>{t('Job title')}</label><input className="input" value={form.jobTitle} onChange={set('jobTitle')} /></div>
            <div className="full">
              <RecipientPicker label={t('Direct manager (optional)')} value={form.manager} onChange={(v) => setForm((f) => ({ ...f, manager: v }))} max={1}
                excludeIds={editing === 'new' ? [] : [editing._id]}
                hint={t('Only needed when the chart cannot decide (for example several people hold the position above). It overrides the chart.')} />
            </div>
            {editing !== 'new' && (
              <label className="row full" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                {t('Account is active')}
              </label>
            )}
          </div>
        </Modal>
      )}

      {resetting && (
        <Modal title={t('Reset password')} onClose={() => setResetting(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setResetting(null)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={doReset} disabled={busy || newPw.length < 10}>{t('Reset password')}</button>
          </>}>
          <p style={{ marginBottom: 12 }}>{resetting.fullName}</p>
          <div className="field">
            <label>{t('Temporary password')}</label>
            <input className="input" type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <span className="hint">{t('At least 10 characters, with letters and numbers')}</span>
          </div>
        </Modal>
      )}
    </div>
  );
}
