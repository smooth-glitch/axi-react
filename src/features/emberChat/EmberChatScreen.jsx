import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ChatScreen from "./components/ChatScreen.jsx";
import ModalLayer from "./components/ModalLayer.jsx";
import NewGroupModal from "./components/modals/NewGroupModal.jsx";
import MembersModal from "./components/modals/MembersModal.jsx";
import ProfileModal from "./components/modals/ProfileModal.jsx";
import SmartStructureModal from "./components/modals/SmartStructureModal.jsx";
import AdminConsoleModal from "./components/modals/AdminConsoleModal.jsx";
import ForwardModal from "./components/modals/ForwardModal.jsx";
import SandeshLoginScreen from "./components/SandeshLoginScreen.jsx";
import ToastContainer from "./components/Toast.jsx";
import {
  chats as initialChats,
  messagesByChat as initialMessagesByChat,
  authorizedUsers,
} from "./data/sampleData.js";
import { sandeshSocket } from "../../services/sandeshSocket.js";
import "./EmberChat.css";

const formatTs = (ts) => {
  if (!ts) return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ms = Number(ts);
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export function EmberChatScreen({ onOpenAiChat }) {
  // Authorized session user. Fall back to null if no valid session for authorized personnel
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("sandesh_session_user");
      if (saved) {
        const parsed = JSON.parse(saved);
        const match = authorizedUsers.find(
          (u) => u.username.toLowerCase() === (parsed.username || "").toLowerCase()
        );
        if (match) return { ...match, ...parsed };
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [chats, setChats] = useState(() => {
    // Keep General Broadcast and department hosts from initialChats
    return initialChats.filter(
      (c) => c.id === "room-general" || c.isHost || c.category === "department_host"
    );
  });

  // P0: Real online list. Drop sample data, start empty
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [activeChatId, setActiveChatId] = useState("room-general");
  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messagesByChat, setMessagesByChat] = useState(() => ({
    "room-general": initialMessagesByChat["room-general"] || [],
  }));
  const [groupMembersByName, setGroupMembersByName] = useState({});
  const [typingUsersByChat, setTypingUsersByChat] = useState({});
  const typingTimersRef = useRef({});

  const [modal, setModal] = useState(null); // "new-group" | "members" | "profile" | "smart_structure" | "admin_console" | "forward" | null
  const [forwardTargetMsg, setForwardTargetMsg] = useState(null);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [socketStatus, setSocketStatus] = useState("disconnected");

  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0] || {
    id: "room-general",
    name: "General Broadcast",
    isGroup: true,
  };
  const messages = messagesByChat[activeChatId] ?? [];

  const pushToast = useCallback((text, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const setChatTyping = useCallback((chatId, username) => {
    setTypingUsersByChat((prev) => ({ ...prev, [chatId]: username }));
    if (typingTimersRef.current[chatId]) {
      clearTimeout(typingTimersRef.current[chatId]);
    }
    typingTimersRef.current[chatId] = setTimeout(() => {
      setTypingUsersByChat((prev) => {
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      delete typingTimersRef.current[chatId];
    }, 3500);
  }, []);

  // Main Socket Connection & Event Handling
  useEffect(() => {
    if (!currentUser) return undefined;

    const myUsername = (currentUser.username || currentUser.name || "").toLowerCase().trim();

    const unsubscribe = sandeshSocket.subscribe((event) => {
      if (event.type === "status_change") {
        setSocketStatus(event.status);
        if (event.status === "connected") {
          // Re-fetch history for currently active chat on reconnect
          const currentId = activeChatIdRef.current;
          if (currentId.startsWith("user-")) {
            const partner = currentId.replace(/^user-/, "");
            sandeshSocket.sendHistory("dm", partner);
          } else if (currentId === "room-general") {
            sandeshSocket.sendHistory("global");
          } else if (currentId.startsWith("room-")) {
            const grp = currentId.replace(/^room-/, "");
            sandeshSocket.sendHistory("group", grp);
          }
        }
      } else if (event.type === "error" && event.text) {
        // P0: Handle error events (show toast)
        pushToast(event.text, true);
      } else if (event.type === "system") {
        // P0: Re-send /list whenever a system event contains "has joined" or "has left"
        if (event.text && (event.text.includes("has joined") || event.text.includes("has left"))) {
          sandeshSocket.sendList();
        }
      } else if (event.type === "users" && Array.isArray(event.list)) {
        // P0: Build onlineUsers only from /list results, replace list, exclude yourself
        const realUsers = event.list
          .filter((name) => name && name.toLowerCase().trim() !== myUsername)
          .map((name) => {
            const clean = name.toLowerCase().trim();
            return {
              id: clean,
              name,
              username: clean,
              initials: name.slice(0, 2).toUpperCase(),
              color: "#34c759",
              status: "Online on Sandesh",
            };
          });
        setOnlineUsers(realUsers);
      } else if (event.type === "private") {
        // P0: Route incoming private events to DM with from
        const fromUser = event.from || "Associate";
        const partnerUsername = fromUser.toLowerCase().trim();
        const chatId = `user-${partnerUsername}`;
        const timeStr = formatTs(event.ts);
        const isOpen = activeChatIdRef.current === chatId;

        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: "in",
          from: fromUser,
          text: event.text,
          time: timeStr,
          ts: event.ts,
          status: "read",
          ticks: "read",
          ...(event.replyTo ? { replyTo: event.replyTo } : {}),
        };

        setMessagesByChat((prev) => ({
          ...prev,
          [chatId]: [...(prev[chatId] ?? []), newMsg],
        }));

        setChats((prevChats) => {
          const existingIndex = prevChats.findIndex((c) => c.id === chatId);
          if (existingIndex !== -1) {
            const updated = [...prevChats];
            const existing = updated[existingIndex];
            updated[existingIndex] = {
              ...existing,
              preview: event.text,
              time: timeStr,
              unread: isOpen ? 0 : (existing.unread || 0) + 1,
            };
            return updated;
          }
          const newChat = {
            id: chatId,
            name: fromUser,
            username: partnerUsername,
            isGroup: false,
            category: "associate",
            designation: "Enterprise Associate",
            preview: event.text,
            time: timeStr,
            unread: isOpen ? 0 : 1,
            topic: "Direct Message",
            initials: fromUser.slice(0, 2).toUpperCase(),
            color: "#34c759",
          };
          return [newChat, ...prevChats];
        });

        // If DM is open, acknowledge read receipt
        if (isOpen) {
          sandeshSocket.sendRead(partnerUsername);
        }
      } else if (event.type === "chat") {
        // P0: Route global room to room-general
        const isMine = event.from && event.from.toLowerCase().trim() === myUsername;
        const timeStr = formatTs(event.ts);
        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: isMine ? "out" : "in",
          from: event.from || "Associate",
          text: event.text,
          time: timeStr,
          ts: event.ts,
          status: "sent",
          ticks: "sent",
          ...(event.replyTo ? { replyTo: event.replyTo } : {}),
        };

        setMessagesByChat((prev) => {
          const existing = prev["room-general"] ?? [];
          if (isMine) {
            const pendingIndex = existing.findIndex(
              (m) => m.dir === "out" && (m.status === "sending" || m.id.toString().startsWith("temp-"))
            );
            if (pendingIndex !== -1) {
              const updated = [...existing];
              updated[pendingIndex] = {
                ...updated[pendingIndex],
                id: event.id || updated[pendingIndex].id,
                ts: event.ts,
                time: timeStr,
                status: "sent",
                ticks: "sent",
              };
              return { ...prev, "room-general": updated };
            }
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
        // P0: Route group_message to room-<group>
        const groupName = event.group;
        const targetGroup = `room-${groupName}`;
        const isMine = event.from && event.from.toLowerCase().trim() === myUsername;
        const timeStr = formatTs(event.ts);
        const isOpen = activeChatIdRef.current === targetGroup;

        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: isMine ? "out" : "in",
          from: event.from || "Associate",
          text: event.text,
          time: timeStr,
          ts: event.ts,
          status: "sent",
          ticks: "sent",
          ...(event.replyTo ? { replyTo: event.replyTo } : {}),
        };

        setMessagesByChat((prev) => {
          const existing = prev[targetGroup] ?? [];
          if (isMine) {
            const pendingIndex = existing.findIndex(
              (m) => m.dir === "out" && (m.status === "sending" || m.id.toString().startsWith("temp-"))
            );
            if (pendingIndex !== -1) {
              const updated = [...existing];
              updated[pendingIndex] = {
                ...updated[pendingIndex],
                id: event.id || updated[pendingIndex].id,
                ts: event.ts,
                time: timeStr,
                status: "sent",
                ticks: "sent",
              };
              return { ...prev, [targetGroup]: updated };
            }
          }
          return {
            ...prev,
            [targetGroup]: [...existing, newMsg],
          };
        });

        setChats((prevChats) => {
          const idx = prevChats.findIndex((c) => c.id === targetGroup);
          if (idx !== -1) {
            const updated = [...prevChats];
            updated[idx] = {
              ...updated[idx],
              preview: `${event.from || "Associate"}: ${event.text}`,
              time: timeStr,
              unread: isOpen ? 0 : (updated[idx].unread || 0) + (isMine ? 0 : 1),
            };
            return updated;
          }
          const newGroupChat = {
            id: targetGroup,
            name: groupName,
            isGroup: true,
            category: "channel",
            preview: `${event.from || "Associate"}: ${event.text}`,
            time: timeStr,
            unread: isOpen ? 0 : (isMine ? 0 : 1),
            topic: groupName,
            members: groupMembersByName[groupName] || [],
          };
          return [newGroupChat, ...prevChats];
        });
      } else if (event.type === "host_message") {
        // P0: Route host_message to host-<host>
        const targetHost = `host-${event.host}`;
        const timeStr = formatTs(event.ts);
        const isOpen = activeChatIdRef.current === targetHost;
        const newMsg = {
          id: event.id || Date.now(),
          kind: "text",
          dir: "in",
          from: event.from || event.host || "Host",
          text: event.text,
          time: timeStr,
          ts: event.ts,
          status: "read",
          ticks: "read",
          ...(event.replyTo ? { replyTo: event.replyTo } : {}),
        };

        setMessagesByChat((prev) => ({
          ...prev,
          [targetHost]: [...(prev[targetHost] ?? []), newMsg],
        }));

        setChats((prevChats) => {
          const idx = prevChats.findIndex((c) => c.id === targetHost);
          if (idx !== -1) {
            const updated = [...prevChats];
            updated[idx] = {
              ...updated[idx],
              preview: event.text,
              time: timeStr,
              unread: isOpen ? 0 : (updated[idx].unread || 0) + 1,
            };
            return updated;
          }
          const newHostChat = {
            id: targetHost,
            name: event.host ? event.host.toUpperCase() : "Host",
            isGroup: false,
            isHost: true,
            category: "department_host",
            designation: "Department Host",
            preview: event.text,
            time: timeStr,
            unread: isOpen ? 0 : 1,
            topic: "Host Channel",
          };
          return [newHostChat, ...prevChats];
        });
      } else if (event.type === "dm_ack") {
        // P1: Replace temp ID with real server ID and timestamp on dm_ack
        const targetChatId = `user-${(event.with || "").toLowerCase().trim()}`;
        setMessagesByChat((prev) => {
          const list = prev[targetChatId] || [];
          const idx = list.findIndex(
            (m) => m.dir === "out" && (m.status === "sending" || m.id.toString().startsWith("temp-"))
          );
          if (idx !== -1) {
            const updated = [...list];
            updated[idx] = {
              ...updated[idx],
              id: event.id,
              ts: event.ts,
              time: formatTs(event.ts),
              status: "sent",
              ticks: "sent",
              serverStatus: event.status, // "delivered" | "queued"
            };
            return { ...prev, [targetChatId]: updated };
          }
          return prev;
        });
      } else if (event.type === "group_msg_ack") {
        // P1: Replace temp ID on group_msg_ack
        const targetChatId = `room-${event.group}`;
        setMessagesByChat((prev) => {
          const list = prev[targetChatId] || [];
          const idx = list.findIndex(
            (m) => m.dir === "out" && (m.status === "sending" || m.id.toString().startsWith("temp-"))
          );
          if (idx !== -1) {
            const updated = [...list];
            updated[idx] = {
              ...updated[idx],
              id: event.id,
              ts: event.ts,
              time: formatTs(event.ts),
              status: "sent",
              ticks: "sent",
            };
            return { ...prev, [targetChatId]: updated };
          }
          return prev;
        });
      } else if (event.type === "own_message_id") {
        // P1: Replace temp ID for global broadcast
        setMessagesByChat((prev) => {
          const list = prev["room-general"] || [];
          const idx = list.findIndex(
            (m) => m.dir === "out" && (m.status === "sending" || m.id.toString().startsWith("temp-"))
          );
          if (idx !== -1) {
            const updated = [...list];
            updated[idx] = {
              ...updated[idx],
              id: event.id,
              ts: event.ts,
              time: formatTs(event.ts),
              status: "sent",
              ticks: "sent",
            };
            return { ...prev, "room-general": updated };
          }
          return prev;
        });
      } else if (event.type === "dm_read") {
        // P1: Read receipts
        const targetChatId = `user-${(event.from || "").toLowerCase().trim()}`;
        setMessagesByChat((prev) => {
          const list = prev[targetChatId] || [];
          const updated = list.map((m) =>
            m.dir === "out" ? { ...m, status: "read", ticks: "read" } : m
          );
          return { ...prev, [targetChatId]: updated };
        });
      } else if (event.type === "typing_dm") {
        // P1: Typing in DM
        const fromUser = (event.from || "").toLowerCase().trim();
        setChatTyping(`user-${fromUser}`, event.from);
      } else if (event.type === "group_typing") {
        // P1: Typing in Group
        setChatTyping(`room-${event.group}`, event.from);
      } else if (event.type === "typing") {
        // P1: Typing in Global
        setChatTyping("room-general", event.text);
      } else if (event.type === "conversations" && Array.isArray(event.list)) {
        // Restore conversations from server
        setChats((prevChats) => {
          const updated = [...prevChats];
          event.list.forEach((item) => {
            const partner = item.with;
            if (!partner) return;
            const partnerUsername = partner.toLowerCase().trim();
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
        // P1: Load history
        let targetChatId = null;
        if (event.scope === "dm" && event.with) {
          targetChatId = `user-${event.with.toLowerCase().trim()}`;
        } else if (event.scope === "global") {
          targetChatId = "room-general";
        } else if (event.scope === "group" && event.group) {
          targetChatId = `room-${event.group}`;
        } else if (event.scope === "host" && event.host) {
          targetChatId = `host-${event.host}`;
        }

        if (targetChatId) {
          const mappedMsgs = (event.list || [])
            .filter((m) => !m.deleted)
            .map((m) => {
              const isOutgoing = m.from && m.from.toLowerCase().trim() === myUsername;
              const emojiMap = {};
              (m.reactions || []).forEach((r) => {
                if (!emojiMap[r.emoji]) emojiMap[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
                emojiMap[r.emoji].count += 1;
                if (r.user && r.user.toLowerCase().trim() === myUsername) {
                  emojiMap[r.emoji].mine = true;
                }
              });

              return {
                id: m.id,
                kind: "text",
                dir: isOutgoing ? "out" : "in",
                from: m.from,
                text: m.text,
                time: formatTs(m.ts),
                ts: m.ts,
                status: "read",
                ticks: "read",
                reactions: Object.values(emojiMap),
                replyTo: m.replyTo,
                previewUrl: m.previewUrl,
                previewTitle: m.previewTitle,
                previewDescription: m.previewDescription,
                previewImage: m.previewImage,
              };
            });

          setMessagesByChat((prev) => ({
            ...prev,
            [targetChatId]: mappedMsgs,
          }));
        }
      } else if (
        event.type === "reaction" ||
        event.type === "dm_reaction" ||
        event.type === "group_reaction"
      ) {
        // P1: Handle reactions from server
        const msgId = event.messageId;
        const emojiMap = {};
        (event.reactions || []).forEach(({ user, emoji }) => {
          if (!emojiMap[emoji]) emojiMap[emoji] = { emoji, count: 0, mine: false };
          emojiMap[emoji].count += 1;
          if (user && user.toLowerCase().trim() === myUsername) {
            emojiMap[emoji].mine = true;
          }
        });
        const aggregated = Object.values(emojiMap);

        setMessagesByChat((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((k) => {
            updated[k] = updated[k].map((m) => {
              if (m.id !== msgId) return m;
              return { ...m, reactions: aggregated };
            });
          });
          return updated;
        });
      } else if (
        event.type === "deleted" ||
        event.type === "dm_deleted" ||
        event.type === "group_deleted"
      ) {
        // P1: Handle server delete events
        const msgId = event.messageId;
        setMessagesByChat((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((k) => {
            updated[k] = updated[k].filter((m) => m.id !== msgId);
          });
          return updated;
        });
      } else if (event.type === "delete_denied") {
        // P1: Handle delete denied
        pushToast(
          `Cannot delete message: ${event.reason === "forbidden" ? "not allowed" : event.reason || "denied"}`,
          true
        );
      } else if (event.type === "groups" && Array.isArray(event.list)) {
        // P1: Handle groups event
        const membersMap = {};
        event.list.forEach((g) => {
          membersMap[g.name] = g.members || [];
        });
        setGroupMembersByName((prev) => ({ ...prev, ...membersMap }));

        setChats((prevChats) => {
          const updated = [...prevChats];
          event.list.forEach((g) => {
            const chatId = `room-${g.name}`;
            const existingIdx = updated.findIndex((c) => c.id === chatId);
            if (existingIdx !== -1) {
              updated[existingIdx] = {
                ...updated[existingIdx],
                members: g.members,
              };
            } else {
              updated.push({
                id: chatId,
                name: g.name,
                isGroup: true,
                category: "channel",
                preview: "Group active",
                time: "now",
                unread: 0,
                topic: g.name,
                members: g.members,
              });
            }
          });
          return updated;
        });
      } else if (event.type === "group_created") {
        // P1: Handle group_created
        const chatId = `room-${event.name}`;
        setGroupMembersByName((prev) => ({ ...prev, [event.name]: event.members || [] }));
        setChats((prevChats) => {
          if (prevChats.some((c) => c.id === chatId)) return prevChats;
          return [
            {
              id: chatId,
              name: event.name,
              isGroup: true,
              category: "channel",
              preview: "Group created",
              time: "now",
              unread: 0,
              topic: event.name,
              members: event.members || [],
            },
            ...prevChats,
          ];
        });
        setActiveChatId(chatId);
        pushToast(`Group "${event.name}" created`);
      } else if (event.type === "added_to_group") {
        // P1: Handle added_to_group
        const chatId = `room-${event.name}`;
        setGroupMembersByName((prev) => ({ ...prev, [event.name]: event.members || [] }));
        setChats((prevChats) => {
          const idx = prevChats.findIndex((c) => c.id === chatId);
          if (idx !== -1) {
            const updated = [...prevChats];
            updated[idx] = { ...updated[idx], members: event.members || [] };
            return updated;
          }
          return [
            {
              id: chatId,
              name: event.name,
              isGroup: true,
              category: "channel",
              preview: `Added by ${event.by || "member"}`,
              time: "now",
              unread: 1,
              topic: event.name,
              members: event.members || [],
            },
            ...prevChats,
          ];
        });
        pushToast(`You were added to group "${event.name}" by ${event.by || "an associate"}`);
      } else if (event.type === "left_group" || event.type === "group_deleted") {
        const leftName = typeof event.text === "string" ? event.text : event.group || "";
        if (leftName) {
          const chatId = `room-${leftName}`;
          setChats((prev) => prev.filter((c) => c.id !== chatId));
          if (activeChatIdRef.current === chatId) {
            setActiveChatId("room-general");
          }
        }
      }
    });

    sandeshSocket.connect(currentUser);

    return () => {
      unsubscribe();
      sandeshSocket.disconnect();
    };
  }, [currentUser, pushToast, setChatTyping]);

  // Periodic /list poll (every 5 seconds)
  useEffect(() => {
    if (!currentUser) return undefined;
    const interval = setInterval(() => {
      if (sandeshSocket.status === "connected") {
        sandeshSocket.sendList();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Load history & send read receipt whenever activeChatId changes
  useEffect(() => {
    if (!activeChat || socketStatus !== "connected") return;
    if (!activeChat.isGroup && !activeChat.isHost && activeChat.id.startsWith("user-")) {
      const targetUser = activeChat.username || activeChat.id.replace(/^user-/, "");
      sandeshSocket.sendHistory("dm", targetUser);
      sandeshSocket.sendRead(targetUser);
    } else if (activeChat.id === "room-general") {
      sandeshSocket.sendHistory("global");
    } else if (activeChat.isGroup) {
      const groupName = activeChat.name || activeChat.id.replace(/^room-/, "");
      sandeshSocket.sendHistory("group", groupName);
    } else if (activeChat.isHost) {
      const hostKey = activeChat.id.replace(/^host-/, "");
      sandeshSocket.sendHistory("host", hostKey);
    }
  }, [activeChatId, activeChat, socketStatus]);

  const updateActiveMessages = (updater) => {
    setMessagesByChat((prev) => ({ ...prev, [activeChatId]: updater(prev[activeChatId] ?? []) }));
  };

  // P0: Clicking an online user opens a DM (creates if missing, then selects)
  const handleSelectOnlineUser = (user) => {
    const username = (user.username || user.name || user.id).toLowerCase().trim();
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
          initials: (user.name || username).slice(0, 2).toUpperCase(),
          color: user.color || "#34c759",
        };
        return [newChat, ...prevChats];
      }
      return prevChats;
    });
    setActiveChatId(chatId);
    setSidebarOpen(false);
    if (socketStatus === "connected") {
      sandeshSocket.sendHistory("dm", username);
      sandeshSocket.sendRead(username);
    }
  };

  const handleSelectChat = (id) => {
    if (id.startsWith("user-")) {
      const username = id.replace(/^user-/, "").toLowerCase().trim();
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
      if (socketStatus === "connected") {
        sandeshSocket.sendRead(username);
      }
    }
    setActiveChatId(id);
    setSidebarOpen(false);
    // Mark unread as 0 on open
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  };

  // P0 & P1: Send messages with sending/sent/failed status and correct routing
  const handleSend = (text, replyTo) => {
    const tempId = `temp-${Date.now()}`;
    const newMsg = {
      id: tempId,
      kind: "text",
      dir: "out",
      from: currentUser.name || currentUser.username,
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ts: Date.now(),
      status: "sending",
      ticks: "sending",
      ...(replyTo ? { replyTo } : {}),
    };

    // Forward through WebSocket if connected
    let sendResult = false;
    if (activeChat.isGroup) {
      if (activeChat.id === "room-general") {
        // Don't send /groupmsg for General Broadcast
        sendResult = sandeshSocket.sendGlobalMsg(text);
      } else {
        const grp = activeChat.name || activeChat.id.replace(/^room-/, "");
        sendResult = sandeshSocket.sendGroupMsg(grp, text);
      }
    } else if (activeChat.isHost) {
      sendResult = sandeshSocket.sendHostMsg(activeChat.id.replace(/^host-/, ""), text);
    } else {
      // P0: Send to username, not display name
      const targetUser = (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase().trim();
      sendResult = sandeshSocket.sendDM(targetUser, text);
    }

    if (!sendResult) {
      // P1: sandeshSocket.send() returns false when socket is closed, don't add as sent
      newMsg.status = "failed";
      newMsg.ticks = "failed";
      updateActiveMessages((list) => [...list, newMsg]);
      pushToast("Cannot send message: disconnected from server", true);
      return;
    }

    updateActiveMessages((list) => [...list, newMsg]);

    // Update conversation preview in sidebar
    setChats((prevChats) =>
      prevChats.map((c) =>
        c.id === activeChatId
          ? {
              ...c,
              preview: `You: ${text}`,
              time: "now",
            }
          : c
      )
    );
  };

  const handleTyping = () => {
    if (socketStatus !== "connected") return;
    if (activeChat.isGroup) {
      if (activeChat.id === "room-general") {
        sandeshSocket.sendTyping("global");
      } else {
        const grp = activeChat.name || activeChat.id.replace(/^room-/, "");
        sandeshSocket.sendTyping("group", grp);
      }
    } else if (!activeChat.isHost) {
      const targetUser = (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase().trim();
      sandeshSocket.sendTyping("dm", targetUser);
    }
  };

  const handleAttachFile = (filePayload) => {
    const tempId = `temp-${Date.now()}`;
    const newMsg = {
      id: tempId,
      dir: "out",
      from: currentUser.name || currentUser.username,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ticks: "sent",
      ...filePayload,
    };
    updateActiveMessages((list) => [...list, newMsg]);

    const descriptor =
      filePayload.kind === "image"
        ? `📷 Photo: ${filePayload.fileName || "image"}`
        : filePayload.kind === "video"
        ? `🎥 Video: ${filePayload.fileName || "video"}`
        : filePayload.kind === "audio"
        ? `🎙️ Voice Note (${filePayload.duration || "0:05"})`
        : `📎 Document: ${filePayload.fileName || "file"}`;

    if (socketStatus === "connected") {
      if (activeChat.isGroup) {
        if (activeChat.id === "room-general") {
          sandeshSocket.sendGlobalMsg(descriptor);
        } else {
          const grp = activeChat.name || activeChat.id.replace(/^room-/, "");
          sandeshSocket.sendGroupMsg(grp, descriptor);
        }
      } else if (activeChat.isHost) {
        sandeshSocket.sendHostMsg(activeChat.id.replace(/^host-/, ""), descriptor);
      } else {
        const targetUser = (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase().trim();
        sandeshSocket.sendDM(targetUser, descriptor);
      }
    }

    setChats((prevChats) =>
      prevChats.map((c) =>
        c.id === activeChatId
          ? {
              ...c,
              preview: `You: ${descriptor}`,
              time: "now",
            }
          : c
      )
    );
  };

  const handleToggleReaction = (msgId, emoji) => {
    const isGroup = activeChat.isGroup;
    const target = isGroup
      ? (activeChat.id === "room-general" ? "global" : activeChat.name)
      : (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase().trim();

    sandeshSocket.sendReaction(
      isGroup ? (activeChat.id === "room-general" ? "global" : "group") : "dm",
      target,
      msgId,
      emoji
    );
  };

  const handleDeleteMessage = (msgId) => {
    updateActiveMessages((prev) => prev.filter((m) => m.id !== msgId));
    pushToast("Message deleted");

    if (socketStatus === "connected") {
      const isGroup = activeChat.isGroup;
      const target = isGroup
        ? (activeChat.id === "room-general" ? "global" : activeChat.name)
        : (activeChat.username || activeChat.id.replace(/^user-/, "")).toLowerCase().trim();

      const numId = Number(msgId);
      if (!isNaN(numId)) {
        sandeshSocket.sendDelete(
          isGroup ? (activeChat.id === "room-general" ? "global" : "group") : "dm",
          target,
          numId
        );
      }
    }
  };

  const handleOpenForward = (msg) => {
    setForwardTargetMsg(msg);
    setModal("forward");
  };

  const handleForwardMessage = (selectedTargets, originalMsg) => {
    if (!selectedTargets || selectedTargets.length === 0 || !originalMsg) return;

    selectedTargets.forEach((target) => {
      const tempId = `temp-fwd-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const forwardedMsg = {
        id: tempId,
        kind: originalMsg.kind || "text",
        dir: "out",
        from: currentUser.name || currentUser.username,
        text: originalMsg.text || "",
        fileName: originalMsg.fileName,
        fileSize: originalMsg.fileSize,
        imageUrl: originalMsg.imageUrl,
        videoUrl: originalMsg.videoUrl,
        audioUrl: originalMsg.audioUrl,
        duration: originalMsg.duration,
        title: originalMsg.title,
        details: originalMsg.details,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ts: Date.now(),
        status: "sent",
        ticks: "sent",
        forwarded: true,
        originalFrom: originalMsg.from,
      };

      // 1. Update local chat messages
      setMessagesByChat((prev) => ({
        ...prev,
        [target.id]: [...(prev[target.id] || []), forwardedMsg],
      }));

      // 2. Transmit through sandeshSocket backend if connected
      const forwardPayload = forwardedMsg.text
        ? forwardedMsg.text
        : (forwardedMsg.fileName || forwardedMsg.title || "Forwarded attachment");

      if (socketStatus === "connected") {
        if (target.isGroup) {
          if (target.id === "room-general") {
            sandeshSocket.sendGlobalMsg(forwardPayload);
          } else {
            const grp = target.name || target.id.replace(/^room-/, "");
            sandeshSocket.sendGroupMsg(grp, forwardPayload);
          }
        } else if (target.isHost) {
          sandeshSocket.sendHostMsg(target.id.replace(/^host-/, ""), forwardPayload);
        } else {
          const targetUser = (target.username || target.id.replace(/^user-/, "")).toLowerCase().trim();
          sandeshSocket.sendDM(targetUser, forwardPayload);
        }
      }

      // 3. Update sidebar conversation preview
      setChats((prevChats) => {
        const chatExists = prevChats.some((c) => c.id === target.id);
        if (chatExists) {
          return prevChats.map((c) =>
            c.id === target.id
              ? {
                  ...c,
                  preview: `You (Forwarded): ${forwardPayload}`,
                  time: "now",
                }
              : c
          );
        }
        return [
          {
            id: target.id,
            name: target.name,
            username: target.username,
            isGroup: false,
            color: target.color || "#10b981",
            preview: `You (Forwarded): ${forwardPayload}`,
            time: "now",
            unread: 0,
          },
          ...prevChats,
        ];
      });
    });

    pushToast(
      `Message forwarded to ${selectedTargets.length} recipient${selectedTargets.length > 1 ? "s" : ""}`
    );
    setModal(null);
    setForwardTargetMsg(null);
  };

  const handleDeleteChat = (chatId) => {
    setMessagesByChat((prev) => {
      const next = { ...prev };
      delete next[chatId];
      if (chatId === "room-general") {
        next["room-general"] = [];
      }
      return next;
    });

    if (chatId !== "room-general") {
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatIdRef.current === chatId) {
        setActiveChatId("room-general");
      }
      const chatItem = chats.find((c) => c.id === chatId);
      if (chatItem?.isGroup && chatId.startsWith("room-")) {
        const grp = chatItem.name || chatId.replace(/^room-/, "");
        sandeshSocket.sendLeaveGroup(grp);
      }
    } else {
      setChats((prev) =>
        prev.map((c) =>
          c.id === "room-general"
            ? { ...c, preview: "Conversation cleared", unread: 0 }
            : c
        )
      );
    }

    pushToast("Conversation deleted");
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
        ticks: "sent",
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

  const currentGroupMembersRaw =
    (activeChat.isGroup && groupMembersByName[activeChat.name]) ||
    activeChat.members ||
    [currentUser.username || currentUser.name];

  const enrichedGroupMembers = currentGroupMembersRaw.map((m) => {
    if (typeof m === "object" && m !== null) return m;
    const found = authorizedUsers.find(
      (u) => (u.username || u.name || u.id || "").toLowerCase() === String(m).toLowerCase()
    );
    if (found) return found;
    return {
      id: m,
      username: m,
      name: m,
      role: "Member",
      designation: "Team Associate",
      initials: String(m).slice(0, 2).toUpperCase(),
      color: "#ff7a59",
    };
  });

  const teamPool = (authorizedUsers && authorizedUsers.length > 0) ? authorizedUsers : (onlineUsers || []);
  const currentAddableUsers = teamPool.filter((u) => {
    const uName = (u.username || u.name || u.id || "").toLowerCase();
    return !currentGroupMembersRaw.some((m) => {
      const mName = (typeof m === "string" ? m : m.username || m.name || m.id || "").toLowerCase();
      return mName === uName;
    });
  });

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
          onDeleteChat={handleDeleteChat}
        />

        <ChatScreen
          key={activeChatId}
          chat={{ ...activeChat, members: enrichedGroupMembers }}
          messages={messages}
          userCategory={currentUser.category || "employee"}
          isAdmin={currentUser.isAdmin}
          onMenuClick={() => setSidebarOpen(true)}
          onMembersClick={() => setModal("members")}
          onSend={handleSend}
          onAttachFile={handleAttachFile}
          onToggleReaction={handleToggleReaction}
          onForward={handleOpenForward}
          onDeleteMessage={handleDeleteMessage}
          onDeleteChat={handleDeleteChat}
          onActionCardClick={handleActionCardClick}
          onOpenSmartPrompts={(p) => {
            setSelectedPrompt(p || { id: "general", label: "Smart Prompt" });
            setModal("smart_structure");
          }}
          onOpenAdminConsole={() => setModal("admin_console")}
          onOpenAiChat={onOpenAiChat}
          typingUser={typingUsersByChat[activeChatId]}
          onTyping={handleTyping}
          disabled={socketStatus !== "connected"}
          pushToast={pushToast}
        />

        {modal && (
          <ModalLayer onScrimClick={() => setModal(null)}>
            {modal === "new-group" && (
              <NewGroupModal
                onlineUsers={onlineUsers}
                availableUsers={authorizedUsers}
                currentUsername={currentUser.username}
                onCancel={() => setModal(null)}
                onCreate={(payload) => {
                  const groupName =
                    typeof payload === "string" ? payload.trim() : payload?.name?.trim();
                  const selectedMembers = payload?.selected || [];

                  if (!groupName) return;

                  // P1: Use consistent id room-<groupName> on both send and receive
                  const chatId = `room-${groupName}`;
                  const newChat = {
                    id: chatId,
                    name: groupName,
                    isGroup: true,
                    category: "channel",
                    preview: "Group created",
                    time: "now",
                    unread: 0,
                    topic: groupName,
                    members: [currentUser.username, ...selectedMembers],
                  };

                  setChats((prev) => [newChat, ...prev]);
                  setActiveChatId(chatId);
                  setGroupMembersByName((prev) => ({
                    ...prev,
                    [groupName]: [currentUser.username, ...selectedMembers],
                  }));

                  const safeBackendGroupName = groupName.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 24) || "group";
                  sandeshSocket.sendCreateGroup(safeBackendGroupName);

                  // Add invited members
                  selectedMembers.forEach((mem) => {
                    sandeshSocket.sendAddMember(safeBackendGroupName, mem);
                  });

                  pushToast(`Group "${groupName}" created successfully`);
                  setModal(null);
                }}
              />
            )}
            {modal === "members" && (
              <MembersModal
                title={activeChat.name}
                members={enrichedGroupMembers}
                addableUsers={currentAddableUsers}
                onAdd={(userName) => {
                  const groupName = activeChat.name || activeChat.id.replace(/^room-/, "");
                  sandeshSocket.sendAddMember(groupName, userName);
                  setGroupMembersByName((prev) => ({
                    ...prev,
                    [groupName]: [...(prev[groupName] || []), userName],
                  }));
                  pushToast(`Added ${userName} to ${groupName}`);
                  setModal(null);
                }}
                onLeave={() => {
                  const groupName = activeChat.name || activeChat.id.replace(/^room-/, "");
                  sandeshSocket.sendLeaveGroup(groupName);
                  setChats((prev) => prev.filter((c) => c.id !== activeChat.id));
                  setActiveChatId("room-general");
                  pushToast(`Left group ${groupName}`);
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
                  try {
                    localStorage.setItem(
                      "sandesh_session_user",
                      JSON.stringify({ ...currentUser, status })
                    );
                  } catch {}
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
            {modal === "forward" && forwardTargetMsg && (
              <ForwardModal
                message={forwardTargetMsg}
                chats={chats}
                onlineUsers={onlineUsers}
                availableUsers={authorizedUsers}
                currentUsername={currentUser.username}
                onCancel={() => {
                  setModal(null);
                  setForwardTargetMsg(null);
                }}
                onForward={handleForwardMessage}
              />
            )}
          </ModalLayer>
        )}

        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </div>
  );
}

export { EmberChatScreen as SandeshChatScreen };
export default EmberChatScreen;
