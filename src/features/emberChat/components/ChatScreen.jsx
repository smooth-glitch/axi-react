import { useEffect, useRef, useState } from "react";
import TopBar from "./TopBar.jsx";
import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";
import TopicsEpisodesView from "./TopicsEpisodesView.jsx";

const NEAR_BOTTOM_PX = 120;

export default function ChatScreen({
  chat,
  messages,
  userCategory,
  isAdmin,
  onMenuClick,
  onMembersClick,
  onSend,
  onAttachFile,
  onToggleReaction,
  onDeleteMessage,
  onActionCardClick,
  onOpenSmartPrompts,
  onOpenAdminConsole,
  onOpenAiChat,
  pushToast,
}) {
  const [activeView, setActiveView] = useState("messages"); // "messages" | "episodes"
  const [replyingTo, setReplyingTo] = useState(null);
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const listRef = useRef(null);
  const prevMessageCount = useRef(messages.length);

  const scrollToBottom = (behavior = "smooth") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

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
    if (activeView === "messages") {
      scrollToBottom("auto");
    }
  }, [activeView]);

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
    <main id="sandesh-main-panel" className="sandesh-main-panel-3d">
      <TopBar
        chat={chat}
        activeView={activeView}
        onChangeView={setActiveView}
        onMenuClick={onMenuClick}
        onMembersClick={onMembersClick}
        onOpenSmartPrompts={onOpenSmartPrompts}
        onOpenAdminConsole={onOpenAdminConsole}
        onOpenAiChat={onOpenAiChat}
        isAdmin={isAdmin}
      />

      {activeView === "episodes" ? (
        <TopicsEpisodesView
          chat={chat}
          onSelectTopic={(ep) => {
            pushToast(`Switched to episode: ${ep.title}`);
            setActiveView("messages");
          }}
          onNewEpisode={(ep) => {
            pushToast(`New topic "${ep.title}" initialized`);
          }}
        />
      ) : (
        <div className="sandesh-chat-body">
          <MessageList
            listRef={listRef}
            onScroll={handleScroll}
            messages={messages}
            onReply={(msg) => setReplyingTo({ from: msg.from ?? "You", text: msg.text || msg.title || "Message" })}
            onReact={onToggleReaction}
            onDelete={onDeleteMessage}
            onActionCardClick={onActionCardClick}
            pushToast={pushToast}
          />

          <button
            id="sandesh-jump-latest"
            type="button"
            className={`sandesh-jump-latest-3d ${showJumpLatest ? "show" : ""}`}
            onClick={() => {
              scrollToBottom();
              setShowJumpLatest(false);
            }}
          >
            ↓ Jump to latest
          </button>

          <Composer
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onSend={handleSend}
            onAttachFile={onAttachFile}
            onOpenSmartPromptModal={onOpenSmartPrompts}
            pushToast={pushToast}
            userCategory={userCategory}
          />
        </div>
      )}
    </main>
  );
}
