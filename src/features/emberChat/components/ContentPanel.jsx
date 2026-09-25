import { useEffect, useMemo, useRef, useState } from "react";
import { emojiGroups, emojiKeywords, gifResults, stickerResults } from "../data/sampleData.js";

const categoryIcons = {
  "All": "grid_view",
  "Smileys & Emotion": "sentiment_satisfied_alt",
  "Hands & Gestures": "pan_tool_alt",
  "Hearts & Sparkles": "favorite",
  "Work & Tech": "laptop_mac",
  "Food & Activities": "celebration",
};

// Rich curated GIFs library with animated SVG visuals
const CURATED_GIFS = [
  {
    id: "g1",
    title: "Thumbs Up",
    tags: ["thumbsup", "agree", "cool", "yes", "like", "ok"],
    url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
    preview: "👍",
    accent: "#ff7a59",
  },
  {
    id: "g2",
    title: "Celebration Tada",
    tags: ["party", "celebrate", "tada", "congrats", "cheers", "win"],
    url: "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif",
    preview: "🎉",
    accent: "#ff9f0a",
  },
  {
    id: "g3",
    title: "Mind Blown",
    tags: ["mindblown", "wow", "shock", "amazing", "omg"],
    url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif",
    preview: "🤯",
    accent: "#af52de",
  },
  {
    id: "g4",
    title: "Clapping Applause",
    tags: ["clap", "applause", "bravo", "good job", "respect"],
    url: "https://media.giphy.com/media/7rj2ZgttvgomY/giphy.gif",
    preview: "👏",
    accent: "#34c759",
  },
  {
    id: "g5",
    title: "Thinking Hard",
    tags: ["think", "hmm", "ponder", "wonder", "idea"],
    url: "https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif",
    preview: "🤔",
    accent: "#007aff",
  },
  {
    id: "g6",
    title: "Rocket Launch",
    tags: ["rocket", "ship", "fast", "launch", "speed", "deploy"],
    url: "https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif",
    preview: "🚀",
    accent: "#ff3b30",
  },
  {
    id: "g7",
    title: "High Five",
    tags: ["highfive", "partner", "team", "together", "awesome"],
    url: "https://media.giphy.com/media/l0ErFafpUCQTQFMSk/giphy.gif",
    preview: "✋",
    accent: "#5856d6",
  },
  {
    id: "g8",
    title: "Coffee Time",
    tags: ["coffee", "morning", "break", "energy", "work"],
    url: "https://media.giphy.com/media/oZEBLugoTdzxK/giphy.gif",
    preview: "☕",
    accent: "#a2845e",
  },
];

// Rich curated Stickers library
const CURATED_STICKERS = [
  {
    id: "s1",
    title: "APPROVED",
    tags: ["approved", "ok", "passed", "done", "verified"],
    color: "#34c759",
    icon: "verified",
    badge: "APPROVED",
  },
  {
    id: "s2",
    title: "TOP PRIORITY",
    tags: ["urgent", "priority", "critical", "important"],
    color: "#ff3b30",
    icon: "priority_high",
    badge: "URGENT",
  },
  {
    id: "s3",
    title: "GREAT JOB",
    tags: ["congrats", "kudos", "great", "applause", "awesome"],
    color: "#ff9f0a",
    icon: "star",
    badge: "KUDOS",
  },
  {
    id: "s4",
    title: "UNDER REVIEW",
    tags: ["review", "pending", "audit", "check"],
    color: "#007aff",
    icon: "rate_review",
    badge: "IN REVIEW",
  },
  {
    id: "s5",
    title: "SANDESH VERIFIED",
    tags: ["sandesh", "official", "enterprise", "badge"],
    color: "var(--sandesh-coral-accent)",
    icon: "security",
    badge: "SANDESH",
  },
  {
    id: "s6",
    title: "DEPLOYED",
    tags: ["shipped", "deployed", "live", "production"],
    color: "#af52de",
    icon: "rocket_launch",
    badge: "SHIPPED",
  },
];

