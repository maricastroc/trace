"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type ToastAction = { label: string; onClick: () => void };
type ToastState = { id: number; message: string; action?: ToastAction };
type Show = (message: string, action?: ToastAction) => void;

const ToastContext = createContext<Show>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [paused, setPaused] = useState(false);

  const show = useCallback<Show>((message, action) => {
    setToast({ id: Date.now(), message, action });
  }, []);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? 8000 : 5200);
    return () => window.clearTimeout(timer);
  }, [toast, paused]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-4">
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex max-w-[min(560px,calc(100vw-32px))] items-center gap-3 rounded-xl bg-ink py-2.5 pr-2.5 pl-4 text-[14.5px] text-sheet shadow-[0_24px_48px_-24px_rgba(18,20,25,0.6)]"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 rounded-lg border border-white/30 px-2.5 py-1.5 text-[13.5px] font-semibold hover:bg-white/10"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                  setPaused(false);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
