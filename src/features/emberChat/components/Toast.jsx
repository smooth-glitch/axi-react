export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div id="ember-toast-container" aria-live="polite" role="status">
      {toasts.map((t) => {
        const isError = Boolean(t.error);
        const lower = (t.text || "").toLowerCase();
        const isOffline = lower.includes("online") || lower.includes("disconnect");
        const isDelete = lower.includes("deleted");
        const isAdd = lower.includes("added") || lower.includes("created");

        let iconName = "notifications";
        let statusTitle = "Notification";

        if (isError) {
          if (isOffline) {
            iconName = "cloud_off";
            statusTitle = "Presence Status";
          } else {
            iconName = "error_outline";
            statusTitle = "Alert";
          }
        } else if (isDelete) {
          iconName = "delete_outline";
          statusTitle = "Updated";
        } else if (isAdd) {
          iconName = "person_add";
          statusTitle = "Success";
        } else {
          iconName = "check_circle";
          statusTitle = "Notice";
        }

        return (
          <div
            key={t.id}
            className={`sandesh-toast-popup ${isError ? "error" : "success"}`}
          >
            <div className="toast-icon-badge">
              <span className="material-icons">{iconName}</span>
            </div>
            <div className="toast-content">
              <span className="toast-title">{statusTitle}</span>
              <span className="toast-text">{t.text}</span>
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
