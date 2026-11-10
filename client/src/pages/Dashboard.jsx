import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CalendarCheck, ChevronLeft, ChevronRight, ClipboardList, Inbox, Send, Plus, BellRing } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, COMPANY } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { fmtDate, fmtLocalDate, timeRange } from '../utils/format.js';
import { notifLink, notifText } from '../utils/notifications.js';
import { PageHead, PageLoader, ErrorBox, ScoreRing, StatusBadge, STATUS_COLORS } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const { data, loading, error, reload } = useFetch(() => api.get('/dashboard/me', { params: { year } }).then((r) => r.data), [year]);
  const notifs = useFetch(() => api.get('/notifications', { params: { limit: 5 } }).then((r) => r.data), []);
  const nextMeetings = useFetch(() => api.get('/meetings', { params: { scope: 'upcoming', limit: 3 } }).then((r) => r.data.items), []);

  const createCurrent = async (periodId) => {
    try {
      const r = await api.post('/plans', { periodId });
      navigate(`/plans/${r.data.plan._id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const yearSwitch = (
    <div className="row" style={{ gap: 6 }}>
      <button className="icon-btn" onClick={() => setYear(year - 1)} aria-label={t('Previous year')}><ChevronLeft size={20} /></button>
      <strong style={{ minWidth: 48, textAlign: 'center' }}>{year}</strong>
      <button className="icon-btn" onClick={() => setYear(year + 1)} aria-label={t('Next year')}><ChevronRight size={20} /></button>
    </div>
  );

  if (loading && !data) return <div className="page"><PageLoader /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const cp = data.currentPeriod;
  const chart = data.periods.map((p) => ({ name: p.name, weighted: p.scoreWeighted, count: p.scoreByCount }));
  const sentTotal = Object.values(data.reports.sent).reduce((s, n) => s + n, 0);
  const statusOrder = ['completed', 'in_progress', 'not_completed', 'pending', 'cancelled'];
  const statusLabel = { completed: 'Completed', in_progress: 'In progress', not_completed: 'Not completed', pending: 'Pending', cancelled: 'Cancelled' };

  return (
    <div className="page">
      <PageHead title={t('Welcome, {name}', { name: user.fullName.split(' ')[0] })} subtitle={COMPANY[lang]} actions={yearSwitch} />

      <div className="grid hero">
        <section className="glass card">
          <div className="hero-score">
            <ScoreRing value={data.averages.weighted} size={150} stroke={15} caption={t('weighted')} />
            <div className="stack-sm">
              <h2>{t('Your performance in {year}', { year })}</h2>
              {data.averages.evaluatedPeriods > 0 ? (
                <>
                  <p className="muted">{t('Average over {n} evaluated period(s).', { n: data.averages.evaluatedPeriods })}</p>
                  <div className="row wrap">
                    <span className="badge badge-blue">{t('By count {count}%', { count: data.averages.count })}</span>
                    <span className="badge badge-good">{t('Weighted {count}%', { count: data.averages.weighted })}</span>
                  </div>
                </>
              ) : (
                <p className="muted">{t('Your score appears here once you evaluate the tasks of a period.')}</p>
              )}
            </div>
          </div>
        </section>

        <section className="glass card stack-sm">
          <div className="row between">
            <h2>{cp ? cp.name : t('Current period')}</h2>
            {cp?.planId && <StatusBadge status={cp.evalStatus === 'not_started' ? cp.planStatus : cp.evalStatus} />}
          </div>
          {!cp ? (
            <p className="muted">{t('There is no open reporting period right now.')}</p>
          ) : cp.planId ? (
            <>
              <div className="segbar" aria-hidden>
                {statusOrder.map((s) => (
                  <span key={s} style={{ width: `${cp.total ? (cp.counts[s] / cp.total) * 100 : 0}%`, background: STATUS_COLORS[s] }} />
                ))}
              </div>
              <div className="legend">
                {statusOrder.filter((s) => cp.counts[s] > 0).map((s) => (
                  <span key={s}><i style={{ background: STATUS_COLORS[s] }} />{t(statusLabel[s])} {cp.counts[s]}</span>
                ))}
              </div>
              <p className="muted small">{t('{n} task(s) in this period\'s plan.', { n: cp.total })} · {t('Ends {date}', { date: fmtDate(cp.endDate, lang) })}</p>
              <Link className="btn btn-primary" to={`/plans/${cp.planId}`}><CalendarCheck size={17} /> {t('Open this period\'s plan')}</Link>
            </>
          ) : (
            <>
              <p className="muted">{t('You have not created a plan for this period yet.')} · {t('Ends {date}', { date: fmtDate(cp.endDate, lang) })}</p>
              <button className="btn btn-primary" onClick={() => createCurrent(cp.periodId)}><Plus size={17} /> {t('Create this period\'s plan')}</button>
            </>
          )}
        </section>
      </div>

      <div className="grid cols-4">
        <Link to="/plans" className="glass stat" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="stat-icon"><ClipboardList size={22} /></span>
          <div><strong>{data.planCount}</strong><span className="label-s">{t('Plans in {year}', { year })}</span></div>
        </Link>
        <Link to="/sent" className="glass stat" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="stat-icon"><Send size={22} /></span>
          <div><strong>{sentTotal}</strong><span className="label-s">{t('Reports sent')}</span></div>
        </Link>
        <Link to="/inbox?pending=1" className="glass stat" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="stat-icon"><Inbox size={22} /></span>
          <div><strong>{data.reports.pendingReview}</strong><span className="label-s">{t('Waiting for your decision')}</span></div>
        </Link>
        <Link to="/inbox" className="glass stat" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="stat-icon"><BellRing size={22} /></span>
          <div><strong>{data.reports.unreadReports}</strong><span className="label-s">{t('Unread reports')}</span></div>
        </Link>
      </div>

      <section className="glass card">
        <div style={{ marginBottom: 12 }}>
          <h2>{t('Performance by period')}</h2>
          <p className="muted small">{t('Only periods with evaluated tasks are shown.')}</p>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#587091', fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: '#587091', fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v) => (v === null || v === undefined ? '–' : `${v}%`)} cursor={{ fill: 'rgba(11,79,214,.06)' }} />
              <Legend />
              <Bar dataKey="weighted" name={t('Weighted score')} fill="#0b4fd6" radius={[8, 8, 0, 0]} maxBarSize={26} />
              <Bar dataKey="count" name={t('Score by count')} fill="#5bb4ff" radius={[8, 8, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="glass card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2>{t('Next meetings')}</h2>
          <Link to="/meetings" className="small">{t('All meetings')}</Link>
        </div>
        {!nextMeetings.data || nextMeetings.data.length === 0 ? (
          <p className="muted">{t('No meeting is planned.')}</p>
        ) : (
          <div className="list">
            {nextMeetings.data.map((m) => (
              <Link key={m._id} to={`/meetings/${m._id}`} className="list-item click" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="grow"><strong>{m.title}</strong><div className="muted small">{fmtLocalDate(m.startsAt, lang)} · {timeRange(m.startsAt, m.endsAt)}</div></div>
                {m.myStatus === 'invited' && <span className="badge badge-blue">{t('Waiting for your answer')}</span>}
                {m.joinOpen && m.hasLink && <span className="badge badge-good">{t('Join')}</span>}
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid cols-2">
        <section className="glass card">
          <h2 style={{ marginBottom: 8 }}>{t('Upcoming deadlines')}</h2>
          {data.upcoming.length === 0 ? (
            <p className="muted">{t('No task is due in the next 7 days.')}</p>
          ) : (
            <div className="list">
              {data.upcoming.map((u) => (
                <Link key={u.taskId} to={`/plans/${u.planId}`} className="list-item click" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="grow"><strong>{u.title}</strong></div>
                  <span className="badge badge-warn">{fmtDate(u.dueDate, lang)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="glass card">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2>{t('Recent notifications')}</h2>
            <Link to="/notifications" className="small">{t('View all')}</Link>
          </div>
          {!notifs.data || notifs.data.items.length === 0 ? (
            <p className="muted">{t('You are all caught up.')}</p>
          ) : (
            <div className="list">
              {notifs.data.items.map((n) => (
                <Link key={n._id} to={notifLink(n)} className={`list-item click ${n.isRead ? '' : 'unread'}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="grow small">{notifText(n, t, lang)}</div>
                  <span className="muted small nowrap">{fmtDate(n.createdAt, lang)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
