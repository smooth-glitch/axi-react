import { quickReactions } from "../data/sampleData.js";

export default function QuickReactPopup({ style, onPick, onMore }) {
  return (
    <div id="ember-quick-react-popup" role="menu" aria-label="Quick reactions" style={style}>
      {quickReactions.map((emoji) => (
        <button key={emoji} type="button" data-emoji={emoji} aria-label={emoji} onClick={() => onPick?.(emoji)}>
          {emoji}
        </button>
      ))}
      <button type="button" id="ember-quick-react-more" aria-label="More reactions" onClick={onMore}>
        +
      </button>
    </div>
  );
}
