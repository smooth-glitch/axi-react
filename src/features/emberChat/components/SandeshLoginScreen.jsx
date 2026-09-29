import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { sandeshApi, ERROR_MESSAGES, validatePasswordPolicy } from "../../../services/sandeshApi.js";
import { generateTotpCode } from "../../../services/totpHelper.js";
import sandeshLogo from "../../../assets/sandesh-logo.png";
import { SmokeyBackground } from "@/components/ui/login-form";
import {
  User,
  Lock,
  ArrowRight,
  ShieldCheck,
  Building2,
  Phone,
  Mail,
  KeyRound,
  Layers,
  Briefcase,
  CheckCircle2,
  Eye,
  EyeOff,
  QrCode,
  Copy,
  Download,
  RotateCcw,
  Smartphone,
  AlertTriangle,
  ExternalLink,
  Laptop,
  Check,
  RefreshCw,
  Trash2,
} from "lucide-react";

function buildSessionUser(data) {
  const u = data.user || {};
  return {
    ...u,
    token: data.token,
    expiresTs: data.expiresTs,
    mustChangePassword: !!data.mustChangePassword,
    isAdmin: u.role === "admin" || u.canManageUsers === true,
    initials: (u.name || u.username || "U").slice(0, 2).toUpperCase(),
    color: "#ff7a59",
    armSessionId: "arm-" + Date.now(),
  };
}

