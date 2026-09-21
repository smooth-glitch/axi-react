import { createRoot } from 'react-dom/client';
import TemplatesButton from './components/TemplatesButton';
import './templates.css';

// Replaces AXIPromptTemplates' injectButton() (script.js ~10953-10985). The
// original placed its wrapper either right after .axi-insights-wrap or at
// the front of .composerShell — create that anchor node with the same
// placement logic, then mount a React root directly on it (no portal needed
// since the anchor IS the desired location).
function boot() {
  if (document.getElementById('axiTplBtn')) return;
  const shell = document.querySelector('.composerShell');
  if (!shell) return;

  const anchor = document.createElement('span');
  const insightsWrap = document.querySelector('.axi-insights-wrap');
  if (insightsWrap?.parentElement === shell) {
    insightsWrap.insertAdjacentElement('afterend', anchor);
  } else {
    shell.insertBefore(anchor, shell.firstChild);
  }

  createRoot(anchor).render(<TemplatesButton />);
  console.info('[AXI Prompt Templates] React version loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1400));
} else {
  setTimeout(boot, 1400);
}
