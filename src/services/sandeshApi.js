/**
 * Sandesh Backend HTTP API Client
 *
 * Base URL prefix: http://10.0.2.146/api/sd/
 * Every response: {"ok": true, "data": {...}} or {"ok": false, "error": {"code", "message", "details"}}
 * Authenticated calls: Authorization: Bearer <token>
 */

const DEFAULT_API_BASE = 'http://10.0.2.146/api/sd';

export const ERROR_MESSAGES = {
  invalid_credentials: 'Wrong credentials or unknown identifier. Please check and try again.',
  totp_required: 'Two-factor authenticator code required for this device.',
  otp_invalid: 'That verification code is not correct or has expired. Please try again.',
  otp_locked: 'Too many wrong codes. Please request a new verification code.',
  locked: 'Account is temporarily locked due to repeated failed attempts. Please wait ~15 minutes.',
  rate_limited: 'Too many requests. Please slow down and wait a moment.',
  pending_approval: 'Your registration is pending approval from your organisation host/admin.',
  account_inactive: 'This account has been deactivated. Please contact your administrator.',
  rejected: 'Your registration was not approved.',
  password_change_required: 'An administrator must change their default password before continuing.',
  weak_password: 'Password must be at least 8 characters and include letters and at least one digit.',
  already_configured: 'This organisation has already been configured. Please sign in or self-register as a new user.',
  already_setup: 'This organisation has already been configured. Please sign in or self-register as a new user.',
  no_pending_setup: 'No setup is currently pending. Please start setup again.',
  already_enabled: 'Two-factor authentication is already active.',
  not_found: 'The requested resource was not found.',
  network_error: 'Unable to connect to Sandesh backend (http://10.0.2.146/api/sd). Check server connection.',
};

export function validatePasswordPolicy(password) {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  if (!hasLetter || !hasDigit) {
    return { valid: false, message: 'Password must contain both letters and at least one digit.' };
  }
  return { valid: true };
}

class SandeshApiService {
  constructor() {
    this._listeners = new Set();
  }

  getBaseUrl() {
    const base = this._resolveBaseUrl();
    // An https page can't call an http:// API (mixed content is blocked); the same host serves
    // the API over https too, so upgrade the scheme when the page itself is https.
    if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
      return base.replace(/^http:\/\//i, 'https://');
    }
    return base;
  }

