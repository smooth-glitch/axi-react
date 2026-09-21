import { createRoot } from 'react-dom/client';
import ProviderSwitcher from './components/ProviderSwitcher';

// Replaces AXIProviderSwitcher's init() (script.js ~10930-10964). Mounts
// directly onto the existing #axiProviderWrap element (static markup in
// index.html), replacing its children with the React-rendered equivalent.
function boot() {
  const wrap = document.getElementById('axiProviderWrap');
  if (!wrap) return;
  wrap.innerHTML = ''; // clear the static button/panel markup before mounting
  createRoot(wrap).render(<ProviderSwitcher />);
  console.info('[AXI Provider Switcher] React version loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 1200));
} else {
  setTimeout(boot, 1200);
}
