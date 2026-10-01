import { useCallback, useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";
import AdminFormsPanel from "./AdminFormsPanel.jsx";
import AdminOptionsPanel from "./AdminOptionsPanel.jsx";
import AdminActivityPanel from "./AdminActivityPanel.jsx";
import AdminUnlockPanel from "./AdminUnlockPanel.jsx";

const EMPTY_DATA = {
  users: [],
  affiliates: [],
  branches: [],
  departments: [],
  designations: [],
  categories: [],
};

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
    isEmployee: !!u.isEmployee,
    hostScope: u.hostScope || null,
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

const emptyHostScope = () => ({
  employees: { any: false, branches: [], departments: [], designations: [] },
  affiliates: { any: false, selected: [] },
  categories: [],
});

function normaliseScope(scope) {
  const base = emptyHostScope();
  return {
    employees: { ...base.employees, ...(scope?.employees || {}) },
    affiliates: { ...base.affiliates, ...(scope?.affiliates || {}) },
    categories: scope?.categories || [],
  };
}

function scopeIsEmpty(scope) {
  const e = scope.employees;
  return !(
    e.any || e.branches.length || e.departments.length || e.designations.length ||
    scope.affiliates.any || scope.affiliates.selected.length || scope.categories.length
  );
}

const toggleIn = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

// "Who does this host cover?" -- a person matches if they fit ANY selected group.
function HostScopePicker({ scope, onChange, data }) {
  const chip = (label, checked, onToggle, disabled) => (
    <label
      key={label}
      className="checkbox-label"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 10, opacity: disabled ? 0.5 : 1 }}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span>{label}</span>
    </label>
  );
  const emp = scope.employees;
  const setEmp = (patch) => onChange({ ...scope, employees: { ...emp, ...patch } });
  const group = (title, children) => (
    <div style={{ marginTop: 10 }}>
      <label style={{ fontWeight: 600, fontSize: 12 }}>{title}</label>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
  const none = (what) => <span className="section-note">No {what} configured yet.</span>;
  return (
    <div className="host-scope-select">
      <p className="section-note">
        This host will cover users who match <strong>any</strong> of the groups selected below.
      </p>
      {group(
        "Employees",
        <>
          {chip("All employees", emp.any, () => setEmp({ any: !emp.any }))}
          <div>
            {data.branches.length
              ? data.branches.map((b) =>
                  chip(`Branch: ${b.name}`, emp.branches.includes(b.name), () =>
                    setEmp({ branches: toggleIn(emp.branches, b.name) }), emp.any))
              : none("branches")}
          </div>
          <div>
            {data.departments.length
              ? data.departments.map((d) =>
                  chip(`Dept: ${d.name}`, emp.departments.includes(d.name), () =>
                    setEmp({ departments: toggleIn(emp.departments, d.name) }), emp.any))
              : none("departments")}
          </div>
          <div>
            {data.designations.length
              ? data.designations.map((d) =>
                  chip(`Role: ${d.name}`, emp.designations.includes(d.name), () =>
                    setEmp({ designations: toggleIn(emp.designations, d.name) }), emp.any))
              : none("designations")}
          </div>
        </>
      )}
      {group(
        "Affiliates",
        <>
          {chip("All affiliates", scope.affiliates.any, () =>
            onChange({ ...scope, affiliates: { ...scope.affiliates, any: !scope.affiliates.any } }))}
          <div>
            {data.affiliates.length
              ? data.affiliates.map((a) =>
                  chip(a.name, scope.affiliates.selected.includes(a.name), () =>
                    onChange({
                      ...scope,
                      affiliates: { ...scope.affiliates, selected: toggleIn(scope.affiliates.selected, a.name) },
                    }), scope.affiliates.any))
              : none("affiliates")}
          </div>
        </>
      )}
      {group(
        "User categories",
        data.categories.filter((c) => c.active !== false).map((c) =>
          chip(c.name, scope.categories.includes(c.name), () =>
            onChange({ ...scope, categories: toggleIn(scope.categories, c.name) })))
      )}
    </div>
  );
}

