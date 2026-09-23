import { useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ChatScreen from "./components/ChatScreen.jsx";
import ModalLayer from "./components/ModalLayer.jsx";
import NewGroupModal from "./components/modals/NewGroupModal.jsx";
import MembersModal from "./components/modals/MembersModal.jsx";
import ProfileModal from "./components/modals/ProfileModal.jsx";
import ToastContainer from "./components/Toast.jsx";
import { me as initialMe, chats, onlineUsers, messagesByChat as initialMessagesByChat } from "./data/sampleData.js";
import "./EmberChat.css";

// The Ember chat UI (markup/styling only — see ember-chat-react's README for
// the source project). Everything here is local state; no network/WebSocket
// wiring. onOpenAiChat is the one integration point with the rest of the
// axi-react app: it's how a person leaves this screen and reaches the
// existing AI assistant page, which App.jsx keeps permanently mounted
// underneath (never unmounted, so none of its effects/legacy scripts break).
export default function EmberChatScreen({ onOpenAiChat }) {
  const [me, setMe] = useState(initialMe);
  const [activeChatId, setActiveChatId] = useState(chats[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState(initialMessagesByChat);
  const [modal, setModal] = useState(null); // "new-group" | "members" | "profile" | null
  const [toasts, setToasts] = useState([]);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? chats[0];
  const messages = messagesByChat[activeChatId] ?? [];

  const pushToast = (text, error = false) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  };

  const updateActiveMessages = (updater) => {
    setMessagesByChat((prev) => ({ ...prev, [activeChatId]: updater(prev[activeChatId] ?? []) }));
  };

  const handleSend = (text, replyTo) => {
    updateActiveMessages((list) => [
      ...list,
      {
        id: Date.now(),
        kind: "text",
        dir: "out",
        text,
        time: "now",
        ticks: "sent",
        ...(replyTo ? { replyTo } : {}),
      },
    ]);
  };

  const handleToggleReaction = (msgId, emoji) => {
    updateActiveMessages((list) =>
      list.map((m) => {
        if (m.id !== msgId) return m;
        const reactions = m.reactions ? m.reactions.map((r) => ({ ...r })) : [];
        const mineIdx = reactions.findIndex((r) => r.mine);
        const clickedSameOne = mineIdx !== -1 && reactions[mineIdx].emoji === emoji;

        if (mineIdx !== -1) {
          reactions[mineIdx].count -= 1;
          reactions[mineIdx].mine = false;
          if (reactions[mineIdx].count <= 0) reactions.splice(mineIdx, 1);
        }
        if (clickedSameOne) return { ...m, reactions };

        const existingIdx = reactions.findIndex((r) => r.emoji === emoji);
        if (existingIdx !== -1) {
          reactions[existingIdx].count += 1;
          reactions[existingIdx].mine = true;
        } else {
          reactions.push({ emoji, count: 1, mine: true });
        }
        return { ...m, reactions };
      })
    );
  };

  const handleDeleteMessage = (msgId) => {
    updateActiveMessages((list) => list.filter((m) => m.id !== msgId));
    pushToast("Message deleted");
  };

  return (
    <div className="ember-app-root">
      <div id="ember-app" className="active">
        <div id="ember-backdrop" className={sidebarOpen ? "show" : ""} onClick={() => setSidebarOpen(false)} />

        <Sidebar
          me={me}
          chats={chats}
          onlineUsers={onlineUsers}
          activeChatId={activeChatId}
          isOpen={sidebarOpen}
          onSelectChat={(id) => {
            setActiveChatId(id);
            setSidebarOpen(false);
          }}
          onEditProfile={() => setModal("profile")}
          onClose={() => setSidebarOpen(false)}
          onNewGroup={() => setModal("new-group")}
          onOpenAiChat={onOpenAiChat}
        />

        <ChatScreen
          key={activeChatId}
          chat={activeChat}
          messages={messages}
          onMenuClick={() => setSidebarOpen(true)}
          onMembersClick={() => setModal("members")}
          onSend={handleSend}
          onToggleReaction={handleToggleReaction}
          onDeleteMessage={handleDeleteMessage}
          pushToast={pushToast}
        />

        {modal && (
          <ModalLayer onScrimClick={() => setModal(null)}>
            {modal === "new-group" && (
              <NewGroupModal
                onlineUsers={onlineUsers}
                onCancel={() => setModal(null)}
                onCreate={() => {
                  pushToast("Group created");
                  setModal(null);
                }}
              />
            )}
            {modal === "members" && (
              <MembersModal
                title={activeChat.name}
                members={onlineUsers.slice(0, 2)}
                addableUsers={onlineUsers}
                onAdd={() => pushToast("Member added")}
                onLeave={() => {
                  pushToast("Left group");
                  setModal(null);
                }}
                onClose={() => setModal(null)}
              />
            )}
            {modal === "profile" && (
              <ProfileModal
                me={me}
                onCancel={() => setModal(null)}
                onSave={({ status }) => {
                  setMe((m) => ({ ...m, status }));
                  setModal(null);
                  pushToast("Profile saved");
                }}
              />
            )}
          </ModalLayer>
        )}

        <ToastContainer toasts={toasts} />
      </div>
    </div>
  );
}
