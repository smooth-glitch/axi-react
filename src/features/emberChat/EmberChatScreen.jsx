import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  me as defaultMe,
  chats as initialChats,
  onlineUsers as initialOnlineUsers,
  messagesByChat as initialMessagesByChat,
} from "./data/sampleData.js";
import { sandeshSocket } from "../../services/sandeshSocket.js";
import "./EmberChat.css";

const formatTs = (ts) => {
  if (!ts) return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ms = Number(ts) > 1e11 ? Number(ts) : Number(ts) * 1000;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function EmberChatScreen({ onOpenAiChat }) {
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
  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState(initialMessagesByChat);
  const [modal, setModal] = useState(null); // "new-group" | "members" | "profile" | "smart_structure" | "admin_console" | null
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [socketStatus, setSocketStatus] = useState("disconnected");

  const activeChat = chats.find((c) => c.id === activeChatId) ?? chats[0];
  const messages = messagesByChat[activeChatId] ?? [];

  const pushToast = useCallback((text, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  // Connect to backend WebSocket upon user session
  useEffect(() => {
    if (!currentUser) return undefined;

    const myUsername = (currentUser.username || currentUser.name || "").toLowerCase().trim();

    const unsubscribe = sandeshSocket.subscribe((event) => {
      if (event.type === "status_change") {
        setSocketStatus(event.status);
      } else if (event.type === "error" && event.text) {
        // Item 10: Show backend errors with toast (e.g. username already taken, no such user)
        pushToast(event.text, true);
      } else if (event.type === "private") {
        // Item 2: Handle incoming private events (from, text, id, ts)
        const fromUser = event.from || "Associate";
        const partnerUsername = fromUser.toLowerCase();
        const chatId = `user-${partnerUsername}`;
        const timeStr = formatTs(event.ts);

        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: "in",
          from: fromUser,
          text: event.text,
          time: timeStr,
          ts: event.ts,
        };

        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: [...(prev[chatId] ?? []), newMsg],
        }));

        setChats((prevChats) => {
          const existingIndex = prevChats.findIndex((c) => c.id === chatId);
          const isChatOpen = activeChatIdRef.current === chatId;
          if (existingIndex !== -1) {
            const updated = [...prevChats];
            const existing = updated[existingIndex];
            updated[existingIndex] = {
              ...existing,
              preview: event.text,
              time: timeStr,
              unread: isChatOpen ? 0 : (existing.unread || 0) + 1,
            };
            return updated;
          } else {
            const newChat = {
              id: chatId,
              name: fromUser,
              username: partnerUsername,
              isGroup: false,
              category: "associate",
              designation: "Enterprise Associate",
              preview: event.text,
              time: timeStr,
              unread: isChatOpen ? 0 : 1,
              topic: "Direct Message",
              initials: fromUser.slice(0, 2).toUpperCase(),
              color: "#34c759",
            };
            return [newChat, ...prevChats];
          }
        });
      } else if (event.type === "chat") {
        // Item 3: Route global room correctly -> room-general
        const isMine = event.from && event.from.toLowerCase() === myUsername;
        const timeStr = formatTs(event.ts);
        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: isMine ? "out" : "in",
          from: event.from || "Associate",
          text: event.text,
          time: timeStr,
          ts: event.ts,
        };

        setMessagesByChat((prev) => {
          const existing = prev["room-general"] ?? [];
          if (
            isMine &&
            existing.some(
              (m) =>
                m.text === event.text &&
                Math.abs((m.ts || m.id) - (event.id || 0)) < 15000
            )
          ) {
            return {
              ...prev,
              "room-general": existing.map((m) =>
                m.text === event.text ? { ...m, id: event.id || m.id, ts: event.ts } : m
              ),
            };
          }
          return {
            ...prev,
            "room-general": [...existing, newMsg],
          };
        });

        setChats((prevChats) =>
          prevChats.map((c) =>
            c.id === "room-general"
              ? {
                  ...c,
                  preview: `${event.from || "Associate"}: ${event.text}`,
                  time: timeStr,
                  unread:
                    activeChatIdRef.current === "room-general"
                      ? 0
                      : (c.unread || 0) + (isMine ? 0 : 1),
                }
              : c
          )
        );
      } else if (event.type === "group_message") {
        const targetGroup = `room-${event.group}`;
        const isMine = event.from && event.from.toLowerCase() === myUsername;
        const timeStr = formatTs(event.ts);
        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: isMine ? "out" : "in",
          from: event.from || "Associate",
          text: event.text,
          time: timeStr,
          ts: event.ts,
        };

        setMessagesByChat((prev) => ({
          ...prev,
          [targetGroup]: [...(prev[targetGroup] ?? []), newMsg],
        }));

        setChats((prevChats) =>
          prevChats.map((c) =>
            c.id === targetGroup
              ? {
                  ...c,
                  preview: `${event.from || "Associate"}: ${event.text}`,
                  time: timeStr,
                  unread:
                    activeChatIdRef.current === targetGroup
                      ? 0
                      : (c.unread || 0) + (isMine ? 0 : 1),
                }
              : c
          )
        );
      } else if (event.type === "host_message") {
        const targetHost = `host-${event.host}`;
        const timeStr = formatTs(event.ts);
        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: "in",
          from: event.from || event.host || "Host",
          text: event.text,
          time: timeStr,
          ts: event.ts,
        };

        setMessagesByChat((prev) => ({
          ...prev,
          [targetHost]: [...(prev[targetHost] ?? []), newMsg],
        }));

        setChats((prevChats) =>
          prevChats.map((c) =>
            c.id === targetHost
              ? {
                  ...c,
                  preview: event.text,
                  time: timeStr,
                  unread: activeChatIdRef.current === targetHost ? 0 : (c.unread || 0) + 1,
                }
              : c
          )
        );
      } else if (event.type === "dm_ack") {
        // Item 8: Use real message ID from dm_ack to replace local Date.now() ID
        const targetChatId = `user-${(event.with || "").toLowerCase()}`;
        setMessagesByChat((prev) => {
          const list = prev[targetChatId] || [];
          let replaced = false;
          const updated = [...list]
            .reverse()
            .map((m) => {
              if (!replaced && m.dir === "out") {
                replaced = true;
                return { ...m, id: event.id, ts: event.ts, serverStatus: event.status };
              }
              return m;
            })
            .reverse();
          return { ...prev, [targetChatId]: updated };
        });
      } else if (event.type === "own_message_id") {
        // Item 8: Use real message ID for global broadcast
        setMessagesByChat((prev) => {
          const list = prev["room-general"] || [];
          let replaced = false;
          const updated = [...list]
            .reverse()
            .map((m) => {
              if (!replaced && m.dir === "out") {
                replaced = true;
                return { ...m, id: event.id, ts: event.ts };
              }
              return m;
            })
            .reverse();
          return { ...prev, "room-general": updated };
        });
      } else if (event.type === "conversations" && Array.isArray(event.list)) {
        // Item 6: Restore inbox after connect with /conversations
        setChats((prevChats) => {
          const updated = [...prevChats];
          event.list.forEach((item) => {
            const partner = item.with;
            if (!partner) return;
            const partnerUsername = partner.toLowerCase();
            const chatId = `user-${partnerUsername}`;
            const timeStr = formatTs(item.ts);
            const existingIdx = updated.findIndex((c) => c.id === chatId);
            if (existingIdx !== -1) {
              updated[existingIdx] = {
                ...updated[existingIdx],
                preview: item.text || updated[existingIdx].preview,
                time: timeStr || updated[existingIdx].time,
              };
            } else {
              // Add restored inbox conversation to sidebar
              updated.splice(1, 0, {
                id: chatId,
                name: partner,
                username: partnerUsername,
                isGroup: false,
                category: "associate",
                designation: "Enterprise Associate",
                preview: item.text || "Direct conversation",
                time: timeStr,
                unread: 0,
                topic: "Direct Message",
                initials: partner.slice(0, 2).toUpperCase(),
                color: "#34c759",
              });
            }
          });
          return updated;
        });
      } else if (event.type === "history") {
        // Item 7: Load history when DM or global opens
        if (event.scope === "dm" && event.with) {
          const targetChatId = `user-${event.with.toLowerCase()}`;
          const mappedMsgs = (event.list || []).map((m) => {
            const isOutgoing = m.from && m.from.toLowerCase() === myUsername;
            return {
              id: m.id,
              kind: "text",
              dir: isOutgoing ? "out" : "in",
              from: m.from,
              text: m.text,
              time: formatTs(m.ts),
              ts: m.ts,
              reactions: (m.reactions || []).map((r) => ({
                emoji: r.emoji,
                count: 1,
                mine: r.user && r.user.toLowerCase() === myUsername,
              })),
            };
          });
          setMessagesByChat((prev) => ({
            ...prev,
            [targetChatId]: mappedMsgs,
          }));
        } else if (event.scope === "global") {
          const mappedMsgs = (event.list || []).map((m) => {
            const isOutgoing = m.from && m.from.toLowerCase() === myUsername;
            return {
              id: m.id,
              kind: "text",
              dir: isOutgoing ? "out" : "in",
              from: m.from,
              text: m.text,
              time: formatTs(m.ts),
              ts: m.ts,
            };
          });
          setMessagesByChat((prev) => ({
            ...prev,
            "room-general": mappedMsgs,
          }));
        }
      } else if (event.type === "users" && Array.isArray(event.list)) {
        // Item 5: Drop sample users and filter out current user
        const realUsers = event.list
          .filter((name) => name && name.toLowerCase() !== myUsername)
          .map((name) => ({
            id: name.toLowerCase(),
            name,
            username: name.toLowerCase(),
            initials: name.slice(0, 2).toUpperCase(),
            color: "#34c759",
            status: "Online on Sandesh",
          }));
        setOnlineUsers(realUsers);
      } else if (event.type === "reaction" || event.type === "dm_reaction" || event.type === "group_reaction") {
        const msgId = event.messageId;
        const reactions = event.reactions || [];
        setMessagesByChat((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((k) => {
            updated[k] = updated[k].map((m) => {
              if (m.id !== msgId) return m;
              return {
                ...m,
                reactions: reactions.map((r) => ({
                  emoji: r.emoji,
                  count: 1,
                  mine: r.user && r.user.toLowerCase() === myUsername,
                })),
              };
            });
          });
          return updated;
        });
      } else if (event.type === "deleted" || event.type === "dm_deleted" || event.type === "group_deleted") {
        const msgId = event.messageId;
        setMessagesByChat((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((k) => {
            updated[k] = updated[k].filter((m) => m.id !== msgId);
          });
          return updated;
        });
      }
    });

    sandeshSocket.connect(currentUser);

    return () => {
      unsubscribe();
      sandeshSocket.disconnect();
    };
  }, [currentUser, pushToast]);

  // Item 5: Refresh online list every 5 seconds
  useEffect(() => {
    if (!currentUser) return undefined;
    const interval = setInterval(() => {
      if (sandeshSocket.status === "connected") {
        sandeshSocket.send("/list");
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Item 7: Load history when active DM or general room opens
  useEffect(() => {
    if (!activeChat || socketStatus !== "connected") return;
    if (!activeChat.isGroup && !activeChat.isHost && activeChat.id.startsWith("user-")) {
      const targetUser = activeChat.username || activeChat.id.replace(/^user-/, "");
      sandeshSocket.send(`/history dm ${targetUser}`);
    } else if (activeChat.id === "room-general") {
      sandeshSocket.send("/history global");
    }
  }, [activeChatId, activeChat, socketStatus]);

  const updateActiveMessages = (updater) => {
    setMessagesByChat((prev) => ({ ...prev, [activeChatId]: updater(prev[activeChatId] ?? []) }));
  };

  // Item 4: Make online users clickable - create DM chat on click if missing
  const handleSelectOnlineUser = (user) => {
    const username = (user.username || user.name || user.id).toLowerCase();
    const chatId = `user-${username}`;
    setChats((prevChats) => {
      const exists = prevChats.some((c) => c.id === chatId);
      if (!exists) {
        const newChat = {
          id: chatId,
          name: user.name || username,
          username,
          isGroup: false,
          category: "associate",
          designation: user.status || "Enterprise Associate",
          preview: "Start a conversation",
          time: "now",
          unread: 0,
          topic: "Direct Message",
          initials: user.initials || username.slice(0, 2).toUpperCase(),
          color: user.color || "#34c759",
        };
        return [newChat, ...prevChats];
      }
      return prevChats;
    });
    setActiveChatId(chatId);
    setSidebarOpen(false);
    if (socketStatus === "connected") {
      sandeshSocket.send(`/history dm ${username}`);
    }
  };

  const handleSelectChat = (id) => {
    if (id.startsWith("user-")) {
      const username = id.replace(/^user-/, "").toLowerCase();
      setChats((prevChats) => {
        const exists = prevChats.some((c) => c.id === id);
        if (!exists) {
          const newChat = {
            id,
            name: username,
            username,
            isGroup: false,
            category: "associate",
            designation: "Enterprise Associate",
            preview: "Start a conversation",
            time: "now",
            unread: 0,
            topic: "Direct Message",
            initials: username.slice(0, 2).toUpperCase(),
            color: "#34c759",
          };
          return [newChat, ...prevChats];
        }
        return prevChats;
      });
    }
    setActiveChatId(id);
    setSidebarOpen(false);
    // Mark unread as 0 on open
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  };

  // Item 1: Send DMs by username
  const handleSend = (text, replyTo) => {
    const tempId = Date.now();
    const newMsg = {
      id: tempId,
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
      if (activeChat.id === "room-general") {
        sandeshSocket.send(text);
      } else {
        sandeshSocket.sendGroupMsg(activeChat.name, text);
      }
    } else if (activeChat.isHost) {
      sandeshSocket.sendHostMsg(activeChat.id.replace("host-", ""), text);
    } else {
      // Item 1: Send activeChat.username
      const targetUser = (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase();
      sandeshSocket.sendDM(targetUser, text);
    }

    // Item 9: Remove fake bot replies. Keep ONLY for sample department hosts
    if (activeChat.isHost) {
      setTimeout(() => {
        let replyText = `Received your message: "${text}". Processing request through host channel.`;
        if (activeChat.id === "host-hr") {
          replyText = "HR Operations has logged your inquiry. Use the Smart Prompts bar to submit specific requests.";
        } else if (activeChat.id === "host-workspace") {
          replyText = "Sandesh Workspace acknowledged. Record has been updated in the application queue.";
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
    const isGroup = activeChat.isGroup;
    const target = isGroup
      ? (activeChat.id === "room-general" ? "global" : activeChat.name)
      : (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase();

    sandeshSocket.sendReaction(
      isGroup ? (activeChat.id === "room-general" ? "global" : "group") : "dm",
      target,
      msgId,
      emoji
    );

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
    const isGroup = activeChat.isGroup;
    const target = isGroup
      ? (activeChat.id === "room-general" ? "global" : activeChat.name)
      : (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase();

    sandeshSocket.sendDelete(
      isGroup ? (activeChat.id === "room-general" ? "global" : "group") : "dm",
      target,
      msgId
    );
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
          actions: [],
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
          onSelectChat={handleSelectChat}
          onSelectOnlineUser={handleSelectOnlineUser}
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

export { EmberChatScreen as SandeshChatScreen };
export default EmberChatScreen;