export default function AdminConsoleModal({ initialTab = "users", initialQuery = "", onClose, pushToast }) {
  const [activeTab, setActiveTab] = useState(initialTab || "users"); // "users" | "affiliates" | "setup" | "invite"
  const [adminData, setAdminData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [locked, setLocked] = useState(false); // the backend wants the password + one-time code first
  const [busy, setBusy] = useState(false);
  const [reassignTargetUser, setReassignTargetUser] = useState(null);
  const [selectedNewHost, setSelectedNewHost] = useState("");
  const [hostEditUser, setHostEditUser] = useState(null); // { user, isHost, scope }
  const [placementUser, setPlacementUser] = useState(null); // { user, branch, department, designation, autoHost }
  const [handover, setHandover] = useState(null); // { user, mode: "demote" | "deactivate", newHost, count }
  const [bulkMove, setBulkMove] = useState(null); // { kind, from, to, preview, result }
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
    hostScope: emptyHostScope(),
  });

  const fail = useCallback(
    (res) => {
      // The unlock lapsed (or was never done): show the unlock screen instead of a bare error.
      if (res?.error?.code === "admin_locked") {
        setLocked(true);
        return;
      }
      pushToast({ type: "sd", ok: false, error: res?.error || { message: "Request failed." } });
    },
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
      if (firstFail.error?.code === "admin_locked") {
        setLocked(true);
        return;
      }
      setLoadError(firstFail.error?.message || "Couldn't load the admin data.");
      return;
    }
    setLocked(false);
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
    // If the console is opened before the socket is up (or after a reconnect),
    // load as soon as it connects instead of waiting for a manual Retry.
    return sandeshSocket.subscribe((event) => {
      if (event.type === "status_change" && event.status === "connected") loadAll();
    });
  }, [loadAll]);

  const hostCandidates = adminData.users.filter((u) => u.active && (u.isHost || u.role === "admin"));

  const warn = (text) => pushToast(`⚠️ ${text}`);

  const deactivateOrActivate = async (user, extra = {}) => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.user.status", {
      username: user.username,
      active: !user.active,
      ...extra,
    });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`User ${user.name} ${user.active ? "deactivated" : "activated"}`);
    const moved = res.data?.movedUsers?.length || 0;
    const orphans = res.data?.orphans?.length || 0;
    if (moved) pushToast(`${moved} ${moved === 1 ? "person was" : "people were"} moved to @${extra.reassignTo}`);
    if (orphans) warn(`${orphans} ${orphans === 1 ? "person has" : "people have"} no active host now. Use "Change Host" on them.`);
    setHandover(null);
    loadAll();
  };

  const toggleUserActive = async (user) => {
    // Deactivating a host leaves their people without one: offer to hand them over in the same step.
    if (user.active && user.isHost) {
      const count = adminData.users.filter((u) => u.hostUser === user.username).length;
      const firstOther = hostCandidates.find((h) => h.username !== user.username)?.username || "";
      setHandover({ user, mode: "deactivate", newHost: firstOther, count });
      return;
    }
    deactivateOrActivate(user);
  };

  const confirmHandover = async (e) => {
    e.preventDefault();
    if (!handover) return;
    const { user, mode, newHost } = handover;
    if (mode === "deactivate") return deactivateOrActivate(user, newHost ? { reassignTo: newHost } : {});
    setBusy(true);
    const res = await sandeshSocket.sd("admin.user.update", {
      username: user.username,
      isHost: false,
      hostScope: null,
      reassignTo: newHost,
    });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`${user.name} is no longer a host; ${res.data?.movedUsers?.length || 0} people moved to @${newHost}`);
    setHandover(null);
    setHostEditUser(null);
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
    if (res.data?.coversUser === false) {
      warn(`@${selectedNewHost}'s scope doesn't normally cover ${reassignTargetUser.name} (department/branch/designation). Saved as an admin override.`);
    }
    setReassignTargetUser(null);
    loadAll();
  };

  const saveHostScope = async (e) => {
    e.preventDefault();
    const { user, isHost, scope } = hostEditUser;
    if (isHost && scopeIsEmpty(scope)) {
      pushToast({ type: "sd", ok: false, error: { message: "Choose at least one group this host will cover." } });
      return;
    }
    setBusy(true);
    const res = await sandeshSocket.sd("admin.user.update", {
      username: user.username,
      isHost,
      hostScope: isHost ? scope : null,
    });
    setBusy(false);
    if (!res.ok) {
      // A host who still has people can't just stop being a host: ask who takes over.
      if (res.error?.code === "has_users") {
        const count = adminData.users.filter((u) => u.hostUser === user.username).length;
        const firstOther = hostCandidates.find((h) => h.username !== user.username)?.username || "";
        setHandover({ user, mode: "demote", newHost: firstOther, count });
        return;
      }
      return fail(res);
    }
    pushToast(
      !isHost ? `${user.name} is no longer a host` : user.isHost ? `Updated ${user.name}'s host scope` : `${user.name} is now a host`
    );
    const out = res.data?.uncoveredUsers || [];
    if (out.length) warn(`${out.length} of ${user.name}'s people are outside the new scope: ${out.map((x) => "@" + x).join(", ")}. Move them with "Change Host".`);
    setHostEditUser(null);
    loadAll();
  };

  const savePlacement = async (e) => {
    e.preventDefault();
    if (!placementUser) return;
    const { user, branch, department, designation, autoHost } = placementUser;
    const changed = branch !== (user.branch || "") || department !== (user.department || "") || designation !== (user.designation || "");
    if (!changed) {
      pushToast({ type: "sd", ok: false, error: { message: "Nothing to change: pick a different branch, department or designation." } });
      return;
    }
    setBusy(true);
    const res = await sandeshSocket.sd("admin.user.update", { username: user.username, branch, department, designation, autoHost });
    setBusy(false);
    if (!res.ok) return fail(res);
    pushToast(`${user.name} updated: ${[branch, department, designation].filter(Boolean).join(" · ")}`);
    if (res.data?.hostChanged) pushToast(`Host switched to @${res.data.hostChanged.to}, who covers the new placement`);
    if (res.data?.hostMismatch) {
      const sug = res.data.hostMismatch.suggestedHosts || [];
      warn(`@${res.data.hostMismatch.host} no longer covers ${user.name}. ${sug.length ? `Matching hosts: ${sug.map((x) => "@" + x).join(", ")}.` : "No host currently covers this placement."} Use "Change Host".`);
    }
    setPlacementUser(null);
    loadAll();
  };

  const bulkKindOf = { departments: "department", branches: "branch", designations: "designation" };

  const previewBulk = async () => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.users.bulk_move", { kind: bulkMove.kind, from: bulkMove.from, to: bulkMove.to, dryRun: true });
    setBusy(false);
    if (!res.ok) return fail(res);
    setBulkMove({ ...bulkMove, preview: res.data, result: null });
  };

  const runBulk = async () => {
    setBusy(true);
    const res = await sandeshSocket.sd("admin.users.bulk_move", { kind: bulkMove.kind, from: bulkMove.from, to: bulkMove.to, autoHost: !!bulkMove.autoHost });
    setBusy(false);
    if (!res.ok) return fail(res);
    const d = res.data || {};
    pushToast(`Moved ${d.count || 0} ${d.count === 1 ? "person" : "people"} to ${bulkMove.to}`);
    if (d.failed?.length) warn(`${d.failed.length} could not be moved: ${d.failed.map((f) => `@${f.username} (${f.message})`).join("; ")}`);
    if (d.hostMismatch?.length) warn(`${d.hostMismatch.length} now have a host that doesn't cover them: ${d.hostMismatch.map((x) => "@" + x).join(", ")}`);
    setBulkMove(null);
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
        if (scopeIsEmpty(f.hostScope)) {
          pushToast({ type: "sd", ok: false, error: { message: "Choose at least one group this host will cover." } });
          return;
        }
        args.isHost = true;
        args.hostScope = f.hostScope;
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
    setInviteForm({ ...inviteForm, name: "", email: "", mobile: "", isHost: false, hostScope: emptyHostScope() });
    setActiveTab("users");
    loadAll();
  };

  return (
    <div className="sandesh-modal-card-3d sandesh-admin-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div className="admin-header-badge">
            <span className="material-icons admin-badge-icon">admin_panel_settings</span>
          </div>
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
          className={`sandesh-tab-pill ${activeTab === "forms" ? "active" : ""}`}
          onClick={() => setActiveTab("forms")}
        >
          <span className="material-icons pill-icon">description</span> Forms
        </button>
        <button
          type="button"
          className={`sandesh-tab-pill ${activeTab === "options" ? "active" : ""}`}
          onClick={() => setActiveTab("options")}
        >
          <span className="material-icons pill-icon">tune</span> Options
        </button>
        <button
          type="button"
          className={`sandesh-tab-pill ${activeTab === "activity" ? "active" : ""}`}
          onClick={() => setActiveTab("activity")}
        >
          <span className="material-icons pill-icon">history</span> Activity
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
        {locked && (
          <AdminUnlockPanel
            onUnlocked={() => {
              setLocked(false);
              loadAll();
            }}
          />
        )}
        {!locked && loading && !["forms", "options", "activity"].includes(activeTab) && <p className="section-note" style={{ padding: 16 }}>Loading…</p>}
        {!locked && !loading && loadError && !["forms", "options", "activity"].includes(activeTab) && (
          <div className="sandesh-alert sandesh-alert-danger" style={{ margin: 16 }}>
            {loadError}{" "}
            <button type="button" className="sandesh-btn-link" onClick={loadAll}>
              Retry
            </button>
          </div>
        )}

        {/* TAB 1: USERS & HOSTS */}
        {!locked && !loading && !loadError && activeTab === "users" && (
          <div className="admin-table-container">
            <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h4>All Registered Users ({adminData.users.length})</h4>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div className="admin-search-glass">
                  <span className="material-icons" style={{ fontSize: 16, color: "var(--sandesh-text-muted)" }}>search</span>
                  <input
                    type="text"
                    placeholder="Filter users..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                  {userSearch && (
                    <button
                      type="button"
                      onClick={() => setUserSearch("")}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--sandesh-text-muted)", padding: 0 }}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button type="button" className="admin-btn-action" onClick={() => setActiveTab("invite")}>
                  <span className="material-icons" style={{ fontSize: 15 }}>person_add</span>
                  <span>+ Invite User</span>
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
                      {u.isEmployee && (
                        <button
                          type="button"
                          className="sandesh-btn-link"
                          onClick={() =>
                            setPlacementUser({
                              user: u,
                              branch: u.branch || "",
                              department: u.department || "",
                              designation: u.designation || "",
                              autoHost: false,
                            })
                          }
                        >
                          Change Placement
                        </button>
                      )}
                      {u.isEmployee && u.role !== "admin" && (
                        <button
                          type="button"
                          className="sandesh-btn-link"
                          onClick={() =>
                            setHostEditUser({ user: u, isHost: u.isHost, scope: normaliseScope(u.hostScope) })
                          }
                        >
                          {u.isHost ? "Edit Host Scope" : "Make Host"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {hostEditUser && (
              <div className="reassign-host-panel">
                <h5>Host settings for {hostEditUser.user.name}</h5>
                <form onSubmit={saveHostScope} className="reassign-form" style={{ display: "block" }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={hostEditUser.isHost}
                      onChange={(e) => setHostEditUser({ ...hostEditUser, isHost: e.target.checked })}
                    />
                    <span>Chat Host (SPOC for other users)</span>
                  </label>
                  {hostEditUser.isHost && (
                    <HostScopePicker
                      scope={hostEditUser.scope}
                      data={adminData}
                      onChange={(scope) => setHostEditUser({ ...hostEditUser, scope })}
                    />
                  )}
                  <div className="reassign-btns" style={{ marginTop: 12 }}>
                    <button type="submit" className="sandesh-btn-primary-3d" disabled={busy}>
                      Save
                    </button>
                    <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setHostEditUser(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {placementUser && (
              <div className="reassign-host-panel" data-testid="placement-panel">
                <h5>Change placement for {placementUser.user.name}</h5>
                <form onSubmit={savePlacement} className="reassign-form" style={{ display: "block" }}>
                  {[
                    ["branch", "Branch", adminData.branches],
                    ["department", "Department", adminData.departments],
                    ["designation", "Designation", adminData.designations],
                  ].map(([field, label, items]) => (
                    <div key={field} style={{ marginBottom: 8 }}>
                      <label className="section-note">{label}</label>
                      <div className="sandesh-input-box-3d select-box">
                        <select
                          aria-label={label}
                          value={placementUser[field]}
                          onChange={(e) => setPlacementUser({ ...placementUser, [field]: e.target.value })}
                          required
                        >
                          {!items.some((i) => i.name === placementUser[field]) && <option value={placementUser[field]}>{placementUser[field] || "—"}</option>}
                          {items.map((i) => (
                            <option key={i.name} value={i.name}>{i.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={placementUser.autoHost}
                      onChange={(e) => setPlacementUser({ ...placementUser, autoHost: e.target.checked })}
                    />
                    <span>Switch to a host that covers the new placement (if their current host won't)</span>
                  </label>
                  <div className="reassign-btns" style={{ marginTop: 12 }}>
                    <button type="submit" className="sandesh-btn-primary-3d" disabled={busy}>Save</button>
                    <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setPlacementUser(null)}>Cancel</button>
                  </div>
                </form>
              </div>
            )}

            {handover && (
              <div className="reassign-host-panel" data-testid="handover-panel">
                <h5>
                  {handover.mode === "deactivate" ? `Deactivate host ${handover.user.name}` : `${handover.user.name} stops being a host`}
                </h5>
                <p className="section-note">
                  {handover.count
                    ? `${handover.count} ${handover.count === 1 ? "person has" : "people have"} this person as their host.`
                    : "They currently host nobody."}{" "}
                  {handover.mode === "deactivate" ? "Choose who takes over (or decide later)." : "Choose who takes over before continuing."}
                </p>
                <form onSubmit={confirmHandover} className="reassign-form">
                  <div className="sandesh-input-box-3d select-box">
                    <select
                      aria-label="New host"
                      value={handover.newHost}
                      onChange={(e) => setHandover({ ...handover, newHost: e.target.value })}
                      required={handover.mode === "demote"}
                    >
                      {handover.mode === "deactivate" && <option value="">Decide later (they will show as unassigned)</option>}
                      {hostCandidates
                        .filter((h) => h.username !== handover.user.username)
                        .map((h) => (
                          <option key={h.username} value={h.username}>{h.name} (@{h.username})</option>
                        ))}
                    </select>
                  </div>
                  <div className="reassign-btns">
                    <button type="submit" className="sandesh-btn-primary-3d" disabled={busy || (handover.mode === "demote" && !handover.newHost)}>
                      {handover.mode === "deactivate" ? "Deactivate" : "Move people and continue"}
                    </button>
                    <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setHandover(null)}>Cancel</button>
                  </div>
                </form>
              </div>
            )}

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
        {!locked && !loading && !loadError && activeTab === "affiliates" && (
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
        {!locked && !loading && !loadError && activeTab === "setup" && (
          <div className="admin-setup-grid">
            {[
              { kind: "branches", title: "Branches", icon: "domain", fields: ["name", "city", "country", "pin"] },
              { kind: "departments", title: "Departments", icon: "corporate_fare", fields: ["name", "description"] },
              { kind: "designations", title: "Designations", icon: "badge", fields: ["name", "description"] },
            ].map(({ kind, title, icon, fields }) => (
              <div className="setup-card" key={kind}>
                <div className="setup-card-header">
                  <div className="setup-card-title-wrap">
                    <div className="setup-card-icon-badge">
                      <span className="material-icons">{icon}</span>
                    </div>
                    <h5>{title}</h5>
                  </div>
                  <span className="setup-card-count-pill">{adminData[kind].length}</span>
                </div>
                <ul className="setup-list">
                  {adminData[kind].length === 0 ? (
                    <li className="setup-empty-state">
                      <span className="material-icons setup-empty-icon">inventory_2</span>
                      <span>No {title.toLowerCase()} configured</span>
                    </li>
                  ) : (
                    adminData[kind].map((item) => (
                      <li key={item.name} className="setup-list-item">
                        <div className="setup-item-details">
                          <strong className="setup-item-name">{item.name}</strong>
                          <span className="setup-item-sub">
                            {kind === "branches"
                              ? [item.city, item.country, item.pin && `(${item.pin})`].filter(Boolean).join(", ")
                              : item.description || "No description provided"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="setup-item-remove-btn"
                          disabled={busy}
                          title={`Move everyone in ${item.name} somewhere else`}
                          onClick={() =>
                            setBulkMove({
                              kind: bulkKindOf[kind],
                              orgKind: kind,
                              from: item.name,
                              to: adminData[kind].find((x) => x.name !== item.name)?.name || "",
                              autoHost: false,
                              preview: null,
                            })
                          }
                        >
                          <span className="material-icons">swap_horiz</span>
                          <span>Move people</span>
                        </button>
                        <button
                          type="button"
                          className="setup-item-remove-btn"
                          disabled={busy}
                          onClick={() => deleteSetupItem(kind, item.name)}
                          title={`Remove ${item.name}`}
                        >
                          <span className="material-icons">delete_outline</span>
                          <span>Remove</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSetupItem(kind);
                  }}
                  className="setup-add-form"
                >
                  <div className="setup-inputs-stack">
                    {fields.map((f) => (
                      <div className="sandesh-input-box-3d" key={f}>
                        <input
                          type="text"
                          placeholder={f === "pin" ? "PIN Code" : f[0].toUpperCase() + f.slice(1)}
                          value={setupDraft[kind][f]}
                          required={f !== "description"}
                          onChange={(e) =>
                            setSetupDraft((prev) => ({ ...prev, [kind]: { ...prev[kind], [f]: e.target.value } }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <button type="submit" className="admin-btn-add" disabled={busy}>
                    <span className="material-icons" style={{ fontSize: 16 }}>add</span>
                    <span>Add {title.slice(0, -1)}</span>
                  </button>
                </form>
              </div>
            ))}
            {bulkMove && (
              <div className="setup-card" data-testid="bulk-panel" style={{ gridColumn: "1 / -1" }}>
                <h5>Move people: {bulkMove.kind} “{bulkMove.from}”</h5>
                <p className="section-note">Everyone currently in “{bulkMove.from}” moves to the {bulkMove.kind} you choose. Nothing changes until you confirm.</p>
                <div className="sandesh-input-box-3d select-box">
                  <select
                    aria-label="Move to"
                    value={bulkMove.to}
                    onChange={(e) => setBulkMove({ ...bulkMove, to: e.target.value, preview: null })}
                  >
                    {adminData[bulkMove.orgKind]
                      .filter((x) => x.name !== bulkMove.from)
                      .map((x) => (
                        <option key={x.name} value={x.name}>{x.name}</option>
                      ))}
                  </select>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!bulkMove.autoHost}
                    onChange={(e) => setBulkMove({ ...bulkMove, autoHost: e.target.checked })}
                  />
                  <span>Switch people to a host that covers the new placement where their host won't</span>
                </label>
                {bulkMove.preview && (
                  <p className="section-note" data-testid="bulk-preview">
                    {bulkMove.preview.count === 0
                      ? "Nobody is in this group."
                      : `${bulkMove.preview.count} ${bulkMove.preview.count === 1 ? "person" : "people"} will move: ${bulkMove.preview.users.map((u) => "@" + u).join(", ")}`}
                  </p>
                )}
                <div className="reassign-btns" style={{ marginTop: 12 }}>
                  <button type="button" className="sandesh-btn-secondary-3d" onClick={previewBulk} disabled={busy || !bulkMove.to}>Preview</button>
                  <button
                    type="button"
                    className="sandesh-btn-primary-3d"
                    onClick={runBulk}
                    disabled={busy || !bulkMove.preview || bulkMove.preview.count === 0}
                  >
                    {bulkMove.preview?.count ? `Move ${bulkMove.preview.count}` : "Move"}
                  </button>
                  <button type="button" className="sandesh-btn-secondary-3d" onClick={() => setBulkMove(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TABS 5-6: LITE TSTRUCT FORMS + OPTIONS (load their own data) */}
        {!locked && activeTab === "forms" && <AdminFormsPanel pushToast={pushToast} />}
        {!locked && activeTab === "options" && <AdminOptionsPanel pushToast={pushToast} />}
        {!locked && activeTab === "activity" && <AdminActivityPanel pushToast={pushToast} />}

        {/* TAB 4: INVITE USER */}
        {!locked && !loading && !loadError && activeTab === "invite" && (
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
                    <HostScopePicker
                      scope={inviteForm.hostScope}
                      data={adminData}
                      onChange={(hostScope) => setInviteForm({ ...inviteForm, hostScope })}
                    />
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
