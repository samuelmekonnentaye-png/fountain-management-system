import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, Check, Download, Forward, Printer, Undo2 } from 'lucide-react';
import api, { download, errMsg } from '../api/client.js';
import { useI18n, COMPANY } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { deptName, fmtDate, fmtDateTime, periodRange } from '../utils/format.js';
import { ROLE_LABEL, userRole } from '../utils/roles.js';
import { Badge, ErrorBox, PageHead, PageLoader, ScoreRing, StatusBadge } from '../components/ui.jsx';
import ComposeModal from '../components/ComposeModal.jsx';

export default function ReportView() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch(() => api.get(`/reports/${id}`).then((r) => r.data), [id]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  if (loading && !data) return <div className="page"><PageLoader /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const { report, canReview, canForward, myRole } = data;
  const s = report.snapshot;
  const toList = report.recipients.filter((r) => r.type === 'to');
  const ccList = report.recipients.filter((r) => r.type === 'cc');
  const hierarchical = report.workflow === 'hierarchical';
  const open = ['submitted', 'in_review'].includes(report.status);

  const decide = async (decision) => {
    if (decision !== 'approved' && comment.trim().length < 3) {
      toast.error(t('Write a short comment explaining the reason'));
      return;
    }
    setBusy(true);
    try {
      await api.post(`/reports/${id}/review`, { decision, comment });
      toast.success(decision === 'approved' ? t('Decision saved') : t('Decision saved'));
      setComment('');
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const forward = async (payload) => {
    await api.post(`/reports/${id}/forward`, { to: payload.to, cc: payload.cc, subject: payload.subject, message: payload.message });
    toast.success(t('Report forwarded'));
    setForwarding(false);
    await reload();
  };

  const exportExcel = async () => {
    try {
      await download(`/exports/report/${id}`, { lang }, 'report.xlsx');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const recLine = (list) =>
    list.map((r) => (
      <span key={r.user._id} style={{ marginRight: 12, display: 'inline-block' }}>
        {r.user.fullName}
        {r.readAt ? <span className="muted small"> ✓ {fmtDateTime(r.readAt, lang)}</span> : r.readAt === null ? <span className="muted small"> · {t('not read yet')}</span> : null}
      </span>
    ));

  // approval route: done / current / waiting / stopped
  const stepState = (i) => {
    if (report.status === 'approved') return 'done';
    if (i < report.approvalIndex) return 'done';
    if (i === report.approvalIndex) return open ? 'current' : 'stopped';
    return 'waiting';
  };

  return (
    <div className="page">
      <div className="print-only print-head">
        <h2>{COMPANY.en}</h2>
        <div>{COMPANY.am}</div>
      </div>
      <PageHead
        title={report.subject || (report.kind === 'plan' ? t('Work plan report') : t('Monthly evaluation report'))}
        subtitle={`${s.ownerName} · ${s.periodName}`}
        actions={
          <>
            <StatusBadge status={report.kind} />
            <StatusBadge status={report.status} />
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={15} /> {t('Print / Save as PDF')}</button>
            <button className="btn btn-ghost btn-sm" onClick={exportExcel}><Download size={15} /> Excel</button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>{t('Back')}</button>
          </>
        }
      />

      <section className="glass card">
        <div className="report-head">
          <ScoreRing value={s.scoreWeighted} size={130} stroke={13} caption={t('weighted')} />
          <dl className="kv grow">
            <dt>{t('Employee')}</dt><dd>{s.ownerName}{s.ownerJobTitle ? ` – ${s.ownerJobTitle}` : ''}</dd>
            <dt>{t('Department')}</dt><dd>{deptName({ name: s.departmentName, nameAm: s.departmentNameAm }, lang) || '–'}</dd>
            <dt>{t('Period')}</dt><dd>{s.periodName} <span className="muted small">({periodRange({ startDate: s.periodStart, endDate: s.periodEnd }, lang)})</span></dd>
            <dt>{t('Sent by')}</dt>
            <dd>{report.sender.fullName} <span className="muted small">({t(ROLE_LABEL[userRole(report.sender)] || '')}) · {fmtDateTime(report.createdAt, lang)}</span></dd>
            <dt>{t('Approval')}</dt><dd><StatusBadge status={report.workflow} /></dd>
            <dt>{t('Send To')}</dt><dd>{recLine(toList)}</dd>
            {ccList.length > 0 && (<><dt>CC</dt><dd>{recLine(ccList)}</dd></>)}
            <dt>{t('Score')}</dt>
            <dd>{t('Weighted {w}% · by count {c}% · {done} of {total} tasks completed', { w: s.scoreWeighted, c: s.scoreByCount, done: s.completedTasks, total: s.totalTasks })}</dd>
          </dl>
        </div>
        {report.message && <p style={{ marginTop: 16, whiteSpace: 'pre-wrap' }} className="glass card-tight">{report.message}</p>}
      </section>

      {hierarchical && report.approvalChain.length > 0 && (
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Approval route')}</h2>
          <div className="stepper">
            {report.approvalChain.map((u, i) => {
              const st = stepState(i);
              return (
                <div key={u._id} className={`step ${st}`}>
                  <span className="step-dot">{st === 'done' ? '✓' : st === 'stopped' ? '✕' : i + 1}</span>
                  <strong className="small">{u.fullName}</strong>
                  <small>{t(ROLE_LABEL[userRole(u)])}</small>
                  <small>{st === 'done' ? t('Approved') : st === 'current' ? t('Waiting for decision') : st === 'stopped' ? t(report.status === 'rejected' ? 'Rejected' : 'Returned') : t('Not reached yet')}</small>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {s.objectives && (
        <section className="glass card">
          <h2 style={{ marginBottom: 6 }}>{t('Objectives')}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.objectives}</p>
        </section>
      )}

      <section className="glass card">
        <h2 style={{ marginBottom: 10 }}>{t('Tasks')}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Task')}</th>
                <th>KPI</th>
                <th className="num">{t('Target')}</th>
                <th className="num">{t('Weight')}</th>
                <th>{t('Status')}</th>
                {report.kind === 'evaluation' && <th className="num">{t('Actual')}</th>}
                <th className="num">{t('Achieved')}</th>
                <th>{report.kind === 'plan' ? t('Due date') : t('Result')}</th>
              </tr>
            </thead>
            <tbody>
              {s.tasks.map((task, i) => (
                <tr key={i}>
                  <td><strong>{task.title}</strong>{task.description && <div className="muted small">{task.description}</div>}</td>
                  <td>{task.kpi}</td>
                  <td className="num nowrap">{task.target} {task.unit}</td>
                  <td className="num">{task.weight ? `${task.weight}%` : '–'}</td>
                  <td><StatusBadge status={task.status} /></td>
                  {report.kind === 'evaluation' && <td className="num nowrap">{task.status === 'pending' ? '–' : `${task.actual} ${task.unit}`}</td>}
                  <td className="num">{task.status === 'pending' ? '–' : `${task.achievement}%`}</td>
                  <td>
                    {report.kind === 'plan' ? fmtDate(task.dueDate, lang) : task.actualResult}
                    {task.shortfallReason && <div className="small" style={{ color: 'var(--bad)' }}>{t('Reason')}: {task.shortfallReason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass card">
        <h2 style={{ marginBottom: 12 }}>{t('Review history')}</h2>
        {report.reviews.length === 0 ? (
          <p className="muted">{t('Nobody has reviewed this report yet.')}</p>
        ) : (
          <div className="timeline">
            {report.reviews.map((rv) => (
              <div key={rv._id} className={`timeline-item ${rv.decision === 'approved' ? 'good' : ['returned', 'rejected'].includes(rv.decision) ? 'warn' : ''}`}>
                <span className="timeline-dot" />
                <div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <strong>{rv.reviewer?.fullName}</strong>
                    {rv.decision === 'forwarded' ? <Badge tone="blue">{t('Forwarded')}</Badge> : <StatusBadge status={rv.decision} />}
                    <span className="muted small">{fmtDateTime(rv.at, lang)}</span>
                  </div>
                  {rv.comment && <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{rv.comment}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(canReview || canForward) && (
        <section className="glass card stack no-print">
          <h2>{t('Your decision')}</h2>
          {canReview && (
            <>
              <div className="field">
                <label>{t('Comment')}</label>
                <textarea className="textarea" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)}
                  placeholder={t('Required when returning or rejecting the report')} />
              </div>
              <div className="row wrap">
                <button className="btn btn-good" disabled={busy} onClick={() => decide('approved')}>
                  <Check size={16} /> {hierarchical && report.approvalIndex + 1 < report.approvalChain.length ? t('Approve and pass on') : t('Approve')}
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => decide('returned')}><Undo2 size={16} /> {t('Return for correction')}</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => decide('rejected')}><Ban size={16} /> {t('Reject')}</button>
                {canForward && <button className="btn btn-ghost" onClick={() => setForwarding(true)}><Forward size={16} /> {hierarchical ? t('Add another approver') : t('Forward')}</button>}
              </div>
            </>
          )}
          {!canReview && canForward && (
            <div className="row wrap">
              <p className="muted grow">{t('This report already has a decision. You can still forward it to senior management.')}</p>
              <button className="btn btn-ghost" onClick={() => setForwarding(true)}><Forward size={16} /> {t('Forward')}</button>
            </div>
          )}
        </section>
      )}
      {myRole === 'cc' && (
        <div className="alert alert-info no-print"><Badge>CC</Badge> {t('You received this report as CC. Only the "Send To" recipients can approve or return it.')}</div>
      )}
      {myRole === 'sender' && ['returned', 'rejected'].includes(report.status) && (
        <div className="alert alert-warn no-print">
          {report.status === 'returned' ? t('This report was returned.') : t('This report was rejected.')} <Link to={`/plans/${report.plan}`}>{t('Open the plan')}</Link>
        </div>
      )}

      {forwarding && (
        <ComposeModal
          mode="forward"
          forwardWorkflow={hierarchical ? 'hierarchical' : 'direct'}
          title={hierarchical ? t('Add another approver') : t('Forward report')}
          initialSubject={`Fwd: ${report.subject || ''}`.trim()}
          summary={{ weighted: s.scoreWeighted, byCount: s.scoreByCount, completed: s.completedTasks, total: s.totalTasks }}
          submitLabel={hierarchical ? t('Add approver') : t('Forward')}
          onClose={() => setForwarding(false)}
          onSubmit={forward}
        />
      )}
    </div>
  );
}
