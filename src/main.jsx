import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { bootChatStore } from './store/chatStore';
// Registers window.handleSend — imported for its side effect (module-scope
// `window.handleSend = handleSend` at chatFlow.js:941). Composer.jsx calls
// window.handleSend?.() on submit, same as the original vanilla wiring.
import './services/chatFlow.js';
// Registers window.renderHighchartInMessage / enhanceCodeBlocks /
// axiEnhanceCallouts / axiCopyCode — called by axi-message-thread-react.js.
import './services/messageRendering.js';
// Registers window.buildVectorIndexForDataset / window.searchVectorDB —
// called by axi-databin-core.js (dataset load) and transport.js's
// callOpenAI (per-query RAG narrowing) respectively. Imported explicitly
// (not pulled in transitively like chatExport/pdfExport) because
// buildVectorIndexForDataset can be called very early, as soon as a
// dataset loads — before any component would otherwise import this.
import './services/vectorSearch.js';

// App.jsx itself registers the messageThread/composer/databin notify hooks
// at module-eval time (same timing their old mount.jsx files used). Importing
// App below runs that registration before bootChatStore's initial notify()
// needs window.__axiNotifyThread to exist — so this ordering (import App,
// then boot) is load-bearing, not incidental.
bootChatStore();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// preview verification test
