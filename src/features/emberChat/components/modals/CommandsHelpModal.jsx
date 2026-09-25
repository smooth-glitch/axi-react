import { useState } from "react";
import { COMMAND_CATEGORIES, DEFAULT_COMMANDS_CATALOG } from "../../data/hashCommandsCatalog.js";

export default function CommandsHelpModal({
  initialCommand = null,
  onSelectCommand,
  onClose,
}) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState(initialCommand || "");

  const query = searchQuery.trim().toLowerCase().replace(/^#/, "");

  const filteredCommands = DEFAULT_COMMANDS_CATALOG.filter((cmd) => {
    if (selectedCategory !== "all" && cmd.category !== selectedCategory) {
      return false;
    }
    if (!query) return true;
    const nameMatch = cmd.name.toLowerCase().includes(query);
    const aliasMatch = (cmd.aliases || []).some((a) => a.toLowerCase().includes(query));
    const summaryMatch = (cmd.summary || "").toLowerCase().includes(query);
    return nameMatch || aliasMatch || summaryMatch;
  });

  return (
    <div className="sandesh-modal-card-3d sandesh-commands-help-modal">
      {/* Header */}
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{
              background: "rgba(255, 122, 89, 0.15)",
              color: "var(--sandesh-coral-accent)",
            }}
          >
            <span className="material-icons">terminal</span>
          </div>
          <div>
            <h3>Sandesh #Commands Directory</h3>
            <span className="modal-subtitle">
              Type # in the message box to run actions &amp; navigate interfaces
            </span>
          </div>
        </div>
        <button
          type="button"
          className="close-btn-3d"
          onClick={onClose}
          aria-label="Close commands dialog"
        >
          ×
        </button>
      </div>

      {/* Search and Category Filters */}
      <div className="commands-filter-bar">
        <div className="new-group-input-box" style={{ flex: 1, margin: "14px 20px 8px 20px" }}>
          <span className="material-icons field-icon">search</span>
          <input
            type="text"
            className="new-group-input"
            placeholder="Search commands by name, alias or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>

        <div className="commands-categories-scroll">
          <button
            type="button"
            className={`cmd-cat-pill ${selectedCategory === "all" ? "active" : ""}`}
            onClick={() => setSelectedCategory("all")}
          >
            All Commands ({DEFAULT_COMMANDS_CATALOG.length})
          </button>
          {COMMAND_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`cmd-cat-pill ${selectedCategory === cat.id ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat.id)}
            >
              <span className="material-icons pill-cat-icon">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Commands List */}
      <div className="sandesh-modal-body commands-scroll-body">
        {filteredCommands.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">search_off</span>
            <h4>No commands found</h4>
            <p>No chat command matches &ldquo;{searchQuery}&rdquo;</p>
          </div>
        ) : (
          <div className="commands-grid">
            {filteredCommands.map((cmd) => (
              <div key={cmd.name} className="command-card-3d">
                <div className="command-card-top">
                  <div className="command-name-badge">
                    <span className="cmd-hash">#</span>
                    <span className="cmd-title">{cmd.name}</span>
                    {cmd.aliases && cmd.aliases.length > 0 && (
                      <span className="cmd-aliases">
                        ({cmd.aliases.map((a) => `#${a}`).join(", ")})
                      </span>
                    )}
                  </div>
                  {cmd.requires && cmd.requires !== "none" && (
                    <span className={`cmd-req-badge req-${cmd.requires}`}>
                      {cmd.requires === "admin" ? "Admin Only" : "Host Only"}
                    </span>
                  )}
                </div>

                <div className="command-card-desc">{cmd.summary}</div>

                <div className="command-card-usage">
                  <code>{cmd.usage}</code>
                </div>

                <div className="command-card-actions">
                  <button
                    type="button"
                    className="cmd-run-btn"
                    onClick={() => {
                      onSelectCommand?.(cmd);
                      onClose?.();
                    }}
                  >
                    <span className="material-icons">play_arrow</span>
                    <span>Use Command</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Tip: You can type <code style={{ color: "var(--sandesh-coral-accent)" }}>#</code> in the chat composer anytime for live suggestions.
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
