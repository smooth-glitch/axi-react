import { useState, useEffect } from "react";
import Avatar from "../Avatar.jsx";
import { statusPresets } from "../../data/sampleData.js";
import { sandeshApi } from "../../../../services/sandeshApi.js";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import { Shield, KeyRound, RefreshCw, AlertTriangle, Check, Copy } from "lucide-react";

export default function ProfileModal({ me, onCancel, onSave, onAvatarUpdated }) {
  const [status, setStatus] = useState(me.status ?? "");
  const [avatarUrl, setAvatarUrl] = useState(me.avatar || me.avatarUrl || "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");

  // 2FA Management State
  const [mfaInfo, setMfaInfo] = useState(null);
  const [loadingMfa, setLoadingMfa] = useState(false);
  const [mfaAction, setMfaAction] = useState(null); // "regen" | "disable" | null
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaSuccess, setMfaSuccess] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  useEffect(() => {
    if (!me?.token) return;
    let active = true;
    setLoadingMfa(true);
    sandeshApi.get2faStatus(me.token).then((res) => {
      if (!active) return;
      setLoadingMfa(false);
      if (res.ok && res.data) {
        setMfaInfo(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [me?.token]);

  const handleRequestEmailCodeIfNeeded = async () => {
    if (mfaInfo?.method === "email" && me?.token) {
      setActionLoading(true);
      const res = await sandeshApi.requestEmail2fa(me.token);
      setActionLoading(false);
      if (res.ok) {
        setMfaSuccess("A fresh verification code was emailed to your address.");
        if (res.data?.devOtp) {
          setMfaCode(res.data.devOtp);
        }
      } else {
        setMfaError(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    }
  };

  const handleOpenAction = (action) => {
    setMfaAction(action);
    setMfaError("");
    setMfaSuccess("");
    setMfaPassword("");
    setMfaCode("");
    handleRequestEmailCodeIfNeeded();
  };

  const handleSubmitMfaAction = async (e) => {
    e?.preventDefault();
    if (!mfaCode.trim()) {
      setMfaError("Verification code or recovery code is required.");
      return;
    }
    setMfaError("");
    setMfaSuccess("");
    setActionLoading(true);

    try {
      if (mfaAction === "regen") {
        const res = await sandeshApi.regenerateRecoveryCodes(
          { password: mfaPassword || undefined, code: mfaCode.trim() },
          me.token
        );
        setActionLoading(false);
        if (res.ok && res.data?.recoveryCodes) {
          setNewRecoveryCodes(res.data.recoveryCodes);
          setMfaAction(null);
          setMfaSuccess("10 fresh recovery codes generated successfully!");
        } else {
          setMfaError(sandeshApi.getFriendlyErrorMessage(res.error));
        }
      } else if (mfaAction === "disable") {
        const res = await sandeshApi.disable2fa(
          { password: mfaPassword || undefined, code: mfaCode.trim() },
          me.token
        );
        setActionLoading(false);
        if (res.ok) {
          setMfaAction(null);
          setMfaSuccess("2FA reset successfully. Your next login will re-trigger enrollment.");
        } else {
          setMfaError(sandeshApi.getFriendlyErrorMessage(res.error));
        }
      }
    } catch (err) {
      setActionLoading(false);
      setMfaError("Action failed. Please try again.");
    }
  };

  const handleCopyNewCodes = () => {
    if (!newRecoveryCodes) return;
    navigator.clipboard.writeText(newRecoveryCodes.join("\n"));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError("");
    setUploadingAvatar(true);
    try {
      const res = await sandeshApi.uploadAvatar(file);
      if (res.ok && res.data?.url) {
        const newUrl = res.data.url;
        setAvatarUrl(newUrl);
        sandeshSocket.sendSetAvatar(newUrl);
        onAvatarUpdated?.(newUrl);
        try {
          const saved = localStorage.getItem("sandesh_session_user");
          if (saved) {
            const parsed = JSON.parse(saved);
            localStorage.setItem(
              "sandesh_session_user",
              JSON.stringify({ ...parsed, avatar: newUrl })
            );
          }
        } catch {}
      } else {
        setAvatarError(res.error || "Failed to upload photo.");
      }
    } catch (err) {
      setAvatarError(err?.message || "Error uploading image.");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };

  return (
    <div id="ember-profile-modal" className="sandesh-modal-card-3d" style={{ maxWidth: "480px" }}>
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{ background: "rgba(255, 122, 89, 0.15)", color: "var(--sandesh-coral-accent)" }}
          >
            <span className="material-icons">account_circle</span>
          </div>
          <div>
            <h3>Your Profile &amp; Security</h3>
            <span className="modal-subtitle">Custom status, profile and two-factor authentication</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onCancel} aria-label="Close modal">
          ×
        </button>
      </div>

      <div className="sandesh-modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* User Card */}
        <div>
          <div
            id="ember-profile-avatar-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              background: "rgba(255,255,255,0.7)",
              padding: "12px 16px",
              borderRadius: "14px",
              border: "1px solid var(--sandesh-glass-border)",
            }}
          >
            <Avatar initials={me.initials} color={me.color} imageUrl={avatarUrl} size={48} className="" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--sandesh-text-main)" }}>
                {me.username || me.name}
              </div>
              <div style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
                {me.designation || me.role}
              </div>
            </div>
            <label
              className="sandesh-btn-secondary-3d"
              id="ember-profile-photo-label"
              style={{
                fontSize: "11px",
                padding: "6px 12px",
                cursor: uploadingAvatar ? "not-allowed" : "pointer",
                opacity: uploadingAvatar ? 0.7 : 1,
              }}
            >
              {uploadingAvatar ? "Uploading..." : "Change Photo"}
              <input
                type="file"
                id="ember-profile-photo-input"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                disabled={uploadingAvatar}
                onChange={handlePhotoSelect}
              />
            </label>
          </div>
          {avatarError && (
            <div style={{ color: "#ef4444", fontSize: "11px", marginTop: "4px", paddingLeft: "4px" }}>
              {avatarError}
            </div>
          )}
        </div>

        {/* Status Message */}
        <div>
          <div className="section-title-wrap" style={{ marginBottom: "8px" }}>
            <span className="section-title">Status Message</span>
          </div>
          <div className="new-group-input-box">
            <span className="material-icons field-icon">edit_note</span>
            <input
              id="ember-profile-status-input"
              type="text"
              className="new-group-input"
              placeholder="What's on your mind?"
              maxLength={80}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
        </div>

        {/* Quick Presets */}
        <div>
          <div className="section-title-wrap" style={{ marginBottom: "8px" }}>
            <span className="section-title">Quick Presets</span>
          </div>
          <div id="ember-profile-status-presets" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {statusPresets.map((p) => (
              <button
                key={p}
                className="status-preset"
                type="button"
                style={{
                  background: status === p ? "rgba(255, 122, 89, 0.15)" : "rgba(255,255,255,0.7)",
                  borderColor: status === p ? "var(--sandesh-coral-accent)" : "rgba(0,0,0,0.06)",
                  color: status === p ? "var(--sandesh-coral-accent)" : "var(--sandesh-text-main)",
                  fontWeight: status === p ? "700" : "500",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  border: "1px solid",
                }}
                onClick={() => setStatus(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* ── Two-Factor Authentication Section ── */}
        <div style={{ marginTop: "4px" }}>
          <div className="section-title-wrap" style={{ marginBottom: "8px" }}>
            <span className="section-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Shield size={14} color="var(--sandesh-coral-accent)" /> Two-Factor Authentication
            </span>
          </div>

          <div
            style={{
              background: "rgba(255, 255, 255, 0.65)",
              border: "1px solid rgba(240, 205, 185, 0.7)",
              borderRadius: "12px",
              padding: "12px 14px",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <span style={{ fontWeight: 700, color: "var(--sandesh-text-main)" }}>Security Status: </span>
                <span style={{ color: "#10b981", fontWeight: 700 }}>
                  {loadingMfa ? "Checking..." : mfaInfo?.enabled ? "Active & Enrolled" : "Enrolled"}
                </span>
              </div>
              <div
                style={{
                  background: "rgba(255, 122, 89, 0.12)",
                  color: "var(--sandesh-coral-accent)",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontWeight: 600,
                  fontSize: "11px",
                }}
              >
                Method: {mfaInfo?.method === "email" ? "Email OTP" : "Authenticator App"}
              </div>
            </div>

            {mfaSuccess && (
              <div className="sandesh-alert sandesh-alert-success" style={{ padding: "8px 10px", margin: "8px 0" }}>
                {mfaSuccess}
              </div>
            )}
            {mfaError && (
              <div className="sandesh-alert sandesh-alert-danger" style={{ padding: "8px 10px", margin: "8px 0" }}>
                {mfaError}
              </div>
            )}

            {/* Fresh Recovery Codes Display */}
            {newRecoveryCodes && (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#b91c1c", marginBottom: 4 }}>
                  Save your 10 new recovery codes:
                </div>
                <div className="sandesh-recovery-grid" style={{ maxHeight: 130 }}>
                  {newRecoveryCodes.map((c, i) => (
                    <div key={i} className="sandesh-recovery-item" style={{ fontSize: 11, padding: "4px 8px" }}>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  onClick={handleCopyNewCodes}
                  style={{ width: "100%", height: 32, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                >
                  {copiedCodes ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                  <span>{copiedCodes ? "Copied!" : "Copy New Codes"}</span>
                </button>
              </div>
            )}

            {/* Action Buttons */}
            {!mfaAction && (
              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  style={{ flex: 1, height: "32px", fontSize: "11px" }}
                  onClick={() => handleOpenAction("regen")}
                >
                  Regenerate Recovery Codes
                </button>
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  style={{ flex: 1, height: "32px", fontSize: "11px", color: "#dc2626" }}
                  onClick={() => handleOpenAction("disable")}
                >
                  Reset / Re-enroll 2FA
                </button>
              </div>
            )}

            {/* Active Action Form */}
            {mfaAction && (
              <form onSubmit={handleSubmitMfaAction} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sandesh-text-main)" }}>
                  {mfaAction === "regen"
                    ? "Enter current code to regenerate recovery codes:"
                    : "Enter current code to reset 2FA (re-enroll on next login):"}
                </div>

                {me.role === "admin" && (
                  <input
                    type="password"
                    placeholder="Admin password"
                    value={mfaPassword}
                    onChange={(e) => setMfaPassword(e.target.value)}
                    style={{
                      height: 32,
                      padding: "0 8px",
                      borderRadius: 6,
                      border: "1px solid rgba(230,200,185,0.8)",
                      fontSize: 12,
                    }}
                  />
                )}

                <input
                  type="text"
                  placeholder={mfaInfo?.method === "email" ? "Enter emailed code" : "Current TOTP or recovery code"}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  style={{
                    height: 32,
                    padding: "0 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(230,200,185,0.8)",
                    fontSize: 12,
                  }}
                  autoFocus
                  required
                />

                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button
                    type="submit"
                    className="sandesh-btn-primary-3d"
                    style={{ flex: 1, height: 32, fontSize: 11, margin: 0 }}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "Processing..." : mfaAction === "regen" ? "Regenerate" : "Confirm Reset"}
                  </button>
                  <button
                    type="button"
                    className="sandesh-btn-secondary-3d"
                    style={{ height: 32, fontSize: 11 }}
                    onClick={() => setMfaAction(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="sandesh-modal-actions new-group-footer">
        <button className="sandesh-btn-secondary-3d" id="ember-profile-cancel-btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="sandesh-btn-primary-3d"
          id="ember-profile-save-btn"
          onClick={() => onSave?.({ status, avatar: avatarUrl })}
          type="button"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
