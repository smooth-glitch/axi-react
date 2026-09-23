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
 * Includes automatic reconnection and resilient local fallback when backend is offline.
 */

class SandeshSocketService {
  constructor() {
    this.ws = null;
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected' | 'offline_fallback'
    this.listeners = new Set();
    this.currentUser = null;
    this.reconnectTimer = null;
    this.isManualDisconnect = false;
    this.offlineQueue = [];
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
    this.currentUser = user;
    this.isManualDisconnect = false;
    this.status = 'connecting';
    this.notify({ type: 'status_change', status: this.status });

    // In local dev, backend runs at ws://localhost:8080.
    // In production behind nginx, it routes via /ws.
    const wsUrl = window.location.protocol === 'https:'
      ? `wss://${window.location.host}/ws`
      : (window.location.port === '5173' ? 'ws://localhost:8080' : `ws://${window.location.host}/ws`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.info('[SandeshSocket] WebSocket connected, sending handshake...');
        const handshake = {
          username: user.username || user.name || 'User',
          token: user.token || 'sandesh-token-' + Date.now(),
          armSessionId: user.armSessionId || 'sess-' + Date.now(),
        };
        this.ws.send(JSON.stringify(handshake));
      };

      this.ws.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          payload = { type: '__raw__', text: event.data };
        }

        if (payload.type === 'welcome') {
          this.status = 'connected';
          this.notify({ type: 'status_change', status: this.status, name: payload.name });
          // Fetch contacts and hosts once authenticated
          this.send('/hosts');
          this.send('/list');
          this.send('/history global');
        }

        this.notify(payload);
      };

      this.ws.onerror = () => {
        console.warn('[SandeshSocket] Connection error. Operating with active local fallback.');
        this.status = 'offline_fallback';
        this.notify({ type: 'status_change', status: this.status });
      };

      this.ws.onclose = () => {
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
    }, 7000);
  }

  send(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
      return true;
    }
    return false;
  }

  sendDM(toUser, text) {
    return this.send(`/msg ${toUser} ${text}`);
  }

  sendGroupMsg(group, text) {
    return this.send(`/groupmsg ${group} ${text}`);
  }

  sendHostMsg(hostKey, text) {
    return this.send(`/hostmsg ${hostKey} ${text}`);
  }

  sendReaction(scope, target, msgId, emoji) {
    // /react global <id> <emoji> or /react dm <user> <id> <emoji>
    if (scope === 'dm') {
      return this.send(`/react dm ${target} ${msgId} ${emoji}`);
    } else if (scope === 'group') {
      return this.send(`/react group ${target} ${msgId} ${emoji}`);
    }
    return this.send(`/react global ${msgId} ${emoji}`);
  }

  sendDelete(scope, target, msgId) {
    if (scope === 'dm') {
      return this.send(`/delete dm ${target} ${msgId}`);
    } else if (scope === 'group') {
      return this.send(`/delete group ${target} ${msgId}`);
    }
    return this.send(`/delete global ${msgId}`);
  }

  sendTyping(scope, target) {
    if (scope === 'dm') {
      return this.send(`/typing dm ${target}`);
    } else if (scope === 'group') {
      return this.send(`/typing group ${target}`);
    }
    return this.send(`/typing global`);
  }

  disconnect() {
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
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
