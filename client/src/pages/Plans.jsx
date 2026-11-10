import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Download, CalendarRange } from 'lucide-react';
import api, { download, errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { periodRange } from '../utils/format.js';
import { ROLES, hasRole } from '../utils/roles.js';
import { Badge, EmptyState, ErrorBox, PageHead, PageLoader, ScoreRing, StatusBadge } from '../components/ui.jsx';

const TYPE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' };

export default function Plans() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState(null);
  const { data, loading, error, reload } = useFetch(() => api.get('/plans', { params: { year } }).then((r) => r.data.items), [year]);
  const canManagePeriods = hasRole(user, ROLES.ADMIN, ROLES.GM);

  const create = async (periodId) => {
    setBusy(periodId);
    try {
      const r = await api.post('/plans', { periodId });
      navigate(`/plans/${r.data.plan._id}`);
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(null);
    }
  };

  const exportExcel = async () => {
    try {
      await download('/exports/my-plans', { year, lang }, `work-plans-${year}.xlsx`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const today = Date.now();
  return (
    <div className="page">
      <PageHead
        title={t('My work plans')}
        subtitle={t('Plan the period, track the tasks, then evaluate and report the result.')}
        actions={
          <>
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn" onClick={() => setYear(year - 1)} aria-label={t('Previous year')}><ChevronLeft size={20} /></button>
              <strong style={{ minWidth: 48, textAlign: 'center' }}>{year}</strong>
              <button className="icon-btn" onClick={() => setYear(year + 1)} aria-label={t('Next year')}><ChevronRight size={20} /></button>
            </div>
            <button className="btn btn-ghost" onClick={exportExcel}><Download size={16} /> Excel</button>
          </>
        }
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <PageLoader />
      ) : data && data.length === 0 ? (
        <section className="glass card">
          <EmptyState
            icon={CalendarRange}
            title={t('No reporting periods in {year}', { year })}
            text={t('A reporting period (for example a month) must exist before you can plan.')}
            action={canManagePeriods ? <Link className="btn btn-primary" to="/admin/periods">{t('Create a reporting period')}</Link> : <span className="muted">{t('Ask the administrator or the General Manager to create it.')}</span>}
          />
        </section>
      ) : (
        <div className="grid cols-3">
          {(data || []).map(({ period, plan }) => {
            const isCurrent = period.status === 'open' && new Date(period.startDate) <= today && new Date(period.endDate) >= today;
            return plan ? (
              <div key={period._id} className={`glass month-card has-plan ${isCurrent ? 'current' : ''}`}
                onClick={() => navigate(`/plans/${plan._id}`)} role="link" tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/plans/${plan._id}`)}>
                <div className="row between">
                  <div>
                    <h3>{period.name}</h3>
                    <span className="muted small">{periodRange(period, lang)}</span>
                  </div>
                  <ScoreRing value={plan.evaluated ? plan.scoreWeighted : null} size={54} stroke={6} />
                </div>
                <p className="muted small">{plan.title}</p>
                <p className="small">{t('{done} of {total} tasks completed', { done: plan.completedCount, total: plan.taskCount })}</p>
                <div className="row wrap" style={{ gap: 6 }}>
                  <StatusBadge status={plan.planStatus} />
                  {plan.evalStatus !== 'not_started' && <StatusBadge status={plan.evalStatus} />}
                  {period.status === 'closed' && <Badge>{t('Closed')}</Badge>}
                </div>
              </div>
            ) : (
              <div key={period._id} className={`glass month-card ${isCurrent ? 'current' : ''}`}>
                <div>
                  <h3>{period.name}</h3>
                  <span className="muted small">{periodRange(period, lang)} · {t(TYPE_LABEL[period.type])}</span>
                </div>
                <p className="muted small grow">{period.status === 'open' ? t('No plan yet') : t('This period is closed')}</p>
                {period.status === 'open' && (
                  <button className="btn btn-ghost btn-sm" disabled={busy === period._id} onClick={() => create(period._id)}>
                    <CalendarPlus size={16} /> {t('Create plan')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
