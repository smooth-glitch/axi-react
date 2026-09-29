import { useCallback, useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";

const EMPTY_DATA = {
  users: [],
  affiliates: [],
  branches: [],
  departments: [],
  designations: [],
  categories: [],
};

const emptyScope = { any: false, branches: [], departments: [], designations: [] };

function toRow(u) {
  return {
    id: u.username,
    name: u.name,
    username: u.username,
    role: u.role,
    designation: u.designation,
    department: u.department,
    branch: u.branch,
    category: u.userType === "external" ? u.category || "external" : u.userType || "external",
    isHost: !!u.isHost,
    hostFor: u.isHost ? scopeLabel(u.hostScope) : undefined,
    hostUser: u.host || null,
    active: u.active !== false && u.status === "active",
    status: u.status,
  };
}

function scopeLabel(scope) {
  const emp = scope?.employees || {};
  if (emp.any) return "all employees";
  const bits = [...(emp.branches || []), ...(emp.departments || []), ...(emp.designations || [])];
  if (scope?.affiliates?.any || scope?.affiliates?.selected?.length) bits.push("affiliates");
  bits.push(...(scope?.categories || []));
  return bits.length ? bits.join(", ") : "selected users";
}

export default function AdminConsoleModal({ initialTab = "users", initialQuery = "", onClose, pushToast }) {
  const [activeTab, setActiveTab] = useState(initialTab || "users"); // "users" | "affiliates" | "setup" | "invite"
  const [adminData, setAdminData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reassignTargetUser, setReassignTargetUser] = useState(null);
  const [selectedNewHost, setSelectedNewHost] = useState("");
  const [userSearch, setUserSearch] = useState(initialQuery || "");
  const [setupDraft, setSetupDraft] = useState({
    branches: { name: "", city: "", country: "India", pin: "" },
    departments: { name: "", description: "" },
    designations: { name: "", description: "" },
  });
  const [affDraft, setAffDraft] = useState({ name: "", category: "", city: "", country: "India", pin: "" });

  // Invite user form state
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    mobile: "",
    userType: "employee", // employee | external | affiliate
    branch: "",
    department: "",
    designation: "",
    category: "",
    affiliate: "",
    country: "India",
    city: "",
    pin: "",
    isHost: false,
    hostAny: true,
  });

  const fail = useCallback(
    (res) => pushToast({ ok: false, error: res?.error || { message: "Request failed." } }),
    [pushToast]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const [users, branches, departments, designations, categories, affiliates] = await Promise.all([
      sandeshSocket.sd("admin.users.list", { status: "all", pageSize: 200 }),
      sandeshSocket.sd("admin.cfg.list", { kind: "branches" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "departments" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "designations" }),
      sandeshSocket.sd("admin.cfg.list", { kind: "categories" }),
      sandeshSocket.sd("admin.affiliates.list", {}),
    ]);
    setLoading(false);
    const firstFail = [users, branches, departments, designations, categories, affiliates].find((r) => !r.ok);
    if (firstFail) {
      setLoadError(firstFail.error?.message || "Couldn't load the admin data.");
      return;
    }
    setAdminData({
      users: (users.data?.users || []).map(toRow),
      branches: branches.data?.items || [],
      departments: departments.data?.items || [],
      designations: designations.data?.items || [],
      categories: categories.data?.items || [],
      affiliates: affiliates.data?.affiliates || [],
    });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const hostCandidates = adminData.users.filter((u) => u.active && (u.isHost || u.role === "admin"));

  const toggleUserActive = async (user) => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.user.status", { username: user.username, active: !user.active });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`User ${user.name} ${user.active ? "deactivated" : "activated"}`);
    loadAll();
  };

  const handleReassignHost = async (e) => {
    e.preventDefault();
    if (!reassignTargetUser || !selectedNewHost) return;
    setBusy(true);
    const res = await sandeshSocket.sd("admin.host.change", {
      user: reassignTargetUser.username,
      host: selectedNewHost,
    });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Reassigned Host for ${reassignTargetUser.name} to @${selectedNewHost}`);
    setReassignTargetUser(null);
    loadAll();
  };

  const addSetupItem = async (kind) => {
    const item = setupDraft[kind];
    setBusy(true);
    const res = await sandeshSocket.sd("admin.cfg.save", { kind, item });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Added ${item.name}`);
    setSetupDraft((prev) => ({
      ...prev,
      [kind]: Object.fromEntries(Object.entries(prev[kind]).map(([k]) => [k, k === "country" ? "India" : ""])),
    }));
    loadAll();
  };

  const deleteSetupItem = async (kind, name) => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.cfg.delete", { kind, name });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Removed ${name}`);
    loadAll();
  };

  const addAffiliate = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await sandeshSocket.sd("admin.cfg.save", {
      kind: "affiliates",
      item: { ...affDraft, branches: [] },
    });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`Added affiliate ${affDraft.name}`);
    setAffDraft({ name: "", category: "", city: "", country: "India", pin: "" });
    loadAll();
  };

  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    if (!inviteForm.name || !inviteForm.email) return;
    const f = inviteForm;
    const args = { name: f.name.trim(), email: f.email.trim(), mobile: f.mobile.trim() || undefined };
    if (f.userType === "employee") {
      Object.assign(args, { isEmployee: true, branch: f.branch, department: f.department, designation: f.designation });
      if (f.isHost) {
        args.isHost = true;
        args.hostScope = { employees: { ...emptyScope, any: f.hostAny } };
      }
    } else if (f.userType === "affiliate") {
      Object.assign(args, { isEmployee: false, affiliate: f.affiliate, city: f.city, country: f.country, pin: f.pin });
    } else {
      Object.assign(args, { isEmployee: false, category: f.category, city: f.city, country: f.country, pin: f.pin });
    }
    setBusy(true);
    const res = await sandeshSocket.sd("users.invite", args);
    setBusy(false);
    if (!res.ok) return fail(res);
    const created = res.data?.user;
    pushToast(`Invited ${created?.name || f.name} (@${created?.username}). They sign in and set up 2FA on first login.`);
    setInviteForm({ ...inviteForm, name: "", email: "", mobile: "" });
    setActiveTab("users");
    loadAll();
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
        {loading && <p className="section-note" style={{ padding: 16 }}>Loading…</p>}
        {!loading && loadError && (
          <div className="sandesh-alert sandesh-alert-danger" style={{ margin: 16 }}>
            {loadError}{" "}
            <button type="button" className="sandesh-btn-link" onClick={loadAll}>
              Retry
            </button>
          </div>
        )}

        {/* TAB 1: USERS & HOSTS */}
        {!loading && !loadError && activeTab === "users" && (
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
                <button type="button" className="sandesh-btn-mini-primary" onClick={() => setActiveTab("invite")}>
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
                  if (q === "admin" || q === "admins") return u.role === "admin";
                  return [u.name, u.username, u.designation, u.department].some((v) =>
                    (v || "").toLowerCase().includes(q)
                  );
                })
                .map((u) => (
                  <div key={u.id} className={`table-row ${!u.active ? "inactive-row" : ""}`}>
                    <div className="cell-user">
                      <span className="cell-name">{u.name}</span>
                      <span className="cell-sub">
                        @{u.username}
                        {u.role === "admin" ? " • Admin" : ""}
                        {u.designation ? ` • ${u.designation}` : ""}
                      </span>
                    </div>
                    <div className="cell-cat">
                      <span className={`tag-pill tag-${u.category}`}>{u.category}</span>
                      {u.isHost && <span className="host-badge">HOST</span>}
                    </div>
                    <div className="cell-dept" style={{ display: "flex", flexDirection: "column" }}>
                      <span>{u.branch || "—"}</span>
                      <span className="cell-sub">{u.department || ""}</span>
                    </div>
                    <div className="cell-host">
                      <span>{u.isHost ? `Host for ${u.hostFor}` : u.hostUser ? `@${u.hostUser}` : "Unassigned"}</span>
                    </div>
                    <div className="cell-status">
                      {u.status === "pending" ? (
                        <span className="status-toggle inactive" title="Approve it under User Access Approvals">
                          Pending
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`status-toggle ${u.active ? "active" : "inactive"}`}
                          onClick={() => toggleUserActive(u)}
                          disabled={busy}
                          title="Click to toggle active state"
                        >
                          {u.active ? "Active" : "Inactive"}
                        </button>
                      )}
                    </div>
                    <div className="cell-actions">
                      <button
                        type="button"
                        className="sandesh-btn-link"
                        onClick={() => {
                          setSelectedNewHost(hostCandidates.find((h) => h.username !== u.username)?.username || "");
                          setReassignTargetUser(u);
                        }}
                      >
                        Change Host
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {reassignTargetUser && (
              <div className="reassign-host-panel">
                <h5>Reassign SPOC Host for {reassignTargetUser.name}</h5>
                <form onSubmit={handleReassignHost} className="reassign-form">
                  <div className="sandesh-input-box-3d select-box">
                    <select value={selectedNewHost} onChange={(e) => setSelectedNewHost(e.target.value)} required>
                      {hostCandidates
                        .filter((h) => h.username !== reassignTargetUser.username)
                        .map((h) => (
                          <option key={h.username} value={h.username}>
                            {h.name} (@{h.username})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="reassign-btns">
                    <button type="submit" className="sandesh-btn-primary-3d" disabled={busy || !selectedNewHost}>
                      Confirm Reassignment
                    </button>
                    <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setReassignTargetUser(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AFFILIATES */}
        {!loading && !loadError && activeTab === "affiliates" && (
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
              {adminData.affiliates.length === 0 && (
                <div className="table-row">
                  <span className="section-note">No affiliates yet — add one below.</span>
                </div>
              )}
              {adminData.affiliates.map((af) => (
                <div key={af.name} className="table-row">
                  <span className="cell-name">{af.name}</span>
                  <span><span className="tag-pill tag-affiliate">{af.category}</span></span>
                  <span>{[af.city, af.country].filter(Boolean).join(", ")}</span>
                  <span>{(af.branches || []).map((b) => b.name || b).join(", ") || "—"}</span>
                  <span className="host-name">{(af.hosts || []).map((h) => `@${h}`).join(", ") || "—"}</span>
                </div>
              ))}
            </div>

            <form onSubmit={addAffiliate} className="invite-user-form" style={{ marginTop: 16 }}>
              <h4>Add Affiliate</h4>
              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Organisation</label>
                  <div className="sandesh-input-box-3d">
                    <input type="text" value={affDraft.name} required onChange={(e) => setAffDraft({ ...affDraft, name: e.target.value })} />
                  </div>
                </div>
                <div className="sandesh-input-group">
                  <label>Category</label>
                  <div className="sandesh-input-box-3d select-box">
                    <select value={affDraft.category} required onChange={(e) => setAffDraft({ ...affDraft, category: e.target.value })}>
                      <option value="">Select…</option>
                      {adminData.categories.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="sandesh-form-row">
                {["city", "country", "pin"].map((k) => (
                  <div className="sandesh-input-group" key={k}>
                    <label>{k === "pin" ? "PIN" : k[0].toUpperCase() + k.slice(1)}</label>
                    <div className="sandesh-input-box-3d">
                      <input type="text" value={affDraft[k]} onChange={(e) => setAffDraft({ ...affDraft, [k]: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="sandesh-modal-actions">
                <button type="submit" className="sandesh-btn-primary-3d" disabled={busy}>Add Affiliate</button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: ORGANIZATION SETUP */}
        {!loading && !loadError && activeTab === "setup" && (
          <div className="admin-setup-grid">
            {[
              { kind: "branches", title: "Branches", fields: ["name", "city", "country", "pin"] },
              { kind: "departments", title: "Departments", fields: ["name", "description"] },
              { kind: "designations", title: "Designations", fields: ["name", "description"] },
            ].map(({ kind, title, fields }) => (
              <div className="setup-card" key={kind}>
                <div className="setup-card-header">
                  <h5>{title} ({adminData[kind].length})</h5>
                </div>
                <ul className="setup-list">
                  {adminData[kind].map((item) => (
                    <li key={item.name}>
                      <strong>{item.name}</strong>
                      <span>
                        {kind === "branches"
                          ? [item.city, item.country, item.pin && `(${item.pin})`].filter(Boolean).join(", ")
                          : item.description}
                      </span>
                      <button
                        type="button"
                        className="sandesh-btn-link"
                        disabled={busy}
                        onClick={() => deleteSetupItem(kind, item.name)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSetupItem(kind);
                  }}
                  style={{ display: "grid", gap: 6, marginTop: 8 }}
                >
                  {fields.map((f) => (
                    <div className="sandesh-input-box-3d" key={f}>
                      <input
                        type="text"
                        placeholder={f === "pin" ? "PIN" : f[0].toUpperCase() + f.slice(1)}
                        value={setupDraft[kind][f]}
                        required={f !== "description"}
                        onChange={(e) =>
                          setSetupDraft((prev) => ({ ...prev, [kind]: { ...prev[kind], [f]: e.target.value } }))
                        }
                      />
                    </div>
                  ))}
                  <button type="submit" className="sandesh-btn-mini-primary" disabled={busy}>
                    + Add
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: INVITE USER */}
        {!loading && !loadError && activeTab === "invite" && (
          <form onSubmit={handleInviteSubmit} className="invite-user-form">
            <h4>Invite User to Sandesh Platform</h4>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Full Name</label>
                <div className="sandesh-input-box-3d">
                  <input type="text" placeholder="Enter name" autoComplete="off" value={inviteForm.name}
                    onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} required />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Email Address</label>
                <div className="sandesh-input-box-3d">
                  <input type="email" placeholder="user@organization.com" autoComplete="off" value={inviteForm.email}
                    onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} required />
                </div>
              </div>
            </div>

            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Mobile Number</label>
                <div className="sandesh-input-box-3d">
                  <input type="text" placeholder="+91..." autoComplete="off" value={inviteForm.mobile}
                    onChange={(e) => setInviteForm({ ...inviteForm, mobile: e.target.value })} />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>User Type</label>
                <div className="sandesh-input-box-3d select-box">
                  <select value={inviteForm.userType} onChange={(e) => setInviteForm({ ...inviteForm, userType: e.target.value })}>
                    <option value="employee">Employee</option>
                    <option value="affiliate">Affiliate Partner</option>
                    <option value="external">Customer / Citizen / Vendor…</option>
                  </select>
                </div>
              </div>
            </div>

            {inviteForm.userType === "employee" && (
              <>
                <div className="sandesh-form-row">
                  {[
                    ["branch", "Assigned Branch", "branches"],
                    ["department", "Department", "departments"],
                    ["designation", "Designation", "designations"],
                  ].map(([key, label, kind]) => (
                    <div className="sandesh-input-group" key={key}>
                      <label>{label}</label>
                      <div className="sandesh-input-box-3d select-box">
                        <select value={inviteForm[key]} required onChange={(e) => setInviteForm({ ...inviteForm, [key]: e.target.value })}>
                          <option value="">{adminData[kind].length ? "Select…" : "Add some under Org Setup first"}</option>
                          {adminData[kind].map((i) => (
                            <option key={i.name} value={i.name}>{i.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="host-privilege-box">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={inviteForm.isHost}
                      onChange={(e) => setInviteForm({ ...inviteForm, isHost: e.target.checked })} />
                    <span>Appoint this user as a Chat Host (SPOC for other users)</span>
                  </label>
                  {inviteForm.isHost && (
                    <label className="checkbox-label">
                      <input type="checkbox" checked={inviteForm.hostAny}
                        onChange={(e) => setInviteForm({ ...inviteForm, hostAny: e.target.checked })} />
                      <span>Host for all employees in the organisation</span>
                    </label>
                  )}
                </div>
              </>
            )}

            {inviteForm.userType === "affiliate" && (
              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Affiliate Organisation</label>
                  <div className="sandesh-input-box-3d select-box">
                    <select value={inviteForm.affiliate} required onChange={(e) => setInviteForm({ ...inviteForm, affiliate: e.target.value })}>
                      <option value="">{adminData.affiliates.length ? "Select…" : "Add one under Affiliates first"}</option>
                      {adminData.affiliates.map((a) => (
                        <option key={a.name} value={a.name}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {inviteForm.userType === "external" && (
              <div className="sandesh-form-row">
                <div className="sandesh-input-group">
                  <label>Category</label>
                  <div className="sandesh-input-box-3d select-box">
                    <select value={inviteForm.category} required onChange={(e) => setInviteForm({ ...inviteForm, category: e.target.value })}>
                      <option value="">Select…</option>
                      {adminData.categories.filter((c) => c.active !== false).map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {inviteForm.userType !== "employee" && (
              <div className="sandesh-form-row">
                {["city", "country", "pin"].map((k) => (
                  <div className="sandesh-input-group" key={k}>
                    <label>{k === "pin" ? "PIN" : k[0].toUpperCase() + k.slice(1)}</label>
                    <div className="sandesh-input-box-3d">
                      <input type="text" value={inviteForm[k]} required={inviteForm.userType === "external"}
                        onChange={(e) => setInviteForm({ ...inviteForm, [k]: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="sandesh-modal-actions">
              <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setActiveTab("users")}>
                Cancel
              </button>
              <button type="submit" className="sandesh-btn-primary-3d" disabled={busy}>
                Dispatch Onboarding Invitation
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
