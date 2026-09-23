import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import QuickReactPopup from "./QuickReactPopup.jsx";
import MessageActionMenu from "./MessageActionMenu.jsx";

const LONG_PRESS_MS = 450;

function TicksIcon({ state }) {
  return <span className={`ticks${state === "read" ? " read" : ""}`}>{state === "read" ? "✓✓" : "✓"}</span>;
}

function MessageRow({ msg, onReact, onReply, onOpenActionMenu }) {
  const longPressTimer = useRef(null);

  if (msg.kind === "system") {
    return <div className="system-line">{msg.text}</div>;
  }

  const isOut = msg.dir === "out";
  const bubbleClass = `msg ${isOut ? "out" : "in"}${msg.kind === "image" ? " image-msg" : ""}`;

  const startLongPress = (e) => {
    const { clientX, clientY } = e;
    longPressTimer.current = setTimeout(() => {
      onOpenActionMenu?.(msg, { x: clientX, y: clientY });
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  return (
    <div className={`row ${isOut ? "out" : "in"}${msg.grouped ? " grouped" : ""}`}>
      {!isOut && (msg.grouped ? <span className="avatar-spacer" /> : <Avatar initials={msg.initials} color={msg.color} />)}

      <div
        className={bubbleClass}
        style={{ "--sender-color": msg.color }}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenActionMenu?.(msg, { x: e.clientX, y: e.clientY });
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerMove={cancelLongPress}
      >
        {!isOut && !msg.grouped && <span className="from">{msg.from}</span>}

        {msg.replyTo && (
          <div className="reply-quote">
            <div className="reply-quote-from">{msg.replyTo.from}</div>
            <div className="reply-quote-text">{msg.replyTo.text}</div>
          </div>
        )}

        {msg.kind === "image" ? (
          <img src={msg.imageUrl} alt="" />
        ) : (
          <span>{msg.text}</span>
        )}

        {isOut && (
          <span style={{ float: "right", marginTop: 2 }}>
            <TicksIcon state={msg.ticks} />
          </span>
        )}

        {msg.reactions && msg.reactions.length > 0 && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`reaction-pill${r.mine ? " mine" : ""}`}
                onClick={() => onReact?.(msg.id, r.emoji)}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className="react-trigger"
        aria-label="React"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onOpenActionMenu?.(msg, { x: rect.left, y: rect.top }, "react");
        }}
      >
        😊
      </button>
      <button className="reply-trigger" aria-label="Reply" onClick={() => onReply?.(msg)}>
        ↩
      </button>
    </div>
  );
}

export default function MessageList({ messages, onReact, onReply, onDelete, pushToast, listRef, onScroll }) {
  const [popup, setPopup] = useState(null); // { msg, kind: "react" | "menu", x, y }
  const containerRef = useRef(null);

  useEffect(() => {
    if (!popup) return undefined;
    // Close on outside click/scroll/escape, same as any transient popover --
    // but not on a click *inside* the popup itself, which would unmount it
    // (and its buttons) before their own onClick ever gets to fire.
    const closeIfOutside = (e) => {
      if (e.target.closest("#ember-quick-react-popup, #ember-message-action-menu")) return;
      setPopup(null);
    };
    const closeOnEscape = (e) => e.key === "Escape" && setPopup(null);
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("scroll", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("scroll", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [popup]);

  const openPopup = (msg, point, kind = "menu") => {
    setPopup({ msg, kind, x: point.x, y: point.y });
  };

  const popupStyle = popup
    ? (() => {
        const margin = 8;
        const width = popup.kind === "react" ? 220 : 200;
        const left = Math.min(Math.max(popup.x, margin), window.innerWidth - width - margin);
        const top = Math.min(Math.max(popup.y - 46, margin), window.innerHeight - 220);
        return { left, top };
      })()
    : null;

  return (
    <div
      id="ember-messages"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      ref={(el) => {
        containerRef.current = el;
        if (listRef) listRef.current = el;
      }}
      onScroll={onScroll}
    >
      {messages.map((msg) => (
        <MessageRow key={msg.id} msg={msg} onReact={onReact} onReply={onReply} onOpenActionMenu={openPopup} />
      ))}

      {popup && popup.kind === "react" && (
        <QuickReactPopup
          style={popupStyle}
          onPick={(emoji) => {
            onReact?.(popup.msg.id, emoji);
            setPopup(null);
          }}
          onMore={() => {
            pushToast?.("More reactions coming soon");
            setPopup(null);
          }}
        />
      )}

      {popup && popup.kind === "menu" && (
        <MessageActionMenu
          style={popupStyle}
          canDelete={popup.msg.dir === "out"}
          onReply={() => {
            onReply?.(popup.msg);
            setPopup(null);
          }}
          onCopy={() => {
            navigator.clipboard
              ?.writeText(popup.msg.text ?? "")
              .then(() => pushToast?.("Copied to clipboard"))
              .catch(() => pushToast?.("Couldn't copy text", true));
            setPopup(null);
          }}
          onDelete={() => {
            onDelete?.(popup.msg.id);
            setPopup(null);
          }}
        />
      )}
    </div>
  );
}
