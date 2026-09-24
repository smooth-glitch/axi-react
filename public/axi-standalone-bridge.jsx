/* ============================================================
   SANDESH STANDALONE BRIDGE
   Lets this app run and be tested as a normal top-level web page (its own
   tab, no Axpert iframe) until Axpert's own React-hosting support ships.
   Every existing service file in this project (axi-databin-core.js,
   axi-databin-services.js, axi-admin-services.js, script.js) already resolves
   its Axpert bridge functions with the same pattern:
       typeof parent[name] === 'function' ? parent[name] : window[name]
   In a normal top-level page (not inside an iframe), `parent === window` —
   so simply defining these functions on `window`, before any other script
   runs, makes every existing `parent.X` call site in the whole app resolve
   to the implementations below with ZERO changes to those files. When this
   page IS embedded in Axpert (parent !== window and the host's real
   GetDataFromAxList exists), this file detects that and does nothing at all.

   Must be the FIRST <script> tag in index.html, before axi-foundation.js.

   ── CONFIG ───────────────────────────────────────────────────────────
   AXI_ARM_BASE_URL: https://agile.axi-global.com/ARM_API
   AXI_ARM_PROJECT:  erpdemo
   (Same host as the handbook's own worked example, different appname —
   this deployment apparently hosts multiple Axpert projects behind the
   same ARM gateway; erpdev in the handbook was a different project's.)

   ── WHAT WORKS / WHAT DOESN'T ──────────────────────────────────────────
   Reads (fetchADSData → GetDataFromAxList → the AxList REST endpoint) work
   fully. Writes (AxSetValue/AxSubmitData/AxCallScriptAPIAsync — saving a
   Data Bin, an RBAC assignment, deleting either) do NOT: the ARM API
   Handbook this bridge is built from only documents Signin/AxList/AxGet
   (all reads). Calling a write here throws/reports a clear
   "not available outside Axpert" error instead of silently failing or
   corrupting state — this is a deliberate, documented gap, not an oversight.
   Everything that doesn't touch Axpert at all (the AI chat/provider calls)
   is completely unaffected either way.
   ============================================================ */
