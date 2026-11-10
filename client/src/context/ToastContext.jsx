import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const remove = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (type, message) => {
      const id = nextId.current++;
      setItems((xs) => [...xs, { id, type, message }]);
      setTimeout(() => remove(id), type === 'error' ? 7000 : 4000);
    },
    [remove]
  );

  const api = useMemo(() => ({ success: (m) => push('success', m), error: (m) => push('error', m) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack no-print" role="status" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={`toast toast-${x.type}`}>
            {x.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{x.message}</span>
            <button className="icon-btn" onClick={() => remove(x.id)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
