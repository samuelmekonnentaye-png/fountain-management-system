import { useEffect, useState } from 'react';
import { GitBranch, Send, Users } from 'lucide-react';
import api, { errMsg } from '../api/client.js';
import { useI18n } from '../context/I18nContext.jsx';
import { ROLE_LABEL, userRole } from '../utils/roles.js';
import { Modal, ScoreRing } from './ui.jsx';
import RecipientPicker from './RecipientPicker.jsx';

// Email-style composer used to SEND a report and to FORWARD one.
//   mode="send"    -> the sender chooses a workflow: direct (pick recipients) or hierarchical (automatic chain)
//   mode="forward" -> forwardWorkflow tells how the report is routed ('direct' or 'hierarchical')
// onSubmit({ workflow, to: [ids], cc: [ids], subject, message }) must return a promise.
export default function ComposeModal({
  title, initialSubject = '', summary, submitLabel, onClose, onSubmit, mode = 'send', forwardWorkflow = 'direct',
}) {
  const { t } = useI18n();
  const [workflow, setWorkflow] = useState(mode === 'send' ? 'direct' : forwardWorkflow);
  const [chain, setChain] = useState(null); // null = loading
  const [problem, setProblem] = useState(null); // 'ambiguous' | 'none' | null
  const [positionName, setPositionName] = useState('');
  const [upTo, setUpTo] = useState(0); // index of the last approver the report should reach
  const [to, setTo] = useState([]);
  const [cc, setCc] = useState([]);
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'send') return undefined;
    let alive = true;
    api
      .get('/users/me/approval-chain')
      .then((r) => {
        if (!alive) return;
        setChain(r.data.items);
        setProblem(r.data.problem);
        setPositionName(r.data.positionName || '');
        setUpTo(Math.max(0, r.data.items.length - 1));
        if (r.data.items.length > 0 && !r.data.problem) setWorkflow('hierarchical');
      })
      .catch(() => alive && setChain([]));
    return () => {
      alive = false;
    };
  }, [mode]);

  const hierarchicalSend = mode === 'send' && workflow === 'hierarchical';
  const singleApprover = mode === 'forward' && forwardWorkflow === 'hierarchical';

  const submit = async () => {
    if (!hierarchicalSend && to.length === 0) {
      setError(singleApprover ? t('Choose the person who should approve next') : t('Choose at least one person in "Send To"'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const finalApproverId = hierarchicalSend && chain && upTo < chain.length - 1 ? chain[upTo]._id : null;
      await onSubmit({ workflow, to: to.map((u) => u._id), cc: cc.map((u) => u._id), subject, message, finalApproverId });
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const WorkflowCard = ({ value, icon: Icon, label, text, disabled }) => (
    <label className={`choice ${workflow === value ? 'active' : ''} ${disabled ? 'disabled' : ''}`}>
      <input type="radio" name="workflow" value={value} checked={workflow === value} disabled={disabled}
        onChange={() => setWorkflow(value)} />
      <Icon size={20} />
      <span>
        <strong>{label}</strong>
        <span className="muted small">{text}</span>
      </span>
    </label>
  );

  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || (hierarchicalSend && (!chain?.length || problem === 'ambiguous'))}>
            <Send size={16} /> {busy ? t('Sending…') : submitLabel || t('Send')}
          </button>
        </>
      }
    >
      <div className="stack">
        {summary && (
          <div className="row glass card-tight" style={{ gap: 18 }}>
            <ScoreRing value={summary.weighted} size={74} stroke={8} />
            <div>
              <strong>{t('Performance score')}</strong>
              <div className="muted small">
                {t('By count {count}% · {done} of {total} tasks completed', {
                  count: summary.byCount, done: summary.completed, total: summary.total,
                })}
              </div>
            </div>
          </div>
        )}

        {mode === 'send' && (
          <div className="stack-sm">
            <span className="label">{t('How should this report be approved?')}</span>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <WorkflowCard value="hierarchical" icon={GitBranch} label={t('Along my manager chain')}
                text={t('Each manager approves in turn, automatically.')} disabled={chain !== null && (chain.length === 0 || problem === 'ambiguous')} />
              <WorkflowCard value="direct" icon={Users} label={t('Direct')}
                text={t('I choose who receives it; the first decision counts.')} />
            </div>
          </div>
        )}

        {hierarchicalSend ? (
          <div className="stack-sm">
            <span className="label">{t('Approval route')}</span>
            {chain === null ? (
              <span className="muted small">{t('Searching…')}</span>
            ) : problem === 'ambiguous' ? (
              <div className="alert alert-warn">{t('Your superior cannot be decided automatically: several people hold the position "{position}". Ask the administrator to set your direct manager.', { position: positionName })}</div>
            ) : chain.length === 0 ? (
              <div className="alert alert-warn">{t('You have no approval chain yet. Ask the administrator to set your position or manager, or choose "Direct" and pick the recipients yourself.')}</div>
            ) : (
              <>
                <ol className="route">
                  {chain.map((u, i) => (
                    <li key={u._id} className={i > upTo ? 'dim' : ''}>
                      <span className="route-n">{i + 1}</span>
                      <span>
                        <strong>{u.fullName}</strong>
                        <span className="muted small"> · {u.position?.name || t(ROLE_LABEL[userRole(u)])}</span>
                        {i > upTo && <span className="muted small"> · {t('not asked')}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                {chain.length > 1 && (
                  <div className="field">
                    <label>{t('Send it up to')}</label>
                    <select className="select" value={upTo} onChange={(e) => setUpTo(Number(e.target.value))}>
                      {chain.map((u, i) => (
                        <option key={u._id} value={i}>{`${i + 1}. ${u.fullName}${i === chain.length - 1 ? ` (${t('last approver')})` : ''}`}</option>
                      ))}
                    </select>
                    <span className="hint">{t('The report goes up to this approver only; the people above are not asked.')}</span>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <RecipientPicker
            label={singleApprover ? t('Next approver') : t('Send To')}
            value={to} onChange={setTo} max={singleApprover ? 1 : 30}
            excludeIds={cc.map((u) => u._id)}
            hint={singleApprover ? t('This person is added right after you in the approval route.') : t('The report appears only in the accounts of the people you choose.')}
          />
        )}

        {!singleApprover && (
          <RecipientPicker label="CC" variant="cc" value={cc} onChange={setCc} excludeIds={to.map((u) => u._id)}
            hint={t('CC recipients can read the report but cannot approve or return it.')} />
        )}
        <div className="field">
          <label>{t('Subject')}</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </div>
        <div className="field">
          <label>{t('Message (optional)')}</label>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} />
        </div>
        {error && <div className="error-text" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
