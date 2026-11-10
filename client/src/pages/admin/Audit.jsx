import { useState } from 'react';
import api from '../../api/client.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { fmtDateTime } from '../../utils/format.js';
import { Badge, ErrorBox, PageHead, PageLoader, Pagination, RolesBadges } from '../../components/ui.jsx';

const GROUPS = ['', 'user', 'plan', 'report', 'department', 'period'];

export default function Audit() {
  const { t, lang } = useI18n();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, loading, error, reload } = useFetch(
    () => api.get('/audit', { params: { page, limit: 30, action: action || undefined } }).then((r) => r.data),
    [page, action]
  );

  return (
    <div className="page">
      <PageHead title={t('Audit trail')} subtitle={t('Who sent, reviewed, changed or forwarded what, and when.')} />
      <select className="select" style={{ width: 'auto', alignSelf: 'flex-start' }} value={action}
        onChange={(e) => { setAction(e.target.value); setPage(1); }}>
        {GROUPS.map((g) => <option key={g} value={g}>{g ? g : t('All actions')}</option>)}
      </select>
      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card" style={{ padding: 8 }}>
        {loading && !data ? <PageLoader /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('When')}</th><th>{t('Who')}</th><th>{t('Action')}</th><th>{t('Details')}</th></tr></thead>
              <tbody>
                {(data?.items || []).map((a) => (
                  <tr key={a._id}>
                    <td className="nowrap muted">{fmtDateTime(a.createdAt, lang)}</td>
                    <td>{a.actor?.fullName || '–'} {a.actor && <RolesBadges user={a.actor} />}</td>
                    <td><Badge tone="blue">{a.action}</Badge></td>
                    <td className="small muted" style={{ maxWidth: 380, wordBreak: 'break-word' }}>
                      {a.details ? JSON.stringify(a.details).slice(0, 220) : ''}
                    </td>
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
