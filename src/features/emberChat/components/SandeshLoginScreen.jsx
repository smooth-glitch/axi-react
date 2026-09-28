import { useState } from "react";
import { authorizedUsers } from "../data/sampleData.js";
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
} from "lucide-react";

export default function SandeshLoginScreen({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState("signin"); // "signin" | "first_admin" | "self_reg"

  // Sign In State
  const [signInIdentifier, setSignInIdentifier] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInWithOtp, setSignInWithOtp] = useState(false);
  const [signInOtp, setSignInOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // First Time Setup State
  const [adminOrg, setAdminOrg] = useState("Agile Labs Enterprise");
  const [adminName, setAdminName] = useState("Sabarish");
  const [adminEmail, setAdminEmail] = useState("sabarish@agilelabs.com");
  const [adminMobile, setAdminMobile] = useState("+91 98860 11111");
  const [adminPassword, setAdminPassword] = useState("SandeshAdmin123");
  const [adminOtp, setAdminOtp] = useState("");
  const [adminOtpSent, setAdminOtpSent] = useState(false);

  // Self Registration State
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [regCategory, setRegCategory] = useState("employee");
  const [regOrg, setRegOrg] = useState("Agile Labs");
  const [regBranch, setRegBranch] = useState("Bangalore HQ");
  const [regDept, setRegDept] = useState("Engineering");
  const [regDesignation, setRegDesignation] = useState("Systems Specialist");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successNotice, setSuccessNotice] = useState("");

  const handleSignIn = (e) => {
    e.preventDefault();
    if (!signInIdentifier) {
      setErrorMsg("Please enter your username, email, or name.");
      return;
    }
    setErrorMsg("");
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      const raw = signInIdentifier.trim().toLowerCase();
      const foundUser = authorizedUsers.find(
        (u) =>
          u.username.toLowerCase() === raw ||
          u.name.toLowerCase() === raw ||
          u.name.toLowerCase().includes(raw) ||
          (u.email && u.email.toLowerCase() === raw)
      );

      if (!foundUser) {
        setErrorMsg(
          "Access restricted: Only authorized personnel (Sabarish, Nageshwari, Gunn Kataria, Anish, Arjun) are permitted to sign in."
        );
        return;
      }

      onLoginSuccess({
        ...foundUser,
        token: "sandesh-jwt-" + Date.now(),
        armSessionId: "arm-sess-" + Date.now(),
      });
    }, 500);
  };

  const handleFirstAdminSetup = (e) => {
    e.preventDefault();
    if (!adminOtpSent) {
      setAdminOtpSent(true);
      setSuccessNotice("Verification OTP sent to " + adminMobile + " (Enter 123456 to verify)");
      return;
    }

    if (adminOtp !== "123456" && adminOtp.length < 4) {
      setErrorMsg("Please enter a valid 6-digit OTP code (use 123456 for demo).");
      return;
    }

    setErrorMsg("");
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      const cleanAdmin = adminName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || "admin";
      onLoginSuccess({
        name: adminName,
        username: cleanAdmin,
        role: "Primary Enterprise Administrator",
        org: adminOrg,
        category: "employee",
        branch: "Bangalore HQ",
        department: "Executive Leadership",
        designation: "Administrator",
        status: "Available",
        initials: (adminName[0] + (adminName.split(" ")[1]?.[0] || "A")).toUpperCase(),
        color: "#ff7a59",
        isAdmin: true,
        token: "sandesh-admin-token-" + Date.now(),
        armSessionId: "arm-sess-" + Date.now(),
      });
    }, 700);
  };

  const handleSelfReg = (e) => {
    e.preventDefault();
    if (!regName || !regEmail) {
      setErrorMsg("Please provide your name and email address.");
      return;
    }
    setErrorMsg("");
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      const cleanReg = regName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || "associate";
      onLoginSuccess({
        name: regName,
        username: cleanReg,
        role: regCategory === "employee" ? "Employee" : "Affiliate Member",
        org: regOrg,
        category: regCategory,
        branch: regBranch,
        department: regDept,
        designation: regDesignation,
        status: "Available",
        initials: regName.slice(0, 2).toUpperCase(),
        color: "#ff9472",
        isAdmin: false,
        token: "sandesh-reg-token-" + Date.now(),
        armSessionId: "arm-sess-" + Date.now(),
      });
    }, 700);
  };

  return (
    <div className="sandesh-auth-wrapper">
      {/* Interactive WebGL Shader Smokey Background in Sandesh Coral & Peach */}
      <SmokeyBackground
        color="#ff7a59"
        backgroundColor="#fff3eb"
        accentColor="#ff5757"
        backdropBlurAmount="md"
        className="sandesh-webgl-smokey"
      />

      {/* 3D Ambient Peach Lighting & Glow Orbs */}
      <div className="sandesh-ambient-canvas">
        <div className="peach-orb peach-orb-1" />
        <div className="peach-orb peach-orb-2" />
        <div className="peach-orb peach-orb-3" />
        <div className="peach-orb-mesh" />
      </div>

      <div className="sandesh-auth-container">
        {/* Floating 3D Crystal Card */}
        <div className="sandesh-glass-card sandesh-auth-card">
          {/* Header Brand */}
          <div className="sandesh-auth-header">
            <div className="sandesh-brand-badge-3d">
              <img src={sandeshLogo} alt="Sandesh Logo" className="sandesh-brand-badge-img" />
            </div>
            <h1 className="sandesh-auth-title">Sandesh</h1>
            <p className="sandesh-auth-tagline">Enterprise Messaging &amp; Collaboration Platform</p>
            <div className="sandesh-enterprise-pill">
              <span className="live-dot" /> Connected to Organization Infra
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="sandesh-tab-pills-3d">
            <button
              type="button"
              className={`sandesh-tab-pill ${activeTab === "signin" ? "active" : ""}`}
              onClick={() => { setActiveTab("signin"); setErrorMsg(""); setSuccessNotice(""); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`sandesh-tab-pill ${activeTab === "first_admin" ? "active" : ""}`}
              onClick={() => { setActiveTab("first_admin"); setErrorMsg(""); setSuccessNotice(""); }}
            >
              First Time Setup
            </button>
            <button
              type="button"
              className={`sandesh-tab-pill ${activeTab === "self_reg" ? "active" : ""}`}
              onClick={() => { setActiveTab("self_reg"); setErrorMsg(""); setSuccessNotice(""); }}
            >
              Self Register
            </button>
          </div>

          {/* Error and Success alerts */}
          {errorMsg && <div className="sandesh-alert sandesh-alert-danger">{errorMsg}</div>}
          {successNotice && <div className="sandesh-alert sandesh-alert-success">{successNotice}</div>}

          {/* TAB 1: User Sign In */}
          {activeTab === "signin" && (
            <form onSubmit={handleSignIn} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <label>Username, Email, or Mobile</label>
                <div className="sandesh-input-box-3d">
                  <User size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    placeholder="e.g. alice, bob, arjun"
                    value={signInIdentifier}
                    onChange={(e) => setSignInIdentifier(e.target.value)}
                    required
                  />
                </div>
              </div>

              {!signInWithOtp ? (
                <div className="sandesh-input-group">
                  <div className="label-with-action">
                    <label>Password</label>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setSignInWithOtp(true);
                        setOtpSent(true);
                        setSuccessNotice("OTP sent: Use 123456 to test");
                      }}
                    >
                      Login via OTP instead
                    </button>
                  </div>
                  <div className="sandesh-input-box-3d">
                    <Lock size={18} className="sandesh-lucide-icon" />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your Sandesh password"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="sandesh-input-action-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? "Hide password" : "Show password"}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="sandesh-input-group">
                  <div className="label-with-action">
                    <label>OTP Code</label>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setSignInWithOtp(false)}
                    >
                      Use Password instead
                    </button>
                  </div>
                  <div className="sandesh-input-box-3d">
                    <KeyRound size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      placeholder="Enter 6-digit OTP (e.g. 123456)"
                      value={signInOtp}
                      onChange={(e) => setSignInOtp(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>{loading ? "Authenticating..." : "Sign In to Sandesh"}</span>
                <ArrowRight size={18} className="sandesh-btn-arrow" />
              </button>

              <div className="sandesh-quick-demo-accounts">
                <span className="demo-label">Authorized Personnel:</span>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("sabarish");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👑 Admin (Sabarish)
                </button>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("nageshwari");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👩‍💼 HR (Nageshwari)
                </button>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("gunn");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👨‍💻 Eng (Gunn Kataria)
                </button>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("anish");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👨‍💻 Eng (Anish)
                </button>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("arjun");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👨‍💻 Eng (Arjun)
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: First Time Admin Setup */}
          {activeTab === "first_admin" && (
            <form onSubmit={handleFirstAdminSetup} className="sandesh-auth-form">
              <div className="sandesh-input-group">
                <label>Organization Name</label>
                <div className="sandesh-input-box-3d">
                  <Building2 size={18} className="sandesh-lucide-icon" />
                  <input
                    type="text"
                    placeholder="e.g. Agile Labs Private Limited"
                    value={adminOrg}
                    onChange={(e) => setAdminOrg(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Administrator Name</label>
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
                <label>Admin Corporate Email ID</label>
                <div className="sandesh-input-box-3d">
                  <Mail size={18} className="sandesh-lucide-icon" />
                  <input
                    type="email"
                    placeholder="admin@organization.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {adminOtpSent && (
                <div className="sandesh-input-group">
                  <label>Validation OTP (Demo Code: 123456)</label>
                  <div className="sandesh-input-box-3d">
                    <CheckCircle2 size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      placeholder="Enter 123456"
                      value={adminOtp}
                      onChange={(e) => setAdminOtp(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="sandesh-btn-primary-3d"
                disabled={loading}
              >
                <span>
                  {loading
                    ? "Setting up..."
                    : !adminOtpSent
                      ? "Validate Credentials & Send OTP"
                      : "Verify OTP & Launch Sandesh Platform"}
                </span>
                <ArrowRight size={18} className="sandesh-btn-arrow" />
              </button>
            </form>
          )}

          {/* TAB 3: User Self Registration */}
          {activeTab === "self_reg" && (
            <form onSubmit={handleSelfReg} className="sandesh-auth-form">
              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Full Name</label>
                  <div className="sandesh-input-box-3d">
                    <User size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      placeholder="Your name"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="sandesh-input-group">
                  <label>User Category</label>
                  <div className="sandesh-input-box-3d select-box">
                    <Layers size={18} className="sandesh-lucide-icon" />
                    <select
                      value={regCategory}
                      onChange={(e) => setRegCategory(e.target.value)}
                    >
                      <option value="employee">Employee</option>
                      <option value="customer">Individual Customer</option>
                      <option value="vendor">Vendor / Supplier</option>
                      <option value="consultant">Consultant</option>
                      <option value="affiliate">Affiliate Partner</option>
                      <option value="citizen">Citizen</option>
                      <option value="patient">Patient / Healthcare</option>
                    </select>
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

              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Organization / Branch</label>
                  <div className="sandesh-input-box-3d">
                    <Building2 size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      value={regOrg}
                      onChange={(e) => setRegOrg(e.target.value)}
                    />
                  </div>
                </div>
                <div className="sandesh-input-group">
                  <label>Designation / Role</label>
                  <div className="sandesh-input-box-3d">
                    <Briefcase size={18} className="sandesh-lucide-icon" />
                    <input
                      type="text"
                      value={regDesignation}
                      onChange={(e) => setRegDesignation(e.target.value)}
                    />
                  </div>
                </div>
              </div>

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

          {/* Footer note */}
          <div className="sandesh-auth-footer">
            <span>Powered by Sandesh Enterprise • Secured with Erlang/OTP real-time core</span>
          </div>
        </div>
      </div>
    </div>
  );
}
