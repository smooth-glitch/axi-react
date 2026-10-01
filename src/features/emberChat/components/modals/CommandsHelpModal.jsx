import { useState, useMemo, useEffect } from "react";
import { COMMAND_CATEGORIES, DEFAULT_COMMANDS_CATALOG } from "../../data/hashCommandsCatalog.js";

export default function CommandsHelpModal({
  initialCommand = null,
  catalog = DEFAULT_COMMANDS_CATALOG,
  currentUser = null,
  onSelectCommand,
  onClose,
}) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState(initialCommand || "");
  const [copiedCmd, setCopiedCmd] = useState(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Clean search query
  const query = searchQuery.trim().toLowerCase().replace(/^#/, "");

  // Safe normalized catalog list
  const allCommands = useMemo(() => {
    const sourceList = Array.isArray(catalog) && catalog.length > 0 ? catalog : DEFAULT_COMMANDS_CATALOG;
    // Map backend categories if needed to harmonize with UI categories
    return sourceList.map((cmd) => {
      let cat = (cmd.category || "help").toLowerCase();
      if (cat === "inbox") cat = "notifs";
      return {
        ...cmd,
        uiCategory: cat,
      };
    });
  }, [catalog]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = { all: allCommands.length };
    COMMAND_CATEGORIES.forEach((cat) => {
      counts[cat.id] = allCommands.filter((c) => {
        if (cat.id === "notifs") return c.uiCategory === "notifs" || c.category === "inbox";
        if (cat.id === "people") return c.uiCategory === "people" || c.category === "profile";
        return c.uiCategory === cat.id || c.category === cat.id;
      }).length;
    });
    return counts;
  }, [allCommands]);

  // Filtered commands based on category and search query
  const filteredCommands = useMemo(() => {
    return allCommands.filter((cmd) => {
      // Category filter
      if (selectedCategory !== "all") {
        const matchesCategory =
          selectedCategory === "notifs"
            ? cmd.uiCategory === "notifs" || cmd.category === "inbox"
            : selectedCategory === "people"
            ? cmd.uiCategory === "people" || cmd.category === "profile"
            : cmd.uiCategory === selectedCategory || cmd.category === selectedCategory;

        if (!matchesCategory) return false;
      }

      // Search filter
      if (!query) return true;

      const nameMatch = (cmd.name || "").toLowerCase().includes(query);
      const aliasMatch = (cmd.aliases || []).some((a) => a.toLowerCase().includes(query));
      const summaryMatch = (cmd.summary || "").toLowerCase().includes(query);
      const usageMatch = (cmd.usage || "").toLowerCase().includes(query);
      const catMatch = (cmd.category || "").toLowerCase().includes(query);
      const argsMatch = (cmd.args || []).some(
        (arg) =>
          (arg.name && arg.name.toLowerCase().includes(query)) ||
          (arg.type && String(arg.type).toLowerCase().includes(query))
      );

      return nameMatch || aliasMatch || summaryMatch || usageMatch || catMatch || argsMatch;
    });
  }, [allCommands, selectedCategory, query]);

  const handleCopyUsage = (e, cmd) => {
    e.stopPropagation();
    const textToCopy = cmd.usage || `#${cmd.name}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedCmd(cmd.name);
      setTimeout(() => setCopiedCmd(null), 2000);
    }
  };

  return (
    <div
      className="sandesh-modal-card-3d sandesh-commands-help-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commands-directory-title"
    >
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
            <h3 id="commands-directory-title">Sandesh #Commands Directory</h3>
            <span className="modal-subtitle">
              Complete index of {allCommands.length} chat, system &amp; workflow hash commands
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

      {/* Search Bar & Filters */}
      <div className="commands-filter-bar">
        <div className="commands-search-row">
          <div className="new-group-input-box" style={{ flex: 1 }}>
            <span className="material-icons field-icon">search</span>
            <input
              type="text"
              className="new-group-input"
              placeholder="Search commands by name, alias, syntax or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery("")}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <div className="commands-count-indicator">
            {filteredCommands.length} / {allCommands.length}
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="commands-help-categories commands-categories-scroll">
          <button
            type="button"
            className={`cmd-cat-pill ${selectedCategory === "all" ? "active" : ""}`}
            onClick={() => setSelectedCategory("all")}
          >
            <span className="material-icons pill-cat-icon">apps</span>
            <span>All Commands ({allCommands.length})</span>
          </button>
          {COMMAND_CATEGORIES.map((cat) => {
            const count = categoryCounts[cat.id] || 0;
            if (count === 0) return null;
            return (
              <button
                key={cat.id}
                type="button"
                className={`cmd-cat-pill ${selectedCategory === cat.id ? "active" : ""}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <span className="material-icons pill-cat-icon">{cat.icon}</span>
                <span>{cat.label}</span>
                <span className="cmd-pill-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Commands Scroll Body */}
      <div className="sandesh-modal-body commands-scroll-body">
        {filteredCommands.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">search_off</span>
            <h4>No commands found</h4>
            <p>
              No hash command matched <strong>&ldquo;{searchQuery}&rdquo;</strong>
              {selectedCategory !== "all" ? ` in category "${selectedCategory}"` : ""}
            </p>
            <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
              {searchQuery && (
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                  onClick={() => setSearchQuery("")}
                >
                  Clear Search
                </button>
              )}
              {selectedCategory !== "all" && (
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                  onClick={() => setSelectedCategory("all")}
                >
                  View All Categories
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="commands-grid">
            {filteredCommands.map((cmd) => {
              const categoryObj = COMMAND_CATEGORIES.find(
                (c) => c.id === cmd.uiCategory || c.id === cmd.category
              );
              const isCopied = copiedCmd === cmd.name;

              return (
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
                    <div className="command-tags-row">
                      {categoryObj && (
                        <span className="cmd-cat-tag">
                          {categoryObj.label}
                        </span>
                      )}
                      {cmd.requires && cmd.requires !== "none" && (
                        <span className={`cmd-req-badge req-${cmd.requires}`}>
                          {cmd.requires === "admin" ? "Admin Only" : cmd.requires === "host" ? "Host Only" : cmd.requires}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="command-card-desc">{cmd.summary}</div>

                  <div className="command-card-usage-wrap">
                    <div className="command-card-usage">
                      <code>{cmd.usage}</code>
                    </div>
                    <button
                      type="button"
                      className="cmd-copy-btn"
                      onClick={(e) => handleCopyUsage(e, cmd)}
                      title="Copy command syntax"
                      aria-label={`Copy syntax for #${cmd.name}`}
                    >
                      <span className="material-icons" style={{ fontSize: "14px" }}>
                        {isCopied ? "check" : "content_copy"}
                      </span>
                      <span>{isCopied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>

                  {/* Arguments breakdown if parameters are needed */}
                  {cmd.args && cmd.args.length > 0 && (
                    <div className="cmd-args-preview">
                      <span className="cmd-args-label">Parameters:</span>
                      <div className="cmd-args-list">
                        {cmd.args.map((arg, idx) => (
                          <span
                            key={idx}
                            className={`cmd-arg-chip ${arg.required ? "arg-req" : "arg-opt"}`}
                            title={arg.required ? "Required parameter" : "Optional parameter"}
                          >
                            <span className="arg-chip-name">{arg.name}</span>
                            <span className="arg-chip-type">
                              {arg.type === "enum" && arg.values ? `enum(${arg.values.join("|")})` : String(arg.type || "text")}
                            </span>
                            {arg.required ? (
                              <span className="arg-req-mark">*</span>
                            ) : (
                              <span className="arg-opt-mark">opt</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="command-card-actions">
                    <span className="cmd-card-category-hint">
                      <span className="material-icons" style={{ fontSize: "14px", verticalAlign: "middle" }}>
                        {categoryObj?.icon || "label"}
                      </span>{" "}
                      {categoryObj?.label || cmd.category}
                    </span>
                    <button
                      type="button"
                      className="cmd-run-btn"
                      onClick={() => {
                        onSelectCommand?.(cmd);
                        onClose?.();
                      }}
                      title={`Insert #${cmd.name} in chat`}
                    >
                      <span className="material-icons">play_arrow</span>
                      <span>Use Command</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sandesh-modal-actions" style={{ padding: "14px 22px" }}>
        <span style={{ fontSize: "12px", color: "var(--sandesh-text-muted)" }}>
          Tip: You can type <code style={{ color: "var(--sandesh-coral-accent)", fontWeight: 700 }}>#</code> in the composer for quick autocompletion, or type <code style={{ color: "var(--sandesh-coral-accent)", fontWeight: 700 }}>#help</code> anytime.
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
