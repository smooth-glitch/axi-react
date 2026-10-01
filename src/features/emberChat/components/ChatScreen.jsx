import { useEffect, useRef, useState } from "react";
import TopBar from "./TopBar.jsx";
import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";
import TopicsEpisodesView from "./TopicsEpisodesView.jsx";
import WorkspaceNotificationsSlider from "./WorkspaceNotificationsSlider.jsx";
import WorkspaceChatsSlider from "./WorkspaceChatsSlider.jsx";

const NEAR_BOTTOM_PX = 120;

export default function ChatScreen({
  chat,
  messages,
  userCategory,
  isAdmin,
  canApprove,
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
  optionCategories,
  optionsVersion,
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
  onToggleNotifications,
  notificationsOpen = false,
  priorityCounts = null,
  priorityNotifications = [],
  onResolveNotification,
  onMarkReadNotification,
  onMarkAllReadNotifications,
  onClearResolvedNotifications,
  onDismissNotification,
  onNotificationAction,
  onToggleChatsSlider,
  chatsSliderOpen = false,
  onSelectChat,
  onNewGroup,
  socketStatus,
  onReconnectSocket,
  onSignOut,
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
        currentUser={currentUser}
        activeView={activeView}
        onChangeView={setActiveView}
        onMenuClick={chat.id === "workspace" || chat.isWorkspace ? onToggleChatsSlider : onMenuClick}
        onMembersClick={onMembersClick}
        onOpenSmartPrompts={onOpenSmartPrompts}
        onOpenTStructUser={onOpenTStructUser}
        onOpenAdminConsole={onOpenAdminConsole}
        onOpenAiChat={onOpenAiChat}
        onDeleteChat={onDeleteChat}
        isAdmin={isAdmin}
        canApprove={canApprove}
        onlineUsers={onlineUsers}
        onOpenApprovals={onOpenApprovals}
        pendingApprovalsCount={pendingApprovalsCount}
        onToggleNotifications={onToggleNotifications}
        notificationsOpen={notificationsOpen}
        priorityCounts={priorityCounts}
        onSignOut={onSignOut}
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
          {(canApprove ?? isAdmin) && pendingApprovalsCount > 0 && (
            <div className="sandesh-pending-approval-banner">
              <div className="approval-banner-left">
                <span className="material-icons banner-icon">how_to_reg</span>
                <div className="banner-text-wrap">
                  <strong>{pendingApprovalsCount} User{pendingApprovalsCount > 1 ? "s" : ""} Waiting for Entry Approval</strong>
                  <span>Verify applicant details and authorize access to enter Connectum Chat.</span>
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
              <span>Disconnected from Connectum backend. Reconnecting in the background...</span>
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
            optionCategories={optionCategories}
            optionsVersion={optionsVersion}
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

      {/* Backdrop when either slider is open */}
      {(chatsSliderOpen || notificationsOpen) && (
        <div
          className="workspace-slider-backdrop"
          onClick={() => {
            if (chatsSliderOpen) onToggleChatsSlider?.();
            if (notificationsOpen) onToggleNotifications?.();
          }}
        />
      )}

      {/* Left-Hand Chats Slider — on My Workspace */}
      {(chat.id === "workspace" || chat.isWorkspace) && (
        <>
          <WorkspaceChatsSlider
            isOpen={chatsSliderOpen}
            onClose={onToggleChatsSlider}
            me={currentUser}
            chats={chats}
            onlineUsers={onlineUsers}
            activeChatId={chat.id}
            onSelectChat={(id) => {
              onToggleChatsSlider?.();
              onSelectChat?.(id);
            }}
            onNewGroup={onNewGroup}
            socketStatus={socketStatus}
            onReconnectSocket={onReconnectSocket}
            onSignOut={onSignOut}
          />

          {!chatsSliderOpen && (
            <button
              type="button"
              className="workspace-slider-edge-tab edge-tab-left"
              onClick={onToggleChatsSlider}
              title="Open Chats Slider"
              aria-label="Open chats slider"
            >
              <span className="material-icons">chat</span>
              <span className="edge-tab-label">Chats</span>
            </button>
          )}
        </>
      )}

      {/* Right-Hand Priority Notifications Slider — Present on My Workspace and Other Chat Messages */}
      <WorkspaceNotificationsSlider
        isOpen={notificationsOpen}
        onClose={onToggleNotifications}
        notifications={priorityNotifications || []}
        counts={priorityCounts}
        onResolve={onResolveNotification}
        onMarkRead={onMarkReadNotification}
        onMarkAllRead={onMarkAllReadNotifications}
        onClearResolved={onClearResolvedNotifications}
        onDismiss={onDismissNotification}
        onAction={onNotificationAction}
        user={currentUser}
      />

      {!notificationsOpen && (
        <button
          type="button"
          className="workspace-slider-edge-tab edge-tab-right"
          onClick={onToggleNotifications}
          title="Open Priority Notifications Slider"
          aria-label="Open notifications slider"
        >
          <span className="material-icons">notifications</span>
          <span className="edge-tab-label">Notifications</span>
          {priorityCounts?.high > 0 && (
            <span className="edge-tab-badge badge-red">{priorityCounts.high}</span>
          )}
          {priorityCounts?.high === 0 && priorityCounts?.medium > 0 && (
            <span className="edge-tab-badge badge-yellow">{priorityCounts.medium}</span>
          )}
        </button>
      )}
    </main>
  );
}
