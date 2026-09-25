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

function VoiceNoteBubble({ msg }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);

  const togglePlay = () => {
    if (!audioRef.current) {
      setIsPlaying(!isPlaying);
      return;
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {
        setIsPlaying(true);
        setTimeout(() => setIsPlaying(false), 3000);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && audioRef.current.duration) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  return (
    <div className="sandesh-voice-bubble-3d">
      {msg.audioUrl && (
        <audio
          ref={audioRef}
          src={msg.audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          style={{ display: "none" }}
        />
      )}
      <button
        type="button"
        className="sandesh-voice-play-btn"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
        title={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        <span className="material-icons">{isPlaying ? "pause" : "play_arrow"}</span>
      </button>
      <div className="sandesh-voice-track">
        <div className="sandesh-voice-wave-bars">
          {Array.from({ length: 24 }).map((_, i) => {
            const barProgress = (i / 24) * 100;
            const isFilled = barProgress <= progress;
            return (
              <span
                key={i}
                className={`wave-bar ${isFilled ? "filled" : ""} ${isPlaying ? "playing" : ""}`}
                style={{
                  height: `${7 + ((i * 5 + 7) % 17)}px`,
                  animationDelay: `${(i % 6) * 0.12}s`,
                }}
              />
            );
          })}
        </div>
        <div className="sandesh-voice-meta">
          <span className="voice-duration">{msg.duration || "0:05"}</span>
          <span className="voice-badge">
            <span className="material-icons" style={{ fontSize: "12px", verticalAlign: "middle" }}>mic</span> Voice Note
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageRow({ msg, onReact, onReply, onForward, onDelete, onOpenActionMenu, onActionCardClick }) {
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
        {/* WhatsApp-style Forwarded Indicator */}
        {msg.forwarded && (
          <div className="sandesh-forwarded-pill">
            <span className="material-icons forwarded-icon" style={{ transform: "scaleX(-1)" }}>reply</span>
            <span>Forwarded</span>
          </div>
        )}

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

        {/* 4. Video Message */}
        {msg.kind === "video" && (
          <div className="sandesh-video-card">
            <video src={msg.videoUrl} controls className="sandesh-inline-video" />
            {msg.text && <p className="video-caption">{msg.text}</p>}
          </div>
        )}

        {/* 5. Voice Note Audio Message */}
        {msg.kind === "audio" && (
          <VoiceNoteBubble msg={msg} />
        )}

        {/* 6. Normal Text Message */}
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

      {/* Floating Action Triggers matching WhatsApp message structure */}
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
        <button
          type="button"
          className="msg-action-btn"
          aria-label="Forward"
          title="Forward message to someone or group"
          onClick={() => onForward?.(msg)}
        >
          <span className="material-icons" style={{ transform: "scaleX(-1)" }}>reply</span>
        </button>
        <button
          type="button"
          className="msg-action-btn menu-btn"
          aria-label="More options"
          title="More options"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenActionMenu?.(msg, { x: rect.left, y: rect.bottom + 4 }, "menu");
          }}
        >
          <span className="material-icons">expand_more</span>
        </button>
        <button
          type="button"
          className="msg-action-btn delete-btn"
          aria-label="Delete message"
          title="Delete message"
          onClick={() => onDelete?.(msg.id)}
        >
          <span className="material-icons">delete_outline</span>
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
  onForward,
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
        const margin = 12;
        const width = popup.kind === "react" ? 360 : 190;
        const height = popup.kind === "react" ? 52 : 270;
        const left = Math.min(
          Math.max(popup.x - (popup.kind === "react" ? 60 : 10), margin),
          window.innerWidth - width - margin
        );
        let top = popup.y - height - 10;
        if (top < margin) {
          top = popup.y + 24;
        }
        if (top + height > window.innerHeight - margin) {
          top = window.innerHeight - height - margin;
        }
        return { left, top, position: "fixed" };
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
            onForward={onForward}
            onDelete={onDelete}
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
          canDelete={true}
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
          onForward={() => {
            onForward?.(popup.msg);
            setPopup(null);
          }}
          onStar={() => {
            pushToast?.("Message starred");
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
