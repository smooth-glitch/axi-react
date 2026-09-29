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
  onForward,
  onDeleteMessage,
  onDeleteChat,
  onActionCardClick,
  onOpenSmartPrompts,
  options,
  onOpenSubmissions,
  onOpenTStructUser,
  onOpenAdminConsole,
  onOpenAiChat,
  typingUser,
  onTyping,
  disabled = false,
  pushToast,
  currentUser = null,
  onlineUsers = [],
  availableUsers = [],
  chats = [],
  initialComposerText = "",
  mediaPanelConfig = null,
  onCloseMediaPanel,
  onOpenApprovals,
  pendingApprovalsCount = 0,
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
        onOpenTStructUser={onOpenTStructUser}
        onOpenAdminConsole={onOpenAdminConsole}
        onOpenAiChat={onOpenAiChat}
        onDeleteChat={onDeleteChat}
        isAdmin={isAdmin}
        onlineUsers={onlineUsers}
        onOpenApprovals={onOpenApprovals}
        pendingApprovalsCount={pendingApprovalsCount}
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
          {isAdmin && pendingApprovalsCount > 0 && (
            <div className="sandesh-pending-approval-banner">
              <div className="approval-banner-left">
                <span className="material-icons banner-icon">how_to_reg</span>
                <div className="banner-text-wrap">
                  <strong>{pendingApprovalsCount} User{pendingApprovalsCount > 1 ? "s" : ""} Waiting for Entry Approval</strong>
                  <span>Verify applicant details and authorize access to enter Sandesh Chat.</span>
                </div>
              </div>
              <button
                type="button"
                className="sandesh-btn-banner-approve"
                onClick={onOpenApprovals}
              >
                <span>Review &amp; Allow Entry</span>
                <span className="material-icons">arrow_forward</span>
              </button>
            </div>
          )}

          {disabled && (
            <div
              className="sandesh-disconnected-banner"
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                backdropFilter: "blur(12px)",
                color: "#b91c1c",
                padding: "8px 16px",
                margin: "10px 16px 0 16px",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                fontWeight: "500",
                zIndex: 10,
              }}
            >
              <span className="material-icons" style={{ fontSize: "18px" }}>wifi_off</span>
              <span>Disconnected from Sandesh backend. Reconnecting in the background...</span>
            </div>
          )}

          <MessageList
            listRef={listRef}
            onScroll={handleScroll}
            messages={messages}
            typingUser={typingUser}
            onReply={(msg) => setReplyingTo({ from: msg.from ?? "You", text: msg.text || msg.title || "Message" })}
            onReact={onToggleReaction}
            onForward={onForward}
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
            options={options}
            onOpenSubmissions={onOpenSubmissions}
            onTyping={onTyping}
            disabled={disabled}
            pushToast={pushToast}
            userCategory={userCategory}
            currentUser={currentUser}
            onlineUsers={onlineUsers}
            availableUsers={availableUsers}
            chats={chats}
            initialText={initialComposerText}
            mediaPanelConfig={mediaPanelConfig}
            onCloseMediaPanel={onCloseMediaPanel}
          />
        </div>
      )}
    </main>
  );
}
