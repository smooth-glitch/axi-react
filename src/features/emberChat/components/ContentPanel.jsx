import { useEffect, useMemo, useRef, useState } from "react";
import { emojiGroups, emojiKeywords } from "../data/sampleData.js";

const categoryIcons = {
  "All": "grid_view",
  "Smileys & Emotion": "sentiment_satisfied_alt",
  "Hands & Gestures": "pan_tool_alt",
  "Hearts & Sparkles": "favorite",
  "Work & Tech": "laptop_mac",
  "Food & Activities": "celebration",
};

export default function ContentPanel({ onPickEmoji, onClose }) {
  const [emojiQuery, setEmojiQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const panelRef = useRef(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        // Check if clicked the toggle button
        if (e.target.closest(".composer-emoji-btn")) return;
        onClose?.();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const query = emojiQuery.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    let base = emojiGroups;
    if (activeCategory !== "All") {
      base = emojiGroups.filter((g) => g.label === activeCategory);
    }
    if (!query) return base;

    return base
      .map((group) => ({
        ...group,
        emoji: group.emoji.filter((e) => {
          const kw = (emojiKeywords[e] || "").toLowerCase();
          return kw.includes(query) || e.includes(query);
        }),
      }))
      .filter((group) => group.emoji.length > 0);
  }, [query, activeCategory]);

  const totalFilteredCount = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.emoji.length, 0);
  }, [filteredGroups]);

  return (
    <div
      id="ember-content-panel"
      ref={panelRef}
      className="sandesh-emoji-picker-panel"
      role="dialog"
      aria-label="Emoji Picker"
    >
      {/* Header with Title and Close button */}
      <div className="emoji-panel-header">
        <div className="panel-title-pill">
          <span className="material-icons emoji-header-icon">add_reaction</span>
          <span className="emoji-panel-title">Emojis & Reactions</span>
        </div>
        <button
          type="button"
          className="emoji-panel-close-btn"
          onClick={onClose}
          aria-label="Close emoji picker"
        >
          ✕
        </button>
      </div>

      {/* Search Input Bar */}
      <div className="emoji-search-box">
        <span className="material-icons search-icon">search</span>
        <input
          id="ember-emoji-search"
          type="text"
          className="emoji-search-input"
          placeholder="Search emojis (e.g. smile, fire, love)..."
          autoCapitalize="none"
          autoCorrect="off"
          value={emojiQuery}
          onChange={(e) => setEmojiQuery(e.target.value)}
          autoFocus
        />
        {emojiQuery && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => setEmojiQuery("")}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Category Tabs Strip */}
      <div className="emoji-category-tabs" role="tablist">
        <button
          type="button"
          className={`category-tab-btn ${activeCategory === "All" ? "active" : ""}`}
          onClick={() => setActiveCategory("All")}
          role="tab"
          aria-selected={activeCategory === "All"}
          title="All Emojis"
        >
          <span className="material-icons tab-icon">apps</span>
          <span className="tab-label">All</span>
        </button>
        {emojiGroups.map((group) => (
          <button
            key={group.label}
            type="button"
            className={`category-tab-btn ${activeCategory === group.label ? "active" : ""}`}
            onClick={() => setActiveCategory(group.label)}
            role="tab"
            aria-selected={activeCategory === group.label}
            title={group.label}
          >
            <span className="material-icons tab-icon">
              {categoryIcons[group.label] || "emoji_emotions"}
            </span>
            <span className="tab-label">{group.label.split(" ")[0]}</span>
          </button>
        ))}
      </div>

      {/* Scrollable Emojis Grid */}
      <div className="emoji-scroll-body" id="ember-emoji-grid">
        {totalFilteredCount === 0 ? (
          <div className="emoji-empty-result">
            <span className="material-icons">sentiment_dissatisfied</span>
            <p>No emoji matching &ldquo;{emojiQuery}&rdquo;</p>
          </div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.label} className="emoji-group-section">
              <div className="emoji-group-heading">
                <span>{group.label}</span>
                <span className="group-count">{group.emoji.length}</span>
              </div>
              <div className="emoji-grid-cells">
                {group.emoji.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="emoji-cell"
                    title={emojiKeywords[e] || e}
                    aria-label={emojiKeywords[e] || e}
                    onClick={() => onPickEmoji?.(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