export default function SandeshLoginScreen({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState("signin"); // "signin" | "first_admin" | "self_reg"

  // Public backend config & status
  const [publicData, setPublicData] = useState(null);
  const [checkingPublic, setCheckingPublic] = useState(true);
  const [deviceId, setDeviceId] = useState(() => sandeshApi.getDeviceId());

  // General loading & feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  // Tab 1: Sign In inputs
  const [signInIdentifier, setSignInIdentifier] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Tab 2: First-Time Setup inputs (Flow 1)
  const [adminOrg, setAdminOrg] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminMobile, setAdminMobile] = useState("");
  const [adminSetupToken, setAdminSetupToken] = useState("");
  const [setupStep, setSetupStep] = useState("form"); // "form" | "otp"
  const [setupOtp, setSetupOtp] = useState("");
  const [setupDevOtp, setSetupDevOtp] = useState(null);

  // Tab 3: Self-Registration inputs (Flow 2)
  const [regName, setRegName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regType, setRegType] = useState("employee"); // "employee" | "affiliate" | "external"
  const [regBranch, setRegBranch] = useState("");
  const [regDept, setRegDept] = useState("");
  const [regDesignation, setRegDesignation] = useState("");
  const [regCategory, setRegCategory] = useState("Citizen");
  const [regAffiliate, setRegAffiliate] = useState("");
  const [regAffiliateBranch, setRegAffiliateBranch] = useState("");
  const [regCountry, setRegCountry] = useState("India");
  const [regCity, setRegCity] = useState("");
  const [regPin, setRegPin] = useState("");
  const [selfRegSuccess, setSelfRegSuccess] = useState(null); // { registered, requestId, awaitingApprovalFrom }

  // Multi-Factor & Enrollment Modals / Views
  // Case A/B TOTP Enrollment state
  const [totpEnrollment, setTotpEnrollment] = useState(null);
  // Case A/B Email Enrollment state
  const [emailEnrollment, setEmailEnrollment] = useState(null);
  // Case D: TOTP verification challenge (untrusted device)
  const [totpChallenge, setTotpChallenge] = useState(null);
  // Case D: Email verification challenge (untrusted device)
  const [emailChallenge, setEmailChallenge] = useState(null);
  // Recovery codes reveal view (Case B - shown once)
  const [recoveryReveal, setRecoveryReveal] = useState(null);
  // Force password change view (Admin mandatory password update)
  const [adminPasswordChange, setAdminPasswordChange] = useState(null);

  // Countdown timers for email OTP resend
  const [emailCooldown, setEmailCooldown] = useState(0);

  // Listen to device ID rotation
  useEffect(() => {
    return sandeshApi.onDeviceIdChange((newId) => {
      setDeviceId(newId);
    });
  }, []);

  // Cooldown countdown timer
  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = setInterval(() => {
      setEmailCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [emailCooldown]);

  // Initial Boot Check: GET /api/sd/public
  useEffect(() => {
    let mounted = true;
    async function checkPublic() {
      setCheckingPublic(true);
      const res = await sandeshApi.getPublic();
      if (!mounted) return;
      setCheckingPublic(false);

      if (res.ok && res.data) {
        setPublicData(res.data);
        if (res.data.setupDone === false) {
          setActiveTab("first_admin");
          setSuccessNotice(
            "Welcome! Organisation setup is required before login. Complete this one-time step to create your enterprise organisation."
          );
        } else {
          setActiveTab((prev) => (prev === "first_admin" ? "signin" : prev));
          if (res.data.org) {
            setAdminOrg(res.data.org);
          }
        }
      } else {
        console.warn("[Sandesh] Failed to fetch public info:", res.error);
      }
    }
    checkPublic();
    return () => {
      mounted = false;
    };
  }, []);

  // Clear messages on tab change
  const handleTabChange = (tab) => {
    if (tab === "first_admin" && publicData?.setupDone) {
      setActiveTab("signin");
      setErrorMsg("This organisation has already been configured. Please sign in with your credentials or self-register as a new user.");
      return;
    }
    setActiveTab(tab);
    setErrorMsg("");
    setSuccessNotice("");
    setSelfRegSuccess(null);
    setTotpEnrollment(null);
    setEmailEnrollment(null);
    setTotpChallenge(null);
    setEmailChallenge(null);
    setRecoveryReveal(null);
    setAdminPasswordChange(null);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // FLOW 3: LOGIN
  // ──────────────────────────────────────────────────────────────────────────
  const handleSignIn = async (e) => {
    e?.preventDefault();
    if (!signInIdentifier.trim()) {
      setErrorMsg("Please enter your username, email, or mobile number.");
      return;
    }

    setErrorMsg("");
    setSuccessNotice("");
    setLoading(true);

    try {
      const res = await sandeshApi.login({
        identifier: signInIdentifier,
        password: signInPassword || undefined,
        deviceId,
        mfaMethod: "totp",
      });

      setLoading(false);

      if (res.ok) {
        const data = res.data;

        // Case A1: Unenrolled account -> TOTP setup required
        if (data.totpSetupRequired && data.mfaMethod === "totp") {
          let qrDataUrl = "";
          try {
            if (data.otpauthUri) {
              qrDataUrl = await QRCode.toDataURL(data.otpauthUri, {
                width: 220,
                margin: 2,
                color: { dark: "#1e293b", light: "#ffffff" },
              });
            }
          } catch (qrErr) {
            console.error("QR Code generation error:", qrErr);
          }

          let devCode = null;
          if (data.secret) {
            devCode = await generateTotpCode(data.secret);
          }

          setTotpEnrollment({
            ...data,
            qrDataUrl,
            devCode,
            identifier: signInIdentifier,
            password: signInPassword,
            code: devCode || "",
          });
          return;
        }

        // Case A2: Unenrolled account -> Email setup
        if (data.totpSetupRequired && data.mfaMethod === "email") {
          setEmailEnrollment({
            ...data,
            identifier: signInIdentifier,
            password: signInPassword,
            code: data.devOtp || "",
          });
          if (data.retryAfter || data.expiresInSec) {
            setEmailCooldown(data.retryAfter || 30);
          }
          return;
        }

        // Case D2: Email-method account on untrusted device -> ok: true with emailOtpRequired
        if (data.emailOtpRequired && data.mfaMethod === "email") {
          setEmailChallenge({
            ...data,
            identifier: signInIdentifier,
            password: signInPassword,
            code: data.devOtp || "",
            useRecovery: false,
          });
          if (data.retryAfter || data.expiresInSec) {
            setEmailCooldown(data.retryAfter || 30);
          }
          return;
        }

        // Case C: Known device within 14 days -> Instant success
        if (data.token) {
          handleSuccessfulLoginSession(data);
          return;
        }
      } else {
        // Handle Error responses
        const error = res.error || {};

        // Case D1: Enrolled TOTP account on untrusted device -> 401 totp_required
        if (error.code === "totp_required") {
          setTotpChallenge({
            identifier: signInIdentifier,
            password: signInPassword,
            code: "",
            useRecovery: false,
          });
          return;
        }

        // Standard error codes
        if (error.code === "invalid_credentials") {
          setErrorMsg(ERROR_MESSAGES.invalid_credentials);
        } else if (error.code === "pending_approval") {
          setErrorMsg(ERROR_MESSAGES.pending_approval);
          try {
            const existing = JSON.parse(localStorage.getItem("sandesh_pending_registrations") || "[]");
            const uClean = signInIdentifier.trim().toLowerCase();
            if (!existing.some((x) => (x.username || "").toLowerCase() === uClean)) {
              existing.unshift({
                id: error.requestId || Date.now(),
                type: "registration",
                status: "pending",
                title: `Pending User: @${signInIdentifier}`,
                name: signInIdentifier,
                username: signInIdentifier,
                email: signInIdentifier.includes("@") ? signInIdentifier : `${signInIdentifier}@agilelabs.com`,
                category: "Self-Registered Applicant",
                department: "General",
                designation: "Associate",
                time: "Recently",
                details: "Account registered on Sandesh backend, waiting for admin clearance to enter chat.",
                fromUser: signInIdentifier,
              });
              localStorage.setItem("sandesh_pending_registrations", JSON.stringify(existing));
            }
          } catch {
            // ignore
          }
        } else if (error.code === "locked") {
          setErrorMsg(ERROR_MESSAGES.locked);
        } else if (error.code === "rate_limited") {
          setErrorMsg(ERROR_MESSAGES.rate_limited);
        } else if (error.code === "account_inactive") {
          setErrorMsg(ERROR_MESSAGES.account_inactive);
        } else {
          setErrorMsg(sandeshApi.getFriendlyErrorMessage(error));
        }
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("An unexpected connection error occurred. Please try again.");
      console.error(err);
    }
  };

  // Helper when session is obtained (Case B, C, or D completion)
  const handleSuccessfulLoginSession = (data) => {
    // If recovery codes are issued (Case B: enrollment completion), show them first!
    if (data.totpJustEnabled && Array.isArray(data.recoveryCodes) && data.recoveryCodes.length > 0) {
      setRecoveryReveal({
        recoveryCodes: data.recoveryCodes,
        pendingSession: data,
        acknowledged: false,
      });
      return;
    }

    // If admin password change is required, force it before launching
    if (data.mustChangePassword && (data.user?.role === "admin" || data.user?.canManageUsers)) {
      setAdminPasswordChange({
        pendingSession: data,
        oldPassword: signInPassword || "",
        newPassword: "",
        confirmPassword: "",
      });
      return;
    }

    // Otherwise, login is complete!
    const sessionUser = buildSessionUser(data);
    onLoginSuccess(sessionUser);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // CASE A / B: TOTP ENROLLMENT VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────
  const handleVerifyTotpEnrollment = async (e) => {
    e?.preventDefault();
    if (!totpEnrollment?.code?.trim()) {
      setErrorMsg("Please enter the 6-digit code from your authenticator app.");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const res = await sandeshApi.login({
        identifier: totpEnrollment.identifier,
        password: totpEnrollment.password || undefined,
        totp: totpEnrollment.code.trim(),
        deviceId,
      });

      setLoading(false);

      if (res.ok && res.data?.token) {
        setTotpEnrollment(null);
        handleSuccessfulLoginSession(res.data);
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to verify authenticator code. Please try again.");
    }
  };

  // Switch to Email 2FA during enrollment
  const handleSwitchToEmailEnrollment = async () => {
    setErrorMsg("");
    setLoading(true);
    const identifier = totpEnrollment?.identifier || signInIdentifier;
    const password = totpEnrollment?.password || signInPassword;

    try {
      const res = await sandeshApi.login({
        identifier,
        password: password || undefined,
        deviceId,
        mfaMethod: "email",
      });

      setLoading(false);
      if (res.ok && res.data) {
        setTotpEnrollment(null);
        setEmailEnrollment({
          ...res.data,
          identifier,
          password,
          code: res.data.devOtp || "",
        });
        if (res.data.retryAfter || res.data.expiresInSec) {
          setEmailCooldown(res.data.retryAfter || 30);
        }
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to switch to email verification.");
    }
  };

  // Switch to Authenticator App during enrollment
  const handleSwitchToTotpEnrollment = async () => {
    setErrorMsg("");
    setLoading(true);
    const identifier = emailEnrollment?.identifier || signInIdentifier;
    const password = emailEnrollment?.password || signInPassword;

    try {
      const res = await sandeshApi.login({
        identifier,
        password: password || undefined,
        deviceId,
        mfaMethod: "totp",
      });

      setLoading(false);
      if (res.ok && res.data) {
        setEmailEnrollment(null);
        let qrDataUrl = "";
        try {
          if (res.data.otpauthUri) {
            qrDataUrl = await QRCode.toDataURL(res.data.otpauthUri, {
              width: 220,
              margin: 2,
              color: { dark: "#1e293b", light: "#ffffff" },
            });
          }
        } catch {}

        let devCode = null;
        if (res.data.secret) {
          devCode = await generateTotpCode(res.data.secret);
        }

        setTotpEnrollment({
          ...res.data,
          qrDataUrl,
          devCode,
          identifier,
          password,
          code: devCode || "",
        });
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to switch to authenticator app verification.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // CASE A / B: EMAIL ENROLLMENT VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────
  const handleVerifyEmailEnrollment = async (e) => {
    e?.preventDefault();
    if (!emailEnrollment?.code?.trim()) {
      setErrorMsg("Please enter the 6-digit verification code sent to your email.");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const res = await sandeshApi.login({
        identifier: emailEnrollment.identifier,
        password: emailEnrollment.password || undefined,
        emailOtp: emailEnrollment.code.trim(),
        deviceId,
      });

      setLoading(false);

      if (res.ok && res.data?.token) {
        setEmailEnrollment(null);
        handleSuccessfulLoginSession(res.data);
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to verify email code. Please try again.");
    }
  };

  // Resend Email code (with cooldown)
  const handleResendEmailCode = async (isChallenge = false) => {
    if (emailCooldown > 0) return;
    setErrorMsg("");
    setLoading(true);

    const target = isChallenge ? emailChallenge : emailEnrollment;
    try {
      const res = await sandeshApi.login({
        identifier: target.identifier,
        password: target.password || undefined,
        deviceId,
        mfaMethod: "email",
      });

      setLoading(false);
      if (res.ok && res.data) {
        if (isChallenge) {
          setEmailChallenge((prev) => ({
            ...prev,
            ...res.data,
            code: res.data.devOtp || prev.code,
          }));
        } else {
          setEmailEnrollment((prev) => ({
            ...prev,
            ...res.data,
            code: res.data.devOtp || prev.code,
          }));
        }
        setEmailCooldown(res.data.retryAfter || 30);
        setSuccessNotice("Fresh verification code sent to your email.");
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to resend email code.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // CASE D: DEVICE 2FA CHALLENGE (TOTP OR RECOVERY CODE)
  // ──────────────────────────────────────────────────────────────────────────
  const handleVerifyTotpChallenge = async (e) => {
    e?.preventDefault();
    if (!totpChallenge?.code?.trim()) {
      setErrorMsg("Please enter the code to continue.");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const payload = {
        identifier: totpChallenge.identifier,
        password: totpChallenge.password || undefined,
        deviceId,
      };

      if (totpChallenge.useRecovery) {
        payload.recoveryCode = totpChallenge.code.trim();
      } else {
        payload.totp = totpChallenge.code.trim();
      }

      const res = await sandeshApi.login(payload);
      setLoading(false);

      if (res.ok && res.data?.token) {
        setTotpChallenge(null);
        handleSuccessfulLoginSession(res.data);
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Verification failed. Please check the code and try again.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // CASE D: DEVICE EMAIL CHALLENGE (EMAIL OTP OR RECOVERY CODE)
  // ──────────────────────────────────────────────────────────────────────────
  const handleVerifyEmailChallenge = async (e) => {
    e?.preventDefault();
    if (!emailChallenge?.code?.trim()) {
      setErrorMsg("Please enter the code to continue.");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const payload = {
        identifier: emailChallenge.identifier,
        password: emailChallenge.password || undefined,
        deviceId,
      };

      if (emailChallenge.useRecovery) {
        payload.recoveryCode = emailChallenge.code.trim();
      } else {
        payload.emailOtp = emailChallenge.code.trim();
      }

      const res = await sandeshApi.login(payload);
      setLoading(false);

      if (res.ok && res.data?.token) {
        setEmailChallenge(null);
        handleSuccessfulLoginSession(res.data);
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Verification failed. Please check the code and try again.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RECOVERY CODES ACKNOWLEDGEMENT & DOWNLOAD
  // ──────────────────────────────────────────────────────────────────────────
  const handleCopyAllRecoveryCodes = () => {
    if (!recoveryReveal?.recoveryCodes) return;
    const text = [
      "SANDESH ENTERPRISE TWO-FACTOR RECOVERY CODES",
      "Created: " + new Date().toISOString(),
      "Identifier: " + (signInIdentifier || adminUsername),
      "---------------------------------------------",
      ...recoveryReveal.recoveryCodes.map((c, i) => `${(i + 1).toString().padStart(2, "0")}. ${c}`),
      "---------------------------------------------",
      "KEEP THESE CODES SECURE. EACH CODE CAN BE USED ONCE.",
    ].join("\n");

    navigator.clipboard.writeText(text);
    setCopiedRecovery(true);
    setTimeout(() => setCopiedRecovery(false), 2500);
  };

  const handleDownloadRecoveryCodes = () => {
    if (!recoveryReveal?.recoveryCodes) return;
    const text = [
      "SANDESH ENTERPRISE TWO-FACTOR RECOVERY CODES",
      "Created: " + new Date().toISOString(),
      "Identifier: " + (signInIdentifier || adminUsername),
      "---------------------------------------------",
      ...recoveryReveal.recoveryCodes.map((c, i) => `${(i + 1).toString().padStart(2, "0")}. ${c}`),
      "---------------------------------------------",
      "KEEP THESE CODES SECURE. EACH CODE CAN BE USED ONCE.",
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sandesh-recovery-codes-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFinishRecoveryReveal = () => {
    const session = recoveryReveal.pendingSession;
    setRecoveryReveal(null);

    // If admin must change password, force password change screen
    if (session.mustChangePassword && (session.user?.role === "admin" || session.user?.canManageUsers)) {
      setAdminPasswordChange({
        pendingSession: session,
        oldPassword: signInPassword || session.defaultPassword || "",
        newPassword: "",
        confirmPassword: "",
      });
      return;
    }

    const sessionUser = buildSessionUser(session);
    onLoginSuccess(sessionUser);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // MANDATORY ADMIN PASSWORD CHANGE
  // ──────────────────────────────────────────────────────────────────────────
  const handleAdminPasswordChange = async (e) => {
    e?.preventDefault();
    const { oldPassword, newPassword, confirmPassword, pendingSession } = adminPasswordChange;

    const validation = validatePasswordPolicy(newPassword);
    if (!validation.valid) {
      setErrorMsg(validation.message);
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg("New password and confirmation do not match.");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const res = await sandeshApi.changePassword(
        { oldPassword: oldPassword || undefined, newPassword },
        pendingSession.token
      );

      setLoading(false);

      if (res.ok) {
        setAdminPasswordChange(null);
        const sessionUser = buildSessionUser({
          ...pendingSession,
          mustChangePassword: false,
        });
        onLoginSuccess(sessionUser);
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to update password. Please try again.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // FLOW 1: FIRST-RUN ORG SETUP
  // ──────────────────────────────────────────────────────────────────────────
  const handleStartSetup = async (e) => {
    e?.preventDefault();
    if (publicData?.setupDone) {
      setErrorMsg("This organisation has already been configured. Please sign in or self-register.");
      setActiveTab("signin");
      return;
    }
    if (!adminOrg.trim() || !adminName.trim() || !adminEmail.trim() || !adminMobile.trim()) {
      setErrorMsg("Please fill in all required setup fields.");
      return;
    }

    setErrorMsg("");
    setSuccessNotice("");
    setLoading(true);

    try {
      const res = await sandeshApi.setupStart({
        org: adminOrg.trim(),
        name: adminName.trim(),
        username: adminUsername.trim() || undefined,
        email: adminEmail.trim(),
        mobile: adminMobile.trim(),
        setupToken: adminSetupToken.trim() || undefined,
      });

      setLoading(false);

      if (res.ok && res.data?.sent) {
        setSetupStep("otp");
        if (res.data.devOtp) {
          setSetupDevOtp(res.data.devOtp);
          setSetupOtp(res.data.devOtp);
        }
        setSuccessNotice(
          `Bootstrap verification code sent to ${adminMobile} / ${adminEmail}. (Valid for 5 minutes)`
        );
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to initiate setup. Please check your network connection.");
    }
  };

  const handleVerifySetupOtp = async (e) => {
    e?.preventDefault();
    if (!setupOtp.trim()) {
      setErrorMsg("Please enter the verification code sent to your phone/email.");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const res = await sandeshApi.setupVerify({ otp: setupOtp.trim() });
      setLoading(false);

      if (res.ok && res.data) {
        const data = res.data;
        // Step 3: Transition straight into Flow 3 Admin TOTP Enrollment
        // First admin always enrolls with mfaMethod: "totp"
        let qrDataUrl = "";
        try {
          if (data.otpauthUri) {
            qrDataUrl = await QRCode.toDataURL(data.otpauthUri, {
              width: 220,
              margin: 2,
              color: { dark: "#1e293b", light: "#ffffff" },
            });
          }
        } catch (qrErr) {
          console.error("QR Code generation error:", qrErr);
        }

        let devCode = null;
        if (data.secret) {
          devCode = await generateTotpCode(data.secret);
        }

        const username = data.user?.username || adminUsername || "admin";
        const defaultPassword = data.defaultPassword || "Sandesh" + username;

        setSignInIdentifier(username);
        setSignInPassword(defaultPassword);

        setTotpEnrollment({
          ...data,
          qrDataUrl,
          devCode,
          identifier: username,
          password: defaultPassword,
          code: devCode || "",
          isAdminFirstSetup: true,
        });

        setSuccessNotice("Organisation claimed successfully! Now complete mandatory administrator 2FA setup.");
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to verify setup OTP. Please try again.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // FLOW 2: SELF-REGISTRATION
  // ──────────────────────────────────────────────────────────────────────────
  const handleSelfRegistration = async (e) => {
    e?.preventDefault();
    if (!regName.trim() || !regEmail.trim()) {
      setErrorMsg("Please provide your full name and corporate email.");
      return;
    }

    const pwValidation = validatePasswordPolicy(regPassword);
    if (!pwValidation.valid) {
      setErrorMsg(pwValidation.message);
      return;
    }

    setErrorMsg("");
    setLoading(true);

    try {
      const payload = {
        name: regName.trim(),
        username: regUsername.trim() || undefined,
        email: regEmail.trim(),
        mobile: regMobile.trim() || undefined,
        password: regPassword,
      };

      if (regType === "employee") {
        payload.isEmployee = true;
        payload.branch = regBranch;
        payload.department = regDept;
        payload.designation = regDesignation;
      } else if (regType === "affiliate") {
        payload.isEmployee = false;
        payload.affiliate = regAffiliate || "Affiliate Partner";
        if (regAffiliateBranch) payload.affiliateBranch = regAffiliateBranch;
        payload.city = regCity;
        payload.country = regCountry;
        payload.pin = regPin;
      } else {
        payload.isEmployee = false;
        payload.category = regCategory;
        payload.city = regCity;
        payload.country = regCountry;
        payload.pin = regPin;
      }

      const res = await sandeshApi.register(payload);
      setLoading(false);

      if (res.ok && res.data) {
        setSelfRegSuccess(res.data);
        try {
          const existing = JSON.parse(localStorage.getItem("sandesh_pending_registrations") || "[]");
          const uName = payload.username || payload.name.toLowerCase().replace(/\s+/g, "");
          const record = {
            id: res.data.requestId || Date.now(),
            type: "registration",
            status: res.data.status === "approved" ? "accepted" : "pending",
            title: `New User Registration: ${payload.name}`,
            name: payload.name,
            username: uName,
            email: payload.email,
            mobile: payload.mobile,
            category: payload.category || (payload.isEmployee ? "Employee" : "Associate"),
            department: payload.department || (payload.isEmployee ? "Engineering" : "General"),
            designation: payload.designation || (payload.isEmployee ? "Associate" : "Partner"),
            time: "Just now",
            details: "Self-registered and waiting for admin permission to enter chat interface.",
            fromUser: uName,
            registeredAt: new Date().toISOString(),
          };
          const updated = [record, ...existing.filter((x) => x.username !== uName)];
          localStorage.setItem("sandesh_pending_registrations", JSON.stringify(updated));
        } catch {
          // ignore
        }
      } else {
        setErrorMsg(sandeshApi.getFriendlyErrorMessage(res.error));
      }
    } catch (err) {
      setLoading(false);
      setErrorMsg("Failed to submit registration request. Please try again.");
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER MODALS & OVERLAYS
  // ──────────────────────────────────────────────────────────────────────────

  // Sub-view: Recovery Codes Reveal (Case B)
  if (recoveryReveal) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-flow-badge">
              <ShieldCheck size={14} />
              <span>Step 2 of 2: Emergency Recovery Codes</span>
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 22 }}>
              Save Your Recovery Codes
            </h2>
            <div
              className="sandesh-alert sandesh-alert-danger"
              style={{ display: "flex", alignItems: "flex-start", gap: 8, textAlign: "left" }}
            >
              <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>CRITICAL:</strong> Save these 10 recovery codes now. They will{" "}
                <strong>never be shown again</strong>. Each code can be used once to access your account if you lose
                your authenticator device or email access.
              </div>
            </div>

            <div className="sandesh-recovery-grid">
              {recoveryReveal.recoveryCodes.map((code, idx) => (
                <div key={idx} className="sandesh-recovery-item">
                  <span className="sandesh-recovery-index">{(idx + 1).toString().padStart(2, "0")}.</span>
                  <span>{code}</span>
                </div>
              ))}
            </div>

            <div className="sandesh-actions-group" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className="sandesh-btn-secondary-3d"
                onClick={handleCopyAllRecoveryCodes}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                {copiedRecovery ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                <span>{copiedRecovery ? "Copied All!" : "Copy All Codes"}</span>
              </button>
              <button
                type="button"
                className="sandesh-btn-secondary-3d"
                onClick={handleDownloadRecoveryCodes}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Download size={16} />
                <span>Download .txt</span>
              </button>
            </div>

            <button
              type="button"
              className="sandesh-btn-primary-3d"
              onClick={handleFinishRecoveryReveal}
            >
              <span>I have securely saved my recovery codes</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: Mandatory Admin Password Change
  if (adminPasswordChange) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-flow-badge">
              <ShieldCheck size={14} />
              <span>Mandatory Security Step</span>
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 22 }}>
              Set New Administrator Password
            </h2>
            <p className="sandesh-subtext-muted">
              As an enterprise administrator, you must replace the initial default password with a secure password
              before accessing Sandesh.
            </p>

            {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}

            <form onSubmit={handleAdminPasswordChange} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <label>Current / Default Password</label>
                <div className="sandesh-input-box-3d">
                  <Lock size={18} className="sandesh-lucide-icon" />
                  <input
                    type="password"
                    value={adminPasswordChange.oldPassword}
                    onChange={(e) =>
                      setAdminPasswordChange((prev) => ({ ...prev, oldPassword: e.target.value }))
                    }
                    placeholder="Current default password"
                  />
                </div>
              </div>

              <div className="sandesh-input-group">
                <label>New Administrator Password</label>
                <div className="sandesh-input-box-3d">
                  <KeyRound size={18} className="sandesh-lucide-icon" />
                  <input
                    type="password"
                    value={adminPasswordChange.newPassword}
                    onChange={(e) =>
                      setAdminPasswordChange((prev) => ({ ...prev, newPassword: e.target.value }))
                    }
                    placeholder="Min 8 characters, letters & a digit"
                    required
                  />
                </div>
                <div className="sandesh-pw-meter">
                  <div
                    className="sandesh-pw-bar"
                    style={{
                      width: validatePasswordPolicy(adminPasswordChange.newPassword).valid ? "100%" : "35%",
                      background: validatePasswordPolicy(adminPasswordChange.newPassword).valid
                        ? "#10b981"
                        : "#f59e0b",
                    }}
                  />
                </div>
              </div>

              <div className="sandesh-input-group">
                <label>Confirm New Password</label>
                <div className="sandesh-input-box-3d">
                  <CheckCircle2 size={18} className="sandesh-lucide-icon" />
                  <input
                    type="password"
                    value={adminPasswordChange.confirmPassword}
                    onChange={(e) =>
                      setAdminPasswordChange((prev) => ({ ...prev, confirmPassword: e.target.value }))
                    }
                    placeholder="Confirm new password"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Updating Password..." : "Update Password & Launch Sandesh"}</span>
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: Case A/B TOTP Enrollment (QR + Secret + Code)
  if (totpEnrollment) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-flow-badge">
              <QrCode size={14} />
              <span>Two-Factor Authentication Setup</span>
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 22 }}>
              Scan QR in Authenticator App
            </h2>
            <p className="sandesh-subtext-muted">
              Scan this QR code using Google Authenticator, Microsoft Authenticator, or 1Password.
            </p>

            {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}

            {/* QR Code Container */}
            {totpEnrollment.qrDataUrl && (
              <div className="sandesh-qr-box">
                <img
                  src={totpEnrollment.qrDataUrl}
                  alt="Scan TOTP QR Code"
                  className="sandesh-qr-img"
                />
              </div>
            )}

            {/* Secret for manual entry */}
            <div className="sandesh-secret-container">
              <div>
                <div style={{ fontSize: 10.5, color: "var(--sandesh-text-subtle)", fontWeight: 600 }}>
                  CANNOT SCAN? ENTER SECRET MANUALLY:
                </div>
                <div className="sandesh-secret-code">{totpEnrollment.secret}</div>
              </div>
              <button
                type="button"
                className="sandesh-btn-mini-primary"
                onClick={() => {
                  navigator.clipboard.writeText(totpEnrollment.secret);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
              >
                {copiedKey ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Recommended Apps Links */}
            {Array.isArray(totpEnrollment.recommendedApps) && totpEnrollment.recommendedApps.length > 0 && (
              <div className="sandesh-recommended-apps">
                <span style={{ fontWeight: 600, color: "var(--sandesh-text-main)" }}>
                  Need an authenticator app?
                </span>
                <div className="sandesh-apps-links">
                  {totpEnrollment.recommendedApps.map((app, idx) => (
                    <div key={idx} style={{ display: "inline-flex", gap: 4 }}>
                      {app.ios && (
                        <a
                          href={app.ios}
                          target="_blank"
                          rel="noreferrer"
                          className="sandesh-app-link-btn"
                        >
                          {app.name} (iOS) <ExternalLink size={10} />
                        </a>
                      )}
                      {app.android && (
                        <a
                          href={app.android}
                          target="_blank"
                          rel="noreferrer"
                          className="sandesh-app-link-btn"
                        >
                          {app.name} (Android) <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verification Code Form */}
            <form onSubmit={handleVerifyTotpEnrollment} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <div className="label-with-action">
                  <label>Enter 6-Digit Authenticator Code</label>
                  {totpEnrollment.devCode && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        setTotpEnrollment((prev) => ({ ...prev, code: totpEnrollment.devCode }))
                      }
                      title="Computed for testing using dev TOTP algorithm"
                    >
                      Fill Dev Code: {totpEnrollment.devCode}
                    </button>
                  )}
                </div>
                <div className="sandesh-input-box-3d">
                  <KeyRound size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    maxLength={8}
                    placeholder="e.g. 123456"
                    value={totpEnrollment.code}
                    onChange={(e) =>
                      setTotpEnrollment((prev) => ({ ...prev, code: e.target.value }))
                    }
                    autoFocus
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Verifying..." : "Verify Code & Enroll Device"}</span>
                <ArrowRight size={18} />
              </button>

              {/* Offer email alternative unless this is first admin setup */}
              {!totpEnrollment.isAdminFirstSetup && (
                <div style={{ marginTop: 14, textAlign: "center" }}>
                  <button
                    type="button"
                    className="sandesh-btn-link"
                    onClick={handleSwitchToEmailEnrollment}
                    disabled={loading}
                  >
                    ✉️ Prefer an emailed code? Email me a code instead
                  </button>
                </div>
              )}

              <div style={{ marginTop: 10, textAlign: "center" }}>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() => setTotpEnrollment(null)}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: Case A/B Email Enrollment
  if (emailEnrollment) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-flow-badge">
              <Mail size={14} />
              <span>Two-Factor Authentication Setup</span>
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 22 }}>
              Check Your Email
            </h2>
            <p className="sandesh-subtext-muted">
              A 6-digit verification code has been emailed to your registered address.
            </p>

            {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}
            {successNotice && <div className="sandesh-alert sandesh-alert-success">{successNotice}</div>}

            <form onSubmit={handleVerifyEmailEnrollment} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <div className="label-with-action">
                  <label>Verification Code</label>
                  {emailEnrollment.devOtp && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        setEmailEnrollment((prev) => ({ ...prev, code: emailEnrollment.devOtp }))
                      }
                    >
                      Fill Dev Code: {emailEnrollment.devOtp}
                    </button>
                  )}
                </div>
                <div className="sandesh-input-box-3d">
                  <KeyRound size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    maxLength={8}
                    placeholder="Enter 6-digit code"
                    value={emailEnrollment.code}
                    onChange={(e) =>
                      setEmailEnrollment((prev) => ({ ...prev, code: e.target.value }))
                    }
                    autoFocus
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Verifying..." : "Verify Code & Complete Setup"}</span>
                <ArrowRight size={18} />
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() => handleResendEmailCode(false)}
                  disabled={emailCooldown > 0 || loading}
                >
                  <RotateCcw size={12} style={{ display: "inline", marginRight: 4 }} />
                  {emailCooldown > 0 ? `Resend Code in ${emailCooldown}s` : "Resend Email Code"}
                </button>

                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={handleSwitchToTotpEnrollment}
                  disabled={loading}
                >
                  Use Authenticator App instead
                </button>
              </div>

              <div style={{ marginTop: 12, textAlign: "center" }}>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() => setEmailEnrollment(null)}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: Case D TOTP Challenge (Untrusted Device)
  if (totpChallenge) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-flow-badge">
              <Laptop size={14} />
              <span>Device Security Verification</span>
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 22 }}>
              {totpChallenge.useRecovery ? "Enter Recovery Code" : "Authenticator Code Required"}
            </h2>
            <p className="sandesh-subtext-muted">
              {totpChallenge.useRecovery
                ? "Enter one of your 10 saved emergency recovery codes to authenticate this device."
                : "This device hasn't verified recently. Enter the 6-digit code from your authenticator app."}
            </p>

            {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}

            <form onSubmit={handleVerifyTotpChallenge} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <label>
                  {totpChallenge.useRecovery ? "Recovery Code (e.g. ABCDE-FGHJK)" : "6-Digit Authenticator Code"}
                </label>
                <div className="sandesh-input-box-3d">
                  <KeyRound size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    placeholder={totpChallenge.useRecovery ? "ABCDE-FGHJK" : "123456"}
                    value={totpChallenge.code}
                    onChange={(e) =>
                      setTotpChallenge((prev) => ({ ...prev, code: e.target.value }))
                    }
                    autoFocus
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Verifying..." : "Verify & Trust Device for 14 Days"}</span>
                <ArrowRight size={18} />
              </button>

              <div style={{ marginTop: 14, textAlign: "center" }}>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() =>
                    setTotpChallenge((prev) => ({
                      ...prev,
                      useRecovery: !prev.useRecovery,
                      code: "",
                    }))
                  }
                >
                  {totpChallenge.useRecovery
                    ? "Use Authenticator App Code instead"
                    : "Lost your device? Use a Recovery Code"}
                </button>
              </div>

              <div style={{ marginTop: 10, textAlign: "center" }}>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() => setTotpChallenge(null)}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: Case D Email Challenge (Untrusted Device)
  if (emailChallenge) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-flow-badge">
              <Mail size={14} />
              <span>Device Security Verification</span>
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 22 }}>
              {emailChallenge.useRecovery ? "Enter Recovery Code" : "Verification Code Sent"}
            </h2>
            <p className="sandesh-subtext-muted">
              {emailChallenge.useRecovery
                ? "Enter one of your 10 saved emergency recovery codes to authenticate this device."
                : "A 6-digit verification code was emailed to your address to verify this device."}
            </p>

            {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}
            {successNotice && <div className="sandesh-alert sandesh-alert-success">{successNotice}</div>}

            <form onSubmit={handleVerifyEmailChallenge} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <div className="label-with-action">
                  <label>
                    {emailChallenge.useRecovery
                      ? "Recovery Code (e.g. ABCDE-FGHJK)"
                      : "6-Digit Email Code"}
                  </label>
                  {!emailChallenge.useRecovery && emailChallenge.devOtp && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        setEmailChallenge((prev) => ({ ...prev, code: emailChallenge.devOtp }))
                      }
                    >
                      Fill Dev Code: {emailChallenge.devOtp}
                    </button>
                  )}
                </div>
                <div className="sandesh-input-box-3d">
                  <KeyRound size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    placeholder={emailChallenge.useRecovery ? "ABCDE-FGHJK" : "123456"}
                    value={emailChallenge.code}
                    onChange={(e) =>
                      setEmailChallenge((prev) => ({ ...prev, code: e.target.value }))
                    }
                    autoFocus
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Verifying..." : "Verify & Trust Device for 14 Days"}</span>
                <ArrowRight size={18} />
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                {!emailChallenge.useRecovery && (
                  <button
                    type="button"
                    className="sandesh-btn-link"
                    onClick={() => handleResendEmailCode(true)}
                    disabled={emailCooldown > 0 || loading}
                  >
                    <RotateCcw size={12} style={{ display: "inline", marginRight: 4 }} />
                    {emailCooldown > 0 ? `Resend Code in ${emailCooldown}s` : "Resend Email Code"}
                  </button>
                )}

                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() =>
                    setEmailChallenge((prev) => ({
                      ...prev,
                      useRecovery: !prev.useRecovery,
                      code: "",
                    }))
                  }
                >
                  {emailChallenge.useRecovery
                    ? "Use Email Verification Code instead"
                    : "Lost access? Use Recovery Code"}
                </button>
              </div>

              <div style={{ marginTop: 12, textAlign: "center" }}>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() => setEmailChallenge(null)}
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: Registration Request Submitted
  if (selfRegSuccess) {
    return (
      <div className="sandesh-auth-wrapper">
        <SmokeyBackground
          color="#ff7a59"
          backgroundColor="#fff3eb"
          accentColor="#ff5757"
          backdropBlurAmount="md"
          className="sandesh-webgl-smokey"
        />
        <div className="sandesh-auth-container">
          <div className="sandesh-glass-card sandesh-auth-subcard">
            <div className="sandesh-brand-badge-3d" style={{ marginBottom: 10 }}>
              <CheckCircle2 size={48} color="#10b981" />
            </div>

            <h2 className="sandesh-auth-title" style={{ fontSize: 24 }}>
              Registration Submitted
            </h2>
            <p className="sandesh-auth-tagline">
              Your onboarding request has been dispatched for host approval.
            </p>

            <div
              className="sandesh-alert sandesh-alert-success"
              style={{ textAlign: "left", lineHeight: 1.6 }}
            >
              <div>
                <strong>Request Reference:</strong> #{selfRegSuccess.requestId || "REQ-SD"}
              </div>
              <div>
                <strong>Status:</strong> Pending Host / Admin Approval
              </div>
              {selfRegSuccess.awaitingApprovalFrom > 0 && (
                <div>
                  <strong>Awaiting Response:</strong> Sent to {selfRegSuccess.awaitingApprovalFrom}{" "}
                  designated host(s)
                </div>
              )}
            </div>

            <p className="sandesh-subtext-muted" style={{ textAlign: "center" }}>
              Once an administrator or host approves your request, you can sign in directly using your email or
              username to complete two-factor authentication setup.
            </p>

            <button
              type="button"
              className="sandesh-btn-primary-3d"
              onClick={() => {
                setSelfRegSuccess(null);
                setActiveTab("signin");
              }}
            >
              <span>Return to Sign In</span>
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MAIN VIEW: 3 TABS (SIGN IN, FIRST-TIME SETUP, SELF-REGISTER)
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="sandesh-auth-wrapper">
      <SmokeyBackground
        color="#ff7a59"
        backgroundColor="#fff3eb"
        accentColor="#ff5757"
        backdropBlurAmount="md"
        className="sandesh-webgl-smokey"
      />

      <div className="sandesh-ambient-canvas">
        <div className="peach-orb peach-orb-1" />
        <div className="peach-orb peach-orb-2" />
        <div className="peach-orb peach-orb-3" />
        <div className="peach-orb-mesh" />
      </div>

      <div className="sandesh-auth-container">
        <div className="sandesh-glass-card sandesh-auth-card">
          {/* Header Brand */}
          <div className="sandesh-auth-header">
            <div className="sandesh-brand-badge-3d">
              <img src={sandeshLogo} alt="Sandesh Logo" className="sandesh-brand-badge-img" />
            </div>
            <h1 className="sandesh-auth-title">Sandesh</h1>
            <p className="sandesh-auth-tagline">
              {publicData?.org
                ? `${publicData.org} • Enterprise Platform`
                : "Enterprise Messaging & Collaboration Platform"}
            </p>
            <div className="sandesh-enterprise-pill">
              <span className="live-dot" /> Connected: {publicData?.org ? "Live Organisation" : "Active Core"}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="sandesh-tab-pills-3d">
            <button
              type="button"
              className={`sandesh-tab-pill ${activeTab === "signin" ? "active" : ""}`}
              onClick={() => handleTabChange("signin")}
            >
              Sign In
            </button>
            {(!publicData || publicData.setupDone === false) && (
              <button
                type="button"
                className={`sandesh-tab-pill ${activeTab === "first_admin" ? "active" : ""}`}
                onClick={() => handleTabChange("first_admin")}
              >
                First Time Setup
              </button>
            )}
            <button
              type="button"
              className={`sandesh-tab-pill ${activeTab === "self_reg" ? "active" : ""}`}
              onClick={() => handleTabChange("self_reg")}
            >
              Self Register
            </button>
          </div>

          {/* Alerts */}
          {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}
          {successNotice && <div className="sandesh-alert sandesh-alert-success">{successNotice}</div>}

          {/* ────────────────────────────────────────────────────────────── */}
          {/* TAB 1: USER SIGN IN */}
          {/* ────────────────────────────────────────────────────────────── */}
          {activeTab === "signin" && (
            <form onSubmit={handleSignIn} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <label>Username, Email, or Mobile</label>
                <div className="sandesh-input-box-3d">
                  <User size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    placeholder="e.g. username, email, or +919886000000"
                    value={signInIdentifier}
                    onChange={(e) => setSignInIdentifier(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="sandesh-input-group">
                <div className="label-with-action">
                  <label>Password (required for Admin accounts)</label>
                </div>
                <div className="sandesh-input-box-3d">
                  <Lock size={18} className="sandesh-lucide-icon" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password (optional for non-admins)"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="sandesh-input-action-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Authenticating..." : "Sign In to Sandesh"}</span>
                <ArrowRight size={18} className="sandesh-btn-arrow" />
              </button>
            </form>
          )}

          {/* ────────────────────────────────────────────────────────────── */}
          {/* TAB 2: FIRST TIME ORG SETUP (FLOW 1) */}
          {/* ────────────────────────────────────────────────────────────── */}
          {activeTab === "first_admin" && (
            publicData?.setupDone ? (
              <div className="sandesh-configured-notice-box" style={{ padding: "24px 20px", textAlign: "center" }}>
                <div
                  className="sandesh-flow-badge"
                  style={{ margin: "0 auto 12px auto", background: "rgba(52, 199, 89, 0.15)", color: "#34c759", display: "inline-flex" }}
                >
                  <CheckCircle2 size={15} />
                  <span>Organisation Active &amp; Configured</span>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0", color: "var(--sandesh-text-primary, #1c1c1e)" }}>
                  {publicData.org || "Agile Labs Enterprise"} is Live
                </h3>
                <p style={{ fontSize: 13, color: "var(--sandesh-text-muted, #666)", lineHeight: 1.5, marginBottom: 20 }}>
                  This Sandesh enterprise server has already completed initial bootstrap setup. If you are an existing user or administrator, please Sign In. To join as a new user, please Self Register.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="sandesh-btn-primary-3d"
                    onClick={() => handleTabChange("signin")}
                    style={{ minWidth: 150 }}
                  >
                    <User size={16} />
                    <span>Sign In</span>
                  </button>
                  <button
                    type="button"
                    className="sandesh-btn-secondary-3d"
                    onClick={() => handleTabChange("self_reg")}
                    style={{ minWidth: 150 }}
                  >
                    <Briefcase size={16} />
                    <span>Self Register</span>
                  </button>
                </div>
              </div>
            ) : (
            <form
              onSubmit={setupStep === "form" ? handleStartSetup : handleVerifySetupOtp}
              className="sandesh-auth-form"
            >
              {setupStep === "form" ? (
                <>
                  <div className="sandesh-input-group">
                    <label>Enterprise Organisation Name</label>
                    <div className="sandesh-input-box-3d">
                      <Building2 size={18} className="sandesh-lucide-icon" />
                      <input
                        type="text"
                        placeholder="e.g. Agile Labs Enterprise"
                        value={adminOrg}
                        onChange={(e) => setAdminOrg(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="sandesh-form-row">
                    <div className="sandesh-input-group">
                      <label>Administrator Full Name</label>
                      <div className="sandesh-input-box-3d">
                        <ShieldCheck size={18} className="sandesh-lucide-icon" />
                        <input
                          type="text"
                          placeholder="Full Name"
                          value={adminName}
                          onChange={(e) => setAdminName(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="sandesh-input-group">
                      <label>Desired Username (Optional)</label>
                      <div className="sandesh-input-box-3d">
                        <User size={18} className="sandesh-lucide-icon" />
                        <input
                          type="text"
                          placeholder="e.g. admin"
                          value={adminUsername}
                          onChange={(e) => setAdminUsername(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="sandesh-form-row">
                    <div className="sandesh-input-group">
                      <label>Corporate Email ID</label>
                      <div className="sandesh-input-box-3d">
                        <Mail size={18} className="sandesh-lucide-icon" />
                        <input
                          type="email"
                          placeholder="admin@organisation.com"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="sandesh-input-group">
                      <label>Mobile Number</label>
                      <div className="sandesh-input-box-3d">
                        <Phone size={18} className="sandesh-lucide-icon" />
                        <input
                          type="text"
                          placeholder="+91 98860 00000"
                          value={adminMobile}
                          onChange={(e) => setAdminMobile(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="sandesh-input-group">
                    <label>Setup Token (Optional — only if required by server)</label>
                    <div className="sandesh-input-box-3d">
                      <KeyRound size={18} className="sandesh-lucide-icon" />
                      <input
                        type="text"
                        placeholder="Leave blank unless configured"
                        value={adminSetupToken}
                        onChange={(e) => setAdminSetupToken(e.target.value)}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="sandesh-btn-primary-3d"
                    disabled={loading}
                  >
                    <span>{loading ? "Sending Bootstrap OTP..." : "Send Verification OTP"}</span>
                    <ArrowRight size={18} className="sandesh-btn-arrow" />
                  </button>
                </>
              ) : (
                <>
                  <div className="sandesh-input-group">
                    <div className="label-with-action">
                      <label>Bootstrap OTP Code</label>
                      {setupDevOtp && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setSetupOtp(setupDevOtp)}
                        >
                          Fill Dev OTP: {setupDevOtp}
                        </button>
                      )}
                    </div>
                    <div className="sandesh-input-box-3d">
                      <KeyRound size={18} className="sandesh-lucide-icon" />
                      <input
                        type="text"
                        placeholder="Enter 6-digit verification code"
                        value={setupOtp}
                        onChange={(e) => setSetupOtp(e.target.value)}
                        autoFocus
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="sandesh-btn-primary-3d"
                    disabled={loading}
                  >
                    <span>
                      {loading ? "Verifying & Initializing..." : "Verify & Initialize Organisation"}
                    </span>
                    <ArrowRight size={18} className="sandesh-btn-arrow" />
                  </button>

                  <div style={{ marginTop: 12, textAlign: "center" }}>
                    <button
                      type="button"
                      className="sandesh-btn-link"
                      onClick={() => setSetupStep("form")}
                    >
                      ← Edit Organisation Details
                    </button>
                  </div>
                </>
              )}
            </form>
            )
          )}

          {/* ────────────────────────────────────────────────────────────── */}
          {/* TAB 3: SELF REGISTRATION (FLOW 2) */}
          {/* ────────────────────────────────────────────────────────────── */}
          {activeTab === "self_reg" && (
            <form onSubmit={handleSelfRegistration} className="sandesh-auth-form">
              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Full Name</label>
                  <div className="sandesh-input-box-3d">
                    <User size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      placeholder="Your full name"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="sandesh-input-group">
                  <label>Desired Username (Optional)</label>
                  <div className="sandesh-input-box-3d">
                    <User size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      placeholder="e.g. john_doe"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Email Address</label>
                  <div className="sandesh-input-box-3d">
                    <Mail size={18} className="sandesh-lucide-icon" />
                    <input
                      type="email"
                      placeholder="name@company.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="sandesh-input-group">
                  <label>Mobile Number</label>
                  <div className="sandesh-input-box-3d">
                    <Phone size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      placeholder="+91..."
                      value={regMobile}
                      onChange={(e) => setRegMobile(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="sandesh-input-group">
                <label>Password (Min 8 chars, letters + digit)</label>
                <div className="sandesh-input-box-3d">
                  <Lock size={18} className="sandesh-lucide-icon" />
                  <input
                    type={showRegPassword ? "text" : "password"}
                    placeholder="Choose a strong password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="sandesh-input-action-btn"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                  >
                    {showRegPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="sandesh-pw-meter">
                  <div
                    className="sandesh-pw-bar"
                    style={{
                      width: validatePasswordPolicy(regPassword).valid ? "100%" : "30%",
                      background: validatePasswordPolicy(regPassword).valid ? "#10b981" : "#f59e0b",
                    }}
                  />
                </div>
              </div>

              <div className="sandesh-input-group">
                <label>Registration Type</label>
                <div className="sandesh-input-box-3d select-box">
                  <Layers size={18} className="sandesh-lucide-icon" />
                  <select
                    value={regType}
                    onChange={(e) => setRegType(e.target.value)}
                  >
                    <option value="employee">Enterprise Employee</option>
                    <option value="external">Individual Customer / Citizen</option>
                    <option value="affiliate">Affiliate Partner</option>
                  </select>
                </div>
              </div>

              {regType === "employee" && (
                <div className="sandesh-form-row">
                  <div className="sandesh-input-group">
                    <label>Branch</label>
                    <div className="sandesh-input-box-3d">
                      <Building2 size={18} className="sandesh-lucide-icon" />
                      <input
                        type="text"
                        value={regBranch}
                        onChange={(e) => setRegBranch(e.target.value)}
                        placeholder="e.g. Bangalore HQ"
                      />
                    </div>
                  </div>

                  <div className="sandesh-input-group">
                    <label>Department</label>
                    <div className="sandesh-input-box-3d">
                      <Briefcase size={18} className="sandesh-lucide-icon" />
                      <input
                        type="text"
                        value={regDept}
                        onChange={(e) => setRegDept(e.target.value)}
                        placeholder="e.g. Engineering"
                      />
                    </div>
                  </div>

                  <div className="sandesh-input-group">
                    <label>Designation</label>
                    <div className="sandesh-input-box-3d">
                      <ShieldCheck size={18} className="sandesh-lucide-icon" />
                      <input
                        type="text"
                        value={regDesignation}
                        onChange={(e) => setRegDesignation(e.target.value)}
                        placeholder="e.g. Specialist"
                      />
                    </div>
                  </div>
                </div>
              )}

              {regType === "external" && (
                <>
                  <div className="sandesh-input-group">
                    <label>Category</label>
                    <div className="sandesh-input-box-3d select-box">
                      <Layers size={18} className="sandesh-lucide-icon" />
                      <select
                        value={regCategory}
                        onChange={(e) => setRegCategory(e.target.value)}
                      >
                        <option value="Citizen">Citizen</option>
                        <option value="Customer">Customer</option>
                        <option value="Vendor">Vendor / Supplier</option>
                        <option value="Consultant">Consultant</option>
                        <option value="Patient">Patient</option>
                      </select>
                    </div>
                  </div>

                  <div className="sandesh-form-row">
                    <div className="sandesh-input-group">
                      <label>City</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regCity}
                          onChange={(e) => setRegCity(e.target.value)}
                          placeholder="City"
                          required
                        />
                      </div>
                    </div>
                    <div className="sandesh-input-group">
                      <label>Country</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regCountry}
                          onChange={(e) => setRegCountry(e.target.value)}
                          placeholder="Country"
                          required
                        />
                      </div>
                    </div>
                    <div className="sandesh-input-group">
                      <label>Postal PIN</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regPin}
                          onChange={(e) => setRegPin(e.target.value)}
                          placeholder="PIN"
                          required
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {regType === "affiliate" && (
                <>
                  <div className="sandesh-form-row">
                    <div className="sandesh-input-group">
                      <label>Affiliate Organisation</label>
                      <div className="sandesh-input-box-3d">
                        <Building2 size={18} className="sandesh-lucide-icon" />
                        <input
                          type="text"
                          value={regAffiliate}
                          onChange={(e) => setRegAffiliate(e.target.value)}
                          placeholder="Partner Org"
                          required
                        />
                      </div>
                    </div>
                    <div className="sandesh-input-group">
                      <label>Affiliate Branch (Optional)</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regAffiliateBranch}
                          onChange={(e) => setRegAffiliateBranch(e.target.value)}
                          placeholder="Branch"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="sandesh-form-row">
                    <div className="sandesh-input-group">
                      <label>City</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regCity}
                          onChange={(e) => setRegCity(e.target.value)}
                          placeholder="City"
                        />
                      </div>
                    </div>
                    <div className="sandesh-input-group">
                      <label>Country</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regCountry}
                          onChange={(e) => setRegCountry(e.target.value)}
                          placeholder="Country"
                        />
                      </div>
                    </div>
                    <div className="sandesh-input-group">
                      <label>PIN</label>
                      <div className="sandesh-input-box-3d">
                        <input
                          type="text"
                          value={regPin}
                          onChange={(e) => setRegPin(e.target.value)}
                          placeholder="PIN"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Submitting Registration..." : "Request Onboarding & Continue"}</span>
                <ArrowRight size={18} className="sandesh-btn-arrow" />
              </button>
            </form>
          )}

          {/* ────────────────────────────────────────────────────────────── */}
          {/* DEVICE ID TESTING BAR & FOOTER */}
          {/* ────────────────────────────────────────────────────────────── */}
          <div className="sandesh-device-bar">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Smartphone size={14} color="var(--sandesh-coral-accent)" />
              <span>Device:</span>
              <span className="sandesh-device-id-mono" title={deviceId}>
                {deviceId.slice(0, 8)}...{deviceId.slice(-4)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className="sandesh-dev-chip"
                onClick={() => {
                  const fresh = sandeshApi.rotateDeviceId();
                  setDeviceId(fresh);
                  setSuccessNotice("Rotated to fresh Device ID! Next login tests unrecognised device flow (Case D).");
                }}
                title="Rotate Device ID to test Case D without waiting 14 days"
              >
                <RefreshCw size={11} />
                <span>Rotate Device</span>
              </button>
              <button
                type="button"
                className="sandesh-dev-chip"
                onClick={() => {
                  try {
                    localStorage.removeItem("sandesh_session_user");
                    localStorage.removeItem("sandesh_device_id");
                    sessionStorage.clear();
                  } catch {
                    // ignore
                  }
                  const freshDevId = sandeshApi.rotateDeviceId();
                  setDeviceId(freshDevId);
                  setSignInIdentifier("");
                  setSignInPassword("");
                  setAdminOrg("");
                  setAdminName("");
                  setAdminUsername("");
                  setAdminEmail("");
                  setAdminMobile("");
                  setAdminSetupToken("");
                  setRegName("");
                  setRegUsername("");
                  setRegEmail("");
                  setRegMobile("");
                  setRegPassword("");
                  setErrorMsg("");
                  setSelfRegSuccess(null);
                  setTotpEnrollment(null);
                  setEmailEnrollment(null);
                  setTotpChallenge(null);
                  setEmailChallenge(null);
                  setRecoveryReveal(null);
                  setAdminPasswordChange(null);
                  sandeshApi.getPublic().then((res) => {
                    if (res.ok && res.data) {
                      setPublicData(res.data);
                      if (res.data.setupDone) {
                        setActiveTab("signin");
                      } else {
                        setActiveTab("first_admin");
                      }
                    }
                  });
                  setSuccessNotice("Local cache and session data cleared successfully.");
                }}
                title="Clear all stored session data, cached forms, and device tokens"
              >
                <Trash2 size={11} />
                <span>Clear Cache &amp; Reset</span>
              </button>
            </div>
          </div>

          <div className="sandesh-auth-footer">
            <span>Powered by Sandesh Enterprise • Secured with Erlang/OTP real-time core</span>
          </div>
        </div>
      </div>
    </div>
  );
}
