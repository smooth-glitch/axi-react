export default function ToastContainer({ toasts }) {
  return (
    <div id="ember-toast-container" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.error ? " error" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
