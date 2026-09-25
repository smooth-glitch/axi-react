import { useState } from "react";
import { quickReactions } from "../data/sampleData.js";

const extraPopularReactions = [
  "🔥", "🎉", "👏", "💯", "🚀", "✨", "🤝", "🥰", "🤩", "👀"
];

export default function QuickReactPopup({ style, onPick, onMore }) {
  const [expanded, setExpanded] = useState(false);

  const displayedReactions = expanded
    ? [...quickReactions, ...extraPopularReactions]
    : quickReactions;

  const handleMoreClick = (e) => {
    e.stopPropagation();
    if (onMore) {
      onMore();
    } else {
      setExpanded((v) => !v);
    }
  };

  return (
    <div
      id="ember-quick-react-popup"
      className={`sandesh-quick-react-pill ${expanded ? "expanded" : ""}`}
      role="menu"
      aria-label="Quick reactions"
      style={style}
    >
      <div className="quick-react-emojis">
        {displayedReactions.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="react-emoji-btn"
            data-emoji={emoji}
            aria-label={emoji}
            title={emoji}
            onClick={() => onPick?.(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        id="ember-quick-react-more"
        className={`react-more-btn ${expanded ? "active" : ""}`}
        aria-label={expanded ? "Less reactions" : "More reactions"}
        title={expanded ? "Show fewer reactions" : "More reactions"}
        onClick={handleMoreClick}
      >
        <span className="material-icons">{expanded ? "close" : "add"}</span>
      </button>
    </div>
  );
}
