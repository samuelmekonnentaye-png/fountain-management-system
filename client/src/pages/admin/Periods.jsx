import { useState } from 'react';
import { BellRing, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import api, { errMsg } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { periodRange } from '../../utils/format.js';
import { ROLES, hasRole } from '../../utils/roles.js';
import { Badge, ErrorBox, Modal, PageHead, PageLoader } from '../../components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TYPE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' };
const EMPTY = { name: '', type: 'monthly', startDate: '', endDate: '' };

export default function Periods() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api.get('/periods').then((r) => r.data.items), []);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isAdmin = hasRole(user, ROLES.ADMIN);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Convenience for monthly periods: pick a month and the name and dates are filled in.
  const pickMonth = (value) => {
    if (!value) return;
    const [y, m] = value.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    setForm((f) => ({ ...f, name: `${MONTHS[m - 1]} ${y}`, startDate: `${value}-01`, endDate: last }));
  };

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/periods', form);
      toast.success(t('Reporting period created'));
      setCreating(false);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (p, status) => {
    try {
      await api.patch(`/periods/${p._id}`, { status });
      toast.success(status === 'closed' ? t('Period closed') : t('Period reopened'));
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/periods/${removing._id}`);
      toast.success(t('Reporting period deleted'));
      setRemoving(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };
  const runReminders = async () => {
    try {
      const r = await api.post('/notifications/run-reminders');
      const c = r.data.counts;
      toast.success(t('Reminders created: {n}', { n: c.pendingReview + c.returned + c.periodEnding + c.overdue + c.deadlineNear }));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <PageHead
        title={t('Reporting periods')}
        subtitle={t('Employees plan and evaluate inside a reporting period: a week, a month, or any custom range (for example an Ethiopian month).')}
        actions={
          <>
            {isAdmin && <button className="btn btn-ghost" onClick={runReminders}><BellRing size={16} /> {t('Send reminders now')}</button>}
            <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setCreating(true); }}><Plus size={16} /> {t('New period')}</button>
          </>
        }
      />
      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card" style={{ padding: 8 }}>
        {loading && !data ? <PageLoader /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Name')}</th><th>{t('Type')}</th><th>{t('Dates')}</th><th>{t('Status')}</th><th /></tr></thead>
              <tbody>
                {(data || []).map((p) => (
                  <tr key={p._id}>
                    <td><strong>{p.name}</strong></td>
                    <td>{t(TYPE_LABEL[p.type])}</td>
                    <td className="nowrap">{periodRange(p, lang)}</td>
                    <td>{p.status === 'open' ? <Badge tone="good">{t('Open')}</Badge> : <Badge>{t('Closed')}</Badge>}</td>
                    <td className="right nowrap">
                      {p.status === 'open'
                        ? <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p, 'closed')}><Lock size={14} /> {t('Close')}</button>
                        : <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p, 'open')}><LockOpen size={14} /> {t('Reopen')}</button>}
                      <button className="icon-btn" aria-label={t('Delete')} onClick={() => setRemoving(p)}><Trash2 size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <Modal title={t('New period')} onClose={() => setCreating(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={create} disabled={busy || !form.name || !form.startDate || !form.endDate}>{t('Save')}</button>
          </>}>
          <div className="stack">
            <div className="field"><label>{t('Type')}</label>
              <select className="select" value={form.type} onChange={set('type')}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </div>
            {form.type === 'monthly' && (
              <div className="field"><label>{t('Pick a month')}</label>
                <input className="input" type="month" onChange={(e) => pickMonth(e.target.value)} />
                <span className="hint">{t('Fills in the name and the dates for you.')}</span>
              </div>
            )}
            <div className="field"><label>{t('Name')}</label><input className="input" value={form.name} onChange={set('name')} maxLength={100}
              placeholder={t('e.g. October 2026 or ጥቅምት 2019')} /></div>
            <div className="form-grid">
              <div className="field"><label>{t('Start date')}</label><input className="input" type="date" value={form.startDate} onChange={set('startDate')} /></div>
              <div className="field"><label>{t('End date')}</label><input className="input" type="date" value={form.endDate} onChange={set('endDate')} /></div>
            </div>
          </div>
        </Modal>
      )}
      {removing && (
        <Modal title={t('Delete this period?')} onClose={() => setRemoving(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setRemoving(null)}>{t('Cancel')}</button>
            <button className="btn btn-danger" onClick={remove} disabled={busy}>{t('Delete')}</button>
          </>}>
          <p>{removing.name}</p>
          <p className="muted small" style={{ marginTop: 8 }}>{t('A period that already has plans cannot be deleted; close it instead.')}</p>
        </Modal>
      )}
    </div>
  );
}
