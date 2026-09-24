import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import QuickReactPopup from "./QuickReactPopup.jsx";
import MessageActionMenu from "./MessageActionMenu.jsx";

const LONG_PRESS_MS = 450;

function TicksIcon({ state }) {
  if (state === "sending") {
    return (
      <span className="sandesh-ticks sending" title="Sending..." style={{ opacity: 0.6, display: "inline-flex", verticalAlign: "middle" }}>
        <svg width="12" height="11" viewBox="0 0 12 11" fill="none">
          <circle cx="6" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="sandesh-ticks failed" title="Failed to deliver" style={{ color: "#ef4444", display: "inline-flex", verticalAlign: "middle" }}>
        <svg width="12" height="11" viewBox="0 0 12 11" fill="none">
          <circle cx="6" cy="5.5" r="4.5" stroke="#ef4444" strokeWidth="1.2" />
          <path d="M6 3.2v2.6M6 7.6v.4" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`sandesh-ticks ${state === "read" ? "read" : "sent"}`} title={state === "read" ? "Read" : "Sent"}>
      {state === "read" ? (
        <svg width="15" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1 5.5L4.5 9L11 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5 5.5L8.5 9L15 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        <svg width="12" height="11" viewBox="0 0 12 11" fill="none">
          <path d="M1 5.5L4.5 9L11 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </span>
  );
}

function MessageRow({ msg, onReact, onReply, onOpenActionMenu, onActionCardClick }) {
  const longPressTimer = useRef(null);

  if (msg.kind === "system") {
    return (
      <div className="sandesh-system-bubble">
        <span className="material-icons info-icon">info</span>
        <span>{msg.text}</span>
      </div>
    );
  }

  const isOut = msg.dir === "out";

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
    <div className={`sandesh-msg-row ${isOut ? "out" : "in"}${msg.grouped ? " grouped" : ""}`}>
      {!isOut && (
        msg.grouped ? (
          <span className="sandesh-avatar-spacer" />
        ) : (
          <Avatar initials={msg.initials} color={msg.color || "#ff7a59"} />
        )
      )}

      <div
        className={`sandesh-bubble-3d ${isOut ? "bubble-out" : "bubble-in"}${msg.kind === "card" ? " bubble-card" : ""}`}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenActionMenu?.(msg, { x: e.clientX, y: e.clientY });
        }}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerMove={cancelLongPress}
      >
        {!isOut && !msg.grouped && (
          <div className="msg-sender-line">
            <span className="sender-name">{msg.from}</span>
          </div>
        )}

        {/* Quoted reply banner */}
        {msg.replyTo && (
          <div className="sandesh-reply-quote-3d">
            <div className="quote-from">{msg.replyTo.from}</div>
            <div className="quote-text">{msg.replyTo.text}</div>
          </div>
        )}

        {/* 1. Smart Structure Interactive Card */}
        {msg.kind === "card" && (
          <div className="sandesh-interactive-card">
            <div className="card-top-badge">
              <span className="material-icons card-icon">assignment</span>
              <strong className="card-title">{msg.title}</strong>
              {msg.actionStatus && (
                <span className={`card-status-pill status-${msg.actionStatus.toLowerCase().replace(/\s+/g, "-")}`}>
                  {msg.actionStatus}
                </span>
              )}
            </div>

            {msg.details && (
              <div className="card-details-grid">
                {Object.entries(msg.details).map(([key, val]) => (
                  <div key={key} className="detail-item">
                    <span className="detail-key">{key}:</span>
                    <span className="detail-val">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}

            {msg.actions && msg.actions.length > 0 && (
              <div className="card-action-bar">
                {msg.actions.map((act) => (
                  <button
                    key={act}
                    type="button"
                    className={`card-act-btn ${act === "Approve" ? "btn-approve" : act === "Reject" ? "btn-reject" : "btn-secondary"}`}
                    onClick={() => onActionCardClick?.(msg, act)}
                  >
                    {act}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. File / Document Message */}
        {msg.kind === "file" && (
          <div className="sandesh-file-card">
            <span className="material-icons file-icon">description</span>
            <div className="file-info">
              <span className="file-name">{msg.fileName}</span>
              <span className="file-size">{msg.fileSize || "Document"}</span>
            </div>
            <button type="button" className="file-download-btn" title="Download">
              <span className="material-icons">download</span>
            </button>
          </div>
        )}

        {/* 3. Image Message */}
        {msg.kind === "image" && (
          <div className="sandesh-img-card">
            <img src={msg.imageUrl} alt="Shared preview" />
            {msg.text && <p className="img-caption">{msg.text}</p>}
          </div>
        )}

        {/* 4. Normal Text Message */}
        {(!msg.kind || msg.kind === "text") && (
          <div className="sandesh-text-body">{msg.text}</div>
        )}

        {/* Timestamp and Ticks */}
        <div className="sandesh-bubble-footer">
          <span className="msg-time">{msg.time || "now"}</span>
          {isOut && <TicksIcon state={msg.ticks || msg.status || "sent"} />}
        </div>

        {/* Reaction Badges */}
        {msg.reactions && msg.reactions.length > 0 && (
          <div className="sandesh-reactions-row">
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`reaction-pill-3d ${r.mine ? "active" : ""}`}
                onClick={() => onReact?.(msg.id, r.emoji)}
              >
                <span>{r.emoji}</span>
                <span className="count">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Floating Action Triggers */}
      <div className="sandesh-msg-hover-actions">
        <button
          type="button"
          className="msg-action-btn"
          aria-label="React"
          title="React with Emoji"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenActionMenu?.(msg, { x: rect.left, y: rect.top }, "react");
          }}
        >
          <span className="material-icons">add_reaction</span>
        </button>
        <button
          type="button"
          className="msg-action-btn"
          aria-label="Reply"
          title="Reply"
          onClick={() => onReply?.(msg)}
        >
          <span className="material-icons">reply</span>
        </button>
      </div>
    </div>
  );
}

export default function MessageList({
  messages,
  typingUser,
  onReact,
  onReply,
  onDelete,
  onActionCardClick,
  pushToast,
  listRef,
  onScroll,
}) {
  const [popup, setPopup] = useState(null); // { msg, kind: "react" | "menu", x, y }

  useEffect(() => {
    if (!popup) return undefined;
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
    <div id="sandesh-message-stream" ref={listRef} onScroll={onScroll}>
      <div className="sandesh-stream-inner">
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            onReact={onReact}
            onReply={onReply}
            onOpenActionMenu={openPopup}
            onActionCardClick={onActionCardClick}
          />
        ))}

        {typingUser && (
          <div className="sandesh-msg-row in sandesh-typing-row" style={{ marginTop: "4px" }}>
            <div className="sandesh-bubble-3d bubble-in sandesh-typing-bubble-3d" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px", fontStyle: "italic", opacity: 0.9 }}>
              <span className="typing-text" style={{ fontSize: "13px", color: "var(--sandesh-text-muted)" }}>
                {typingUser} is typing...
              </span>
            </div>
          </div>
        )}
      </div>

      {popup && popup.kind === "react" && (
        <QuickReactPopup
          style={popupStyle}
          onPick={(emoji) => {
            onReact?.(popup.msg.id, emoji);
            setPopup(null);
          }}
        />
      )}

      {popup && popup.kind === "menu" && (
        <MessageActionMenu
          style={popupStyle}
          msg={popup.msg}
          onReact={() => setPopup({ ...popup, kind: "react" })}
          onReply={() => {
            onReply?.(popup.msg);
            setPopup(null);
          }}
          onCopy={() => {
            if (popup.msg.text) {
              navigator.clipboard?.writeText(popup.msg.text);
              pushToast?.("Message copied");
            }
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
