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
  onTyping,
  disabled = false,
  pushToast,
  userCategory = "employee",
}) {
  const [text, setText] = useState("");
  const [contentPanelOpen, setContentPanelOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingTime = useRef(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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
    if (!hasText || disabled) return;
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

  const handleInputChange = (e) => {
    setText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;

    const now = Date.now();
    if (now - lastTypingTime.current > 2500) {
      lastTypingTime.current = now;
      onTyping?.();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (loadEv) => {
        onAttachFile?.({
          kind: "image",
          fileName: file.name,
          imageUrl: loadEv.target.result,
        });
        pushToast?.(`Photo "${file.name}" sent`);
      };
      reader.readAsDataURL(file);
    } else if (file.type.startsWith("video/")) {
      const reader = new FileReader();
      reader.onload = (loadEv) => {
        onAttachFile?.({
          kind: "video",
          fileName: file.name,
          videoUrl: loadEv.target.result,
        });
        pushToast?.(`Video "${file.name}" sent`);
      };
      reader.readAsDataURL(file);
    } else if (file.type.startsWith("audio/")) {
      const reader = new FileReader();
      reader.onload = (loadEv) => {
        onAttachFile?.({
          kind: "audio",
          fileName: file.name,
          audioUrl: loadEv.target.result,
          duration: "Audio File",
        });
        pushToast?.(`Audio "${file.name}" sent`);
      };
      reader.readAsDataURL(file);
    } else {
      onAttachFile?.({
        kind: "file",
        fileName: file.name,
        fileSize: `${(file.size / 1024).toFixed(1)} KB`,
      });
      pushToast?.(`Document "${file.name}" shared`);
    }
    e.target.value = "";
  };

  const startVoiceRecording = async () => {
    if (disabled) return;
    setElapsed(0);
    setRecording(true);
    audioChunksRef.current = [];

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };
        mediaRecorder.start();
      }
    } catch (err) {
      console.warn("Microphone hardware or permission not accessible, using voice simulation", err);
    }
  };

  const stopAndSendVoiceRecording = () => {
    const finalElapsed = elapsed || 1;
    const durationLabel = formatElapsed(finalElapsed);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const audioUrl = URL.createObjectURL(audioBlob);
        try {
          mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
        } catch {}

        onAttachFile?.({
          kind: "audio",
          audioUrl,
          duration: durationLabel,
          fileName: `Voice note (${durationLabel})`,
        });
        pushToast?.("Voice note sent");
      };
      mediaRecorderRef.current.stop();
    } else {
      // Fallback voice note item
      onAttachFile?.({
        kind: "audio",
        audioUrl: "",
        duration: durationLabel,
        fileName: `Voice note (${durationLabel})`,
      });
      pushToast?.("Voice note sent");
    }

    setRecording(false);
    setElapsed(0);
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
      } catch {}
    }
    setRecording(false);
    setElapsed(0);
    audioChunksRef.current = [];
  };

  return (
    <div className={`sandesh-composer-wrapper ${disabled ? "composer-disabled" : ""}`}>
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
              onClick={() => !disabled && onOpenSmartPromptModal?.(p)}
              title={p.desc}
              disabled={disabled}
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
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xlsx,.csv,.txt"
          style={{ display: "none" }}
          disabled={disabled}
        />

        <button
          type="button"
          className="composer-action-btn-3d"
          title="Attach Document, Photo, or Media"
          onClick={() => !disabled && fileInputRef.current?.click()}
          disabled={disabled}
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
              onClick={cancelVoiceRecording}
            >
              <span className="material-icons">delete</span>
            </button>
            <button
              type="button"
              className="recording-send-btn"
              title="Send Voice Note"
              onClick={stopAndSendVoiceRecording}
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
                placeholder={disabled ? "Connecting to Sandesh server..." : "Type a message or press '/' for commands..."}
                value={text}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
              <button
                type="button"
                className="composer-emoji-btn"
                title="Add Emoji / Reactions"
                onClick={() => !disabled && setContentPanelOpen((v) => !v)}
                disabled={disabled}
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
                disabled={disabled}
              >
                <span className="material-icons">send</span>
              </button>
            ) : (
              <button
                type="button"
                className="composer-mic-btn-3d"
                title="Record Voice Note"
                onClick={startVoiceRecording}
                disabled={disabled}
              >
                <span className="material-icons">mic</span>
              </button>
            )}
          </>
        )}

        {contentPanelOpen && !disabled && (
          <ContentPanel
            onPickEmoji={(emoji) => {
              setText((t) => t + emoji);
              setContentPanelOpen(false);
              textareaRef.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}

