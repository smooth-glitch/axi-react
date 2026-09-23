import { useEffect, useRef, useState } from "react";
import TopBar from "./TopBar.jsx";
import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";

const NEAR_BOTTOM_PX = 120;

export default function ChatScreen({
  chat,
  messages,
  onMenuClick,
  onMembersClick,
  onSend,
  onToggleReaction,
  onDeleteMessage,
  pushToast,
}) {
  const [replyingTo, setReplyingTo] = useState(null);
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const listRef = useRef(null);
  const prevMessageCount = useRef(messages.length);

  const scrollToBottom = (behavior = "smooth") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Auto-scroll on new messages, but only if the user is already near the
  // bottom — otherwise let them keep reading older messages and surface the
  // "jump to latest" button instead.
  useEffect(() => {
    const grew = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < NEAR_BOTTOM_PX;
    if (grew && nearBottom) {
      scrollToBottom();
    } else if (grew) {
      setShowJumpLatest(true);
    }
  }, [messages]);

  useEffect(() => {
    scrollToBottom("auto");
  }, []);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < NEAR_BOTTOM_PX) setShowJumpLatest(false);
  };

  const handleSend = (text) => {
    onSend?.(text, replyingTo);
    setReplyingTo(null);
    requestAnimationFrame(() => scrollToBottom());
  };

  return (
    <div id="ember-main">
      <TopBar
        title={chat.name}
        subtitle={chat.isGroup ? "3 members" : "Online"}
        isGroup={chat.isGroup}
        onMenuClick={onMenuClick}
        onMembersClick={onMembersClick}
      />

      <MessageList
        listRef={listRef}
        onScroll={handleScroll}
        messages={messages}
        onReply={(msg) => setReplyingTo({ from: msg.from ?? "You", text: msg.text })}
        onReact={onToggleReaction}
        onDelete={onDeleteMessage}
        pushToast={pushToast}
      />

      <button
        id="ember-jump-latest"
        type="button"
        className={showJumpLatest ? "show" : ""}
        onClick={() => {
          scrollToBottom();
          setShowJumpLatest(false);
        }}
      >
        ↓ New messages
      </button>

      <Composer replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} onSend={handleSend} pushToast={pushToast} />
    </div>
  );
}
