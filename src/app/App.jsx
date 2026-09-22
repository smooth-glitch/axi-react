import { useCallback, useEffect, useRef, useState } from 'react';

import MessageThread from '../features/messageThread/components/MessageThread';
import { registerGlobalNotifyHook as registerMessageThreadNotifyHook } from '../features/messageThread/store';

import Composer from '../features/composer/components/Composer';
import { registerGlobalNotifyHook as registerComposerNotifyHook } from '../features/composer/store';

import DataBinWizard from '../features/databin/components/DataBinWizard';
import { registerGlobalRerenderHook as registerDataBinRerenderHook } from '../features/databin/store';
import { loadExistingDataBin, startNewDataBin as startNewDataBinData } from '../features/databin/logic';

import AdminDashboardShell from '../features/admin/components/AdminDashboardShell';
import '../features/admin/admin.css';

import ProviderSwitcher from '../features/providerSwitcher/components/ProviderSwitcher';

import TemplatesButton from '../features/promptTemplates/components/TemplatesButton';
import '../features/promptTemplates/templates.css';

import ExportButton from '../features/exportChat/components/ExportButton';
import '../features/exportChat/export.css';

import SystemPromptModal from '../features/systemPromptEditor/components/SystemPromptModal';
import { wireFileInput } from '../services/fileUpload';

// These two hooks used to be registered once by each feature's own mount.jsx
// at module-eval time (before this app owned a single root). Same timing
// here — called at module scope, not inside a component/effect.
registerMessageThreadNotifyHook();
registerComposerNotifyHook();
registerDataBinRerenderHook(); // window.renderDataPinModal = notify

