import { useState } from 'react';
import { Check, X } from 'lucide-react';
import api, { errMsg } from '../../api/client.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { deptName, fmtDateTime, posName } from '../../utils/format.js';
import { ROLE_LABEL, ROLE_LIST } from '../../utils/roles.js';
import { Badge, EmptyState, ErrorBox, Modal, PageHead, PageLoader } from '../../components/ui.jsx';
import RecipientPicker from '../../components/RecipientPicker.jsx';

export default function Registrations() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const { data, loading, error, reload } = useFetch(
    () => api.get('/users/registrations', { params: { status: tab } }).then((r) => r.data.items),
    [tab]
  );
  const depts = useFetch(() => api.get('/departments').then((r) => r.data.items), []);
  const positions = useFetch(() => api.get('/positions').then((r) => r.data.items), []);

  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [form, setForm] = useState({ roles: [], departmentId: '', positionId: '', jobTitle: '', employeeId: '', manager: [] });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const openApprove = (u) => {
    setForm({
      roles: u.requestedRoles?.length ? u.requestedRoles : ['employee'],
      departmentId: u.department?._id || '',
      positionId: u.position?._id || '',
      jobTitle: u.jobTitle || '',
      employeeId: '',
      manager: [],
    });
    setApproving(u);
  };
  const toggleRole = (r) =>
    setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));

  const approve = async () => {
    if (form.roles.length === 0) {
      toast.error(t('Choose at least one role'));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/users/${approving._id}/approve`, {
        roles: form.roles, departmentId: form.departmentId, positionId: form.positionId, jobTitle: form.jobTitle,
        employeeId: form.employeeId, managerId: form.manager[0]?._id || null,
      });
      toast.success(t('Account approved. The person can sign in now.'));
      setApproving(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${rejecting._id}/reject`, { reason });
      toast.success(t('Request rejected'));
      setRejecting(null);
      setReason('');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const roleBadges = (roles) => (roles || []).map((r) => <Badge key={r} tone="blue">{t(ROLE_LABEL[r] || r)}</Badge>);

  return (
    <div className="page">
      <PageHead title={t('Registration requests')} subtitle={t('People who asked for an account wait here until you approve them.')} />
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'pending'} className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>{t('Waiting')}</button>
        <button role="tab" aria-selected={tab === 'rejected'} className={`tab ${tab === 'rejected' ? 'active' : ''}`} onClick={() => setTab('rejected')}>{t('Rejected')}</button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card" style={{ padding: 8 }}>
        {loading && !data ? <PageLoader /> : data && data.length === 0 ? (
          <EmptyState icon={Check} title={tab === 'pending' ? t('No registration is waiting') : t('No rejected requests')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Name')}</th><th>{t('Asked to be')}</th><th>{t('Position')}</th><th>{t('Department')}</th>
                  <th>{tab === 'pending' ? t('Requested') : t('Decision')}</th><th />
                </tr>
              </thead>
              <tbody>
                {(data || []).map((u) => (
                  <tr key={u._id}>
                    <td><strong>{u.fullName}</strong><div className="muted small">{u.email}</div></td>
                    <td><span className="row wrap" style={{ gap: 4 }}>{roleBadges(u.requestedRoles)}</span></td>
                    <td>{posName(u.position, lang) || u.jobTitle || '–'}</td>
                    <td>{deptName(u.department, lang) || '–'}</td>
                    <td className="muted small">
                      {tab === 'pending' ? fmtDateTime(u.createdAt, lang) : (
                        <>{fmtDateTime(u.decidedAt, lang)}{u.decidedBy ? ` · ${u.decidedBy.fullName}` : ''}{u.rejectionReason && <div>“{u.rejectionReason}”</div>}</>
                      )}
                    </td>
                    <td className="right nowrap">
                      <button className="btn btn-good btn-sm" onClick={() => openApprove(u)}><Check size={14} /> {t('Approve')}</button>
                      {tab === 'pending' && <> <button className="btn btn-danger btn-sm" onClick={() => { setRejecting(u); setReason(''); }}><X size={14} /> {t('Reject')}</button></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {approving && (
        <Modal title={t('Approve this account')} onClose={() => setApproving(null)} wide
          footer={<>
            <button className="btn btn-ghost" onClick={() => setApproving(null)}>{t('Cancel')}</button>
            <button className="btn btn-good" onClick={approve} disabled={busy}><Check size={16} /> {t('Approve')}</button>
          </>}>
          <div className="stack">
            <div className="alert alert-info">
              <div>
                <strong>{approving.fullName}</strong> · {approving.email}
                <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                  <span className="small">{t('Asked to be')}:</span> {roleBadges(approving.requestedRoles)}
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>{t('Check the request. You can change the roles, department and manager before approving.')}</div>
              </div>
            </div>
            <div className="field">
              <label>{t('Roles')}</label>
              <div className="check-grid">
                {ROLE_LIST.map((r) => (
                  <label key={r}><input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} /> {t(ROLE_LABEL[r])}</label>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <div className="field"><label>{t('Department')}</label>
                <select className="select" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">{t('No department')}</option>
                  {(depts.data || []).map((d) => <option key={d._id} value={d._id}>{deptName(d, lang)}</option>)}
                </select>
              </div>
              <div className="field full"><label>{t('Position in the organization chart')}</label>
                <select className="select" value={form.positionId} onChange={(e) => setForm((f) => ({ ...f, positionId: e.target.value }))}>
                  <option value="">{t('No position')}</option>
                  {(positions.data || []).map((p) => <option key={p._id} value={p._id}>{posName(p, lang)}</option>)}
                </select>
                <span className="hint">{t('The superior is taken from the chart: the person who holds the position above.')}</span>
              </div>
              <div className="field"><label>{t('Job title')}</label>
                <input className="input" value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} />
              </div>
              <div className="field"><label>{t('Employee ID')}</label>
                <input className="input" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
              </div>
            </div>
            <RecipientPicker label={t('Direct manager (optional)')} value={form.manager} onChange={(v) => setForm((f) => ({ ...f, manager: v }))} max={1}
              hint={t('Only needed when the chart cannot decide (for example several people hold the position above). It overrides the chart.')} />
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal title={t('Reject this request')} onClose={() => setRejecting(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setRejecting(null)}>{t('Cancel')}</button>
            <button className="btn btn-danger" onClick={reject} disabled={busy || reason.trim().length < 3}>{t('Reject')}</button>
          </>}>
          <p style={{ marginBottom: 10 }}><strong>{rejecting.fullName}</strong> · {rejecting.email}</p>
          <div className="field">
            <label>{t('Reason (the person will see it)')}</label>
            <textarea className="textarea" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
