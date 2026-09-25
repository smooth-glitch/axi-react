import { useState } from "react";
import Avatar from "../Avatar.jsx";

const DEFAULT_HOSTS = [
  {
    id: "host-hr",
    hostKey: "hr",
    name: "HR Operations Desk",
    category: "department_host",
    spoc: "Nageshwari (HR Manager)",
    description: "Central HR & People Ops. Leave requests, payroll inquiries, onboarding support.",
    initials: "HR",
    color: "#ff9f0a",
    icon: "groups",
    topic: "Leave, Payroll & HR Support",
  },
  {
    id: "host-finance",
    hostKey: "finance",
    name: "Corporate Finance & Accounts",
    category: "department_host",
    spoc: "Corporate Finance Desk",
    description: "Expense processing, travel settlements, client invoices, vendor purchase orders.",
    initials: "FN",
    color: "#34c759",
    icon: "account_balance",
    topic: "Expense Claim & Invoices",
  },
  {
    id: "host-workspace",
    hostKey: "workspace",
    name: "My Workspace (Sandesh)",
    category: "ai_host",
    spoc: "Application Assistant",
    description: "Core workspace automation: Tstruct records, Smart prompts, data bin synchronization.",
    initials: "WS",
    color: "#007aff",
    icon: "auto_awesome",
    topic: "Workspace Automation",
  },
  {
    id: "host-openai",
    hostKey: "openai",
    name: "OpenAI GPT-4o",
    category: "ai_host",
    spoc: "Enterprise AI Model",
    description: "Advanced intelligence: complex calculations, document drafting, query reasoning.",
    initials: "AI",
    color: "#af52de",
    icon: "psychology",
    topic: "AI Inquiries & Analysis",
  },
];

export default function HostsDirectoryModal({
  onSelectHost,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const filteredHosts = DEFAULT_HOSTS.filter((h) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      h.name.toLowerCase().includes(q) ||
      h.description.toLowerCase().includes(q) ||
      h.spoc.toLowerCase().includes(q) ||
      h.hostKey.toLowerCase().includes(q)
    );
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-hosts-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(0, 122, 255, 0.15)",
              color: "#007aff",
            }}
          >
            <span className="material-icons">domain</span>
          </div>
          <div>
            <h3>Sandesh Host Directory</h3>
            <span className="modal-subtitle">
              Department Hosts, Functional SPOCs &amp; Enterprise AI Assistants
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close hosts directory"
        >
          ×
        </button>
      </div>

      <div style={{ padding: "14px 22px 4px 22px" }}>
        <div className="new-group-input-box">
          <span className="material-icons field-icon">search</span>
          <input
            type="text"
            className="new-group-input"
            placeholder="Search department hosts or AI assistants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch("")}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "12px 22px" }}>
        {filteredHosts.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">domain_disabled</span>
            <h4>No hosts found</h4>
            <p>No department host matches &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="directory-user-list">
            {filteredHosts.map((h) => (
              <div key={h.id} className="directory-user-card host-entry-card">
                <div className="directory-user-avatar-wrap">
                  <Avatar initials={h.initials} color={h.color} />
                  <span className="online-beacon-dot" style={{ background: h.color }} />
                </div>

                <div className="directory-user-info">
                  <div className="directory-user-name-row">
                    <span className="directory-user-name">{h.name}</span>
                    <span className="host-key-tag">#{h.hostKey}</span>
                    <span className={`host-cat-pill tag-${h.category}`}>
                      {h.category === "ai_host" ? "AI Model" : "Department"}
                    </span>
                  </div>
                  <div className="directory-user-sub">
                    <strong>SPOC:</strong> {h.spoc}
                  </div>
                  <div className="host-entry-desc">{h.description}</div>
                </div>

                <div className="directory-user-actions">
                  <button
                    type="button"
                    className="sandesh-btn-primary-3d"
                    style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
                    onClick={() => {
                      onSelectHost?.(h.id);
                      onClose?.();
                    }}
                  >
                    <span className="material-icons" style={{ fontSize: "16px" }}>chat</span>
                    <span>Open Host</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#hosts</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#host &lt;host&gt; &lt;text&gt;</code>
        </span>
        <button
          type="button"
          className="sandesh-btn-secondary-3d"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