  _resolveBaseUrl() {
    try {
      const stored = localStorage.getItem('sandesh_api_base');
      if (stored) return stored.replace(/\/+$/, '');
    } catch {
      // ignore
    }
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SANDESH_API_BASE) {
      return import.meta.env.VITE_SANDESH_API_BASE.replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.SANDESH_API_BASE) {
      return window.SANDESH_API_BASE.replace(/\/+$/, '');
    }
    return DEFAULT_API_BASE;
  }

  setBaseUrl(url) {
    try {
      if (url) {
        localStorage.setItem('sandesh_api_base', url.trim().replace(/\/+$/, ''));
      } else {
        localStorage.removeItem('sandesh_api_base');
      }
    } catch {
      // ignore
    }
  }

  /**
   * Device ID generation and persistence.
   * "The every 2 weeks re-check is now per DEVICE, not per account.
   * Start generating and persisting a deviceId (Flow 3) — without it, returning users get asked
   * for a code more often than they should."
   */
  getDeviceId() {
    try {
      const existing = localStorage.getItem('sandesh_device_id');
      if (existing) return existing;

      let newId;
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        newId = crypto.randomUUID();
      } else {
        newId = 'sd-dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 12);
      }
      localStorage.setItem('sandesh_device_id', newId);
      return newId;
    } catch {
      return 'sd-fallback-device-' + Date.now();
    }
  }

  /**
   * Generates a new device ID.
   * "To test the 'new device' path without waiting 14 days, just send a different deviceId."
   */
  rotateDeviceId() {
    let newId;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      newId = crypto.randomUUID();
    } else {
      newId = 'sd-dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 12);
    }
    try {
      localStorage.setItem('sandesh_device_id', newId);
    } catch {
      // ignore
    }
    this.notifyDeviceIdChange(newId);
    return newId;
  }

  onDeviceIdChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  notifyDeviceIdChange(id) {
    this._listeners.forEach((l) => {
      try {
        l(id);
      } catch (e) {
        console.error(e);
      }
    });
  }

  getFriendlyErrorMessage(error) {
    if (!error) return 'An unknown error occurred.';
    if (typeof error === 'string') return error;
    if (error.code && ERROR_MESSAGES[error.code]) {
      return ERROR_MESSAGES[error.code];
    }
    return error.message || error.code || 'An unexpected error occurred.';
  }

  async request(endpoint, options = {}) {
    const { method = 'GET', body, token, headers = {} } = options;
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    const url = `${this.getBaseUrl()}/${cleanEndpoint}`;

    const reqHeaders = {
      Accept: 'application/json',
      ...headers,
    };

    if (body !== undefined) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    if (token) {
      reqHeaders.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      let json;
      const text = await response.text();
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {
          ok: false,
          error: {
            code: 'parse_error',
            message: `Server returned non-JSON response (HTTP ${response.status})`,
            raw: text,
          },
        };
      }

      // If backend responded with standard envelope
      if (typeof json.ok === 'boolean') {
        return json;
      }

      if (response.ok) {
        return { ok: true, data: json };
      }

      return {
        ok: false,
        error: {
          code: 'http_error',
          message: json.message || `Request failed with status ${response.status}`,
          status: response.status,
        },
      };
    } catch (err) {
      console.error(`[SandeshApi] Network error requesting ${url}:`, err);
      return {
        ok: false,
        error: {
          code: 'network_error',
          message: ERROR_MESSAGES.network_error,
          details: err.message,
        },
      };
    }
  }

  // ── FLOW 1: First-Run Org Setup ──────────────────────────────────────────

  /**
   * Step 1: GET /api/sd/public
   * Returns { setupDone: bool, org, branches, departments, designations, categories, affiliates }
   */
  async getPublic() {
    return this.request('public');
  }

  /**
   * Step 2: POST /api/sd/setup/start
   * { org, name, username?, email, mobile, setupToken? }
   * Returns { sent: true, expiresInSec: 300, devOtp?: string }
   */
  async setupStart({ org, name, username, email, mobile, setupToken }) {
    const body = { org, name, email, mobile };
    if (username) body.username = username;
    if (setupToken) body.setupToken = setupToken;
    return this.request('setup/start', { method: 'POST', body });
  }

  /**
   * Step 3: POST /api/sd/setup/verify
   * { otp }
   * Returns { totpSetupRequired: true, mfaMethod: "totp", secret, otpauthUri, issuer, digits, periodSec, recommendedApps, defaultPassword, org, user }
   */
  async setupVerify({ otp }) {
    return this.request('setup/verify', { method: 'POST', body: { otp } });
  }

  // ── FLOW 2: Self-Registration ────────────────────────────────────────────

  /**
   * POST /api/sd/register
   * { name, username?, email, mobile, password, ...profileFields }
   * Returns { registered: true, status: "pending", requestId, awaitingApprovalFrom }
   */
  async register(profile) {
    return this.request('register', { method: 'POST', body: profile });
  }

  // ── FLOW 3: Login & Multi-Factor Auth ────────────────────────────────────

  /**
   * POST /api/sd/login
   * { identifier, password?, totp?, emailOtp?, recoveryCode?, deviceId?, mfaMethod? }
   */
  async login({
    identifier,
    password,
    totp,
    emailOtp,
    recoveryCode,
    deviceId,
    mfaMethod,
  }) {
    const body = {
      identifier: identifier?.trim(),
      deviceId: deviceId || this.getDeviceId(),
    };

    if (password) body.password = password;
    if (totp) body.totp = totp.trim();
    if (emailOtp) body.emailOtp = emailOtp.trim();
    if (recoveryCode) body.recoveryCode = recoveryCode.trim();
    if (mfaMethod) body.mfaMethod = mfaMethod;

    return this.request('login', { method: 'POST', body });
  }

  /**
   * POST /api/sd/logout (Bearer)
   */
  async logout(token) {
    if (!token) return { ok: true };
    return this.request('logout', { method: 'POST', token });
  }

  /**
   * GET /api/sd/session (Bearer)
   * Returns { user, password, sessionExpiresTs, totpDue, mode }
   */
  async getSession(token) {
    if (!token) return { ok: false, error: { code: 'unauthenticated' } };
    return this.request('session', { token });
  }

  /**
   * POST /api/sd/password/change (Bearer)
   * { oldPassword?, newPassword }
   */
  async changePassword({ oldPassword, newPassword }, token) {
    const body = { newPassword };
    if (oldPassword) body.oldPassword = oldPassword;
    return this.request('password/change', { method: 'POST', body, token });
  }

  // ── Authenticated 2FA Management ─────────────────────────────────────────

  /**
   * GET /api/sd/2fa/totp (Bearer)
   * Returns { enabled: bool, method: "totp" | "email" }
   */
  async get2faStatus(token) {
    return this.request('2fa/totp', { token });
  }

  /**
   * POST /api/sd/2fa/email/request (Bearer)
   * Returns { sent: bool, expiresInSec: number, devOtp?: string }
   */
  async requestEmail2fa(token) {
    return this.request('2fa/email/request', { method: 'POST', token });
  }

  /**
   * POST /api/sd/2fa/totp/disable (Bearer)
   * { password, code }
   */
  async disable2fa({ password, code }, token) {
    return this.request('2fa/totp/disable', {
      method: 'POST',
      body: { password, code },
      token,
    });
  }

  /**
   * POST /api/sd/2fa/totp/recovery/regenerate (Bearer)
   * { password, code }
   * Returns { recoveryCodes: string[] }
   */
  async regenerateRecoveryCodes({ password, code }, token) {
    return this.request('2fa/totp/recovery/regenerate', {
      method: 'POST',
      body: { password, code },
      token,
    });
  }

  // ── My Workspace Notification Feed (/api/sd/feed) ───────────────────────

  /**
   * GET /api/sd/feed (Bearer)
   * { priority?, category?, unreadOnly?, limit?, before? }
   * Returns { notifications: [item], counts: { high, medium, low, resolved, unread, total }, hasMore }
   */
  async getFeed(params = {}, token) {
    const qs = new URLSearchParams();
    if (params.priority && params.priority !== 'all') qs.set('priority', params.priority);
    if (params.category) qs.set('category', params.category);
    if (params.unreadOnly !== undefined) qs.set('unreadOnly', String(params.unreadOnly));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.before !== undefined) qs.set('before', String(params.before));

    const queryStr = qs.toString();
    const endpoint = queryStr ? `feed?${queryStr}` : 'feed';
    return this.request(endpoint, { token });
  }

  /**
   * GET /api/sd/feed/summary (Bearer)
   * Returns { high, medium, low, resolved, unread, total }
   */
  async getFeedSummary(token) {
    return this.request('feed/summary', { token });
  }

  /**
   * POST /api/sd/feed/read (Bearer)
   * { ids?: string[], all?: boolean, read?: boolean }
   * Returns { updated: number, counts }
   */
  async feedRead({ ids, all, read = true } = {}, token) {
    const body = all ? { all: true } : { ids: Array.isArray(ids) ? ids : (ids ? [ids] : []) };
    if (read === false) body.read = false;
    return this.request('feed/read', { method: 'POST', body, token });
  }

  /**
   * POST /api/sd/feed/resolve (Bearer)
   * { id: string }
   * Returns { notification, counts }
   */
  async feedResolve(id, token) {
    return this.request('feed/resolve', { method: 'POST', body: { id }, token });
  }

  /**
   * POST /api/sd/feed/dismiss (Bearer)
   * { id: string }
   * Returns { dismissed: true, counts }
   */
  async feedDismiss(id, token) {
    return this.request('feed/dismiss', { method: 'POST', body: { id }, token });
  }

  /**
   * POST /api/sd/feed/clear (Bearer)
   * Returns { cleared: number, counts }
   */
  async feedClear(token) {
    return this.request('feed/clear', { method: 'POST', body: {}, token });
  }
}

export const sandeshApi = new SandeshApiService();
