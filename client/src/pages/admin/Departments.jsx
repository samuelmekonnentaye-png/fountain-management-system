import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import api, { errMsg } from '../../api/client.js';
import { useI18n } from '../../context/I18nContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { deptName } from '../../utils/format.js';
import { Badge, ErrorBox, Modal, PageHead, PageLoader } from '../../components/ui.jsx';

const EMPTY = { name: '', nameAm: '', code: '', parentId: '', isActive: true };

export default function Departments() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => api.get('/departments').then((r) => r.data.items), []);
  const [editing, setEditing] = useState(null); // null | 'new' | dept
  const [removing, setRemoving] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, nameAm: form.nameAm, code: form.code, parentId: form.parentId };
      if (editing === 'new') await api.post('/departments', body);
      else await api.patch(`/departments/${editing._id}`, { ...body, isActive: form.isActive });
      toast.success(t('Department saved'));
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
      await api.delete(`/departments/${removing._id}`);
      toast.success(t('Department deleted'));
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

  return (
    <div className="page">
      <PageHead title={t('Departments')} subtitle={t('Departments appear in registration, user management and performance reports.')}
        actions={<button className="btn btn-primary" onClick={() => { setForm(EMPTY); setEditing('new'); }}><Plus size={16} /> {t('New department')}</button>} />
      <ErrorBox error={error} onRetry={reload} />
      <section className="glass card" style={{ padding: 8 }}>
        {loading && !data ? <PageLoader /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Code')}</th><th>{t('Name (English)')}</th><th>{t('Name (Amharic)')}</th><th>{t('Parent department')}</th><th className="num">{t('Members')}</th><th>{t('Status')}</th><th /></tr></thead>
              <tbody>
                {(data || []).map((d) => (
                  <tr key={d._id}>
                    <td className="muted">{d.code || '–'}</td>
                    <td><strong>{d.name}</strong></td>
                    <td>{d.nameAm || '–'}</td>
                    <td>{deptName(d.parent, lang) || '–'}</td>
                    <td className="num">{d.memberCount}</td>
                    <td>{d.isActive === false ? <Badge tone="bad">{t('Deactivated')}</Badge> : <Badge tone="good">{t('Active')}</Badge>}</td>
                    <td className="right nowrap">
                      <button className="icon-btn" aria-label={t('Edit')} onClick={() => {
                        setForm({ name: d.name, nameAm: d.nameAm || '', code: d.code || '', parentId: d.parent?._id || '', isActive: d.isActive !== false });
                        setEditing(d);
                      }}><Pencil size={17} /></button>
                      <button className="icon-btn" aria-label={t('Delete')} onClick={() => setRemoving(d)}><Trash2 size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing === 'new' ? t('New department') : t('Edit department')} onClose={() => setEditing(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || form.name.trim().length < 2}>{t('Save')}</button>
          </>}>
          <div className="stack">
            <div className="field"><label>{t('Name (English)')}</label><input className="input" value={form.name} onChange={set('name')} /></div>
            <div className="field"><label>{t('Name (Amharic)')}</label><input className="input" value={form.nameAm} onChange={set('nameAm')} /></div>
            <div className="form-grid">
              <div className="field"><label>{t('Code')}</label><input className="input" value={form.code} onChange={set('code')} maxLength={20} /></div>
              <div className="field"><label>{t('Parent department')}</label>
                <select className="select" value={form.parentId} onChange={set('parentId')}>
                  <option value="">{t('None (top level)')}</option>
                  {(data || []).filter((d) => editing === 'new' || d._id !== editing._id).map((d) => <option key={d._id} value={d._id}>{deptName(d, lang)}</option>)}
                </select>
              </div>
            </div>
            {editing !== 'new' && (
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                {t('Department is active')}
              </label>
            )}
          </div>
        </Modal>
      )}
      {removing && (
        <Modal title={t('Delete department?')} onClose={() => setRemoving(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setRemoving(null)}>{t('Cancel')}</button>
            <button className="btn btn-danger" onClick={remove} disabled={busy}>{t('Delete')}</button>
          </>}>
          <p>{removing.name}</p>
        </Modal>
      )}
    </div>
  );
}
