import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, Building2, CalendarRange, CheckCircle2, ClipboardList, FileText, Gauge, RefreshCw, Timer, UserCheck, Users,
} from 'lucide-react';
import api from '../../api/client.js';
import { useI18n, COMPANY } from '../../context/I18nContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { deptName, fmtDateTime, monthShort } from '../../utils/format.js';
import { ROLE_LABEL, ROLE_LIST } from '../../utils/roles.js';
import { Badge, ErrorBox, PageHead, PageLoader, ScoreRing, StatusBadge } from '../../components/ui.jsx';

const REPORT_COLORS = { submitted: '#5bb4ff', in_review: '#0b4fd6', approved: '#0e9f6e', returned: '#d98a00', rejected: '#d64545' };
const REPORT_ORDER = ['submitted', 'in_review', 'approved', 'returned', 'rejected'];
const PHASE_ORDER = ['not_started', 'draft', 'submitted', 'approved', 'returned', 'rejected'];
const PHASE_LABEL = {
  not_started: 'Not started', draft: 'Draft', submitted: 'Submitted', approved: 'Approved', returned: 'Returned', rejected: 'Rejected',
};
const STATUS_LABEL = { submitted: 'Submitted', in_review: 'In review', approved: 'Approved', returned: 'Returned', rejected: 'Rejected' };
const AXIS = { fill: '#587091', fontSize: 12 };

function Kpi({ icon: Icon, value, label, sub, to, tone }) {
  const body = (
    <>
      <span className="stat-icon" style={tone ? { background: `${tone}22`, color: tone } : undefined}><Icon size={22} /></span>
      <div><strong>{value}</strong><span className="label-s">{label}</span>{sub && <div className="muted small">{sub}</div>}</div>
    </>
  );
  return to
    ? <Link to={to} className="glass stat" style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link>
    : <div className="glass stat">{body}</div>;
}

const uptime = (s, t) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? t('{d} d {h} h', { d, h }) : h > 0 ? t('{h} h {m} min', { h, m }) : t('{m} min', { m });
};

