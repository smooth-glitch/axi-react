import { useState } from "react";
import { emojiGroups, emojiKeywords } from "../data/sampleData.js";

export default function ContentPanel({ onPickEmoji }) {
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
          className="content-tab active"
          role="tab"
          aria-selected="true"
        >
          😀 Emoji
        </button>
      </div>

      <div className="content-view">
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
    </div>
  );
}