(function () {
    'use strict';

    // ── 1. Config — fill these in for this deployment ──────────────────
    const AXI_ARM_BASE_URL = "https://agile.axi-global.com/ARM_API";
    const AXI_ARM_PROJECT = "erpdemo";
    const AXI_ARM_SEED = "12345"; // per the Signin password-hashing instructions

    const URLS = {
        signin: `${AXI_ARM_BASE_URL}/AxAuth/api/v1/Signin`,
        axList: `${AXI_ARM_BASE_URL}/AxList/api/v1/AxList`,
        axGet: `${AXI_ARM_BASE_URL}/AxTstructData/api/v1/AxGet`,
    };

    // ── 2. Embedded-mode detection — do nothing at all if inside Axpert ──
    function isEmbedded() {
        try {
            return typeof parent !== 'undefined' && parent !== window && typeof parent.GetDataFromAxList === 'function';
        } catch (e) {
            // Cross-origin parent frame throws on access — that's still "embedded",
            // just not one we can bridge; leave it alone either way.
            return true;
        }
    }

    if (isEmbedded()) {
        console.info('[AXI Standalone Bridge] Running embedded in Axpert — bridge not needed, doing nothing.');
        return;
    }

    console.info('[AXI Standalone Bridge] Running standalone (no Axpert parent frame) — installing REST-backed bridge.');

    // ── 3. MD5 (pure JS, no dependency) ──────────────────────────────────
    // Only used for the Signin password hash below — never for anything
    // security-sensitive beyond replicating what this Axpert deployment
    // already expects. Verified byte-for-byte against Node's crypto module
    // for md5("") / md5("12345") / md5("password") and others before use —
    // md5("12345") === "827ccb0eea8a706c4c34a16891f84e7b", matching the
    // worked example in the Signin password instructions exactly.
    var md5 = (function () {
        var hexChars = '0123456789abcdef';
        function toHex(n) {
            var s = '';
            for (var j = 0; j <= 3; j++) s += hexChars.charAt((n >> (j * 8 + 4)) & 0x0f) + hexChars.charAt((n >> (j * 8)) & 0x0f);
            return s;
        }
        function add(x, y) { var lsw = (x & 0xffff) + (y & 0xffff), msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
        function rotl(n, c) { return (n << c) | (n >>> (32 - c)); }
        function cmn(q, a, b, x, s, t) { return add(rotl(add(add(a, q), add(x, t)), s), b); }
        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

        // UTF-8-encodes str, then packs it into 32-bit little-endian words
        // with MD5's standard bit-length padding already applied.
        function strToBlocks(str) {
            var utf8 = unescape(encodeURIComponent(str));
            var nblk = ((utf8.length + 8) >> 6) + 1;
            var blks = new Array(nblk * 16);
            for (var i = 0; i < nblk * 16; i++) blks[i] = 0;
            for (i = 0; i < utf8.length; i++) blks[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
            blks[i >> 2] |= 0x80 << ((i % 4) * 8);
            var bitLen = utf8.length * 8;
            blks[nblk * 16 - 2] = bitLen & 0xffffffff;
            blks[nblk * 16 - 1] = Math.floor(bitLen / 4294967296);
            return blks;
        }

        return function md5(inputString) {
            var x = strToBlocks(String(inputString));
            var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
            var olda, oldb, oldc, oldd;
            for (var i = 0; i < x.length; i += 16) {
                olda = a; oldb = b; oldc = c; oldd = d;
                a = ff(a, b, c, d, x[i + 0], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
                a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
                a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
                a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
                a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i + 0], 20, -373897302);
                a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
                a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
                a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
                a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
                a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
                a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i + 0], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
                a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
                a = ii(a, b, c, d, x[i + 0], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
                a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
                a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
                a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
                a = add(a, olda); b = add(b, oldb); c = add(c, oldc); d = add(d, oldd);
            }
            return toHex(a) + toHex(b) + toHex(c) + toHex(d);
        };
    })();

    // ── 4. Session state ─────────────────────────────────────────────────
    var session = { token: null, armSessionId: null, username: null };
    var sessionReadyResolve = null;
    var sessionReady = new Promise(function (res) { sessionReadyResolve = res; });

    async function post(url, body, token) {
        const res = await fetch(url, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
            body: JSON.stringify(body),
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = text; }
        if (!res.ok) {
            throw new Error(`${url} -> HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
        }
        return data;
    }

    // Per the Signin password instructions: password = MD5(seed + MD5(plaintext)).
    function hashPassword(plainTextPassword) {
        return md5(AXI_ARM_SEED + md5(plainTextPassword));
    }

    async function signIn(username, plainTextPassword) {
        const data = await post(URLS.signin, {
            appname: AXI_ARM_PROJECT,
            UserName: username,
            password: hashPassword(plainTextPassword),
            Language: 'English',
            Seed: AXI_ARM_SEED,
            SessionId: String(Date.now()),
            Globalvars: true,
            ClearPreviousSession: true,
            trace: false,
        });
        const token = data?.result?.token;
        const armSessionId = data?.result?.ARMSessionId;
        if (!token || !armSessionId) {
            // Handbook: a 200 with no token means bad credentials, not a network error.
            throw new Error('Sign-in failed — check the username/password. (Server responded but returned no session token.)');
        }
        session.token = token;
        session.armSessionId = armSessionId;
        session.username = username;
        return session;
    }

    // ── 5. Bridge functions — these are what every existing service file
    //      already calls via `parent.X`, which resolves here since parent===window. ──

    window.mainUserName = null; // set on successful sign-in, below
    window.AxUserRoles = '';
    // Standalone testing convenience: without a real Axpert session there is
    // no server-side role/permission source, so admin-gated UI (the Admin
    // Dashboard, the Provider Switcher) defaults to visible. Flip to a
    // falsy return here if you specifically need to test the non-admin path.
    window.getSessionValue = function (key) {
        if (key === 'Build' || key === 'AppMgrAccess') return true;
        return '';
    };

    window.GetDataFromAxList = function (params, onSuccess, onError) {
        sessionReady.then(function () {
            const adsNames = params?.adsNames || [];
            const sqlParams = params?.sqlParams || {};
            return post(URLS.axList, {
                ARMSessionId: session.armSessionId,
                action: 'view',
                Project: AXI_ARM_PROJECT,
                ADSNames: adsNames,
                sqlparams: sqlParams,
                trace: false,
                getallrecordscount: true,
                CachePermissions: true,
                RefreshCache: true,
                pageno: 1,
                pagesize: 1000,
                keyfield: 'username',
                keyvalue: 'ALL',
                AxClient_dateformat: 'MM/dd/yyyy',
                select_columns: [], aggregations: {}, groupby_columns: [], sorting: [], filters: [],
            }, session.token);
        }).then(function (data) {
            // Handed straight to the caller — every existing consumer
            // (axi-databin-core.js's safeParseData/parseAxpertResponseSafely
            // chain) already expects exactly this {result:{success,data:[{data:[...]}]}}
            // shape, since it's the same shape Axpert's own GetDataFromAxList
            // response ultimately unwraps to.
            onSuccess?.(data);
        }).catch(function (err) {
            console.error('[AXI Standalone Bridge] GetDataFromAxList failed:', err);
            onError?.(err);
        });
    };

    function writeNotAvailable(action) {
        const err = new Error(
            `${action} is not available outside Axpert. This build is running in standalone/testing mode ` +
            `(see axi-standalone-bridge.js) — reads work, but saves/deletes require the real Axpert host and ` +
            `have not been ported to the REST API. Nothing was changed on the server.`
        );
        console.error('[AXI Standalone Bridge]', err.message);
        return err;
    }

    window.AxSetValue = function () {
        // Intentionally silent: individual field-set calls aren't themselves
        // a failure, and callers always follow up with one AxSubmitData —
        // that's where the "not available" error actually surfaces.
    };
    window.AxSubmitData = function () {
        throw writeNotAvailable('Save');
    };
    window.AxCallScriptAPIAsync = function (script, form, tstruct, recordid, extra, onSuccess, onError) {
        const err = writeNotAvailable('Delete');
        if (typeof onError === 'function') onError(err);
        else throw err;
    };

    // ── 6. Login overlay — blocks interaction until Signin succeeds ──────
    function showLoginOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'axiStandaloneLogin';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:#0F172A;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
        overlay.innerHTML = `
            <form id="axiStandaloneLoginForm" style="background:#fff;border-radius:16px;padding:32px;width:100%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,.3);">
                <h1 style="font-size:18px;font-weight:800;color:#0F172A;margin:0 0 4px;">Sandesh — Standalone Mode</h1>
                <p style="font-size:12.5px;color:#64748B;margin:0 0 20px;line-height:1.5;">Not running inside Axpert. Sign in with your Axpert credentials to test against the real ARM API.</p>
                <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;">Username</label>
                <input id="axiStandaloneUser" type="text" autocomplete="username" style="width:100%;height:40px;padding:0 12px;border-radius:8px;border:1.5px solid #E5E7EB;font-size:14px;margin-bottom:14px;box-sizing:border-box;" required />
                <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;">Password</label>
                <input id="axiStandalonePass" type="password" autocomplete="current-password" style="width:100%;height:40px;padding:0 12px;border-radius:8px;border:1.5px solid #E5E7EB;font-size:14px;margin-bottom:18px;box-sizing:border-box;" required />
                <button type="submit" id="axiStandaloneSubmit" style="width:100%;height:42px;border-radius:9px;border:none;background:#2563EB;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">Sign in</button>
                <p id="axiStandaloneError" style="display:none;color:#DC2626;font-size:12.5px;margin:12px 0 0;"></p>
            </form>`;
        document.body.appendChild(overlay);

        const form = overlay.querySelector('#axiStandaloneLoginForm');
        const errEl = overlay.querySelector('#axiStandaloneError');
        const submitBtn = overlay.querySelector('#axiStandaloneSubmit');

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            const username = overlay.querySelector('#axiStandaloneUser').value.trim();
            const password = overlay.querySelector('#axiStandalonePass').value;
            if (!username || !password) return;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Signing in...';
            errEl.style.display = 'none';
            try {
                await signIn(username, password);
                window.mainUserName = username;
                overlay.remove();
                sessionReadyResolve();
            } catch (err) {
                errEl.textContent = err.message || 'Sign-in failed.';
                errEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in';
            }
        });
    }

    // Sandesh's own sign-in is the app's front door, so this ARM sign-in page is
    // NO LONGER shown at start-up. (It used to appear over the app; once signed
    // in it started the old AI app's ARM data loading, which could open a
    // hidden modal that froze the whole page.) The ARM sign-in itself is kept
    // and can still be opened on demand by code that genuinely needs an ARM
    // session:  window.AxShowArmSignIn();
    // Until someone signs in there, ARM data calls (GetDataFromAxList) simply
    // wait for a session.
    window.AxShowArmSignIn = function () {
        if (document.getElementById('axiStandaloneLogin')) return;
        if (document.body) {
            showLoginOverlay();
        } else {
            document.addEventListener('DOMContentLoaded', showLoginOverlay);
        }
    };

})();

if (typeof window !== "undefined") { window.SandeshStandaloneBridge = true; }
