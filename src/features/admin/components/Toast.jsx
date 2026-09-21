export default function Toast({ state }) {
  return (
    <div id="adm-toast" className={state?.show ? 'adm-toast-show' : ''} style={{ background: state?.isErr ? 'var(--error,#DC2626)' : '#0F172A' }}>
      {!state?.isErr && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
      )}
      <span>{state?.msg || ''}</span>
    </div>
  );
}
