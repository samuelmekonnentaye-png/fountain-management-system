import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Download, FileText, Users } from 'lucide-react';
import api, { download, errMsg } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { deptName } from '../utils/format.js';
import { scoreColor } from '../utils/scores.js';
import { ROLES, hasRole } from '../utils/roles.js';
import { EmptyState, ErrorBox, PageHead, PageLoader, ScoreRing } from '../components/ui.jsx';

const BAND_COLORS = ['#d64545', '#d98a00', '#0b4fd6', '#0e9f6e'];

export default function Team() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [period, setPeriod] = useState('');
  const [department, setDepartment] = useState('');
  const orgWide = hasRole(user, ROLES.GM, ROLES.DEPUTY_GM);

  const depts = useFetch(() => api.get('/departments').then((r) => r.data.items), []);
  const { data, loading, error, reload } = useFetch(
    () => api.get('/dashboard/team', { params: { year, period: period || undefined, department: department || undefined } }).then((r) => r.data),
    [year, period, department]
  );

  const params = { year, period: period || undefined, department: department || undefined, lang };
  const exportFile = async (kind) => {
    try {
      if (kind === 'xlsx') await download('/exports/performance', params, 'performance.xlsx');
      else await download('/exports/performance.csv', params, 'performance.csv');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="page">
      <PageHead
        title={t('Team performance')}
        subtitle={orgWide ? t('Results of all departments. Only scores are shown here, never report contents.') : t('Results of your department and your direct reports.')}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => exportFile('xlsx')}><Download size={16} /> Excel</button>
            <button className="btn btn-ghost" onClick={() => exportFile('csv')}><FileText size={16} /> CSV</button>
          </>
        }
      />
      <div className="row wrap no-print">
        <select className="select" style={{ width: 'auto' }} value={year} onChange={(e) => { setYear(Number(e.target.value)); setPeriod(''); }} aria-label={t('Year')}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('Period')}>
          <option value="">{t('Whole year')}</option>
          {(data?.periods || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={department} onChange={(e) => setDepartment(e.target.value)} aria-label={t('Department')}>
          <option value="">{t('All departments')}</option>
          {(depts.data || []).map((d) => <option key={d._id} value={d._id}>{deptName(d, lang)}</option>)}
        </select>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <PageLoader />
      ) : data && data.employeeCount === 0 ? (
        <section className="glass card">
          <EmptyState icon={Users} title={t('No evaluated plans for this selection')}
            text={t('Scores appear once employees evaluate the tasks of a period.')} />
        </section>
      ) : data ? (
        <>
          <div className="grid cols-3">
            <div className="glass stat">
              <ScoreRing value={data.average} size={74} stroke={8} />
              <div><strong>{t('Average score')}</strong><span className="label-s">{t('weighted, per employee')}</span></div>
            </div>
            <div className="glass stat">
              <span className="stat-icon"><Users size={22} /></span>
              <div><strong>{data.employeeCount}</strong><span className="label-s">{t('Employees evaluated')}</span></div>
            </div>
            <div className="glass stat">
              <span className="stat-icon" style={{ color: '#0e9f6e', background: 'rgba(14,159,110,.12)' }}>★</span>
              <div>
                <strong>{data.departments[0] ? deptName({ name: data.departments[0].name, nameAm: data.departments[0].nameAm }, lang) : '–'}</strong>
                <span className="label-s">{t('Top department')}</span>
              </div>
            </div>
          </div>

          <div className="grid cols-2">
            <section className="glass card">
              <h2 style={{ marginBottom: 10 }}>{t('Departments')}</h2>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={data.departments.map((d) => ({ name: deptName({ name: d.name, nameAm: d.nameAm }, lang), average: d.average }))}
                    layout="vertical" margin={{ left: 10, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fill: '#587091', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fill: '#12305f', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => `${v}%`} cursor={{ fill: 'rgba(11,79,214,.06)' }} />
                    <Bar dataKey="average" name={t('Average score')} radius={[0, 8, 8, 0]} maxBarSize={22}>
                      {data.departments.map((d, i) => <Cell key={i} fill={scoreColor(d.average)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="glass card">
              <h2 style={{ marginBottom: 10 }}>{t('Trend by period')} · {data.year}</h2>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={data.periodTrend.map((m) => ({ name: m.name, average: m.average }))} margin={{ left: -16, right: 12, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#587091', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fill: '#587091', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => (v === null || v === undefined ? '–' : `${v}%`)} />
                    <Line type="monotone" dataKey="average" name={t('Average score')} stroke="#0b4fd6" strokeWidth={3} dot={{ r: 4 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid hero">
            <section className="glass card" style={{ padding: 10 }}>
              <h2 style={{ margin: '10px 12px' }}>{t('Employees')}</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th><th>{t('Employee')}</th><th>{t('Department')}</th>
                      <th className="num">{t('Plans')}</th><th className="num">{t('Weighted')}</th><th className="num">{t('By count')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees.map((e, i) => (
                      <tr key={e.id}>
                        <td>{i + 1}</td>
                        <td><strong>{e.name}</strong><div className="muted small">{e.jobTitle}</div></td>
                        <td>{deptName({ name: e.departmentName, nameAm: e.departmentNameAm }, lang)}</td>
                        <td className="num">{e.plans}</td>
                        <td className="num"><strong style={{ color: scoreColor(e.avgWeighted) }}>{e.avgWeighted}%</strong></td>
                        <td className="num">{e.avgCount}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="glass card">
              <h2 style={{ marginBottom: 10 }}>{t('Score distribution')}</h2>
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={data.distribution} margin={{ left: -22, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,79,214,.12)" vertical={false} />
                    <XAxis dataKey="band" tick={{ fill: '#587091', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
                    <YAxis allowDecimals={false} tick={{ fill: '#587091', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(11,79,214,.06)' }} />
                    <Bar dataKey="count" name={t('Employees')} radius={[8, 8, 0, 0]} maxBarSize={36}>
                      {data.distribution.map((_, i) => <Cell key={i} fill={BAND_COLORS[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
