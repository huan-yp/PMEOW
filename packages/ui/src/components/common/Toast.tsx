import { useStore } from '../../store/useStore.js';

const typeStyles = {
  info: 'border-accent-blue bg-accent-blue/10',
  success: 'border-accent-green bg-accent-green/10',
  warning: 'border-accent-yellow bg-accent-yellow/10',
  error: 'border-accent-red bg-accent-red/10',
};

const typeIcons = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

export function ToastContainer() {
  const { toasts, dismissToast } = useStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`border-l-4 rounded-lg p-3 shadow-lg backdrop-blur-sm animate-in slide-in-from-right ${typeStyles[toast.type]}`}
          style={{ backgroundColor: 'rgba(17, 24, 39, 0.95)' }}
        >
          <div className="flex items-start gap-2">
            <span className="text-sm mt-0.5">{typeIcons[toast.type]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200">{toast.title}</p>
              <p className="text-xs text-slate-400 mt-0.5 break-words">{toast.body}</p>
              {toast.type === 'warning' && toast.onAction && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.onAction!();
                    dismissToast(toast.id);
                  }}
                  className="mt-1.5 px-2 py-0.5 text-xs border border-accent-yellow/30 text-accent-yellow rounded hover:bg-accent-yellow/10 transition-colors"
                >
                  忽略一周
                </button>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-slate-500 hover:text-slate-300 text-sm leading-none"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
