import { useEffect, useRef, useState } from "react";
import ContentPanel from "./ContentPanel.jsx";

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Composer({ replyingTo, onCancelReply, onSend, pushToast }) {
  const [text, setText] = useState("");
  const [contentPanelOpen, setContentPanelOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const textareaRef = useRef(null);

  const hasText = text.trim().length > 0;

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  const handleSend = () => {
    if (!hasText) return;
    onSend?.(text.trim());
    setText("");
  };

  const notUnavailable = (feature) => pushToast?.(`${feature} — not available in this preview`);

  return (
    <>
      {replyingTo && (
        <div id="ember-reply-banner">
          <div id="ember-reply-banner-bar" />
          <div id="ember-reply-banner-body">
            <div id="ember-reply-banner-from">{replyingTo.from ?? "You"}</div>
            <div id="ember-reply-banner-text">{replyingTo.text}</div>
          </div>
          <button id="ember-reply-banner-cancel" type="button" title="Cancel reply" aria-label="Cancel reply" onClick={onCancelReply}>
            ✕
          </button>
        </div>
      )}

      <div id="ember-composer">
        <button
          className="icon-btn"
          id="ember-attach-btn"
          title="Attach"
          aria-label="Attach a photo"
          onClick={() => notUnavailable("Attachments")}
        >
          +
        </button>

        {recording ? (
          <div id="ember-recording-bar">
            <span id="ember-recording-dot" />
            <span id="ember-recording-time">{formatElapsed(elapsed)}</span>
            <div id="ember-recording-wave" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <button
              id="ember-recording-cancel"
              type="button"
              title="Discard"
              aria-label="Discard voice note"
              onClick={() => {
                setRecording(false);
                setElapsed(0);
              }}
            >
              🗑
            </button>
            <button
              id="ember-recording-send"
              type="button"
              title="Send"
              aria-label="Send voice note"
              onClick={() => {
                setRecording(false);
                setElapsed(0);
                notUnavailable("Voice messages");
              }}
            >
              ➤
            </button>
          </div>
        ) : (
          <>
            <div id="ember-input-pill">
              <textarea
                ref={textareaRef}
                id="ember-msg-input"
                rows={1}
                placeholder="Type a message"
                autoComplete="off"
                maxLength={2000}
                enterKeyHint="send"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                className="icon-btn"
                id="ember-content-btn"
                title="Emoji, GIFs & stickers"
                aria-label="Open emoji, GIF, and sticker picker"
                onClick={() => setContentPanelOpen((v) => !v)}
              >
                😀
              </button>
            </div>
            <button
              className="icon-btn"
              id="ember-camera-btn"
              title="Take a photo"
              aria-label="Take a photo"
              onClick={() => notUnavailable("The camera")}
            >
              📷
            </button>
            {hasText ? (
              <button id="ember-send-btn" title="Send" aria-label="Send message" onClick={handleSend}>
                ➤
              </button>
            ) : (
              <button
                className="icon-btn"
                id="ember-mic-btn"
                title="Record a voice note"
                aria-label="Record a voice note"
                onClick={() => {
                  setElapsed(0);
                  setRecording(true);
                }}
              >
                🎤
              </button>
            )}
          </>
        )}

        {contentPanelOpen && (
          <ContentPanel
            onPickEmoji={(emoji) => {
              setText((t) => t + emoji);
            }}
          />
        )}
      </div>
    </>
  );
}
