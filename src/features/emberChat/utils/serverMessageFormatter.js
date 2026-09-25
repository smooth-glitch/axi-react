/**
 * Server Message Formatter
 *
 * Transforms raw Erlang/OTP backend messages, socket error envelopes,
 * and command usage replies into user-friendly, human-readable text.
 *
 * Ensures technical syntax, parameter placeholders (<messageId>, <user>),
 * CLI usage prompts, and harsh backend error codes are converted into
 * clean, helpful, and beautifully styled notifications in the UI.
 *
 * Does NOT alter underlying WebSocket payloads or protocol events.
 */

// Human-friendly parameter names
const PARAM_LABELS = {
  messageid: "message ID",
  msgid: "message ID",
  user: "recipient username",
  username: "username",
  targetuser: "recipient username",
  group: "group name",
  grp: "group name",
  groupname: "group name",
  host: "department host",
  tohost: "target host",
  emoji: "emoji reaction",
  text: "message text",
  message: "message text",
  name: "group name",
  id: "item ID",
  reqid: "request ID",
  cardid: "card ID",
  url: "image URL",
  category: "notification category",
  rest: "status text",
};

// Friendly human descriptions for command usage
const COMMAND_USAGE_GUIDES = {
  reply: "Please provide the message ID and your reply text.",
  replydm: "Please provide the recipient's username, message ID, and your reply.",
  replygroup: "Please provide the group name, message ID, and your reply.",
  dm: "Please provide the recipient's username and your message.",
  msg: "Please provide the recipient's username and your message.",
  pm: "Please provide the recipient's username and your message.",
  host: "Please specify the department host and your message.",
  groupmsg: "Please specify the group name and your message.",
  gm: "Please specify the group name and your message.",
  react: "Please provide the message ID and the emoji reaction.",
  reactdm: "Please provide the username, message ID, and emoji reaction.",
  reactgroup: "Please provide the group name, message ID, and emoji reaction.",
  delete: "Please provide the ID of the message you want to delete.",
  creategroup: "Please provide a name for the new group.",
  addmember: "Please specify the group name and username to add.",
  leavegroup: "Please specify the group name you wish to leave.",
  invite: "Please provide the username you would like to invite.",
  disconnect: "Please provide the username you would like to disconnect.",
  accept: "Please provide the ID of the request to accept.",
  reject: "Please provide the ID of the request to reject.",
  ignore: "Please provide the ID of the request to ignore.",
  transfer: "Please specify the username and target department host.",
  status: "Please enter your status message.",
  setstatus: "Please enter your status message.",
  avatar: "Please provide a valid image URL for your profile avatar.",
  history: "Please specify which chat or room to reload history for.",
  read: "Please specify the username whose messages to mark as read.",
  readnotifs: "Please specify the notification category to mark as read.",
  dismiss: "Please specify the card ID you wish to dismiss.",
  remind: "Please enter the reminder note you want to save.",
  activate: "Please specify the username you want to activate.",
  deactivate: "Please specify the username you want to deactivate.",
  lock: "Please specify the lock action for the Admin Console.",
  help: "Please specify a command name to view its guide.",
};

/**
 * Format a camelCase or snake_case parameter name into words
 */
function humanizeParam(param) {
  if (!param) return "parameter";
  const stripped = param.replace(/<|>|\.{3}/g, "").trim();
  const lower = stripped.toLowerCase();
  if (PARAM_LABELS[lower]) return PARAM_LABELS[lower];

  return stripped
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}


/**
 * Clean angle-bracket placeholders in any usage string
 * E.g. "#reply <messageId> <text...>" -> "#reply [message ID] [text]"
 */
export function cleanUsageSyntax(usageStr) {
  if (!usageStr) return "";
  return usageStr.replace(/<([^>]+)>/g, (_, p) => `[${humanizeParam(p)}]`);
}

/**
 * Format any server event or message into a user-friendly UI display object
 *
 * @param {string | object} input - Event object from WebSocket or message string
 * @param {boolean} [defaultError=false] - Whether caller flagged this as an error
 * @param {object} [meta={}] - Extra metadata (title, icon, type override)
 * @returns {{ text: string, title: string, type: 'info'|'warning'|'error'|'success', icon: string, isError: boolean }}
 */
