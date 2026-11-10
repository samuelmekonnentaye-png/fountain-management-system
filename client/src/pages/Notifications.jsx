import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { fmtDateTime } from '../utils/format.js';
import { notifLink, notifText } from '../utils/notifications.js';
import { EmptyState, ErrorBox, PageHead, PageLoader, Pagination } from '../components/ui.jsx';

export default function Notifications() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, loading, error, reload } = useFetch(
    () => api.get('/notifications', { params: { page, unread: unreadOnly ? 'true' : undefined } }).then((r) => r.data),
    [page, unreadOnly]
  );

  const open = async (n) => {
    if (!n.isRead) api.patch(`/notifications/${n._id}/read`).catch(() => {});
    navigate(notifLink(n));
  };
  const readAll = async () => {
    try {
      await api.post('/notifications/read-all');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <PageHead
        title={t('Notifications')}
        subtitle={t('Reports received, decisions on your reports, and deadlines.')}
        actions={<button className="btn btn-ghost" onClick={readAll} disabled={!data || data.unread === 0}><CheckCheck size={16} /> {t('Mark all as read')}</button>}
      />
      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} />
        {t('Unread only')}
      </label>
      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card">
        {loading && !data ? (
          <PageLoader />
        ) : data && data.items.length === 0 ? (
          <EmptyState icon={Bell} title={t('You are all caught up.')} />
        ) : (
          <div className="list">
            {(data?.items || []).map((n) => (
              <div key={n._id} className={`list-item click ${n.isRead ? '' : 'unread'}`} role="link" tabIndex={0}
                onClick={() => open(n)} onKeyDown={(e) => e.key === 'Enter' && open(n)}>
                <div className="grow">
                  <div>{notifText(n, t, lang)}</div>
                  {n.type === 'report_returned' && n.meta?.comment && <div className="muted small">“{n.meta.comment}”</div>}
                </div>
                <span className="muted small nowrap">{fmtDateTime(n.createdAt, lang)}</span>
              </div>
            ))}
          </div>
        )}
        {data && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
      </section>
    </div>
  );
}
