import { useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";

// The backend (strict mode) keeps the admin console locked until the administrator re-confirms with their
// password and a one-time code sent to them. Shown whenever the console reports it is locked.
export default function AdminUnlockPanel({ onUnlocked }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sendCode = async () => {
    setBusy(true);
    setError("");
    const res = await sandeshSocket.sd("admin.unlock.start", {});
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message || "Couldn't send a code.");
      return;
    }
    if (res.data?.sent === false) {
      setMessage(`A code was sent a moment ago. You can ask for another in ${res.data.retryAfter || "a few"} seconds.`);
      setSent(true);
      return;
    }
    setSent(true);
    // devOtp is only returned by development backends (SANDESH_DEV_OTP=1); production never sends it.
    if (res.data?.devOtp) setCode(res.data.devOtp);
    setMessage(`A one-time code was sent to your registered email/mobile. It is valid for ${Math.round((res.data?.expiresInSec || 300) / 60)} minutes.`);
  };

  const unlock = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await sandeshSocket.sd("admin.unlock", { password, otp: code.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.error?.message || "Couldn't unlock.");
      return;
    }
    setPassword("");
    setCode("");
    onUnlocked?.();
  };

  return (
    <div className="reassign-host-panel" data-testid="admin-unlock" style={{ maxWidth: 460, margin: "24px auto" }}>
      <h5>Unlock the admin console</h5>
      <p className="section-note">
        For safety the console stays locked until you confirm it is you: enter your password and the one-time code we send you.
      </p>
      <form onSubmit={unlock} className="reassign-form" style={{ display: "block" }}>
        <div className="sandesh-input-box-3d" style={{ marginBottom: 8 }}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div className="sandesh-input-box-3d" style={{ flex: 1 }}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              aria-label="One-time code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <button type="button" className="sandesh-btn-secondary-3d" onClick={sendCode} disabled={busy}>
            {sent ? "Send again" : "Send code"}
          </button>
        </div>
        {message && <p className="section-note">{message}</p>}
        {error && (
          <p className="section-note" role="alert" style={{ color: "#c0392b" }}>
            {error}
          </p>
        )}
        <div className="reassign-btns">
          <button type="submit" className="sandesh-btn-primary-3d" disabled={busy || !password || !code}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}
