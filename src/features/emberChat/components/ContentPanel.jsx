import { useState } from "react";
import { emojiGroups, emojiKeywords, gifResults, stickerResults } from "../data/sampleData.js";

export default function ContentPanel({ onPickEmoji }) {
  const [tab, setTab] = useState("emoji");
  const [emojiQuery, setEmojiQuery] = useState("");

  const query = emojiQuery.trim().toLowerCase();
  const filteredEmojiGroups = query
    ? emojiGroups
        .map((group) => ({ ...group, emoji: group.emoji.filter((e) => (emojiKeywords[e] ?? "").includes(query)) }))
        .filter((group) => group.emoji.length > 0)
    : emojiGroups;

  return (
    <div id="ember-content-panel">
      <div id="ember-content-tabs" role="tablist">
        <button
          type="button"
          className={`content-tab${tab === "emoji" ? " active" : ""}`}
          role="tab"
          aria-selected={tab === "emoji"}
          onClick={() => setTab("emoji")}
        >
          😀 Emoji
        </button>
        <button
          type="button"
          className={`content-tab${tab === "gif" ? " active" : ""}`}
          role="tab"
          aria-selected={tab === "gif"}
          onClick={() => setTab("gif")}
        >
          GIF
        </button>
        <button
          type="button"
          className={`content-tab${tab === "sticker" ? " active" : ""}`}
          role="tab"
          aria-selected={tab === "sticker"}
          onClick={() => setTab("sticker")}
        >
          🖼 Stickers
        </button>
      </div>

      <div className={`content-view${tab === "emoji" ? "" : " hidden"}`}>
        <input
          id="ember-emoji-search"
          type="text"
          placeholder="Search emoji…"
          autoCapitalize="none"
          autoCorrect="off"
          value={emojiQuery}
          onChange={(e) => setEmojiQuery(e.target.value)}
        />
        <div id="ember-emoji-grid">
          {filteredEmojiGroups.length === 0 ? (
            <div className="emoji-group-label">No emoji found</div>
          ) : (
            filteredEmojiGroups.map((group) => (
              <div key={group.label}>
                <div className="emoji-group-label">{group.label}</div>
                <div className="emoji-row">
                  {group.emoji.map((e) => (
                    <button key={e} className="emoji-cell" onClick={() => onPickEmoji?.(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={`content-view${tab === "gif" ? "" : " hidden"}`}>
        <input id="ember-gif-search" type="text" placeholder="Search GIFs…" autoCapitalize="none" autoCorrect="off" />
        <div id="ember-gif-grid">
          {gifResults.map((g) => (
            <button key={g.id} className="gif-cell">
              <img src={g.url} alt="" />
            </button>
          ))}
        </div>
        <div className="giphy-attrib">Powered by GIPHY</div>
      </div>

      <div className={`content-view${tab === "sticker" ? "" : " hidden"}`}>
        <input id="ember-sticker-search" type="text" placeholder="Search stickers…" autoCapitalize="none" autoCorrect="off" />
        <div id="ember-sticker-grid">
          {stickerResults.map((s) => (
            <button key={s.id} className="gif-cell">
              <img src={s.url} alt="" />
            </button>
          ))}
        </div>
        <div className="giphy-attrib">Powered by GIPHY</div>
      </div>
    </div>
  );
}
