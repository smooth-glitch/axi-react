import { useEffect, useRef, useState, useCallback } from "react";
import ContentPanel from "./ContentPanel.jsx";
import CommandMenuPopup from "./CommandMenuPopup.jsx";
import { smartPromptsByCategory, quickReactions } from "../data/sampleData.js";
import {
  DEFAULT_COMMANDS_CATALOG,
  filterCatalogCommands,
} from "../data/hashCommandsCatalog.js";
import { sandeshSocket } from "../../../services/sandeshSocket.js";

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
  currentUser = null,
  onlineUsers = [],
  availableUsers = [],
  chats = [],
  initialText = "",
  mediaPanelConfig = null, // { open: boolean, tab: "emojis"|"gifs"|"stickers", query: string }
  onCloseMediaPanel,
}) {
  const [text, setText] = useState(initialText || "");
  const [contentPanelOpen, setContentPanelOpen] = useState(false);
  const [contentPanelTab, setContentPanelTab] = useState("emojis");
  const [contentPanelQuery, setContentPanelQuery] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Command Menu & Autocomplete State
  const [showCmdMenu, setShowCmdMenu] = useState(false);
  const [cmdMenuMode, setCmdMenuMode] = useState("commands"); // "commands" | "args"
  const [filteredCmds, setFilteredCmds] = useState([]);
  const [argSuggestions, setArgSuggestions] = useState([]);
  const [selectedCmdIndex, setSelectedCmdIndex] = useState(0);
  const [currentCommand, setCurrentCommand] = useState(null);
  const [currentArgSpec, setCurrentArgSpec] = useState(null);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingTime = useRef(0);
  const cmdReqIdRef = useRef(0);
  const cmdDebounceTimer = useRef(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const hasText = text.trim().length > 0;
  const activePrompts = smartPromptsByCategory[userCategory] || smartPromptsByCategory.employee;

  // Sync initialText if supplied externally (e.g. from #help modal)
  useEffect(() => {
    if (initialText) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [initialText]);

  // Sync mediaPanelConfig if opened externally (e.g. via #gif or #sticker command)
  useEffect(() => {
    if (mediaPanelConfig?.open) {
      setContentPanelTab(mediaPanelConfig.tab || "emojis");
      setContentPanelQuery(mediaPanelConfig.query || "");
      setContentPanelOpen(true);
    }
  }, [mediaPanelConfig]);

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus();
  }, [replyingTo]);

  // Listen for backend cmd_suggestions
  useEffect(() => {
    const unsub = sandeshSocket.subscribe((event) => {
      if (event.type === "cmd_suggestions" && event.reqId === cmdReqIdRef.current) {
        if (event.items && Array.isArray(event.items) && event.items.length > 0) {
          setArgSuggestions(
            event.items.map((it) => ({
              value: it.value,
              label: it.label || it.value,
              hint: it.hint,
              sub: it.usage || "",
            }))
          );
        }
      }
    });
    return unsub;
  }, []);

  // Compute argument suggestions locally as immediate instant feedback
  const computeLocalArgSuggestions = useCallback(
    (argSpec, token = "") => {
      if (!argSpec) return [];
      const q = token.toLowerCase();

      if (argSpec.type === "user") {
        const pool = [
          ...onlineUsers.map((u) => ({
            value: u.username || u.name,
            label: u.name || u.username,
            hint: "online",
            sub: u.designation || "Colleague",
          })),
          ...availableUsers.map((u) => ({
            value: u.username,
            label: u.name,
            hint: u.department || "Enterprise",
            sub: u.designation || "Colleague",
          })),
        ];
        // Unique by value
        const seen = new Set();
        return pool.filter((item) => {
          if (!item.value || seen.has(item.value.toLowerCase())) return false;
          seen.add(item.value.toLowerCase());
          if (!q) return true;
          return (
            item.value.toLowerCase().includes(q) ||
            item.label.toLowerCase().includes(q)
          );
        });
      }

      if (argSpec.type === "group") {
        return chats
          .filter((c) => c.isGroup && c.id !== "room-general")
          .map((c) => ({
            value: c.name || c.id.replace(/^room-/, ""),
            label: c.name,
            hint: `${c.members?.length || 0} members`,
            sub: c.topic || "Group",
          }))
          .filter((item) => !q || item.value.toLowerCase().includes(q));
      }

      if (argSpec.type === "host") {
        return chats
          .filter((c) => c.isHost)
          .map((c) => {
            const hKey = c.id.replace(/^host-/, "");
            return {
              value: hKey,
              label: c.name,
              hint: `#${hKey}`,
              sub: c.topic || "Department Host",
            };
          })
          .filter((item) => !q || item.value.toLowerCase().includes(q) || item.label.toLowerCase().includes(q));
      }

      if (argSpec.type === "emoji") {
        return quickReactions.map((e) => ({
          value: e,
          label: e,
          hint: "reaction",
          sub: "",
        }));
      }

      if (argSpec.type === "enum" && Array.isArray(argSpec.values)) {
        return argSpec.values
          .map((v) => ({
            value: v,
            label: v,
            hint: "option",
            sub: "",
          }))
          .filter((item) => !q || item.value.toLowerCase().includes(q));
      }

      return [];
    },
    [onlineUsers, availableUsers, chats]
  );

  // Analyze text and caret to trigger command menu / suggestions
  const updateMenuState = useCallback(
    (currentVal, caretPos) => {
      if (!currentVal.startsWith("#")) {
        setShowCmdMenu(false);
        return;
      }

      const before = currentVal.slice(0, caretPos);

      // 1. Typing command name: no space yet
      if (!before.includes(" ")) {
        const query = before.slice(1); // after #
        const matches = filterCatalogCommands(DEFAULT_COMMANDS_CATALOG, query, currentUser);
        setFilteredCmds(matches);
        setCmdMenuMode("commands");
        setSelectedCmdIndex(0);
        setShowCmdMenu(true);
        setCurrentCommand(null);
        setCurrentArgSpec(null);
        return;
      }

      // 2. Space exists: user is typing arguments!
      const parts = before.split(" ");
      const cmdWord = parts[0].slice(1).toLowerCase();
      const matched = DEFAULT_COMMANDS_CATALOG.find(
        (c) => c.name === cmdWord || (c.aliases || []).includes(cmdWord)
      );

      if (!matched) {
        setShowCmdMenu(false);
        return;
      }

      setCurrentCommand(matched);
      const argIndex = parts.length - 2; // parts: ["#cmd", "arg0", "arg1", ...]
      const currentToken = parts[parts.length - 1];
      const argSpec = matched.args ? matched.args[argIndex] : null;

      if (!argSpec || argSpec.type === "text") {
        // Free text: close menu
        setShowCmdMenu(false);
        return;
      }

      setCurrentArgSpec(argSpec);
      setCmdMenuMode("args");
      setSelectedCmdIndex(0);

      // Local instant suggestions
      const locals = computeLocalArgSuggestions(argSpec, currentToken);
      setArgSuggestions(locals);
      setShowCmdMenu(locals.length > 0);

      // Debounce call to backend /cmdcomplete
      if (cmdDebounceTimer.current) {
        clearTimeout(cmdDebounceTimer.current);
      }
      cmdDebounceTimer.current = setTimeout(() => {
        cmdReqIdRef.current += 1;
        sandeshSocket.send(
          `/cmdcomplete ${JSON.stringify({ input: before, reqId: cmdReqIdRef.current })}`
        );
      }, 150);
    },
    [currentUser, computeLocalArgSuggestions]
  );

  const handleSend = () => {
    if (!hasText || disabled) return;
    const trimmed = text.trim();
    onSend?.(trimmed);
    setText("");
    setShowCmdMenu(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSelectCommand = (cmd) => {
    const newText = `#${cmd.name} `;
    setText(newText);
    setSelectedCmdIndex(0);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
    }
    // Update menu for argument typing
    updateMenuState(newText, newText.length);
  };

  const handleSelectArg = (item) => {
    const caret = textareaRef.current?.selectionEnd ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);

    const parts = before.split(" ");
    parts[parts.length - 1] = item.value;
    const newBefore = parts.join(" ") + " ";
    const combined = newBefore + after;

    setText(combined);
    setShowCmdMenu(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e) => {
    // If command menu is active, intercept arrow keys, tab, enter, escape
    if (showCmdMenu) {
      const listLength = cmdMenuMode === "commands" ? filteredCmds.length : argSuggestions.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCmdIndex((idx) => (idx + 1) % Math.max(1, listLength));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCmdIndex((idx) => (idx - 1 + listLength) % Math.max(1, listLength));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        if (cmdMenuMode === "commands" && filteredCmds[selectedCmdIndex]) {
          handleSelectCommand(filteredCmds[selectedCmdIndex]);
          return;
        }
        if (cmdMenuMode === "args" && argSuggestions[selectedCmdIndex]) {
          handleSelectArg(argSuggestions[selectedCmdIndex]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowCmdMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    const caret = e.target.selectionEnd;
    setText(val);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;

    updateMenuState(val, caret);

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

      {/* 3. Floating Command Palette / Autocomplete Menu */}
      {showCmdMenu && (
        <CommandMenuPopup
          mode={cmdMenuMode}
          commands={filteredCmds}
          argSuggestions={argSuggestions}
          selectedIndex={selectedCmdIndex}
          onSelectCommand={handleSelectCommand}
          onSelectArg={handleSelectArg}
          currentCommand={currentCommand}
          currentArgSpec={currentArgSpec}
        />
      )}

      {/* 4. Floating 3D Glass Composer Bar */}
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
                placeholder={
                  disabled
                    ? "Connecting to Sandesh server..."
                    : "Type a message or '#' for commands..."
                }
                value={text}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
              />
              <button
                type="button"
                className="composer-emoji-btn"
                title="Add Emoji, GIFs or Stickers"
                onClick={() => {
                  setContentPanelTab("emojis");
                  setContentPanelQuery("");
                  setContentPanelOpen((v) => !v);
                }}
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

        {contentPanelOpen && (
          <ContentPanel
            initialTab={contentPanelTab}
            initialQuery={contentPanelQuery}
            onClose={() => {
              setContentPanelOpen(false);
              onCloseMediaPanel?.();
            }}
            onPickEmoji={(emoji) => {
              setText((t) => t + emoji);
              setContentPanelOpen(false);
              textareaRef.current?.focus();
            }}
            onPickGif={(gif) => {
              onAttachFile?.({
                kind: "image",
                fileName: `${gif.title}.gif`,
                imageUrl: gif.url,
              });
              pushToast?.(`GIF "${gif.title}" sent`);
              setContentPanelOpen(false);
            }}
            onPickSticker={(stk) => {
              onAttachFile?.({
                kind: "image",
                fileName: `Sticker - ${stk.title}`,
                imageUrl: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='100%25' height='100%25' rx='24' fill='%23ffffff' stroke='${encodeURIComponent(stk.color)}' stroke-width='4'/><text x='50%25' y='45%25' font-size='24' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-weight='bold' fill='${encodeURIComponent(stk.color)}'>${encodeURIComponent(stk.badge)}</text><text x='50%25' y='75%25' font-size='12' text-anchor='middle' font-family='sans-serif' fill='%23666666'>${encodeURIComponent(stk.title)}</text></svg>`,
              });
              pushToast?.(`Sticker "${stk.title}" sent`);
              setContentPanelOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
