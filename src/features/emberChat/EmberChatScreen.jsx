import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ChatScreen from "./components/ChatScreen.jsx";
import ModalLayer from "./components/ModalLayer.jsx";
import NewGroupModal from "./components/modals/NewGroupModal.jsx";
import MembersModal from "./components/modals/MembersModal.jsx";
import ProfileModal from "./components/modals/ProfileModal.jsx";
import SmartStructureModal from "./components/modals/SmartStructureModal.jsx";
import AdminConsoleModal from "./components/modals/AdminConsoleModal.jsx";
import SandeshLoginScreen from "./components/SandeshLoginScreen.jsx";
import ToastContainer from "./components/Toast.jsx";
import { me as defaultMe, chats as initialChats, onlineUsers as initialOnlineUsers, messagesByChat as initialMessagesByChat } from "./data/sampleData.js";
import { sandeshSocket } from "../../services/sandeshSocket.js";
import "./EmberChat.css";

export default function EmberChatScreen({ onOpenAiChat }) {
  // Check for saved Sandesh session in localStorage or start with default user
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("sandesh_session_user");
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return defaultMe;
  });

  const [chats, setChats] = useState(initialChats);
  const [onlineUsers, setOnlineUsers] = useState(initialOnlineUsers);
  const [activeChatId, setActiveChatId] = useState(initialChats[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState(initialMessagesByChat);
  const [modal, setModal] = useState(null); // "new-group" | "members" | "profile" | "smart_structure" | "admin_console" | null
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [socketStatus, setSocketStatus] = useState("disconnected");

  const activeChat = chats.find((c) => c.id === activeChatId) ?? chats[0];
  const messages = messagesByChat[activeChatId] ?? [];

  const pushToast = (text, error = false) => {
    const id = Date.now();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  };

  // Connect to backend WebSocket upon user session
  useEffect(() => {
    if (!currentUser) return undefined;

    const unsubscribe = sandeshSocket.subscribe((event) => {
      if (event.type === "status_change") {
        setSocketStatus(event.status);
      } else if (event.type === "chat" || event.type === "private" || event.type === "group_message" || event.type === "host_message") {
        const incomingTarget = event.group ? `room-${event.group}` : (event.from ? `user-${event.from.toLowerCase()}` : "room-general");
        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: "in",
          from: event.from || "Associate",
          text: event.text,
          time: new Date(event.ts ? event.ts * 1000 : Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessagesByChat((prev) => ({
          ...prev,
          [incomingTarget]: [...(prev[incomingTarget] ?? []), newMsg],
        }));
      } else if (event.type === "users" && Array.isArray(event.list)) {
        // Merge online user list from Erlang backend
        setOnlineUsers((prev) => {
          const names = new Set(prev.map((u) => u.name.toLowerCase()));
          const newEntries = event.list
            .filter((name) => !names.has(name.toLowerCase()))
            .map((name) => ({
              id: name.toLowerCase(),
              name,
              initials: name.slice(0, 2).toUpperCase(),
              color: "#34c759",
              status: "Online on Erlang Node",
            }));
          return [...prev, ...newEntries];
        });
      }
    });

    sandeshSocket.connect(currentUser);

    return () => {
      unsubscribe();
      sandeshSocket.disconnect();
    };
  }, [currentUser]);

  const updateActiveMessages = (updater) => {
    setMessagesByChat((prev) => ({ ...prev, [activeChatId]: updater(prev[activeChatId] ?? []) }));
  };

  const handleSend = (text, replyTo) => {
    const newMsg = {
      id: Date.now(),
      kind: "text",
      dir: "out",
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ticks: "read",
      ...(replyTo ? { replyTo } : {}),
    };

    updateActiveMessages((list) => [...list, newMsg]);

    // Forward through WebSocket if connected
    if (activeChat.isGroup) {
      sandeshSocket.sendGroupMsg(activeChat.name, text);
    } else if (activeChat.isHost) {
      sandeshSocket.sendHostMsg(activeChat.id.replace("host-", ""), text);
    } else {
      sandeshSocket.sendDM(activeChat.name, text);
    }

    // Auto-respond simulation if offline or with bots
    if (activeChat.isHost || activeChat.id === "user-priya") {
      setTimeout(() => {
        let replyText = `Received your message: "${text}". Processing request through host channel.`;
        if (activeChat.id === "host-hr") {
          replyText = "HR Operations has logged your inquiry. Use the Smart Prompts bar to submit specific requests.";
        } else if (activeChat.id === "host-workspace") {
          replyText = "Axpert Workspace acknowledged. Record has been updated in the application queue.";
        }
        updateActiveMessages((list) => [
          ...list,
          {
            id: Date.now() + 1,
            kind: "text",
            dir: "in",
            from: activeChat.name,
            color: "#ff7a59",
            initials: activeChat.name[0],
            text: replyText,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      }, 900);
    }
  };

  const handleAttachFile = (filePayload) => {
    updateActiveMessages((list) => [
      ...list,
      {
        id: Date.now(),
        dir: "out",
        time: "now",
        ticks: "read",
        ...filePayload,
      },
    ]);
  };

  const handleToggleReaction = (msgId, emoji) => {
    sandeshSocket.sendReaction(activeChat.isGroup ? "group" : "dm", activeChat.name, msgId, emoji);
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
    sandeshSocket.sendDelete(activeChat.isGroup ? "group" : "dm", activeChat.name, msgId);
    updateActiveMessages((list) => list.filter((m) => m.id !== msgId));
    pushToast("Message deleted");
  };

  const handleActionCardClick = (msg, action) => {
    updateActiveMessages((list) =>
      list.map((m) => {
        if (m.id !== msg.id) return m;
        return {
          ...m,
          actionStatus: action === "Approve" ? "Approved by You" : action === "Reject" ? "Rejected" : action,
          actions: [], // disable buttons once actioned
        };
      })
    );
    pushToast(`Action "${action}" processed`);
  };

  const handleSmartStructureSubmit = (cardPayload) => {
    updateActiveMessages((list) => [
      ...list,
      {
        id: Date.now(),
        dir: "out",
        time: "now",
        ticks: "read",
        ...cardPayload,
      },
    ]);
    setModal(null);
    setSelectedPrompt(null);
    pushToast("Smart Structure submitted to Host");
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    try {
      localStorage.setItem("sandesh_session_user", JSON.stringify(user));
    } catch {
      // ignore
    }
    pushToast(`Welcome to Sandesh, ${user.name}!`);
  };

  const handleSignOut = () => {
    sandeshSocket.disconnect();
    setCurrentUser(null);
    try {
      localStorage.removeItem("sandesh_session_user");
    } catch {
      // ignore
    }
    pushToast("Signed out of Sandesh");
  };

  // If user is not signed in, show Sandesh Login & Setup Portal
  if (!currentUser) {
    return <SandeshLoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="sandesh-app-root">
      {/* 3D Ambient Peach Lighting & Glow Canvas */}
      <div className="sandesh-ambient-canvas">
        <div className="peach-orb peach-orb-1" />
        <div className="peach-orb peach-orb-2" />
        <div className="peach-orb peach-orb-3" />
        <div className="peach-orb-mesh" />
      </div>

      <div id="sandesh-app-window" className="sandesh-app-window-3d">
        <div
          id="sandesh-sidebar-backdrop"
          className={sidebarOpen ? "show" : ""}
          onClick={() => setSidebarOpen(false)}
        />

        <Sidebar
          me={currentUser}
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
          onOpenAdminConsole={() => setModal("admin_console")}
          onSignOut={handleSignOut}
          socketStatus={socketStatus}
          onReconnectSocket={() => sandeshSocket.connect(currentUser)}
        />

        <ChatScreen
          key={activeChatId}
          chat={activeChat}
          messages={messages}
          userCategory={currentUser.category || "employee"}
          isAdmin={currentUser.isAdmin}
          onMenuClick={() => setSidebarOpen(true)}
          onMembersClick={() => setModal("members")}
          onSend={handleSend}
          onAttachFile={handleAttachFile}
          onToggleReaction={handleToggleReaction}
          onDeleteMessage={handleDeleteMessage}
          onActionCardClick={handleActionCardClick}
          onOpenSmartPrompts={(p) => {
            setSelectedPrompt(p || { id: "general", label: "Smart Prompt" });
            setModal("smart_structure");
          }}
          onOpenAdminConsole={() => setModal("admin_console")}
          onOpenAiChat={onOpenAiChat}
          pushToast={pushToast}
        />

        {modal && (
          <ModalLayer onScrimClick={() => setModal(null)}>
            {modal === "new-group" && (
              <NewGroupModal
                onlineUsers={onlineUsers}
                onCancel={() => setModal(null)}
                onCreate={(newGroupName) => {
                  const newChat = {
                    id: `room-${Date.now()}`,
                    name: newGroupName || "New Group",
                    isGroup: true,
                    preview: "Group created",
                    time: "now",
                    unread: 0,
                  };
                  setChats([newChat, ...chats]);
                  setActiveChatId(newChat.id);
                  sandeshSocket.send(`/creategroup ${newGroupName}`);
                  pushToast("Group created successfully");
                  setModal(null);
                }}
              />
            )}
            {modal === "members" && (
              <MembersModal
                title={activeChat.name}
                members={onlineUsers.slice(0, 3)}
                addableUsers={onlineUsers}
                onAdd={(userName) => {
                  sandeshSocket.send(`/addmember ${activeChat.name} ${userName}`);
                  pushToast(`Added ${userName} to group`);
                }}
                onLeave={() => {
                  sandeshSocket.send(`/leavegroup ${activeChat.name}`);
                  pushToast("Left group");
                  setModal(null);
                }}
                onClose={() => setModal(null)}
              />
            )}
            {modal === "profile" && (
              <ProfileModal
                me={currentUser}
                onCancel={() => setModal(null)}
                onSave={({ status }) => {
                  setCurrentUser((m) => ({ ...m, status }));
                  sandeshSocket.send(`/setstatus ${status}`);
                  setModal(null);
                  pushToast("Profile status updated");
                }}
              />
            )}
            {modal === "smart_structure" && selectedPrompt && (
              <SmartStructureModal
                prompt={selectedPrompt}
                onClose={() => {
                  setModal(null);
                  setSelectedPrompt(null);
                }}
                onSubmit={handleSmartStructureSubmit}
              />
            )}
            {modal === "admin_console" && (
              <AdminConsoleModal
                onClose={() => setModal(null)}
                pushToast={pushToast}
              />
            )}
          </ModalLayer>
        )}

        <ToastContainer toasts={toasts} />
      </div>
    </div>
  );
}