export default function AdminDashboard() {
  const { t, lang } = useI18n();
  const { data, loading, error, reload } = useFetch(() => api.get('/admin/overview').then((r) => r.data), []);

  // keep the numbers fresh while the page is open
  useEffect(() => {
    const h = setInterval(reload, 60000);
    return () => clearInterval(h);
  }, [reload]);

  if (loading && !data) return <div className="page"><PageLoader /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const { users, plans, reports, periods, activity, system } = data;
  const attention = [];
  if (users.pending > 0) attention.push({ to: '/admin/registrations', text: t('{n} registration request(s) are waiting for your approval', { n: users.pending }) });
  if (users.withoutManager > 0) attention.push({ to: '/admin/org', text: t('{n} active user(s) have no clear superior (no position in the chart, or several people hold the position above), so they cannot use the manager chain', { n: users.withoutManager }) });
  if (reports.stalledCount > 0) attention.push({ to: null, text: t('{n} report(s) have been waiting for a decision for more than 2 days', { n: reports.stalledCount }) });
  if (periods.open === 0) attention.push({ to: '/admin/periods', text: t('No reporting period is open, so employees cannot plan or send reports') });

  const roleData = ROLE_LIST.map((r) => ({ name: t(ROLE_LABEL[r]), n: users.byRole[r] || 0 }));
  const deptData = users.byDepartment.map((d) => ({ name: deptName(d, lang) || t('Unassigned'), n: d.n }));
  const monthData = reports.monthly.map((m) => ({ name: monthShort(lang, m.month), sent: m.sent, approved: m.approved }));
  const dayData = activity.daily.map((d) => ({ name: `${Number(d.date.slice(8))}/${Number(d.date.slice(5, 7))}`, n: d.n }));
  const pieData = REPORT_ORDER.map((s) => ({ key: s, name: t(STATUS_LABEL[s]), value: reports.byStatus[s] || 0 })).filter((x) => x.value > 0);
  const phaseData = PHASE_ORDER.map((s) => ({
    name: t(PHASE_LABEL[s]), plan: plans.byPlanStatus[s] || 0, evaluation: plans.byEvalStatus[s] || 0,
  }));
  const healthy = system.database === 'connected';

  return (
    <div className="page">
      <PageHead
        title={t('System overview')}
        subtitle={`${COMPANY[lang]} · ${t('Updated {time}', { time: fmtDateTime(data.generatedAt, lang) })}`}
        actions={<button className="btn btn-ghost" onClick={reload}><RefreshCw size={16} /> {t('Refresh')}</button>}
      />

      <section className={`glass card stack-sm ${attention.length ? '' : 'ok'}`}>
        <div className="row" style={{ gap: 10 }}>
          {attention.length ? <AlertTriangle size={22} color="#d98a00" /> : <CheckCircle2 size={22} color="#0e9f6e" />}
          <h2>{attention.length ? t('Needs your attention') : t('Everything looks healthy')}</h2>
        </div>
        {attention.length > 0 && (
          <ul className="attention">
            {attention.map((a) => (
              <li key={a.text}>{a.to ? <Link to={a.to}>{a.text}</Link> : a.text}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid cols-4">
        <Kpi icon={Users} value={users.active} label={t('Active users')} sub={t('{n} deactivated · {m} new in 30 days', { n: users.inactive, m: users.new30d })} to="/admin/users" />
        <Kpi icon={UserCheck} value={users.pending} label={t('Registration requests')} sub={t('{n} signed in during the last 7 days', { n: users.signedIn7d })} to="/admin/registrations" tone={users.pending ? '#d98a00' : undefined} />
        <Kpi icon={Building2} value={data.departments} label={t('Departments')} to="/admin/departments" />
        <Kpi icon={CalendarRange} value={periods.open} label={t('Open reporting periods')} sub={t('{n} closed', { n: periods.closed })} to="/admin/periods" />
        <Kpi icon={ClipboardList} value={plans.total} label={t('Work plans')} sub={t('{n} with evaluated tasks', { n: plans.evaluated })} />
        <Kpi icon={FileText} value={reports.total} label={t('Reports sent')} sub={t('{n} approved', { n: reports.byStatus.approved || 0 })} />
        <Kpi icon={Timer} value={reports.avgApprovalHours === null ? '–' : `${reports.avgApprovalHours} h`} label={t('Average time to final approval')} />
        <div className="glass stat">
          <ScoreRing value={plans.averageScore} size={64} stroke={7} />
          <div><strong>{t('Average performance')}</strong><span className="label-s">{t('weighted, all evaluated plans')}</span></div>
        </div>
      </div>

      <div className="grid cols-2">
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Reports per month')}</h2>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={monthData} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" vertical={false} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(11,79,214,.06)' }} />
                <Legend />
                <Bar dataKey="sent" name={t('Sent')} fill="#0b4fd6" radius={[8, 8, 0, 0]} maxBarSize={26} />
                <Bar dataKey="approved" name={t('Approved')} fill="#0e9f6e" radius={[8, 8, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('System activity, last 14 days')}</h2>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <AreaChart data={dayData} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="actFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0b4fd6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0b4fd6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" vertical={false} />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval={1} />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="n" name={t('Actions')} stroke="#0b4fd6" strokeWidth={2.5} fill="url(#actFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid cols-3">
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Users by role')}</h2>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={roleData} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={118} tick={{ ...AXIS, fill: '#12305f' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(11,79,214,.06)' }} />
                <Bar dataKey="n" name={t('Users')} fill="#2f7dff" radius={[0, 8, 8, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Users by department')}</h2>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={deptData} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={118} tick={{ ...AXIS, fill: '#12305f' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(11,79,214,.06)' }} />
                <Bar dataKey="n" name={t('Users')} fill="#5bb4ff" radius={[0, 8, 8, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Reports by status')}</h2>
          {pieData.length === 0 ? <p className="muted">{t('No report has been sent yet.')}</p> : (
            <>
              <div style={{ height: 190 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                      {pieData.map((p) => <Cell key={p.key} fill={REPORT_COLORS[p.key]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="legend" style={{ justifyContent: 'center' }}>
                {pieData.map((p) => <span key={p.key}><i style={{ background: REPORT_COLORS[p.key] }} />{p.name} {p.value}</span>)}
              </div>
              <p className="muted small center" style={{ marginTop: 8 }}>
                {t('Manager chain {a} · Direct {b}', { a: reports.byWorkflow.hierarchical || 0, b: reports.byWorkflow.direct || 0 })}
              </p>
            </>
          )}
        </section>
      </div>

      <div className="grid cols-2">
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Where the plans stand')}</h2>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={phaseData} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" vertical={false} />
                <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(11,79,214,.06)' }} />
                <Legend />
                <Bar dataKey="plan" name={t('Work plan')} fill="#0b4fd6" radius={[8, 8, 0, 0]} maxBarSize={22} />
                <Bar dataKey="evaluation" name={t('Monthly evaluation')} fill="#5bb4ff" radius={[8, 8, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Participation by period')}</h2>
          {periods.recent.length === 0 ? <p className="muted">{t('No reporting period has been created yet.')}</p> : (
            <div className="stack-sm">
              {[...periods.recent].reverse().map((p) => {
                const pct = (n) => (p.expected ? Math.min(100, Math.round((n / p.expected) * 100)) : 0);
                return (
                  <div key={p._id}>
                    <div className="row between small">
                      <strong>{p.name}</strong>
                      <span className="muted">{t('{a} of {b} planned · {c} evaluated and approved', { a: p.plans, b: p.expected, c: p.evalApproved })}</span>
                    </div>
                    <div className="progress" title={t('Plans created')}><span style={{ width: `${pct(p.plans)}%` }} /></div>
                    <div className="progress" style={{ marginTop: 3 }} title={t('Evaluation sent')}><span style={{ width: `${pct(p.evalSent)}%`, background: 'linear-gradient(90deg,#27c08c,#0e9f6e)' }} /></div>
                  </div>
                );
              })}
              <div className="legend"><span><i style={{ background: '#0b4fd6' }} />{t('Plans created')}</span><span><i style={{ background: '#0e9f6e' }} />{t('Evaluation sent')}</span></div>
            </div>
          )}
        </section>
      </div>

      <div className="grid cols-2">
        <section className="glass card" style={{ padding: 10 }}>
          <h2 style={{ margin: '10px 12px' }}>{t('Reports waiting too long')}</h2>
          {reports.stalled.length === 0 ? <p className="muted" style={{ margin: '0 12px 12px' }}>{t('No report has been waiting for more than 2 days.')}</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('Employee')}</th><th>{t('Period')}</th><th>{t('Waiting for')}</th><th className="num">{t('Days')}</th></tr></thead>
                <tbody>
                  {reports.stalled.map((r, i) => (
                    <tr key={i}>
                      <td>{r.owner}<div className="muted small"><StatusBadge status={r.kind} /></div></td>
                      <td>{r.period}</td>
                      <td>{r.waitingFor.join(', ') || '–'}</td>
                      <td className="num"><Badge tone={r.days >= 5 ? 'bad' : 'warn'}>{r.days}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass card">
          <h2 style={{ marginBottom: 10 }}>{t('Recent activity')}</h2>
          <div className="list">
            {activity.recent.map((a) => (
              <div key={a._id} className="list-item">
                <Activity size={16} style={{ color: 'var(--blue)', marginTop: 3 }} />
                <div className="grow small">
                  <strong>{a.actor?.fullName || '–'}</strong> <Badge tone="blue">{a.action}</Badge>
                </div>
                <span className="muted small nowrap">{fmtDateTime(a.createdAt, lang)}</span>
              </div>
            ))}
          </div>
          <Link to="/admin/audit" className="small" style={{ display: 'inline-block', marginTop: 8 }}>{t('Open the full audit trail')}</Link>
        </section>
      </div>

      <section className="glass card">
        <div className="row" style={{ gap: 10, marginBottom: 10 }}><Gauge size={20} color="#0b4fd6" /><h2>{t('System health')}</h2></div>
        <div className="grid cols-4">
          <div><span className="muted small">{t('Database')}</span><div className="health"><i className={healthy ? 'dot-ok' : 'dot-bad'} /> {healthy ? t('Connected') : t('Not connected')} <span className="muted small">({system.databaseName})</span></div></div>
          <div><span className="muted small">{t('Server running for')}</span><div className="health">{uptime(system.uptimeSeconds, t)}</div></div>
          <div><span className="muted small">{t('Email notifications')}</span><div className="health"><i className={system.emailEnabled ? 'dot-ok' : 'dot-off'} /> {system.emailEnabled ? t('On') : t('Off (in-app only)')}</div></div>
          <div><span className="muted small">{t('Registration')}</span><div className="health"><i className={system.registrationOpen ? 'dot-ok' : 'dot-off'} /> {system.registrationOpen ? t('Open (needs approval)') : t('Closed')}</div></div>
          <div><span className="muted small">{t('Environment')}</span><div className="health">{system.environment === 'production' ? t('Production') : t('Development')} · Node {system.node}</div></div>
          <div style={{ gridColumn: 'span 3' }}>
            <span className="muted small">{t('Most frequent actions (30 days)')}</span>
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              {activity.topActions.length === 0 ? <span className="muted">–</span> : activity.topActions.map((a) => <Badge key={a.action} tone="blue">{a.action} · {a.n}</Badge>)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
