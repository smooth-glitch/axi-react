import { formatServerMessage } from "../utils/serverMessageFormatter.js";

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div id="ember-toast-container" aria-live="polite" role="status">
      {toasts.map((t) => {
        // Defensive formatting: ensure any raw message or event is cleanly translated
        const formatted = formatServerMessage(t.text, t.error, {
          title: t.title,
          icon: t.icon,
          type: t.type,
        });

        const toastType = t.type || formatted.type || (t.error ? "error" : "success");
        const statusTitle = t.title || formatted.title || (t.error ? "Notice" : "Notice");
        const iconName = t.icon || formatted.icon || (t.error ? "error_outline" : "check_circle");
        const displayText = formatted.text || t.text;

        return (
          <div
            key={t.id}
            className={`sandesh-toast-popup ${toastType}`}
          >
            <div className="toast-icon-badge">
              <span className="material-icons">{iconName}</span>
            </div>
            <div className="toast-content">
              <span className="toast-title">{statusTitle}</span>
              <span className="toast-text">{displayText}</span>
            </div>
            {onDismiss && (
              <button
                type="button"
                className="toast-dismiss-btn"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

