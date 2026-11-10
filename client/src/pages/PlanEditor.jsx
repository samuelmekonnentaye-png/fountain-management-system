import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Lock, Plus, RotateCcw, Save, Scale, Send, Trash2 } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useI18n } from '../context/I18nContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { fmtDate, fmtDateTime, periodRange, toDateInput } from '../utils/format.js';
import { achievementOf, calcScores } from '../utils/scores.js';
import { ErrorBox, Modal, PageHead, PageLoader, ScoreRing, StatusBadge } from '../components/ui.jsx';
import ComposeModal from '../components/ComposeModal.jsx';

const TASK_STATUSES = [
  ['pending', 'Pending'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['not_completed', 'Not completed'],
  ['cancelled', 'Cancelled'],
];
const ACTION_LABEL = {
  created: 'Created', submitted: 'Submitted', approved: 'Approved', returned: 'Returned',
  rejected: 'Rejected', forwarded: 'Forwarded', reopened: 'Reopened',
};
const UNITS = ['tasks', '%', 'visits', 'reports', 'contracts', 'birr', 'hours', 'pieces'];

let keySeq = 0;
const withKey = (t) => ({
  ...t,
  _k: t._id || `new-${++keySeq}`,
  startDate: toDateInput(t.startDate),
  dueDate: toDateInput(t.dueDate),
});
const BLANK = {
  title: '', description: '', kpi: '', target: 1, unit: 'tasks', weight: 0, startDate: '', dueDate: '',
  status: 'pending', actual: 0, actualResult: '', shortfallReason: '',
};

export default function PlanEditor() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch(() => api.get(`/plans/${id}`).then((r) => r.data), [id]);

  const [tab, setTab] = useState('plan');
  const [title, setTitle] = useState('');
  const [objectives, setObjectives] = useState('');
  const [tasks, setTasks] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compose, setCompose] = useState(null); // 'plan' | 'evaluation'
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (data) {
      setTitle(data.plan.title || '');
      setObjectives(data.plan.objectives || '');
      setTasks(data.plan.tasks.map(withKey));
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const scores = useMemo(() => calcScores(tasks), [tasks]);
  if (loading && !data) return <div className="page"><PageLoader /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const { plan, reports } = data;
  const period = plan.period;
  const planEditable = plan.planEditable;
  const evalEditable = plan.evalEditable;
  const phase = tab === 'plan' ? 'plan' : 'evaluation';
  const phaseStatus = tab === 'plan' ? plan.planStatus : plan.evalStatus;
  const periodClosed = period.status === 'closed';

  const patchTask = (i, patch) => {
    setTasks((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const setStatus = (i, status) => {
    const cur = tasks[i];
    const patch = { status };
    if (status === 'completed') patch.actual = Math.max(Number(cur.actual) || 0, Number(cur.target) || 0);
    if (status === 'pending' || status === 'cancelled') patch.actual = 0;
    patchTask(i, patch);
  };
  const addTask = () => { setTasks((xs) => [...xs, withKey(BLANK)]); setDirty(true); };
  const removeTask = (i) => { setTasks((xs) => xs.filter((_, idx) => idx !== i)); setDirty(true); };
  const distribute = () => {
    const idx = tasks.map((x, i) => (x.status === 'cancelled' ? -1 : i)).filter((i) => i >= 0);
    if (!idx.length) return;
    const base = Math.floor(100 / idx.length);
    const extra = 100 - base * idx.length;
    setTasks((xs) => xs.map((x, i) => {
      const pos = idx.indexOf(i);
      return pos < 0 ? x : { ...x, weight: base + (pos < extra ? 1 : 0) };
    }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = tasks.map(({ _k, achievement, ...rest }) => ({
        ...rest, target: Number(rest.target), weight: Number(rest.weight) || 0, actual: Number(rest.actual) || 0,
      }));
      await api.put(`/plans/${plan._id}`, { title, objectives, tasks: payload });
      toast.success(t('Plan saved'));
      await reload();
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openCompose = async (kind) => {
    if (dirty && !(await save())) return;
    setCompose(kind);
  };
  const sendReport = async (kind, payload) => {
    await api.post('/reports', { planId: plan._id, kind, ...payload });
    toast.success(t('Report sent'));
    setCompose(null);
    await reload();
  };
  const reopen = async () => {
    try {
      await api.post(`/plans/${plan._id}/reopen`, { phase });
      toast.success(t('Reopened as a draft'));
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const deletePlan = async () => {
    try {
      await api.delete(`/plans/${plan._id}`);
      toast.success(t('Plan deleted'));
      navigate('/plans');
    } catch (e) {
      toast.error(errMsg(e));
      setConfirmDelete(false);
    }
  };

  const lastDecision = (action) => [...plan.history].reverse().find((h) => h.phase === phase && h.action === action);
  const returned = phaseStatus === 'returned' ? lastDecision('returned') : null;
  const rejected = phaseStatus === 'rejected' ? lastDecision('rejected') : null;
  const canDelete = plan.planStatus === 'draft' && plan.evalStatus === 'not_started' && reports.length === 0;
  const weightWarn = Math.abs(scores.weightSum - 100) > 0.01;
  const locked = tab === 'plan' ? !planEditable : !evalEditable;
  const lockedByEvaluation = tab === 'plan' && !planEditable && ['draft', 'returned'].includes(plan.planStatus);
  const sendDisabled = tasks.length === 0 || periodClosed;

  return (
    <div className="page">
      <PageHead
        title={period.name}
        subtitle={`${periodRange(period, lang)} · ${t('Work plan and evaluation')}`}
        actions={
          <>
            <StatusBadge status={plan.planStatus} />
            {plan.evalStatus !== 'not_started' && <StatusBadge status={plan.evalStatus} />}
            <Link to="/plans" className="btn btn-ghost btn-sm">{t('All plans')}</Link>
          </>
        }
      />

      {periodClosed && (
        <div className="alert alert-warn"><Lock size={18} /><div>{t('This reporting period is closed. You can read the plan but not send reports. Ask the administrator or the General Manager to reopen the period.')}</div></div>
      )}

      <div className="grid hero">
        <section className="glass card stack-sm">
          <div className="field">
            <label htmlFor="plan-title">{t('Plan title')}</label>
            <input id="plan-title" className="input" value={title} disabled={!planEditable} maxLength={200}
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
          </div>
          <div className="field">
            <label htmlFor="plan-obj">{t('Objectives (optional)')}</label>
            <textarea id="plan-obj" className="textarea" style={{ minHeight: 56 }} value={objectives} disabled={!planEditable}
              maxLength={2000} onChange={(e) => { setObjectives(e.target.value); setDirty(true); }} />
          </div>
        </section>
        <section className="glass card row" style={{ gap: 20 }}>
          <ScoreRing value={scores.total ? scores.weighted : null} size={96} stroke={10} caption={t('weighted')} />
          <div>
            <strong>{t('Live score')}</strong>
            <div className="muted small">{t('By count {count}%', { count: scores.byCount })}</div>
            <div className="muted small">{t('{done} of {total} tasks completed', { done: scores.completed, total: scores.total })}</div>
          </div>
        </section>
      </div>

      <div className="row between wrap">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'plan'} className={`tab ${tab === 'plan' ? 'active' : ''}`} onClick={() => setTab('plan')}>{t('1. Plan')}</button>
          <button role="tab" aria-selected={tab === 'eval'} className={`tab ${tab === 'eval' ? 'active' : ''}`} onClick={() => setTab('eval')}>{t('2. Evaluation')}</button>
        </div>
        <div className="row wrap">
          {tab === 'plan' && planEditable && (
            <>
              <span className={`sum-pill ${weightWarn ? 'badge-warn' : 'badge-good'}`}>{t('Total weight {n}%', { n: scores.weightSum })}</span>
              <button className="btn btn-ghost btn-sm" onClick={distribute} disabled={tasks.length === 0}><Scale size={15} /> {t('Distribute weights equally')}</button>
            </>
          )}
          <button className="btn btn-ghost" onClick={save} disabled={saving || !dirty || (!planEditable && !evalEditable)}>
            <Save size={16} /> {saving ? t('Saving…') : t('Save changes')}
          </button>
          {tab === 'plan' ? (
            <button className="btn btn-primary" onClick={() => openCompose('plan')} disabled={!planEditable || sendDisabled}>
              <Send size={16} /> {t('Send plan report')}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => openCompose('evaluation')} disabled={!evalEditable || sendDisabled}>
              <Send size={16} /> {t('Send evaluation report')}
            </button>
          )}
        </div>
      </div>

      {returned && (
        <div className="alert alert-warn" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>{t('This report was returned for correction')}{returned.actor ? ` – ${returned.actor.fullName}` : ''}</strong>
            {returned.comment && <div>{returned.comment}</div>}
            <div className="small">{t('Fix the points above, save, and send it again.')}</div>
          </div>
        </div>
      )}
      {rejected && (
        <div className="alert alert-bad" role="alert">
          <AlertTriangle size={20} />
          <div className="grow">
            <strong>{t('This report was rejected')}{rejected.actor ? ` – ${rejected.actor.fullName}` : ''}</strong>
            {rejected.comment && <div>{rejected.comment}</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reopen}><RotateCcw size={15} /> {t('Reopen as draft')}</button>
        </div>
      )}
      {locked && !returned && !rejected && (
        <div className="alert alert-info">
          <Lock size={18} />
          <div>{lockedByEvaluation ? t('The plan can no longer be changed because the evaluation was already sent.') : t('This part is locked because the report was sent and is waiting for a decision, or it has a final decision.')}</div>
        </div>
      )}

      {tab === 'plan' ? (
        <section className="stack">
          {tasks.length === 0 && (
            <div className="glass card empty">
              <h3>{t('No tasks yet')}</h3>
              <p>{t('Add the tasks you plan to do in this period. Give each one a target and a unit.')}</p>
            </div>
          )}
          {tasks.map((task, i) => (
            <div key={task._k} className={`task-card glass ${task.status === 'cancelled' ? 'cancelled' : ''}`}>
              <div className="task-grid v2">
                <div className="field">
                  <label>{t('Task')} {i + 1}</label>
                  <input className="input" value={task.title} disabled={!planEditable} maxLength={200}
                    placeholder={t('What will you do?')} onChange={(e) => patchTask(i, { title: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t('KPI (how it is measured)')}</label>
                  <input className="input" value={task.kpi} disabled={!planEditable} maxLength={300}
                    placeholder={t('e.g. 5 contracts signed')} onChange={(e) => patchTask(i, { kpi: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t('Target')}</label>
                  <input className="input" type="number" min="0" step="any" value={task.target} disabled={!planEditable}
                    onChange={(e) => patchTask(i, { target: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t('Unit')}</label>
                  <input className="input" list="unit-options" value={task.unit} disabled={!planEditable} maxLength={40}
                    onChange={(e) => patchTask(i, { unit: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t('Weight %')}</label>
                  <input className="input" type="number" min="0" max="100" value={task.weight} disabled={!planEditable}
                    onChange={(e) => patchTask(i, { weight: e.target.value })} />
                </div>
                <div className="field">
                  <label>{t('Due date')}</label>
                  <input className="input" type="date" value={task.dueDate || ''} disabled={!planEditable}
                    onChange={(e) => patchTask(i, { dueDate: e.target.value })} />
                </div>
              </div>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="field" style={{ width: 170 }}>
                  <label>{t('Start date')}</label>
                  <input className="input" type="date" value={task.startDate || ''} disabled={!planEditable}
                    onChange={(e) => patchTask(i, { startDate: e.target.value })} />
                </div>
                <div className="field grow">
                  <label>{t('Details (optional)')}</label>
                  <textarea className="textarea" style={{ minHeight: 44 }} value={task.description} disabled={!planEditable}
                    maxLength={2000} onChange={(e) => patchTask(i, { description: e.target.value })} />
                </div>
                {planEditable && (
                  <button className="btn btn-danger btn-sm" style={{ marginTop: 26 }} onClick={() => removeTask(i)} aria-label={t('Remove task')}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <datalist id="unit-options">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          {planEditable && (
            <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={addTask}>
              <Plus size={16} /> {t('Add task')}
            </button>
          )}
        </section>
      ) : (
        <section className="stack">
          {tasks.length === 0 && <div className="glass card empty"><h3>{t('Add tasks in the Plan tab first')}</h3></div>}
          {tasks.map((task, i) => {
            const ach = achievementOf(task);
            return (
              <div key={task._k} className={`task-card glass ${task.status === 'cancelled' ? 'cancelled' : ''}`}>
                <div className="row between wrap">
                  <div className="grow">
                    <strong>{task.title || t('Untitled task')}</strong>
                    <div className="muted small">
                      {[task.kpi && `KPI: ${task.kpi}`, `${t('Target')}: ${task.target} ${task.unit}`, task.weight > 0 && `${task.weight}%`, task.dueDate && fmtDate(task.dueDate, lang)]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
                <div className="eval-grid v2">
                  <div className="field">
                    <label>{t('Status')}</label>
                    <select className="select" value={task.status} disabled={!evalEditable} onChange={(e) => setStatus(i, e.target.value)}>
                      {TASK_STATUSES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>{t('Actual result')} ({task.unit})</label>
                    <input className="input" type="number" min="0" step="any" value={task.actual}
                      disabled={!evalEditable || ['pending', 'cancelled', 'completed'].includes(task.status)}
                      onChange={(e) => patchTask(i, { actual: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{t('Achievement')}: {ach}%</label>
                    <div className="progress" aria-hidden><span style={{ width: `${ach}%` }} /></div>
                    <textarea className="textarea" style={{ minHeight: 44 }} value={task.actualResult} disabled={!evalEditable}
                      maxLength={2000} placeholder={t('What was actually done?')}
                      onChange={(e) => patchTask(i, { actualResult: e.target.value })} />
                  </div>
                </div>
                {task.status === 'not_completed' && (
                  <div className="field">
                    <label>{t('Why was the goal not reached?')} *</label>
                    <textarea className="textarea" style={{ minHeight: 56 }} value={task.shortfallReason} disabled={!evalEditable}
                      maxLength={2000} onChange={(e) => patchTask(i, { shortfallReason: e.target.value })} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="grid cols-2">
        <section className="glass card">
          <h2 style={{ marginBottom: 8 }}>{t('Report history')}</h2>
          {reports.length === 0 ? (
            <p className="muted">{t('No report has been sent for this plan yet.')}</p>
          ) : (
            <div className="list">
              {reports.map((r) => (
                <Link key={r._id} to={`/reports/${r._id}`} className="list-item click" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="grow">
                    <strong>{r.subject || (r.kind === 'plan' ? t('Work plan') : t('Monthly evaluation'))}</strong>
                    <div className="muted small">{fmtDate(r.createdAt, lang)}</div>
                  </div>
                  <StatusBadge status={r.kind} />
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          )}
          {canDelete && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> {t('Delete this plan')}</button>
            </div>
          )}
        </section>

        <section className="glass card">
          <h2 style={{ marginBottom: 12 }}>{t('Activity')}</h2>
          <div className="timeline">
            {[...plan.history].reverse().map((h) => (
              <div key={h._id} className={`timeline-item ${h.action === 'approved' ? 'good' : ['returned', 'rejected'].includes(h.action) ? 'warn' : ''}`}>
                <span className="timeline-dot" />
                <div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <strong>{t(ACTION_LABEL[h.action] || h.action)}</strong>
                    {h.phase && <span className="badge badge-neutral">{h.phase === 'plan' ? t('Work plan') : t('Monthly evaluation')}</span>}
                    <span className="muted small">{h.actor?.fullName} · {fmtDateTime(h.at, lang)}</span>
                  </div>
                  {h.comment && <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{h.comment}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {compose && (
        <ComposeModal
          title={compose === 'plan' ? t('Send work plan report') : t('Send monthly evaluation report')}
          initialSubject={`${compose === 'plan' ? t('Work plan') : t('Monthly evaluation')} – ${period.name}`}
          summary={{ weighted: scores.weighted, byCount: scores.byCount, completed: scores.completed, total: scores.total }}
          submitLabel={t('Send report')}
          onClose={() => setCompose(null)}
          onSubmit={(payload) => sendReport(compose, payload)}
        />
      )}
      {confirmDelete && (
        <Modal title={t('Delete this plan?')} onClose={() => setConfirmDelete(false)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</button>
            <button className="btn btn-danger" onClick={deletePlan}>{t('Delete')}</button>
          </>}>
          <p>{t('The plan and its tasks will be removed permanently.')}</p>
        </Modal>
      )}
    </div>
  );
}
