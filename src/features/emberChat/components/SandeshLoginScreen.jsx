import { useState } from "react";

export default function SandeshLoginScreen({ onLoginSuccess }) {
  const [activeTab, setActiveTab] = useState("signin"); // "signin" | "first_admin" | "self_reg"

  // Sign In State
  const [signInIdentifier, setSignInIdentifier] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInWithOtp, setSignInWithOtp] = useState(false);
  const [signInOtp, setSignInOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // First Time Setup State
  const [adminOrg, setAdminOrg] = useState("Agile Labs Enterprise");
  const [adminName, setAdminName] = useState("Arjun Sridhar");
  const [adminEmail, setAdminEmail] = useState("arjun@agilelabs.com");
  const [adminMobile, setAdminMobile] = useState("+91 98860 12345");
  const [adminPassword, setAdminPassword] = useState("SandeshArjun");
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
      setErrorMsg("Please enter your username, email, or mobile number.");
      return;
    }
    setErrorMsg("");
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      const raw = signInIdentifier.trim();
      const cleanUsername = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || "user_" + Math.floor(Math.random() * 8999 + 1000);
      onLoginSuccess({
        name: raw,
        username: cleanUsername,
        role: cleanUsername === "arjun" ? "Enterprise Administrator" : "Enterprise Associate",
        org: "Agile Labs Enterprise",
        category: "employee",
        branch: "Bangalore HQ",
        department: "Product Architecture",
        designation: cleanUsername === "arjun" ? "Chief Enterprise Architect" : "Enterprise Associate",
        status: "Available",
        initials: (raw.slice(0, 2)).toUpperCase(),
        color: "#ff7a59",
        isAdmin: cleanUsername === "arjun",
        token: "sandesh-jwt-" + Date.now(),
        armSessionId: "arm-sess-" + Date.now(),
      });
    }, 600);
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
              <span className="sandesh-badge-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </span>
              <div className="sandesh-badge-shine" />
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
                  <span className="material-icons input-icon">person</span>
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
                    <span className="material-icons input-icon">lock</span>
                    <input
                      type="password"
                      placeholder="Enter your Sandesh password"
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      required
                    />
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
                    <span className="material-icons input-icon">sms</span>
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
                {loading ? "Authenticating..." : "Sign In to Sandesh"}
              </button>

              <div className="sandesh-quick-demo-accounts">
                <span className="demo-label">Quick Sign-in:</span>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("arjun");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👑 Admin (Arjun)
                </button>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("priya");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👩‍💼 HR Host (Priya)
                </button>
                <button
                  type="button"
                  className="sandesh-pill-chip"
                  onClick={() => {
                    setSignInIdentifier("ravi");
                    setSignInPassword("Sandesh123");
                  }}
                >
                  👨‍💻 Engineer (Ravi)
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
                  <span className="material-icons input-icon">business</span>
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
                    <span className="material-icons input-icon">badge</span>
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
                    <span className="material-icons input-icon">phone</span>
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
                  <span className="material-icons input-icon">mail</span>
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
                    <span className="material-icons input-icon">verified</span>
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
                {loading
                  ? "Setting up..."
                  : (!adminOtpSent ? "Validate Credentials & Send OTP" : "Verify OTP & Launch Sandesh Platform")}
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
                    <span className="material-icons input-icon">person</span>
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
                    <span className="material-icons input-icon">category</span>
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
                    <span className="material-icons input-icon">email</span>
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
                    <span className="material-icons input-icon">phone</span>
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
                    <span className="material-icons input-icon">domain</span>
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
                    <span className="material-icons input-icon">work</span>
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
                {loading ? "Submitting Registration..." : "Request Onboarding & Continue"}
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