export default function ContentPanel({
  initialTab = "emojis", // "emojis" | "gifs" | "stickers"
  initialQuery = "",
  onPickEmoji,
  onPickGif,
  onPickSticker,
  onClose,
}) {
  const [activeMediaTab, setActiveMediaTab] = useState(initialTab || "emojis");
  const [searchQuery, setSearchQuery] = useState(initialQuery || "");
  const [activeCategory, setActiveCategory] = useState("All");
  const panelRef = useRef(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
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

  const query = searchQuery.trim().toLowerCase();

  // Filter Emojis
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

  // Filter GIFs
  const filteredGifs = useMemo(() => {
    if (!query) return CURATED_GIFS;
    return CURATED_GIFS.filter((g) =>
      g.title.toLowerCase().includes(query) || g.tags.some((t) => t.includes(query))
    );
  }, [query]);

  // Filter Stickers
  const filteredStickers = useMemo(() => {
    if (!query) return CURATED_STICKERS;
    return CURATED_STICKERS.filter((s) =>
      s.title.toLowerCase().includes(query) || s.tags.some((t) => t.includes(query))
    );
  }, [query]);

  return (
    <div
      id="ember-content-panel"
      ref={panelRef}
      className="sandesh-emoji-picker-panel"
      role="dialog"
      aria-label="Media & Emoji Picker"
    >
      {/* 1. Header with Mode Tabs and Close */}
      <div className="emoji-panel-header" style={{ paddingBottom: "10px" }}>
        <div className="content-media-pills">
          <button
            type="button"
            className={`content-media-tab-btn ${activeMediaTab === "emojis" ? "active" : ""}`}
            onClick={() => {
              setActiveMediaTab("emojis");
              setSearchQuery("");
            }}
          >
            <span className="material-icons">sentiment_satisfied_alt</span>
            <span>Emojis</span>
          </button>
          <button
            type="button"
            className={`content-media-tab-btn ${activeMediaTab === "gifs" ? "active" : ""}`}
            onClick={() => {
              setActiveMediaTab("gifs");
              setSearchQuery("");
            }}
          >
            <span className="material-icons">gif_box</span>
            <span>GIFs</span>
          </button>
          <button
            type="button"
            className={`content-media-tab-btn ${activeMediaTab === "stickers" ? "active" : ""}`}
            onClick={() => {
              setActiveMediaTab("stickers");
              setSearchQuery("");
            }}
          >
            <span className="material-icons">sticky_note_2</span>
            <span>Stickers</span>
          </button>
        </div>

        <button
          type="button"
          className="emoji-panel-close-btn"
          onClick={onClose}
          aria-label="Close picker"
        >
          ✕
        </button>
      </div>

      {/* 2. Search Input Bar */}
      <div className="emoji-search-box">
        <span className="material-icons search-icon">search</span>
        <input
          id="ember-emoji-search"
          type="text"
          className="emoji-search-input"
          placeholder={
            activeMediaTab === "gifs"
              ? "Search GIFs (e.g. thumbs up, party, high five)..."
              : activeMediaTab === "stickers"
              ? "Search Stickers (e.g. approved, urgent, kudos)..."
              : "Search emojis (e.g. smile, fire, love)..."
          }
          autoCapitalize="none"
          autoCorrect="off"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* 3. TAB VIEW 1: EMOJIS */}
      {activeMediaTab === "emojis" && (
        <>
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

          <div className="emoji-scroll-body" id="ember-emoji-grid">
            {totalFilteredCount === 0 ? (
              <div className="emoji-empty-result">
                <span className="material-icons">sentiment_dissatisfied</span>
                <p>No emoji matching &ldquo;{searchQuery}&rdquo;</p>
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
        </>
      )}

      {/* 4. TAB VIEW 2: GIFS */}
      {activeMediaTab === "gifs" && (
        <div className="emoji-scroll-body gifs-scroll-grid">
          {filteredGifs.length === 0 ? (
            <div className="emoji-empty-result">
              <span className="material-icons">gif_box</span>
              <p>No GIFs found matching &ldquo;{searchQuery}&rdquo;</p>
            </div>
          ) : (
            <div className="gifs-masonry-grid">
              {filteredGifs.map((gif) => (
                <div
                  key={gif.id}
                  className="gif-card-item"
                  onClick={() => {
                    onPickGif?.(gif);
                    onClose?.();
                  }}
                  title={gif.title}
                >
                  <div
                    className="gif-preview-box"
                    style={{ background: `radial-gradient(circle, ${gif.accent}22, rgba(255,255,255,0.8))` }}
                  >
                    <span className="gif-preview-emoji">{gif.preview}</span>
                    <span className="gif-badge">GIF</span>
                  </div>
                  <span className="gif-title-label">{gif.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. TAB VIEW 3: STICKERS */}
      {activeMediaTab === "stickers" && (
        <div className="emoji-scroll-body stickers-scroll-grid">
          {filteredStickers.length === 0 ? (
            <div className="emoji-empty-result">
              <span className="material-icons">sticky_note_2</span>
              <p>No stickers found matching &ldquo;{searchQuery}&rdquo;</p>
            </div>
          ) : (
            <div className="stickers-cards-grid">
              {filteredStickers.map((stk) => (
                <div
                  key={stk.id}
                  className="sticker-card-item"
                  onClick={() => {
                    onPickSticker?.(stk);
                    onClose?.();
                  }}
                  title={stk.title}
                >
                  <div
                    className="sticker-badge-container"
                    style={{ borderColor: stk.color, color: stk.color }}
                  >
                    <span className="material-icons sticker-main-icon">{stk.icon}</span>
                    <span className="sticker-badge-text">{stk.badge}</span>
                  </div>
                  <span className="sticker-title-label">{stk.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
