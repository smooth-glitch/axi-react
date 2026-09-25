import { useState } from "react";
import { initialAdminData } from "../../data/sampleData.js";

export default function AdminConsoleModal({ initialTab = "users", initialQuery = "", onClose, pushToast }) {
  const [activeTab, setActiveTab] = useState(initialTab || "users"); // "users" | "affiliates" | "setup" | "invite"
  const [adminData, setAdminData] = useState(initialAdminData);
  const [reassignTargetUser, setReassignTargetUser] = useState(null);
  const [selectedNewHost, setSelectedNewHost] = useState("Nageshwari");
  const [userSearch, setUserSearch] = useState(initialQuery || "");

  // Invite user form state
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    mobile: "",
    category: "employee",
    branch: "Bangalore HQ",
    department: "Human Resources",
    designation: "HR Associate",
    isHost: false,
    hostFor: "Selected Branch",
  });

  const toggleUserActive = (userId) => {
    setAdminData((prev) => ({
      ...prev,
      users: prev.users.map((u) => {
        if (u.id === userId) {
          const nextActive = !u.active;
          pushToast(`User ${u.name} ${nextActive ? "activated" : "deactivated"}`);
          return { ...u, active: nextActive };
        }
        return u;
      }),
    }));
  };

  const handleReassignHost = (e) => {
    e.preventDefault();
    if (!reassignTargetUser) return;
    setAdminData((prev) => ({
      ...prev,
      users: prev.users.map((u) => {
        if (u.id === reassignTargetUser.id) {
          return { ...u, hostUser: selectedNewHost };
        }
        return u;
      }),
    }));
    pushToast(`Reassigned Host for ${reassignTargetUser.name} to ${selectedNewHost}`);
    setReassignTargetUser(null);
  };

  const handleInviteSubmit = (e) => {
    e.preventDefault();
    if (!inviteForm.name || !inviteForm.email) return;
    const newUser = {
      id: "u" + (adminData.users.length + 1),
      name: inviteForm.name,
      username: inviteForm.name.toLowerCase().replace(/\s+/g, ""),
      email: inviteForm.email,
      mobile: inviteForm.mobile,
      category: inviteForm.category,
      branch: inviteForm.branch,
      department: inviteForm.department,
      designation: inviteForm.designation,
      isHost: inviteForm.isHost,
      hostFor: inviteForm.isHost ? inviteForm.hostFor : undefined,
      hostUser: "Arjun S.",
      active: true,
    };
    setAdminData((prev) => ({
      ...prev,
      users: [...prev.users, newUser],
    }));
    pushToast(`Invite dispatched to ${inviteForm.name} (${inviteForm.email})`);
    setActiveTab("users");
  };

  return (
    <div className="sandesh-modal-card-3d sandesh-admin-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <span className="material-icons modal-header-icon admin-icon">admin_panel_settings</span>
          <div>
            <h3>Sandesh Administration Console</h3>
            <span className="modal-subtitle">Organization Setup • Directory • Host SPOC Management</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close admin console">
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="sandesh-tab-pills-3d admin-nav-tabs">
        <button
          type="button"
          className={`sandesh-tab-pill ${activeTab === "users" ? "active" : ""}`}
          onClick={() => setActiveTab("users")}
        >
          <span className="material-icons pill-icon">group</span> Users &amp; Hosts
        </button>
        <button
          type="button"
          className={`sandesh-tab-pill ${activeTab === "affiliates" ? "active" : ""}`}
          onClick={() => setActiveTab("affiliates")}
        >
          <span className="material-icons pill-icon">corporate_fare</span> Affiliates
        </button>
        <button
          type="button"
          className={`sandesh-tab-pill ${activeTab === "setup" ? "active" : ""}`}
          onClick={() => setActiveTab("setup")}
        >
          <span className="material-icons pill-icon">settings</span> Org Setup
        </button>
        <button
          type="button"
          className={`sandesh-tab-pill ${activeTab === "invite" ? "active" : ""}`}
          onClick={() => setActiveTab("invite")}
        >
          <span className="material-icons pill-icon">person_add</span> + Invite User
        </button>
      </div>

      <div className="sandesh-modal-body admin-content-scroll">
        {/* TAB 1: USERS & HOSTS */}
        {activeTab === "users" && (
          <div className="admin-table-container">
            <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h4>All Registered Users ({adminData.users.length})</h4>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Filter users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "14px",
                    border: "1px solid rgba(0,0,0,0.1)",
                    fontSize: "12px",
                    background: "rgba(255,255,255,0.7)",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  className="sandesh-btn-mini-primary"
                  onClick={() => setActiveTab("invite")}
                >
                  + Invite User
                </button>
              </div>
            </div>

            <div className="sandesh-glass-table">
              <div className="table-row table-head">
                <span>Name / Role</span>
                <span>Category</span>
                <span>Branch / Dept</span>
                <span>Host (SPOC)</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
              {adminData.users
                .filter((u) => {
                  if (!userSearch) return true;
                  const q = userSearch.toLowerCase();
                  if (q === "admin" || q === "admins") return u.designation?.toLowerCase().includes("admin") || u.category === "admin";
                  return (
                    u.name.toLowerCase().includes(q) ||
                    (u.username && u.username.toLowerCase().includes(q)) ||
                    (u.designation && u.designation.toLowerCase().includes(q)) ||
                    (u.department && u.department.toLowerCase().includes(q))
                  );
                })
                .map((u) => (
                <div key={u.id} className={`table-row ${!u.active ? "inactive-row" : ""}`}>
                  <div className="cell-user">
                    <span className="cell-name">{u.name}</span>
                    <span className="cell-sub">{u.designation}</span>
                  </div>
                  <div className="cell-cat">
                    <span className={`tag-pill tag-${u.category}`}>{u.category}</span>
                    {u.isHost && <span className="host-badge">HOST</span>}
                  </div>
                  <div className="cell-dept">
                    <span>{u.branch}</span>
                    <span className="cell-sub">{u.department}</span>
                  </div>
                  <div className="cell-host">
                    <span>{u.isHost ? `Host for ${u.hostFor}` : (u.hostUser || "Unassigned")}</span>
                  </div>
                  <div className="cell-status">
                    <button
                      type="button"
                      className={`status-toggle ${u.active ? "active" : "inactive"}`}
                      onClick={() => toggleUserActive(u.id)}
                      title="Click to toggle active state"
                    >
                      {u.active ? "Active" : "Inactive"}
                    </button>
                  </div>
                  <div className="cell-actions">
                    <button
                      type="button"
                      className="sandesh-btn-link"
                      onClick={() => setReassignTargetUser(u)}
                    >
                      Change Host
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Reassign Host Dialog Sub-panel */}
            {reassignTargetUser && (
              <div className="reassign-host-panel">
                <h5>Reassign SPOC Host for {reassignTargetUser.name}</h5>
                <form onSubmit={handleReassignHost} className="reassign-form">
                  <div className="sandesh-input-box-3d select-box">
                    <select
                      value={selectedNewHost}
                      onChange={(e) => setSelectedNewHost(e.target.value)}
                    >
                      <option value="Sabarish (Admin Host)">Sabarish (Enterprise Administrator)</option>
                      <option value="Nageshwari (HR Host)">Nageshwari (HR Operations)</option>
                      <option value="Central IT Operations">Central IT Operations</option>
                      <option value="Corporate Finance Host">Corporate Finance Host</option>
                    </select>
                  </div>
                  <div className="reassign-btns">
                    <button type="submit" className="sandesh-btn-primary-3d">
                      Confirm Reassignment
                    </button>
                    <button
                      type="button"
                      className="sandesh-btn-secondary-3d"
                      onClick={() => setReassignTargetUser(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AFFILIATES */}
        {activeTab === "affiliates" && (
          <div className="admin-table-container">
            <div className="admin-section-header">
              <h4>External Affiliates &amp; Partners</h4>
              <span className="section-note">External organizations connected through designated chat hosts</span>
            </div>

            <div className="sandesh-glass-table">
              <div className="table-row table-head">
                <span>Organization</span>
                <span>Category</span>
                <span>Location</span>
                <span>Active Branches</span>
                <span>Assigned SPOC Host</span>
              </div>
              {adminData.affiliates.map((af) => (
                <div key={af.id} className="table-row">
                  <span className="cell-name">{af.name}</span>
                  <span><span className="tag-pill tag-affiliate">{af.category}</span></span>
                  <span>{af.location}</span>
                  <span>{af.branches.join(", ")}</span>
                  <span className="host-name">{af.hostUser}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: ORGANIZATION SETUP */}
        {activeTab === "setup" && (
          <div className="admin-setup-grid">
            {/* Branches */}
            <div className="setup-card">
              <div className="setup-card-header">
                <h5>Branches ({adminData.branches.length})</h5>
              </div>
              <ul className="setup-list">
                {adminData.branches.map((b) => (
                  <li key={b.id}>
                    <strong>{b.name}</strong>
                    <span>{b.city}, {b.country} ({b.zip})</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Departments */}
            <div className="setup-card">
              <div className="setup-card-header">
                <h5>Departments ({adminData.departments.length})</h5>
              </div>
              <ul className="setup-list">
                {adminData.departments.map((d) => (
                  <li key={d.id}>
                    <strong>{d.name}</strong>
                    <span>{d.description}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Designations */}
            <div className="setup-card">
              <div className="setup-card-header">
                <h5>Designations ({adminData.designations.length})</h5>
              </div>
              <ul className="setup-list">
                {adminData.designations.map((dg) => (
                  <li key={dg.id}>
                    <strong>{dg.name}</strong>
                    <span>{dg.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* TAB 4: INVITE USER */}
        {activeTab === "invite" && (
          <form onSubmit={handleInviteSubmit} className="invite-user-form">
            <h4>Invite User to Sandesh Platform</h4>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Full Name</label>
                <div className="sandesh-input-box-3d">
                  <input
                    type="text"
                    placeholder="Enter name"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Email Address</label>
                <div className="sandesh-input-box-3d">
                  <input
                    type="email"
                    placeholder="user@organization.com"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Mobile Number</label>
                <div className="sandesh-input-box-3d">
                  <input
                    type="text"
                    placeholder="+91..."
                    value={inviteForm.mobile}
                    onChange={(e) => setInviteForm({ ...inviteForm, mobile: e.target.value })}
                  />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>User Category</label>
                <div className="sandesh-input-box-3d select-box">
                  <select
                    value={inviteForm.category}
                    onChange={(e) => setInviteForm({ ...inviteForm, category: e.target.value })}
                  >
                    <option value="employee">Employee</option>
                    <option value="affiliate">Affiliate Partner</option>
                    <option value="customer">Customer</option>
                    <option value="vendor">Vendor</option>
                    <option value="consultant">Consultant</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Assigned Branch</label>
                <div className="sandesh-input-box-3d select-box">
                  <select
                    value={inviteForm.branch}
                    onChange={(e) => setInviteForm({ ...inviteForm, branch: e.target.value })}
                  >
                    {adminData.branches.map((b) => (
                      <option key={b.id} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Department</label>
                <div className="sandesh-input-box-3d select-box">
                  <select
                    value={inviteForm.department}
                    onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })}
                  >
                    {adminData.departments.map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="host-privilege-box">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={inviteForm.isHost}
                  onChange={(e) => setInviteForm({ ...inviteForm, isHost: e.target.checked })}
                />
                <span>Appoint this user as a Chat Host (SPOC for other users)</span>
              </label>

              {inviteForm.isHost && (
                <div className="host-scope-select">
                  <label>Host Jurisdiction</label>
                  <div className="sandesh-input-box-3d select-box">
                    <select
                      value={inviteForm.hostFor}
                      onChange={(e) => setInviteForm({ ...inviteForm, hostFor: e.target.value })}
                    >
                      <option value="All Employees">All Employees in Organization</option>
                      <option value="Selected Branch">Selected Branch Only</option>
                      <option value="Selected Department">Selected Department Only</option>
                      <option value="Affiliates">Assigned Affiliates &amp; Vendors</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="sandesh-modal-actions">
              <button
                type="button"
                className="sandesh-btn-secondary-3d"
                onClick={() => setActiveTab("users")}
              >
                Cancel
              </button>
              <button type="submit" className="sandesh-btn-primary-3d">
                Dispatch Onboarding Invitation
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
