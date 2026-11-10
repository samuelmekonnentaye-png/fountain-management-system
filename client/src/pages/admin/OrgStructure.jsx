import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import api, { errMsg } from '../../api/client.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { deptName, posName } from '../../utils/format.js';
import { Badge, EmptyState, ErrorBox, Modal, PageHead, PageLoader } from '../../components/ui.jsx';

const EMPTY = { name: '', nameAm: '', parentId: '', departmentId: '', approver: true, chainEnd: false, seats: 1 };

function Node({ node, depth, open, toggle, onAdd, onEdit, onDelete }) {
  const { t, lang } = useI18n();
  const hasKids = node.children.length > 0;
  const isOpen = open.has(node._id);
  return (
    <>
      <div className="org-row" style={{ paddingLeft: 12 + depth * 22 }}>
        <button className="icon-btn" style={{ width: 28, height: 28, visibility: hasKids ? 'visible' : 'hidden' }} onClick={() => toggle(node._id)} aria-label={isOpen ? t('Collapse') : t('Expand')}>
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="grow">
          <div className="row wrap" style={{ gap: 6 }}>
            <strong>{posName(node, lang)}</strong>
            {node.seats > 1 && <Badge>× {node.seats}</Badge>}
            {node.chainEnd && <Badge tone="good">{t('Reports stop here')}</Badge>}
            {!node.approver && <Badge>{t('Does not approve')}</Badge>}
            {node.holders.length === 0 ? <Badge tone="warn">{t('Vacant')}</Badge> : null}
          </div>
          <div className="muted small">
            {deptName(node.department, lang)}
            {node.holders.length > 0 && ` · ${node.holders.map((h) => h.fullName).join(', ')}`}
          </div>
        </div>
        <div className="nowrap no-print">
          <button className="icon-btn" onClick={() => onAdd(node)} aria-label={t('Add a position below')} title={t('Add a position below')}><Plus size={17} /></button>
          <button className="icon-btn" onClick={() => onEdit(node)} aria-label={t('Edit')}><Pencil size={16} /></button>
          <button className="icon-btn" onClick={() => onDelete(node)} aria-label={t('Delete')}><Trash2 size={16} /></button>
        </div>
      </div>
      {hasKids && isOpen && node.children.map((c) => (
        <Node key={c._id} node={c} depth={depth + 1} open={open} toggle={toggle} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  );
}

export default function OrgStructure() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState('chart');
  const { data, loading, error, reload } = useFetch(() => api.get('/positions').then((r) => r.data.items), []);
  const check = useFetch(() => api.get('/positions/check').then((r) => r.data), [tab]);
  const depts = useFetch(() => api.get('/departments').then((r) => r.data.items), []);

  const [open, setOpen] = useState(null); // Set of expanded ids
  const [editing, setEditing] = useState(null); // 'new' | position
  const [removing, setRemoving] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const { roots } = useMemo(() => {
    const items = (data || []).map((p) => ({ ...p, children: [] }));
    const byId = new Map(items.map((p) => [p._id, p]));
    const rootList = [];
    items.forEach((p) => {
      const parent = p.parent ? byId.get(p.parent) : null;
      if (parent) parent.children.push(p);
      else rootList.push(p);
    });
    const sort = (list) => { list.sort((a, b) => a.name.localeCompare(b.name)); list.forEach((x) => sort(x.children)); };
    sort(rootList);
    return { roots: rootList };
  }, [data]);

  // everything is open down to the second level at first
  const expanded = useMemo(() => {
    if (open) return open;
    const s = new Set();
    const walk = (list, d) => list.forEach((n) => { if (d < 2) s.add(n._id); walk(n.children, d + 1); });
    walk(roots, 0);
    return s;
  }, [open, roots]);
  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  };
  const expandAll = () => setOpen(new Set((data || []).map((p) => p._id)));

  const importChart = async () => {
    setBusy(true);
    try {
      const r = await api.post('/positions/import-company-structure');
      toast.success(t('Organization chart loaded: {a} new positions, {b} new units', { a: r.data.positionsCreated, b: r.data.unitsCreated }));
      reload();
      check.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const openNew = (parent) => {
    setForm({ ...EMPTY, parentId: parent?._id || '', departmentId: parent?.department?._id || '' });
    setEditing('new');
  };
  const openEdit = (p) => {
    setForm({
      name: p.name, nameAm: p.nameAm || '', parentId: p.parent || '', departmentId: p.department?._id || '',
      approver: p.approver, chainEnd: p.chainEnd, seats: p.seats,
    });
    setEditing(p);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, seats: Number(form.seats) || 1 };
      if (editing === 'new') await api.post('/positions', body);
      else await api.patch(`/positions/${editing._id}`, body);
      toast.success(t('Position saved'));
      setEditing(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/positions/${removing._id}`);
      toast.success(t('Position deleted'));
      setRemoving(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const statusBadge = (r) => {
    if (r.status === 'ambiguous') return <Badge tone="bad">{t('Several people hold {position}', { position: r.ambiguousPosition })}</Badge>;
    if (r.status === 'unassigned') return <Badge tone="warn">{t('No position and no manager')}</Badge>;
    if (r.status === 'manager') return <Badge tone="blue">{t('Manager set by hand')}</Badge>;
    if (r.status === 'top') return <Badge>{t('Top of the line')}</Badge>;
    return <Badge tone="good">{t('From the chart')}</Badge>;
  };

  return (
    <div className="page">
      <PageHead
        title={t('Organization chart')}
        subtitle={t('Who reports to whom. A report sent along the chain goes only to the approvers on the sender\'s own line, up to the General Manager.')}
        actions={
          <>
            <button className="btn btn-ghost" onClick={importChart} disabled={busy}><Download size={16} /> {t('Load the company chart')}</button>
            <button className="btn btn-primary" onClick={() => openNew(null)}><Plus size={16} /> {t('New position')}</button>
          </>
        }
      />
      <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'chart'} className={`tab ${tab === 'chart' ? 'active' : ''}`} onClick={() => setTab('chart')}>{t('Chart')}</button>
        <button role="tab" aria-selected={tab === 'check'} className={`tab ${tab === 'check' ? 'active' : ''}`} onClick={() => setTab('check')}>
          {t('Superiors check')}{check.data?.attention > 0 ? ` (${check.data.attention})` : ''}
        </button>
      </div>
      <ErrorBox error={error} onRetry={reload} />

      {tab === 'chart' ? (
        <section className="glass card" style={{ padding: 8 }}>
          {loading && !data ? <PageLoader /> : roots.length === 0 ? (
            <EmptyState title={t('The organization chart is empty')} text={t('Press "Load the company chart" to add all units and positions of FOUNTAIN INTERNATIONAL TRADING PLC, then give each person a position in Users.')} />
          ) : (
            <>
              <div className="row between" style={{ padding: '6px 12px' }}>
                <span className="muted small">{t('{n} positions', { n: data.length })}</span>
                <button className="btn btn-ghost btn-sm" onClick={expandAll}>{t('Expand all')}</button>
              </div>
              <div className="org-tree">
                {roots.map((r) => (
                  <Node key={r._id} node={r} depth={0} open={expanded} toggle={toggle} onAdd={openNew} onEdit={openEdit} onDelete={setRemoving} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="glass card" style={{ padding: 10 }}>
          {check.loading && !check.data ? <PageLoader /> : (
            <>
              <div className="row" style={{ gap: 10, margin: '6px 12px 10px' }}>
                {check.data?.attention > 0
                  ? <><AlertTriangle size={20} color="#d98a00" /><strong>{t('{n} person(s) need your attention', { n: check.data.attention })}</strong></>
                  : <><CheckCircle2 size={20} color="#0e9f6e" /><strong>{t('Everybody has a clear superior')}</strong></>}
                <span className="muted small">{t('Fix it in Users: give the person a position, or set the direct manager by hand.')} <Link to="/admin/users">{t('Open Users')}</Link></span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('Name')}</th><th>{t('Position')}</th><th>{t('Superior')}</th><th>{t('How it is decided')}</th></tr></thead>
                  <tbody>
                    {(check.data?.items || []).map((r) => (
                      <tr key={r.userId}>
                        <td><strong>{r.name}</strong></td>
                        <td>{r.position || '–'}</td>
                        <td>{r.superior || '–'}</td>
                        <td>{statusBadge(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {editing && (
        <Modal title={editing === 'new' ? t('New position') : t('Edit position')} onClose={() => setEditing(null)} wide
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || form.name.trim().length < 2}>{t('Save')}</button>
          </>}>
          <div className="form-grid">
            <div className="field"><label>{t('Name (English)')}</label><input className="input" value={form.name} onChange={set('name')} /></div>
            <div className="field"><label>{t('Name (Amharic)')}</label><input className="input" value={form.nameAm} onChange={set('nameAm')} /></div>
            <div className="field"><label>{t('Reports to')}</label>
              <select className="select" value={form.parentId} onChange={set('parentId')}>
                <option value="">{t('Nobody (top of the chart)')}</option>
                {(data || []).filter((p) => editing === 'new' || p._id !== editing._id).map((p) => <option key={p._id} value={p._id}>{posName(p, lang)}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('Department')}</label>
              <select className="select" value={form.departmentId} onChange={set('departmentId')}>
                <option value="">{t('No department')}</option>
                {(depts.data || []).map((d) => <option key={d._id} value={d._id}>{deptName(d, lang)}</option>)}
              </select>
            </div>
            <div className="field"><label>{t('People in this position')}</label>
              <input className="input" type="number" min="1" value={form.seats} onChange={set('seats')} />
            </div>
            <div className="stack-sm">
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.approver} onChange={(e) => setForm((f) => ({ ...f, approver: e.target.checked }))} />
                {t('The holder approves reports of the people below')}
              </label>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.chainEnd} onChange={(e) => setForm((f) => ({ ...f, chainEnd: e.target.checked }))} />
                {t('Reports from below stop here (last approver)')}
              </label>
            </div>
          </div>
        </Modal>
      )}
      {removing && (
        <Modal title={t('Delete this position?')} onClose={() => setRemoving(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setRemoving(null)}>{t('Cancel')}</button>
            <button className="btn btn-danger" onClick={remove} disabled={busy}>{t('Delete')}</button>
          </>}>
          <p>{posName(removing, lang)}</p>
          <p className="muted small" style={{ marginTop: 8 }}>{t('A position that people hold, or that other positions report to, cannot be deleted.')}</p>
        </Modal>
      )}
    </div>
  );
}
