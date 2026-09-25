/**
 * Sandesh WebSocket Client Service
 *
 * Implements real-time communication with the Erlang/OTP chat backend (axi-chat-backend)
 * matching the protocol documented in docs/CHAT_PROTOCOL.md.
 *
 * Handshake: { username, token, armSessionId }
 * Outgoing: plain text commands (/msg, /groupmsg, /react, /delete, /typing, /hosts, /list, /history, etc.)
 * Incoming: JSON events (welcome, history, chat, private, group_message, reaction, deleted, hosts, users, etc.)
 *
 * Handles automatic reconnection, stale socket detection for React 18 StrictMode,
 * and resilient status reporting.
 */

class SandeshSocketService {
  constructor() {
    this.ws = null;
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected' | 'offline_fallback'
    this.listeners = new Set();
    this.currentUser = null;
    this.reconnectTimer = null;
    this.isManualDisconnect = false;
    this.connEpoch = 0;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error('[SandeshSocket] listener error:', err);
      }
    });
  }

  connect(user) {
    if (!user) return;
    this.currentUser = user;
    this.isManualDisconnect = false;

    // StrictMode double-connect guard:
    // Close existing socket and discard any stale events
    this.connEpoch += 1;
    const currentEpoch = this.connEpoch;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (e) {
        // ignore close error
      }
      this.ws = null;
    }

    this.status = 'connecting';
    this.notify({ type: 'status_change', status: this.status });

    // In local dev, backend runs at ws://${window.location.hostname}:8080.
    // In production behind nginx, it routes via /ws.
    const isDev =
      window.location.port === '5173' ||
      window.location.port === '3000' ||
      window.location.port === '5174' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const wsUrl = window.location.protocol === 'https:'
      ? `wss://${window.location.host}/ws`
      : (isDev ? `ws://${window.location.hostname}:8080` : `ws://${window.location.host}/ws`);

    try {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        if (this.connEpoch !== currentEpoch) {
          try { socket.close(); } catch {}
          return;
        }
        console.info('[SandeshSocket] WebSocket connected, sending handshake...');
        const rawUsername = (user.username || user.name || 'user').toLowerCase().trim();
        // Backend allows max 24 chars, no spaces
        const cleanUsername = rawUsername.replace(/\s+/g, '_').slice(0, 24);
        const handshake = {
          username: cleanUsername,
          token: user.token || 'sandesh-token-' + Date.now(),
          armSessionId: user.armSessionId || 'sess-' + Date.now(),
        };
        socket.send(JSON.stringify(handshake));
      };

      socket.onmessage = (event) => {
        if (this.connEpoch !== currentEpoch) return;

        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          payload = { type: '__raw__', text: event.data };
        }

        if (payload.type === 'welcome') {
          this.status = 'connected';
          this.notify({ type: 'status_change', status: this.status, name: payload.name });
          // Fetch contacts, directory, groups, inbox, and global history once authenticated
          this.send('/hosts');
          this.send('/list');
          this.send('/groups');
          this.send('/conversations');
          this.send('/history global');
          this.send('/cmds');
        }

        this.notify(payload);
      };

      socket.onerror = () => {
        if (this.connEpoch !== currentEpoch) return;
        console.warn('[SandeshSocket] Connection error.');
        this.status = 'offline_fallback';
        this.notify({ type: 'status_change', status: this.status });
      };

      socket.onclose = () => {
        if (this.connEpoch !== currentEpoch) return;
        if (!this.isManualDisconnect) {
          this.status = 'offline_fallback';
          this.notify({ type: 'status_change', status: this.status });
          this.scheduleReconnect();
        } else {
          this.status = 'disconnected';
          this.notify({ type: 'status_change', status: this.status });
        }
      };
    } catch (err) {
      console.warn('[SandeshSocket] WebSocket init failed:', err);
      if (this.connEpoch !== currentEpoch) return;
      this.status = 'offline_fallback';
      this.notify({ type: 'status_change', status: this.status });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.isManualDisconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isManualDisconnect && this.currentUser) {
        console.info('[SandeshSocket] Attempting reconnection...');
        this.connect(this.currentUser);
      }
    }, 2500);
  }

  send(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
      return true;
    }
    return false;
  }

  sendDM(toUser, text) {
    const target = (toUser || '').trim().toLowerCase();
    return this.send(`/msg ${target} ${text}`);
  }

  sendGroupMsg(group, text) {
    const target = (group || '').trim();
    return this.send(`/groupmsg ${target} ${text}`);
  }

  sendGlobalMsg(text) {
    return this.send(text);
  }

  sendHostMsg(hostKey, text) {
    const key = (hostKey || '').trim();
    return this.send(`/hostmsg ${key} ${text}`);
  }

  sendReaction(scope, target, msgId, emoji) {
    if (scope === 'dm') {
      const u = (target || '').trim().toLowerCase();
      return this.send(`/react dm ${u} ${msgId} ${emoji}`);
    } else if (scope === 'group') {
      const g = (target || '').trim();
      return this.send(`/react group ${g} ${msgId} ${emoji}`);
    }
    return this.send(`/react global ${msgId} ${emoji}`);
  }

  sendDelete(scope, target, msgId) {
    if (scope === 'dm') {
      const u = (target || '').trim().toLowerCase();
      return this.send(`/delete dm ${u} ${msgId}`);
    } else if (scope === 'group') {
      const g = (target || '').trim();
      return this.send(`/delete group ${g} ${msgId}`);
    }
    return this.send(`/delete global ${msgId}`);
  }

  sendTyping(scope, target) {
    if (scope === 'dm') {
      const u = (target || '').trim().toLowerCase();
      return this.send(`/typing dm ${u}`);
    } else if (scope === 'group') {
      const g = (target || '').trim();
      return this.send(`/typing group ${g}`);
    }
    return this.send('/typing global');
  }

  sendRead(username) {
    const u = (username || '').trim().toLowerCase();
    return this.send(`/read dm ${u}`);
  }

  sendHistory(scope, target) {
    if (scope === 'dm') {
      const u = (target || '').trim().toLowerCase();
      return this.send(`/history dm ${u}`);
    } else if (scope === 'group') {
      const g = (target || '').trim();
      return this.send(`/history group ${g}`);
    } else if (scope === 'host') {
      const h = (target || '').trim();
      return this.send(`/history host ${h}`);
    }
    return this.send('/history global');
  }

  sendCreateGroup(name) {
    const cleanName = (name || '').trim();
    return this.send(`/creategroup ${cleanName}`);
  }

  sendAddMember(group, username) {
    const g = (group || '').trim();
    const u = (username || '').trim().toLowerCase();
    return this.send(`/addmember ${g} ${u}`);
  }

  sendLeaveGroup(group) {
    const g = (group || '').trim();
    return this.send(`/leavegroup ${g}`);
  }

  sendList() {
    return this.send('/list');
  }

  sendGroups() {
    return this.send('/groups');
  }

  sendConversations() {
    return this.send('/conversations');
  }

  disconnect() {
    this.isManualDisconnect = true;
    this.connEpoch += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.send('/quit');
        this.ws.close();
      } catch (e) {
        // ignore close error
      }
      this.ws = null;
    }
    this.status = 'disconnected';
    this.notify({ type: 'status_change', status: this.status });
  }
}

export const sandeshSocket = new SandeshSocketService();