export function formatServerMessage(input, defaultError = false, meta = {}) {
  // 1. Guard against empty/null input
  if (!input) {
    return {
      text: "Operation completed",
      title: "Notice",
      type: "info",
      icon: "check_circle",
      isError: false,
    };
  }

  // 2. Extract fields from socket event or string
  let rawText = "";
  let code = "";
  let command = "";
  let usage = "";
  let reason = "";
  let eventType = "";
  let suggestions = [];
  let isExplicitError = Boolean(defaultError);

  if (typeof input === "object") {
    eventType = input.type || "";
    code = (input.code || "").toLowerCase();
    command = (input.command || "").toLowerCase();
    usage = input.usage || "";
    reason = (input.reason || "").toLowerCase();
    suggestions = Array.isArray(input.suggestions) ? input.suggestions : [];

    // Sandesh envelope: {"type":"sd", "ok":false, "error":{"code":..., "message":...}}
    if (input.type === "sd" && !input.ok && input.error) {
      code = (input.error.code || "").toLowerCase();
      rawText = input.error.message || "";
      isExplicitError = true;
    } else if (input.type === "cmd_help" && input.command) {
      command = input.command.name || "";
      rawText = input.command.summary || "";
      usage = input.command.usage || "";
      isExplicitError = false;
    } else if (input.type === "delete_denied") {
      isExplicitError = true;
      rawText = reason ? `delete_denied_${reason}` : "delete_denied";
    } else {
      rawText = input.text || input.message || "";
      if (input.type === "error" || input.error) {
        isExplicitError = true;
      }
    }
  } else {
    rawText = String(input).trim();
  }

  const rawLower = rawText.toLowerCase();

  // Strip prefixes like "Sandesh error: " or "Error: "
  const cleanedRaw = rawText
    .replace(/^sandesh\s+error:\s*/i, "")
    .replace(/^error:\s*/i, "")
    .replace(/^backend\s+error:\s*/i, "")
    .trim();

  // 3. CASE: Command Usage / Missing parameter (as in user reference image)
  // Backend string: "Missing <messageId>. Usage: #reply <messageId> <text...>"
  const missingMatch = cleanedRaw.match(/missing\s*<([^>]+)>\.?\s*(?:usage:\s*#?([a-zA-Z0-9_-]+)\s*(.*))?/i);
  if (missingMatch || code === "usage") {
    const missingArg = missingMatch ? missingMatch[1] : "";
    const cmdName = (missingMatch && missingMatch[2] ? missingMatch[2] : command).toLowerCase();

    // If we have a dedicated friendly guide for this command, use it
    if (cmdName && COMMAND_USAGE_GUIDES[cmdName]) {
      return {
        text: COMMAND_USAGE_GUIDES[cmdName],
        title: meta.title || "Command Tip",
        type: "info",
        icon: meta.icon || "lightbulb",
        isError: false,
      };
    }

    // Generic friendly explanation for missing parameter
    const friendlyParam = humanizeParam(missingArg);
    const friendlyCmd = cmdName ? ` #${cmdName}` : "";
    return {
      text: `Please provide the ${friendlyParam} to use${friendlyCmd}.`,
      title: meta.title || "Command Tip",
      type: "info",
      icon: meta.icon || "lightbulb",
      isError: false,
    };
  }

  // 4. CASE: Unknown command
  // Backend string: "Unknown command '#abc'. Did you mean: #dm, #reply?"
  if (code === "unknown_command" || rawLower.startsWith("unknown command")) {
    const cmdMatch = cleanedRaw.match(/unknown command\s*['"]?#?([a-zA-Z0-9_-]+)['"]?/i);
    const typedCmd = cmdMatch ? `#${cmdMatch[1]}` : "Command";

    if (suggestions.length > 0) {
      const suggestStr = suggestions.map((s) => (s.startsWith("#") ? s : `#${s}`)).join(" or ");
      return {
        text: `${typedCmd} was not recognized. Did you mean: ${suggestStr}?`,
        title: meta.title || "Command Notice",
        type: "info",
        icon: meta.icon || "help_outline",
        isError: false,
      };
    }

    const inlineDidYouMean = cleanedRaw.match(/did you mean:\s*([^?]+)/i);
    if (inlineDidYouMean) {
      return {
        text: `${typedCmd} was not recognized. Did you mean: ${inlineDidYouMean[1].trim()}?`,
        title: meta.title || "Command Notice",
        type: "info",
        icon: meta.icon || "help_outline",
        isError: false,
      };
    }

    return {
      text: `${typedCmd} was not recognized. Type # in the chat bar to explore available commands.`,
      title: meta.title || "Command Notice",
      type: "info",
      icon: meta.icon || "help_outline",
      isError: false,
    };
  }

  // 5. CASE: Command Help Event
  if (eventType === "cmd_help" || code === "cmd_help") {
    const summary = rawText || "Command details";
    const usageClean = cleanUsageSyntax(usage);
    return {
      text: usageClean ? `${summary}. (Usage: ${usageClean})` : summary,
      title: meta.title || "Command Guide",
      type: "info",
      icon: meta.icon || "help_outline",
      isError: false,
    };
  }

  // 6. CASE: Rate Limiting
  if (
    code === "rate_limited" ||
    rawLower.includes("too many commands") ||
    rawLower.includes("slow down") ||
    rawLower.includes("rate limit")
  ) {
    return {
      text: "You are sending requests too quickly. Please pause for a few seconds and try again.",
      title: meta.title || "Slow Down",
      type: "warning",
      icon: meta.icon || "hourglass_empty",
      isError: true,
    };
  }

  // 7. CASE: Permissions and Access
  if (code === "not_associated" || rawLower === "not_associated" || rawLower.includes("not associated")) {
    return {
      text: "You must be connected or associated with this contact to exchange direct messages.",
      title: meta.title || "Notice",
      type: "warning",
      icon: meta.icon || "group_off",
      isError: true,
    };
  }

  if (
    code === "not_allowed" ||
    code === "forbidden" ||
    rawLower === "not_allowed" ||
    rawLower === "forbidden" ||
    rawLower.includes("permission denied")
  ) {
    return {
      text: "You do not have permission to perform this action.",
      title: meta.title || "Notice",
      type: "warning",
      icon: meta.icon || "lock",
      isError: true,
    };
  }

  if (code === "unauthenticated" || rawLower === "unauthenticated" || rawLower.includes("unauthenticated")) {
    return {
      text: "Please sign in to your Sandesh account to access this feature.",
      title: meta.title || "Authentication Required",
      type: "warning",
      icon: meta.icon || "account_circle",
      isError: true,
    };
  }

  if (
    code === "session_expired" ||
    rawLower === "session_expired" ||
    rawLower.includes("session expired")
  ) {
    return {
      text: "Your session has expired. Please sign in again to continue.",
      title: meta.title || "Session Expired",
      type: "warning",
      icon: meta.icon || "schedule",
      isError: true,
    };
  }

  if (code === "admin_locked" || rawLower === "admin_locked" || rawLower.includes("admin locked")) {
    return {
      text: "The Admin Console is currently locked. Please unlock it to proceed.",
      title: meta.title || "Admin Console",
      type: "warning",
      icon: meta.icon || "admin_panel_settings",
      isError: true,
    };
  }

  if (code === "password_change_required" || rawLower.includes("password change")) {
    return {
      text: "A password update is required before continuing.",
      title: meta.title || "Security Notice",
      type: "warning",
      icon: meta.icon || "vpn_key",
      isError: true,
    };
  }

  // 8. CASE: Delete Denied
  if (eventType === "delete_denied" || rawLower.includes("delete_denied") || rawLower.includes("cannot delete")) {
    if (reason === "forbidden" || rawLower.includes("forbidden") || rawLower.includes("not allowed")) {
      return {
        text: "You can only delete messages you sent recently.",
        title: meta.title || "Notice",
        type: "info",
        icon: meta.icon || "info_outline",
        isError: false,
      };
    }
    return {
      text: "This message could not be deleted or was already removed.",
      title: meta.title || "Notice",
      type: "info",
      icon: meta.icon || "info_outline",
      isError: false,
    };
  }

  // 9. CASE: Specific Common Chat/Socket Errors
  if (rawLower.includes("no such user") || (code === "not_found" && rawLower.includes("user"))) {
    return {
      text: "User could not be found. Please check the username and try again.",
      title: meta.title || "Notice",
      type: "info",
      icon: meta.icon || "person_search",
      isError: false,
    };
  }

  if (rawLower.includes("already taken") || rawLower.includes("username exists")) {
    return {
      text: "This username is already taken. Please choose another username.",
      title: meta.title || "Notice",
      type: "warning",
      icon: meta.icon || "badge",
      isError: true,
    };
  }

  if (rawLower.includes("disconnected from server") || rawLower.includes("connection error")) {
    return {
      text: "Cannot send message: waiting for connection to server...",
      title: meta.title || "Connection Offline",
      type: "warning",
      icon: meta.icon || "cloud_off",
      isError: true,
    };
  }

  if (rawLower.includes("invalid utf-8") || code === "invalid_encoding") {
    return {
      text: "The message could not be processed due to unsupported characters.",
      title: meta.title || "Notice",
      type: "warning",
      icon: meta.icon || "text_fields",
      isError: true,
    };
  }

  if (rawLower.includes("maximum 2000") || rawLower.includes("too long")) {
    return {
      text: "Message exceeds the maximum allowed length (2,000 characters).",
      title: meta.title || "Notice",
      type: "warning",
      icon: meta.icon || "short_text",
      isError: true,
    };
  }

  // 10. Generic Heuristic Translation for Unmapped Backend Text
  // If the string still contains angle brackets or raw codes, clean them up nicely!
  let userFriendlyText = cleanedRaw;

  // Replace <something> with friendly label
  userFriendlyText = userFriendlyText.replace(/<([^>]+)>/g, (_, p) => humanizeParam(p));

  // Remove "Usage: #..." trailers if any
  userFriendlyText = userFriendlyText.replace(/\s*Usage:\s*#?[a-zA-Z0-9_\-\s<>.…]+/i, "").trim();

  // If the string was just a snake_case error code (e.g. "not_found" or "invalid_id")
  if (/^[a-z0-9_]+$/.test(userFriendlyText)) {
    userFriendlyText = userFriendlyText.replace(/_/g, " ");
    userFriendlyText = userFriendlyText.charAt(0).toUpperCase() + userFriendlyText.slice(1);
  }

  // Capitalize first letter
  if (userFriendlyText.length > 0) {
    userFriendlyText = userFriendlyText.charAt(0).toUpperCase() + userFriendlyText.slice(1);
    if (!/[.!?]$/.test(userFriendlyText)) {
      userFriendlyText += ".";
    }
  } else {
    userFriendlyText = isExplicitError ? "An error occurred. Please try again." : "Operation completed.";
  }

  // Infer title & icon from category if not explicitly given
  const isDelete = rawLower.includes("deleted");
  const isAdd = rawLower.includes("added") || rawLower.includes("created");
  const isPresence = rawLower.includes("online") || rawLower.includes("disconnect");

  let deducedTitle = meta.title || (isExplicitError ? "Notice" : "Notice");
  let deducedType = meta.type || (isExplicitError ? "error" : "success");
  let deducedIcon = meta.icon;

  if (!deducedIcon) {
    if (isPresence) deducedIcon = "cloud_off";
    else if (isExplicitError) deducedIcon = "error_outline";
    else if (isDelete) {
      deducedIcon = "delete_outline";
      deducedTitle = "Updated";
    } else if (isAdd) {
      deducedIcon = "person_add";
      deducedTitle = "Success";
    } else {
      deducedIcon = "check_circle";
    }
  }

  return {
    text: userFriendlyText,
    title: deducedTitle,
    type: deducedType,
    icon: deducedIcon,
    isError: isExplicitError,
  };
}
