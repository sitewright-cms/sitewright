import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  /** Show a transient toast (auto-dismisses). Fire-and-forget. */
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

// Literal class strings (NOT `alert alert-${kind}`) so DaisyUI/Tailwind's content scan emits each
// variant. Keep these spelled out.
const ALERT_CLASS: Record<ToastKind, string> = {
  success: 'alert alert-success',
  error: 'alert alert-error',
  info: 'alert alert-info',
};

const TTL_MS = 2600;
const NOOP: ToastApi = { show: () => {} };

/**
 * App-wide transient notifications: DaisyUI `toast` + `alert` bubbles portalled to <body>
 * (bottom-right, above modals). Call `useToast().show(message, kind)` from anywhere under the
 * provider — e.g. after copying to the clipboard. Each toast auto-dismisses after {@link TTL_MS};
 * pending timers are cleared on unmount. Used OUTSIDE a provider, `useToast()` is a safe no-op.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((handle) => clearTimeout(handle));
  }, []);

  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = (idRef.current += 1);
    setToasts((list) => [...list, { id, message, kind }]);
    const handle = setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, TTL_MS);
    timers.current.set(id, handle);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {createPortal(
        // One STATIC live region (present before any toast is injected, so screen readers
        // announce additions reliably); individual toasts are plain children.
        <div
          className="toast toast-end toast-bottom z-[100]"
          role="status"
          aria-live="polite"
          aria-label="Notifications"
        >
          {toasts.map((t) => (
            <div key={t.id} className={`${ALERT_CLASS[t.kind]} text-sm shadow-lg`}>
              <span>{t.message}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
