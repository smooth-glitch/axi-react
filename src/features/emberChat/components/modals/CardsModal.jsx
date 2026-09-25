import { useState } from "react";

export default function CardsModal({
  initialSection = "all",
  cards = [],
  onDismissCard,
  onAddReminder,
  onClose,
}) {
  const [sectionFilter, setSectionFilter] = useState(initialSection || "all");
  const [newReminderText, setNewReminderText] = useState("");
  const [showAddReminder, setShowAddReminder] = useState(false);

  const sections = ["all", "tasks", "reminders", "system"];

  const filtered = cards.filter((c) => {
    if (sectionFilter === "all") return true;
    return c.section === sectionFilter;
  });

  const handleReminderSubmit = (e) => {
    e.preventDefault();
    const clean = newReminderText.trim();
    if (!clean) return;
    onAddReminder?.(clean);
    setNewReminderText("");
    setShowAddReminder(false);
  };

  return (
    <div className="sandesh-modal-card-3d sandesh-cards-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">view_carousel</span>
          </div>
          <div>
            <h3>Sandesh Message Cards &amp; Reminders</h3>
            <span className="modal-subtitle">
              Interactive task cards, smart alerts and scheduled reminders
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close cards"
        >
          ×
        </button>
      </div>

      {/* Sections and Add Reminder */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 22px 4px 22px", flexWrap: "wrap", gap: "8px" }}>
        <div className="sandesh-tab-pills-3d" style={{ margin: 0 }}>
          {sections.map((sec) => (
            <button
              key={sec}
              type="button"
              className={`sandesh-tab-pill ${sectionFilter === sec ? "active" : ""}`}
              onClick={() => setSectionFilter(sec)}
            >
              {sec.charAt(0).toUpperCase() + sec.slice(1)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="sandesh-btn-primary-3d"
          style={{ padding: "6px 14px", fontSize: "12px", gap: "6px" }}
          onClick={() => setShowAddReminder((v) => !v)}
        >
          <span className="material-icons" style={{ fontSize: "16px" }}>add_alert</span>
          <span>+ Add Reminder</span>
        </button>
      </div>

      {showAddReminder && (
        <form onSubmit={handleReminderSubmit} style={{ padding: "8px 22px 4px 22px" }}>
          <div className="new-group-input-box">
            <span className="material-icons field-icon">edit_calendar</span>
            <input
              type="text"
              className="new-group-input"
              placeholder="What would you like to be reminded of?"
              value={newReminderText}
              onChange={(e) => setNewReminderText(e.target.value)}
              autoFocus
            />
            <button type="submit" className="sandesh-btn-mini-primary" style={{ height: "30px" }}>
              Save
            </button>
          </div>
        </form>
      )}

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "14px 22px" }}>
        {filtered.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">layers_clear</span>
            <h4>No cards in this section</h4>
            <p>You have no active cards or reminders right now.</p>
          </div>
        ) : (
          <div className="cards-grid-stack">
            {filtered.map((card) => (
              <div key={card.id} className="sandesh-message-card-entry">
                <div className="card-entry-header">
                  <div className="card-type-chip">
                    <span className="material-icons card-chip-icon">
                      {card.section === "reminders" ? "alarm" : card.section === "tasks" ? "check_circle" : "dashboard"}
                    </span>
                    <span>{card.title || "Message Card"}</span>
                  </div>
                  <button
                    type="button"
                    className="card-dismiss-btn"
                    title="Dismiss card"
                    onClick={() => onDismissCard?.(card.id)}
                  >
                    <span className="material-icons">close</span>
                    <span>Dismiss</span>
                  </button>
                </div>

                <div className="card-entry-body">
                  <p>{card.text || card.content}</p>
                  {card.subtitle && <span className="card-sub-note">{card.subtitle}</span>}
                </div>

                <div className="card-entry-footer">
                  <span className="card-time-note">{card.time || "Active"}</span>
                  <span className="card-id-note">Card #{card.id}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Command: <code style={{ color: "var(--sandesh-coral-accent)" }}>#cards [section]</code> or <code style={{ color: "var(--sandesh-coral-accent)" }}>#remind &lt;text&gt;</code>
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