// Faithful port of axibot/index.html's <body> (lines 271-1184) into one
// React tree. Six of the eight React feature "islands" that used to mount
// themselves into specific containers via their own createRoot() calls
// (messageThread, composer, databin, providerSwitcher, systemPromptEditor,
// admin) are rendered here as normal JSX children instead — their
// mount.jsx files are no longer the entry point (kept on disk, unused, in
// case the old per-feature IIFE build is still needed for the Axpert-Js-slot
// deployment path). promptTemplates and exportChat, which used to inject a
// button into .composerShell at a specific DOM position, are placed at
// that same position directly.
//
// axi-standalone-bridge.js / axi-foundation.js / axi-databin-services.js /
// axi-admin-services.js are NOT ported here — they stay exactly as they are
// today, loaded as plain global <script> tags before this bundle (see the
// deployment index.html), and everything below still reaches them via
// window.* reads, same as before.
export default function App() {
  // ── Data Bin wizard: used to be owned by databin/mount.jsx's own local
  // module state + its own createRoot(#dataBinPage). Now real React state
  // here, with window.openDataBinPage/closeDataBinPage/openExistingDataBin/
  // startNewDataBin still exposed for any other code that calls them by
  // name (e.g. the admin dashboard's "edit" action, the empty-state
  // "Create Data Bin" button).
  const [dataBinOpen, setDataBinOpen] = useState(false);
  const [dataBinStep, setDataBinStep] = useState(1);

  const closeDataBinPage = useCallback(() => {
    setDataBinOpen(false);
    document.body.style.overflow = '';
  }, []);

  // FIXED GAP: #fileInput's change handler lived only in script.js, which
  // this SPA doesn't load — the element existed but nothing listened for
  // it, so file upload silently did nothing (confirmed via live testing).
  // Note there is no visible UI trigger for this input in EITHER app —
  // #axiLoad, the only related button, is permanently display:none in the
  // original markup too — so this was already only reachable
  // programmatically, not a new gap introduced by not having a button.
  // See src/services/fileUpload.js for the ported handler.
  useEffect(() => wireFileInput(), []);

  useEffect(() => {
    const stepMap = { datasources: 1, files: 2, name: 3 };
    // The original also accepted a string step name ("datasources") from
    // one call site due to a load-order bug in the legacy vanilla code —
    // normalize both forms here deliberately (see databin/mount.jsx).
    window.openDataBinPage = function openDataBinPage(step = 1) {
      const s = typeof step === 'string' ? (stepMap[step] || 1) : (Number(step) || 1);
      setDataBinStep(s);
      setDataBinOpen(true);
      document.body.style.overflow = 'hidden';
    };
    window.closeDataBinPage = closeDataBinPage;
    window.openExistingDataBin = async function openExistingDataBin(id) {
      try {
        await loadExistingDataBin(id);
        window.openDataBinPage(1);
      } catch (err) {
        console.error('Failed to open existing Data Bin', err);
      }
    };
    window.startNewDataBin = async function startNewDataBinGlobal() {
      await startNewDataBinData();
      window.openDataBinPage(1);
    };
  }, [closeDataBinPage]);

  // ── System Prompt dialog: was wired by systemPromptEditor/mount.jsx via
  // plain getElementById + addEventListener after a separate createRoot()
  // call. Same wiring, now against a real React ref since the <dialog> is
  // part of this tree.
  const systemPromptDialogRef = useRef(null);
  const openSystemPromptRef = useRef(null); // set by SystemPromptModal itself

  useEffect(() => {
    const openBtn = document.getElementById('axiEditPromptBtn');
    const dialog = systemPromptDialogRef.current;
    if (!openBtn || !dialog) return undefined;
    function handleOpenClick() {
      openSystemPromptRef.current?.();
      dialog.showModal();
    }
    function handleBackdropClick(e) {
      if (e.target === dialog) dialog.close();
    }
    openBtn.addEventListener('click', handleOpenClick);
    dialog.addEventListener('mousedown', handleBackdropClick);
    return () => {
      openBtn.removeEventListener('click', handleOpenClick);
      dialog.removeEventListener('mousedown', handleBackdropClick);
    };
  }, []);

  // ── Global loader watchdog: window.showLoader/hideLoader (axi-databin-
  // core.js) toggle an 'is-active' class on #globalLoaderOverlay, with no
  // built-in timeout of their own. Several call sites (in the untouched
  // legacy files) show it, do async work, then hide it in a success path —
  // but at least one confirmed case (axi-databin-services.js's loadSavedPins
  // catch block) doesn't release it if that async work throws, leaving the
  // whole page stuck behind the overlay forever (reproduced via live testing
  // with real ARM credentials). Rather than patch every such call site
  // (spread across files we don't touch), this is a last-resort safety net:
  // if the overlay has been active for longer than any legitimate operation
  // should take, force it closed so the app is never permanently unusable,
  // regardless of which code path failed to clean up after itself.
  useEffect(() => {
    const loader = document.getElementById('globalLoaderOverlay');
    if (!loader) return undefined;
    const STUCK_TIMEOUT_MS = 12000;
    let timer = null;
    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    function armWatchdog() {
      clear();
      timer = setTimeout(() => {
        if (loader.classList.contains('is-active')) {
          console.warn('[App] Global loader was stuck active for', STUCK_TIMEOUT_MS, 'ms — force-hiding it.');
          loader.classList.remove('is-active');
        }
      }, STUCK_TIMEOUT_MS);
    }
    const observer = new MutationObserver(() => {
      if (loader.classList.contains('is-active')) armWatchdog();
      else clear();
    });
    observer.observe(loader, { attributes: true, attributeFilter: ['class'] });
    if (loader.classList.contains('is-active')) armWatchdog();
    return () => { observer.disconnect(); clear(); };
  }, []);

  // ── Deferred legacy scripts: axi-databin-core.js, axi-databin-extras.js,
  // axi-ui-polish.js, and axi-push-to-tstruct.js each have a
  // document.readyState-gated boot routine that queries static markup (e.g.
  // #provider, #dataBinNameInput) assuming it already exists — true in the
  // old hybrid page (all-static HTML), not true here (index.html ships only
  // <div id="root">). Loading them as plain <script> tags in <head> means
  // they'd run and null-ref before this component's first render commits
  // the markup they need. Instead they're not referenced in index.html at
  // all — injected here, sequentially (same relative order the old
  // index.html loaded them in, since later ones may read globals the
  // earlier ones set), only after this component's own JSX has mounted.
  useEffect(() => {
    // Guard against React StrictMode's dev-only double-invoke of effects —
    // these scripts bind event listeners and run boot-time side effects that
    // aren't safe to run twice (production only mounts once regardless).
    //
    // FIXED BUG: this used to also honor a `cancelled` flag set true by this
    // effect's own cleanup (StrictMode's synthetic mount -> cleanup -> mount
    // sequence runs the cleanup almost immediately after the first mount).
    // That flag was checked inside the recursive loadNext(), so the very
    // first synthetic cleanup halted the chain after whichever script
    // happened to be loading at that instant — and since the
    // window._axiLegacyScriptsLoading guard above already prevented the
    // second (real) mount from starting a fresh chain, the rest of the
    // scripts silently never loaded, ever. Confirmed via live testing with
    // real ARM credentials: axi-databin-core.js loaded but
    // axi-databin-extras.js never did, so
    // window.syncSavedPinsDropdownSelection stayed undefined for the entire
    // session, and window.__axiLegacyScriptsReady never got set. There's
    // nothing here that actually needs cancelling on unmount — this is a
    // one-time, page-lifetime side effect gated by the window flag, not
    // per-mount state — so cleanup no longer aborts the chain.
    if (window._axiLegacyScriptsLoading) return undefined;
    window._axiLegacyScriptsLoading = true;
    const legacyScripts = [
      '/axi-databin-core.js',
      '/axi-databin-extras.js',
      '/axi-ui-polish.js',
      '/axi-push-to-tstruct.js',
    ];
    function loadNext(i) {
      if (i >= legacyScripts.length) {
        // All four loaded. axi-databin-core.js's OWN boot (not something we
        // control — it's inside one of the untouched legacy files) calls
        // window.loadSavedPins() internally, on its own timing, which can
        // race ahead of axi-databin-extras.js finishing (loadSavedPins ->
        // setActiveDataBin -> syncSavedPinsDropdownSelection, a plain global
        // only axi-databin-extras.js defines) since core.js started loading
        // — and its own internal boot call fired — before extras.js even
        // began. Confirmed via live testing with real ARM credentials: that
        // race threw a ReferenceError, and axi-databin-services.js's own
        // catch block for loadSavedPins doesn't release the global loading
        // overlay on failure, leaving it stuck. Re-triggering loadSavedPins
        // here, now that every legacy script is guaranteed loaded, self-
        // heals the saved-pins UI regardless of how that first internal
        // attempt went — cheap and idempotent (it just re-renders the
        // dropdown), not a fix to the underlying file itself.
        window.__axiLegacyScriptsReady = true;
        window.loadSavedPins?.().catch(() => {});
        return;
      }
      const script = document.createElement('script');
      script.src = legacyScripts[i];
      script.onload = () => loadNext(i + 1);
      script.onerror = () => {
        console.error('[App] Failed to load legacy script:', legacyScripts[i]);
        loadNext(i + 1);
      };
      document.body.appendChild(script);
    }
    loadNext(0);
  }, []);

  // ── Admin dashboard: was gated + booted by admin/mount.jsx's boot()
  // (only admins get any UI at all; buildUserPanel, the non-admin path, was
  // dead code in the original and is deliberately not revived here either).
  //
  // FIXED BUG: this used to be a single one-shot setTimeout(check, 2400),
  // faithfully ported from the original admin/mount.jsx. That timing was
  // calibrated for real Axpert, where the platform already knows the
  // user's identity when this page loads (the user is already logged into
  // Axpert as a whole) — AxiAdminService.getUser() resolves almost
  // immediately, and 2400ms was just "give other scripts a moment to
  // init." In standalone mode (axi-standalone-bridge.js) there is no
  // pre-existing session: the user must type credentials into an
  // interactive sign-in form first, which realistically takes much longer
  // than 2.4s. The one-shot check fired before sign-in completed, found no
  // admin user, and never checked again — so the admin dashboard was
  // reliably broken for every standalone sign-in. Confirmed via live
  // testing with real ARM credentials. Now polls every 800ms (capped at
  // 60 tries / ~48s) until AxiAdminService reports a signed-in admin,
  // instead of checking exactly once.
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    function checkIsAdmin() {
      if (cancelled) return;
      tries += 1;
      const user = window.AxiAdminService?.getUser?.();
      if (user?.isAdmin) {
        setIsAdmin(true);
      } else if (tries < 60) {
        setTimeout(checkIsAdmin, 800);
        return;
      }

      if (!window._axiAdmClosePatch) {
        (function patchClose() {
          if (window._axiAdmClosePatch) return;
          if (typeof window.closeDataBinPage !== 'function') { setTimeout(patchClose, 200); return; }
          window._axiAdmClosePatch = true;
          const orig = window.closeDataBinPage;
          window.closeDataBinPage = function () {
            orig.apply(this, arguments);
            if (typeof window._axiAdmOnClose === 'function') {
              const cb = window._axiAdmOnClose;
              window._axiAdmOnClose = null;
              cb();
            }
          };
        })();
      }
    }
    checkIsAdmin();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="app">
        <main className="main">
          {/* Invisible hover-trigger: mousing over the top 10px of the page reveals the header */}
          <div className="globalBar-trigger" aria-hidden="true" />

          {/* 1. Global Logo Header (Slim, sticky top) */}
          <header className="globalBar">
            <div className="globalBar__inner">
              <div className="globalBrand" role="banner" aria-label="Axi AI">
                <span className="globalBrandWordmark">
                  <span className="globalBrandWordmark-main">Axi</span>
                  <span className="globalBrandWordmark-accent">AI</span>
                </span>
              </div>

              <div className="fileBar">
                <div className="actionGroup">
                  <button id="axiLoad" className="miniBtn" type="button" title="Analyze" style={{ display: 'none' }}>
                    <span className="material-icons">analytics</span>
                    <span>Analyze</span>
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Data Bin wizard — entirely owned by DataBinWizard (mirrors the
              original #dataBinPage markup internally, including the header/
              tabs/panels/selection rail), so nothing else needs to be
              reproduced here. */}
          <section id="dataBinPage" className="dataBinPage" aria-labelledby="dataBinNameInput" hidden={!dataBinOpen}>
            {dataBinOpen && (
              <DataBinWizard step={dataBinStep} onStepChange={setDataBinStep} onClose={closeDataBinPage} />
            )}
          </section>

          {/* 2. Ask View (Main Page) */}
          <section id="view-ask" className="view isActive" style={{ display: 'block', position: 'relative' }}>
            {/* Empty state overlay — lives outside #messages so the message-thread
                re-render cannot destroy it. Hidden by default. */}
            <div id="axiEmptyState" className="axi-es" style={{ display: 'none' }}>
              <div className="axi-es__card">
                <div className="axi-es__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <h2 className="axi-es__title">No data bins yet</h2>
                <p className="axi-es__sub">Create a Data Bin to connect your datasources, then start asking questions.</p>
                <div className="axi-es__actions">
                  <button className="axi-es__btn axi-es__btn--primary" id="axiEsCreateBin" type="button" onClick={() => window.startNewDataBin?.()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Create Data Bin
                  </button>
                  <button className="axi-es__btn axi-es__btn--ghost" id="axiEsConnectAI" type="button" style={{ display: 'none' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    Connect AI
                  </button>
                </div>
              </div>
            </div>

            {/* Welcome screen */}
            <div id="axi-home-screen">
              <h2 className="axi-home-greeting" id="axiHomeGreeting">
                <span id="axiGreetTyped" /><span className="axi-type-cursor" id="axiCursor" />
              </h2>
              <div className="axi-home-divider" id="axiHomeDivider" />
              <div id="axiHomeSubs" className="axi-home-subs">
                <p className="axi-home-sub" id="axiSub1" />
                <p className="axi-home-sub" id="axiSub2" />
              </div>
            </div>

            {/* Messages Area — entirely owned by MessageThread */}
            <div id="messages" className="messages">
              <MessageThread />
            </div>

            <button id="scrollDownBtn" aria-label="Scroll to bottom">
              <span id="axiScrollBadge" className="axi-scroll-badge" style={{ display: 'none' }}>0</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              Scroll to bottom
            </button>

            {/* Floating Composer (Bottom) */}
            <div className="composerWrap">
              <div id="typing" className="typing typing--hidden" aria-hidden="true">
                <div className="typing__dot" />
                <div className="typing__dot" />
                <div className="typing__dot" />
              </div>

              <div className="composerShell">
                {/* TemplatesButton moved to #axiTemplatesCtrl in the AI
                    CONTROLS row — see that div's comment for why. */}

                <div className="axiComposerCard">
                  <button type="button" id="axiCtrlToggle" className="axiCtrlToggle" title="Toggle controls row">
                    <span className="axiCtrlToggle__label">AI Controls</span>
                    <svg className="axiCtrlToggle__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <div id="axiCtrlRowWrap" className="axiCtrlRowWrap">
                    <div className="axiControlsRow">
                      <div className="axiCtrl" id="axiProviderCtrl">
                        <span className="axiCtrl__label">AI Provider</span>
                        {/* Entirely owned by ProviderSwitcher (button + logo + panel) */}
                        <div id="axiProviderWrap" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                          <ProviderSwitcher />
                        </div>
                      </div>

                      <div className="axiCtrl" id="axiDataBinCtrl">
                        <span className="axiCtrl__label">Data Bin</span>
                        <div className="select-wrapper custom-select-wrapper" id="savedPinsWrapper" style={{ display: 'none' }}>
                          <div className="custom-select-trigger" id="savedPinsTrigger" tabIndex={0} title="Select Data Bin">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <ellipse cx="12" cy="5" rx="9" ry="3" />
                              <path d="M3 5v4c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                              <path d="M3 9v4c0 1.66 4 3 9 3s9-1.34 9-3V9" />
                              <path d="M3 13v4c0 1.66 4 3 9 3s9-1.34 9-3v-4" />
                            </svg>
                            <span className="custom-select-value" id="savedPinsValue" title="No Data Bin selected">Load Pin...</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>
                          <div className="custom-options-container">
                            <div className="savedPins-search-wrap" id="savedPinsSearchWrap">
                              <svg className="savedPins-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                              </svg>
                              <input type="text" id="savedPinsSearch" className="savedPins-search-input" placeholder="Search bins…" autoComplete="off" spellCheck="false" />
                            </div>
                            <ul id="savedPinsList" className="custom-options-list" />
                          </div>
                        </div>
                        {/* Shown in place of the dropdown when no bins exist. */}
                        <button id="axiCtrlCreateBin" type="button" className="axiCtrl-create-bin-btn" style={{ display: 'none' }} title="No Data Bins yet — click to create one" onClick={() => window.startNewDataBin?.()}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          Create
                        </button>
                      </div>

                      <div className="axiCtrl" id="axiTemplatesCtrl" style={{ overflow: 'visible' }}>
                        <span className="axiCtrl__label">Templates</span>
                        {/* FIXED: this slot was left empty on an earlier pass
                            based on a stale comment in axi-databin-extras.js
                            ("dashboard.html JS" injects #axiTplBtnNew here) —
                            turns out that's this app's OWN vanilla-JS
                            "AXI PATCH v3" section, not an unrelated feature,
                            and its injection (gated behind loadUserTemplates()
                            resolving) doesn't reliably fire. Meanwhile
                            TemplatesButton was rendering into a DIFFERENT
                            location (.composerShell, id="axiTplBtn") that
                            styles.css deliberately hides via a later
                            `#axiTplBtn { display: none !important; }` rule —
                            added when the vanilla injection was supposed to
                            take over this slot. Net effect, found via live
                            testing with real ARM credentials: Prompt
                            Templates was completely unreachable. Fixed by
                            rendering the same component here instead, with a
                            new id (axiTplBtnReact, see styles.css) that isn't
                            caught by that hide rule. */}
                        <TemplatesButton />
                      </div>

                      <div className="axiCtrl" id="axiEditPromptCtrl">
                        <span className="axiCtrl__label">Prompt</span>
                        <button id="axiEditPromptBtn" type="button" className="axiCtrlBtn" title="Edit System Prompt">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
                          </svg>
                          <span className="axiCtrlBtn__label">Edit Prompt</span>
                          <svg className="axiCtrlBtn__chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      </div>

                      <div className="axiCtrl" id="axiAdminCtrl">
                        <span className="axiCtrl__label">Admin</span>
                        {/* AdminDashboardShell renders its own reopen button
                            elsewhere in this tree (see below) rather than
                            being DOM-relocated into this div, unlike the
                            legacy #adm-reopen-btn move — flagged for review. */}
                      </div>
                    </div>
                    {/* File chips — populated by window.renderFilePills() (axi-foundation.js, unchanged) */}
                    <div id="axiFilePills" style={{ display: 'none' }} />
                  </div>

                  <div className="axiInputRow">
                    <form
                      id="composer"
                      className="composer"
                      autoComplete="off"
                      style={{ flex: 1, minWidth: 0 }}
                      onSubmit={(e) => { e.preventDefault(); window.handleSend?.(); }}
                    >
                      <Composer />
                    </form>
                  </div>
                </div>

                {/* Was appended to the end of .composerShell by exportChat/mount.jsx */}
                <ExportButton />
              </div>
            </div>

            {/* Hidden Ghost Elements (Required for the ported chat/session logic) */}
            <div style={{ display: 'none' }} aria-hidden="true">
              <button id="historyBtn" />
              <div id="historyPopover">
                <button id="closeHistory" />
                <div id="chatList" />
                <button id="newChatFromHistory" />
              </div>
              <button id="newChat" title="New Chat (Ctrl+K)" />
              <button id="reset" />
              <input type="file" id="fileInput" multiple accept=".csv,.xlsx,.xls,.txt,.pdf,.docx,.json" />
            </div>

            {/* Token Savings Badge */}
            <div
              id="axiTokenBadge"
              title="Tokens saved by Vector DB filtering this session"
              style={{
                display: 'none', alignItems: 'center', gap: 5, padding: '4px 10px',
                background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 999,
                fontSize: 12, fontWeight: 600, color: '#15803d', cursor: 'default',
                userSelect: 'none', whiteSpace: 'nowrap',
              }}
            >
              <span className="material-icons" style={{ fontSize: 14, color: '#22c55e' }}>bolt</span>
              <span id="axiTokenBadgeText">0 tokens saved</span>
            </div>
          </section>
        </main>
      </div>

      <div id="globalLoaderOverlay" className="is-active">
        <div className="axi-loader-card">
          <div className="axi-loader-orb" />
        </div>
      </div>

      {/* Admin Dashboard — used to self-append its own container to
          document.body and gate on isAdmin inside boot(); same gate, now a
          normal conditional render. */}
      {isAdmin && <AdminDashboardShell />}

      {/* System Prompt dialog — entirely owned by SystemPromptModal */}
      <dialog id="systemPromptModal" className="axiModal" aria-labelledby="systemPromptTitle" ref={systemPromptDialogRef}>
        <SystemPromptModal dialogRef={systemPromptDialogRef} openRef={openSystemPromptRef} />
      </dialog>
      {/* Hidden trigger kept for parity with the legacy initSystemPromptEditor() binding */}
      <button id="openSystemPrompt" type="button" aria-hidden="true" tabIndex={-1} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }} />

      <dialog id="connectModal" className="axiModal" aria-labelledby="connectTitle">
        <div className="axcn">
          <div className="axcn__head">
            <div className="axcn__headLeft">
              <span className="axcn__headIcon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
              <div>
                <h2 id="connectTitle" className="axcn__title">Connect Provider</h2>
                <p className="axcn__sub">Link your API key to power AXI</p>
              </div>
            </div>
            <button className="axModal__x" type="button" data-close="connectModal" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="axcn__body">
            <label className="axModal__label">Provider</label>
            <div className="axcn__grid">
              <label className="axcn__card">
                <input type="radio" name="axiProvider" value="openai" className="axcn__radio" />
                <div className="axcn__cardInner">
                  <span className="axcn__logo axcn__logo--openai">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
                    </svg>
                  </span>
                  <span className="axcn__cardName">OpenAI</span>
                  <span className="axcn__check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></span>
                </div>
              </label>

              <label className="axcn__card">
                <input type="radio" name="axiProvider" value="gemini" className="axcn__radio" />
                <div className="axcn__cardInner">
                  <span className="axcn__logo axcn__logo--gemini">
                    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 24A12 12 0 0 1 12 0a12 12 0 0 1 0 24zm0-9.173-3.84 3.84a8.464 8.464 0 0 0 3.84.906 8.464 8.464 0 0 0 3.84-.906zm-5.013-1.174-.001.001A8.484 8.484 0 0 0 8.332 18.84L12 15.172l3.668 3.669a8.484 8.484 0 0 0 1.346-1.188L12 14.827l-5.013 3.826zm-.653-1.005L12 10.828l5.666 3.02A8.52 8.52 0 0 0 20.485 12 8.485 8.485 0 0 0 12 3.515 8.485 8.485 0 0 0 3.515 12a8.52 8.52 0 0 0 2.819 3.648z" fill="#4285F4" />
                    </svg>
                  </span>
                  <span className="axcn__cardName">Gemini</span>
                  <span className="axcn__check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></span>
                </div>
              </label>

              <label className="axcn__card">
                <input type="radio" name="axiProvider" value="openrouter" className="axcn__radio" />
                <div className="axcn__cardInner">
                  <span className="axcn__logo axcn__logo--openrouter">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </span>
                  <span className="axcn__cardName">OpenRouter</span>
                  <span className="axcn__check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></span>
                </div>
              </label>
            </div>

            {/* hidden select for JS compat */}
            <select id="provider" style={{ display: 'none' }} aria-hidden="true" defaultValue="openai">
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>

            <label className="axModal__label" style={{ marginTop: 18 }} htmlFor="apiKey">API Key</label>
            <div className="axcn__keyWrap">
              <svg className="axcn__keyIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <input type="password" id="apiKey" className="axcn__keyInput" placeholder="Paste your API key…" autoComplete="off" spellCheck="false" />
              <button type="button" className="axcn__eyeBtn" id="axcnToggleKey" aria-label="Toggle key visibility">
                <svg id="axcnEyeShow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg id="axcnEyeHide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'none' }}>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
            </div>

            <button id="connectBtn" className="axModal__btn axModal__btn--primary axcn__submitBtn" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span id="connectBtnLabel">Verify &amp; Connect</span>
            </button>

            <div id="status" className="axModal__status" style={{ display: 'none' }} />
          </div>
        </div>
      </dialog>

      {/* Shown when the user selects a provider with no saved key.
          JS sets the logo, title, and help link before showModal(). */}
      <dialog id="axiProviderKeyModal" className="axiModal" aria-labelledby="apkTitle">
        <div className="axcn">
          <div className="axcn__head">
            <div className="axcn__headLeft">
              <span className="apk__logo" id="apkLogo" />
              <div>
                <h2 id="apkTitle" className="axcn__title">Connect Provider</h2>
                <p className="axcn__sub" id="apkSub">Paste your API key to activate</p>
              </div>
            </div>
            <button className="axModal__x" type="button" id="apkClose" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="axcn__body">
            <label className="axModal__label" htmlFor="apkKeyInput">API Key</label>
            <div className="axcn__keyWrap">
              <svg className="axcn__keyIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <input type="password" id="apkKeyInput" className="axcn__keyInput" placeholder="Paste your API key…" autoComplete="off" spellCheck="false" />
              <button type="button" className="axcn__eyeBtn" id="apkEyeBtn" aria-label="Toggle key visibility">
                <svg id="apkEyeShow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg id="apkEyeHide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'none' }}>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
            </div>

            <div className="apk__getKeyRow">
              <a className="apk__getKeyLink" id="apkGetKeyLink" href="#" target="_blank" rel="noopener">
                Get API key
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </svg>
              </a>
            </div>

            <button id="apkConnectBtn" className="axModal__btn axModal__btn--primary axcn__submitBtn" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span id="apkConnectBtnLabel">Verify &amp; Connect</span>
            </button>

            <div id="apkStatus" className="axModal__status" style={{ display: 'none' }} />
          </div>
        </div>
      </dialog>

      {/* Shown on first load when no key exists for this user. */}
      <dialog id="axiKeySetupModal" className="axiModal" aria-labelledby="axiKeySetupTitle">
        <div className="axcn">
          <div className="axcn__head">
            <div className="axcn__headLeft">
              <span className="axcn__headIcon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
              <div>
                <h2 id="axiKeySetupTitle" className="axcn__title">Connect your AI</h2>
                <p className="axcn__sub">Choose a provider and paste your API key to get started</p>
              </div>
            </div>
            <button className="axModal__x" type="button" id="axiSetupCloseBtn" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="axcn__body">
            <label className="axModal__label">Provider</label>
            <div className="axcn__grid">
              <label className="axcn__card">
                <input type="radio" name="axiSetupProvider" value="openai" className="axcn__radio" defaultChecked />
                <div className="axcn__cardInner">
                  <span className="axcn__logo axcn__logo--openai">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
                    </svg>
                  </span>
                  <span className="axcn__cardName">OpenAI</span>
                  <span className="axcn__check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></span>
                </div>
              </label>
              <label className="axcn__card">
                <input type="radio" name="axiSetupProvider" value="gemini" className="axcn__radio" />
                <div className="axcn__cardInner">
                  <span className="axcn__logo axcn__logo--gemini">
                    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 24A12 12 0 0 1 12 0a12 12 0 0 1 0 24zm0-9.173-3.84 3.84a8.464 8.464 0 0 0 3.84.906 8.464 8.464 0 0 0 3.84-.906zm-5.013-1.174-.001.001A8.484 8.484 0 0 0 8.332 18.84L12 15.172l3.668 3.669a8.484 8.484 0 0 0 1.346-1.188L12 14.827l-5.013 3.826zm-.653-1.005L12 10.828l5.666 3.02A8.52 8.52 0 0 0 20.485 12 8.485 8.485 0 0 0 12 3.515 8.485 8.485 0 0 0 3.515 12a8.52 8.52 0 0 0 2.819 3.648z" fill="#4285F4" />
                    </svg>
                  </span>
                  <span className="axcn__cardName">Gemini</span>
                  <span className="axcn__check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></span>
                </div>
              </label>
              <label className="axcn__card">
                <input type="radio" name="axiSetupProvider" value="openrouter" className="axcn__radio" />
                <div className="axcn__cardInner">
                  <span className="axcn__logo axcn__logo--openrouter">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                  </span>
                  <span className="axcn__cardName">OpenRouter</span>
                  <span className="axcn__check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg></span>
                </div>
              </label>
            </div>

            <label className="axModal__label" style={{ marginTop: 18 }} htmlFor="axiSetupKeyInput">API Key</label>
            <div className="axcn__keyWrap">
              <svg className="axcn__keyIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <input id="axiSetupKeyInput" type="password" className="axcn__keyInput" placeholder="Paste your API key…" autoComplete="off" spellCheck="false" />
              <button id="axiSetupKeyToggle" className="axcn__eyeBtn" type="button" aria-label="Toggle key visibility">
                <svg id="axiSetupEyeShow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg id="axiSetupEyeHide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'none' }}>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
            </div>

            <button id="axiSetupSaveBtn" className="axModal__btn axModal__btn--primary axcn__submitBtn" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span id="axiSetupBtnLabel">Verify &amp; Connect</span>
            </button>

            <div id="axiSetupStatus" className="axModal__status" style={{ display: 'none', marginTop: 12 }} />
          </div>
        </div>
      </dialog>

      <dialog id="uploadModal" className="axiModal" aria-labelledby="uploadTitle">
        <div className="axiModal__inner">
          <button className="axiModal__close" type="button" data-close="uploadModal" aria-label="Close">
            <span className="material-icons">close</span>
          </button>

          <h2 id="uploadTitle" className="axiModal__title" style={{ marginBottom: 14 }}>Upload files</h2>

          <div className="uploadStage" style={{ minHeight: 'auto', padding: 0, display: 'block' }}>
            <div id="dropzone" className="dropzone" tabIndex={0} role="button" aria-label="Upload files" style={{ width: '100%', height: 320, background: '#F8FAFC', border: '2px dashed #E2E8F0', boxShadow: 'none' }}>
              <span className="srOnly">Click or drag and drop files to upload</span>
              <span className="material-icons uploadIcon" aria-hidden="true" style={{ fontSize: 64 }}>cloud_upload</span>
              <div>
                <div className="uploadText">Click or Drag files to upload</div>
                <div className="uploadSubText">Supports CSV, XLSX, JSON</div>
              </div>
              <input id="picker" type="file" multiple accept=".csv,.xlsx,.xls,.txt,.pdf,.docx,.json" hidden />
            </div>
          </div>
        </div>
      </dialog>

      {/* Full-screen overlay that renders the Axpert SmartViewTableController
          with data converted from an AI chat response. Opened by
          axiShowInSmartList(); closed by the close button below. */}
      <div id="axiSmartListPanel" style={{ display: 'none' }}>
        <div className="axi-sl-modal">
          <div className="axi-sl-header">
            <span className="axi-sl-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="9" x2="9" y2="21" />
              </svg>
              Smart List
            </span>
            <button
              className="axi-sl-close"
              title="Close"
              onClick={() => {
                window.axiDestroySmartList?.();
                const panel = document.getElementById('axiSmartListPanel');
                if (panel) panel.style.display = 'none';
              }}
            >
              &#x2715;
            </button>
          </div>
          <div id="axiSmartListContainer" />
        </div>
      </div>
    </>
  );
}
