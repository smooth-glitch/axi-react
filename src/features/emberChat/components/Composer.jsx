import { useEffect, useRef, useState } from "react";
import ContentPanel from "./ContentPanel.jsx";
import { smartPromptsByCategory } from "../data/sampleData.js";

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Composer({
  replyingTo,
  onCancelReply,
  onSend,
  onAttachFile,
  onOpenSmartPromptModal,
  pushToast,
  userCategory = "employee",
}) {
  const [text, setText] = useState("");
  const [contentPanelOpen, setContentPanelOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const hasText = text.trim().length > 0;
  const activePrompts = smartPromptsByCategory[userCategory] || smartPromptsByCategory.employee;

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
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (loadEv) => {
          onAttachFile?.({
            kind: "image",
            fileName: file.name,
            imageUrl: loadEv.target.result,
          });
          pushToast(`Photo "${file.name}" sent`);
        };
        reader.readAsDataURL(file);
      } else {
        onAttachFile?.({
          kind: "file",
          fileName: file.name,
          fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        });
        pushToast(`Document "${file.name}" shared`);
      }
    }
    e.target.value = "";
  };

  return (
    <div className="sandesh-composer-wrapper">
      {/* 1. Smart Prompts Quick Bar */}
      <div className="sandesh-smart-prompts-bar">
        <span className="prompts-label">
          <span className="material-icons prompt-icon">bolt</span> Smart Prompts:
        </span>
        <div className="prompts-chips-scroll">
          {activePrompts.map((p) => (
            <button
              key={p.id}
              type="button"
              className="sandesh-prompt-chip-3d"
              onClick={() => onOpenSmartPromptModal?.(p)}
              title={p.desc}
            >
              <span className="material-icons prompt-chip-icon">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Replying-to Banner */}
      {replyingTo && (
        <div className="sandesh-reply-banner-3d">
          <div className="reply-accent-bar" />
          <div className="reply-text-col">
            <span className="reply-from">{replyingTo.from ?? "You"}</span>
            <span className="reply-preview">{replyingTo.text}</span>
          </div>
          <button
            type="button"
            className="reply-cancel-btn"
            onClick={onCancelReply}
            title="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. Floating 3D Glass Composer Bar */}
      <div className="sandesh-composer-3d">
        {/* Hidden native file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*,.pdf,.doc,.docx,.xlsx,.csv,.txt"
          style={{ display: "none" }}
        />

        <button
          type="button"
          className="composer-action-btn-3d"
          title="Attach Document or Image"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="material-icons">attach_file</span>
        </button>

        {recording ? (
          <div className="sandesh-recording-bar-3d">
            <span className="recording-pulsing-dot" />
            <span className="recording-timer">{formatElapsed(elapsed)}</span>
            <div className="recording-wave">
              {Array.from({ length: 12 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <button
              type="button"
              className="recording-cancel-btn"
              title="Discard Voice Note"
              onClick={() => {
                setRecording(false);
                setElapsed(0);
              }}
            >
              <span className="material-icons">delete</span>
            </button>
            <button
              type="button"
              className="recording-send-btn"
              title="Send Voice Note"
              onClick={() => {
                setRecording(false);
                onSend?.(`🎙️ Voice Message (${formatElapsed(elapsed)})`);
                setElapsed(0);
                pushToast("Voice note sent");
              }}
            >
              <span className="material-icons">send</span>
            </button>
          </div>
        ) : (
          <>
            <div className="composer-input-pill-3d">
              <textarea
                ref={textareaRef}
                className="sandesh-msg-input"
                rows={1}
                placeholder="Type a message or press '/' for commands..."
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={handleKeyDown}
                maxLength={2000}
              />
              <button
                type="button"
                className="composer-emoji-btn"
                title="Add Emoji / Reactions"
                onClick={() => setContentPanelOpen((v) => !v)}
              >
                😀
              </button>
            </div>

            {hasText ? (
              <button
                type="button"
                className="sandesh-send-btn-3d"
                title="Send Message"
                onClick={handleSend}
              >
                <span className="material-icons">send</span>
              </button>
            ) : (
              <button
                type="button"
                className="composer-mic-btn-3d"
                title="Record Voice Note"
                onClick={() => {
                  setElapsed(0);
                  setRecording(true);
                }}
              >
                <span className="material-icons">mic</span>
              </button>
            )}
          </>
        )}

        {contentPanelOpen && (
          <ContentPanel
            onPickEmoji={(emoji) => {
              setText((t) => t + emoji);
              setContentPanelOpen(false);
              textareaRef.current?.focus();
            }}
            onPickGif={(url) => {
              onSend?.(url);
              setContentPanelOpen(false);
            }}
            onPickSticker={(url) => {
              onSend?.(url);
              setContentPanelOpen(false);
            }}
            pushToast={pushToast}
          />
        )}
      </div>
    </div>
  );
}
