import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Inbox, Send } from 'lucide-react';
import api from '../api/client.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { deptName, fmtDate } from '../utils/format.js';
import { scoreColor } from '../utils/scores.js';
import { Badge, EmptyState, ErrorBox, PageHead, PageLoader, Pagination, StatusBadge } from '../components/ui.jsx';

export default function ReportsList({ box }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [unread, setUnread] = useState(false);
  const [pending, setPending] = useState(params.get('pending') === '1');
  const isInbox = box === 'inbox';

  const { data, loading, error, reload } = useFetch(
    () => api.get(`/reports/${box}`, {
      params: { page, kind, status, unread: isInbox && unread ? 'true' : undefined, pending: isInbox && pending ? 'true' : undefined },
    }).then((r) => r.data),
    [box, page, kind, status, unread, pending]
  );

  const names = (r) => {
    const to = r.recipients.filter((x) => x.type === 'to').map((x) => x.user?.fullName);
    return to.length > 1 ? `${to[0]} +${to.length - 1}` : to[0] || '';
  };
  const reset = (fn) => (e) => { fn(e); setPage(1); };

  return (
    <div className="page">
      <PageHead
        title={isInbox ? t('Inbox') : t('Sent reports')}
        subtitle={isInbox ? t('Reports sent to you (To) or copied to you (CC).') : t('Reports you sent, and what happened to them.')}
      />
      <div className="row wrap no-print">
        <select className="select" style={{ width: 'auto' }} value={kind} onChange={reset((e) => setKind(e.target.value))} aria-label={t('Report type')}>
          <option value="">{t('All report types')}</option>
          <option value="plan">{t('Work plan')}</option>
          <option value="evaluation">{t('Monthly evaluation')}</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={reset((e) => setStatus(e.target.value))} aria-label={t('Status')}>
          <option value="">{t('All statuses')}</option>
          <option value="submitted">{t('Submitted')}</option>
          <option value="in_review">{t('In review')}</option>
          <option value="approved">{t('Approved')}</option>
          <option value="returned">{t('Returned')}</option>
          <option value="rejected">{t('Rejected')}</option>
        </select>
        {isInbox && (
          <>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={pending} onChange={reset((e) => setPending(e.target.checked))} />
              {t('Waiting for my decision')}
            </label>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={unread} onChange={reset((e) => setUnread(e.target.checked))} />
              {t('Unread only')}
            </label>
          </>
        )}
      </div>

      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card" style={{ padding: 8 }}>
        {loading && !data ? (
          <PageLoader />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={isInbox ? Inbox : Send} title={isInbox ? t('Your inbox is empty') : t('You have not sent any report yet')}
            text={isInbox ? t('Reports sent to you will appear here.') : t('Open one of your plans and choose "Send report".')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{isInbox ? t('From') : t('To')}</th>
                  <th>{t('Employee')}</th>
                  <th>{t('Period')}</th>
                  <th>{t('Type')}</th>
                  <th className="num">{t('Score')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Date')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items || []).map((r) => (
                  <tr key={r._id} className={`click ${r.unread ? 'unread-row' : ''}`} onClick={() => navigate(`/reports/${r._id}`)}>
                    <td>
                      {r.unread && <span className="unread-dot" aria-label={t('Unread')} />}
                      {isInbox ? r.sender?.fullName : names(r)}
                      {isInbox && r.myRole === 'cc' && <> <Badge>CC</Badge></>}
                      {r.forwarded && <> <Badge tone="blue">{t('Forwarded')}</Badge></>}
                      {r.needsMyDecision && <> <Badge tone="warn">{t('Your decision')}</Badge></>}
                    </td>
                    <td>
                      {r.snapshot.ownerName}
                      <div className="muted small">{deptName({ name: r.snapshot.departmentName, nameAm: r.snapshot.departmentNameAm }, lang)}</div>
                    </td>
                    <td>{r.snapshot.periodName}</td>
                    <td><StatusBadge status={r.kind} /></td>
                    <td className="num"><strong style={{ color: scoreColor(r.snapshot.scoreWeighted) }}>{r.snapshot.scoreWeighted}%</strong></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="nowrap muted">{fmtDate(r.createdAt, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
      </section>
    </div>
  );
}
