// Ported from _provLogo/_provLabel/_provClass (core.js:492-501) + provChip
// (core.js:447-450). Brand-accurate SVG logos kept verbatim.
const LABELS = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', openrouter: 'OpenRouter' };

function ProviderLogo({ provider }) {
  if (provider === 'openai') return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22.07 9.5a6.09 6.09 0 0 0-.52-5 6.18 6.18 0 0 0-6.65-2.96A6.09 6.09 0 0 0 10.28 0a6.18 6.18 0 0 0-5.9 4.28 6.09 6.09 0 0 0-4.07 2.96 6.18 6.18 0 0 0 .76 7.26 6.09 6.09 0 0 0 .52 5 6.18 6.18 0 0 0 6.65 2.96A6.09 6.09 0 0 0 13.72 24a6.18 6.18 0 0 0 5.9-4.29 6.09 6.09 0 0 0 4.07-2.96 6.18 6.18 0 0 0-.76-7.25zm-9.07 12.7a4.57 4.57 0 0 1-2.94-1.07l.14-.08 4.88-2.82a.8.8 0 0 0 .4-.69V11.1l2.06 1.19a.07.07 0 0 1 .04.06v5.7a4.6 4.6 0 0 1-4.58 4.58zm-9.86-4.22a4.57 4.57 0 0 1-.55-3.07l.15.09 4.87 2.81a.8.8 0 0 0 .8 0l5.95-3.44v2.37a.07.07 0 0 1-.03.06L9.46 19.9a4.6 4.6 0 0 1-6.32-1.91zm-1.28-10.6a4.57 4.57 0 0 1 2.4-2.01v5.8a.8.8 0 0 0 .4.69l5.95 3.44-2.06 1.19a.07.07 0 0 1-.07 0L4.1 13.45a4.6 4.6 0 0 1-.46-6.07zm16.94 3.95-5.95-3.44 2.06-1.19a.07.07 0 0 1 .07 0l4.39 2.54a4.6 4.6 0 0 1-.71 8.3V11.6a.8.8 0 0 0-.4-.69zm2.05-3.08-.15-.09-4.87-2.81a.8.8 0 0 0-.8 0L9.08 9.6V7.23a.07.07 0 0 1 .03-.06l4.38-2.53a4.6 4.6 0 0 1 6.36 1.93zm-12.9 4.24L5.89 11.3a.07.07 0 0 1-.04-.06V5.54A4.6 4.6 0 0 1 13.4 3.2l-.14.08-4.88 2.82a.8.8 0 0 0-.4.69v6.88zm1.12-2.41 2.65-1.53 2.65 1.53v3.06l-2.65 1.53-2.65-1.53V10.1z"/></svg>
  );
  if (provider === 'anthropic') return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.38 2.93h-3.32L4.45 21.07h3.3l1.46-4.15h6.57l1.47 4.15h3.3L14.38 2.93zm-4.3 11.54 2.64-7.44 2.63 7.44H10.08z"/></svg>
  );
  if (provider === 'gemini') return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2C9.5 8.5 2 9.5 2 12c0 2.5 7.5 3.5 10 10 2.5-6.5 10-7.5 10-10C22 9.5 14.5 8.5 12 2z" fill="currentColor" /></svg>
  );
  if (provider === 'openrouter') return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="18" cy="5" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="18" cy="19" r="2" /><path d="M8 12h7l-2.5-2.5M15 12l-2.5 2.5" /></svg>
  );
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>;
}

export default function ProviderBadge({ provider }) {
  const cls = { openai: 'adm-prov-openai', anthropic: 'adm-prov-anthropic', gemini: 'adm-prov-gemini', openrouter: 'adm-prov-openrouter' }[provider] || 'adm-prov-openai';
  return (
    <span className={`adm-prov-badge ${cls}`}>
      <ProviderLogo provider={provider} />
      {LABELS[provider] || provider || 'Unknown'}
    </span>
  );
}

export { LABELS as PROVIDER_LABELS };
