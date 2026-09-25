/**
 * Hash Commands Catalog and Parsing Engine
 *
 * Implements the full client-side catalog conforming to docs/HASH_COMMANDS.md
 * and chat_cmds:commands/0 from axi-chat-backend.
 *
 * Note: As instructed, the forms commands (#forms, #options, #form, #submissions)
 * are excluded from this catalog.
 */

export const COMMAND_CATEGORIES = [
  { id: "messaging", label: "Messaging", icon: "forum" },
  { id: "lookup", label: "Look Things Up", icon: "search" },
  { id: "groups", label: "Groups", icon: "groups" },
  { id: "profile", label: "Your Profile", icon: "person" },
  { id: "people", label: "People & Approvals", icon: "badge" },
  { id: "notifs", label: "Notifications & Cards", icon: "notifications" },
  { id: "admin", label: "Administration", icon: "admin_panel_settings" },
  { id: "help", label: "Help & Reference", icon: "help_outline" },
];

export const DEFAULT_COMMANDS_CATALOG = [
  // 1. Messaging
  {
    name: "dm",
    aliases: ["msg", "pm"],
    category: "messaging",
    summary: "Send a direct message to someone",
    usage: "#dm <user> <text...>",
    args: [
      { name: "user", type: "user", required: true },
      { name: "text", type: "text", required: true, rest: true, max: 2000 },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "host",
    aliases: [],
    category: "messaging",
    summary: "Message a department host (HR, Finance, ...)",
    usage: "#host <host> <text...>",
    args: [
      { name: "host", type: "host", required: true },
      { name: "text", type: "text", required: true, rest: true, max: 2000 },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "reply",
    aliases: [],
    category: "messaging",
    summary: "Reply to a message in the global room",
    usage: "#reply <messageId> <text...>",
    args: [
      { name: "messageId", type: "msgid", required: true },
      { name: "text", type: "text", required: true, rest: true, max: 2000 },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "replydm",
    aliases: [],
    category: "messaging",
    summary: "Reply to a message in a direct conversation",
    usage: "#replydm <user> <messageId> <text...>",
    args: [
      { name: "user", type: "user", required: true },
      { name: "messageId", type: "msgid", required: true },
      { name: "text", type: "text", required: true, rest: true, max: 2000 },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "groupmsg",
    aliases: ["gm"],
    category: "messaging",
    summary: "Send a message to a group",
    usage: "#groupmsg <group> <text...>",
    args: [
      { name: "group", type: "group", required: true },
      { name: "text", type: "text", required: true, rest: true, max: 2000 },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "replygroup",
    aliases: [],
    category: "messaging",
    summary: "Reply to a message in a group",
    usage: "#replygroup <group> <messageId> <text...>",
    args: [
      { name: "group", type: "group", required: true },
      { name: "messageId", type: "msgid", required: true },
      { name: "text", type: "text", required: true, rest: true, max: 2000 },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "react",
    aliases: [],
    category: "messaging",
    summary: "React to a global-room message (toggles)",
    usage: "#react <messageId> <emoji>",
    args: [
      { name: "messageId", type: "msgid", required: true },
      { name: "emoji", type: "emoji", required: true },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "reactdm",
    aliases: [],
    category: "messaging",
    summary: "React to a message in a direct conversation",
    usage: "#reactdm <user> <messageId> <emoji>",
    args: [
      { name: "user", type: "user", required: true },
      { name: "messageId", type: "msgid", required: true },
      { name: "emoji", type: "emoji", required: true },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "reactgroup",
    aliases: [],
    category: "messaging",
    summary: "React to a message in a group",
    usage: "#reactgroup <group> <messageId> <emoji>",
    args: [
      { name: "group", type: "group", required: true },
      { name: "messageId", type: "msgid", required: true },
      { name: "emoji", type: "emoji", required: true },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "delete",
    aliases: [],
    category: "messaging",
    summary: "Delete your own global-room message",
    usage: "#delete <messageId>",
    args: [{ name: "messageId", type: "msgid", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "deletedm",
    aliases: [],
    category: "messaging",
    summary: "Delete your own message in a direct conversation",
    usage: "#deletedm <user> <messageId>",
    args: [
      { name: "user", type: "user", required: true },
      { name: "messageId", type: "msgid", required: true },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "deletegroup",
    aliases: [],
    category: "messaging",
    summary: "Delete your own message in a group",
    usage: "#deletegroup <group> <messageId>",
    args: [
      { name: "group", type: "group", required: true },
      { name: "messageId", type: "msgid", required: true },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "gif",
    aliases: [],
    category: "messaging",
    summary: "Search & send GIFs",
    usage: "#gif [query...]",
    args: [{ name: "query", type: "text", required: false, rest: true }],
    available: true,
    requires: "none",
  },
  {
    name: "sticker",
    aliases: [],
    category: "messaging",
    summary: "Search & send stickers",
    usage: "#sticker [query...]",
    args: [{ name: "query", type: "text", required: false, rest: true }],
    available: true,
    requires: "none",
  },

  // 2. Look things up
  {
    name: "users",
    aliases: ["online", "who"],
    category: "lookup",
    summary: "Who is online right now in Sandesh",
    usage: "#users",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "hosts",
    aliases: [],
    category: "lookup",
    summary: "The host directory (AI hosts, workspace, departments)",
    usage: "#hosts",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "groups",
    aliases: [],
    category: "lookup",
    summary: "The groups and channels you are in",
    usage: "#groups",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "inbox",
    aliases: ["conversations"],
    category: "lookup",
    summary: "Your direct-message threads, newest first",
    usage: "#inbox",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "history",
    aliases: [],
    category: "lookup",
    summary: "Reload the global room's recent messages",
    usage: "#history",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "historydm",
    aliases: [],
    category: "lookup",
    summary: "Load your direct-message history with someone",
    usage: "#historydm <user>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "historygroup",
    aliases: [],
    category: "lookup",
    summary: "Load a group's recent messages",
    usage: "#historygroup <group>",
    args: [{ name: "group", type: "group", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "historyhost",
    aliases: [],
    category: "lookup",
    summary: "Load your conversation with a department host",
    usage: "#historyhost <host>",
    args: [{ name: "host", type: "host", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "read",
    aliases: [],
    category: "lookup",
    summary: "Mark a direct conversation as read",
    usage: "#read <user>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "profile",
    aliases: [],
    category: "lookup",
    summary: "See someone's avatar and status",
    usage: "#profile <user>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "none",
  },

  // 3. Groups
  {
    name: "creategroup",
    aliases: ["newgroup"],
    category: "groups",
    summary: "Create a group (no spaces in the name)",
    usage: "#creategroup <name>",
    args: [{ name: "name", type: "word", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "addmember",
    aliases: ["invitegroup"],
    category: "groups",
    summary: "Add an online user to a group you are in",
    usage: "#addmember <group> <user>",
    args: [
      { name: "group", type: "group", required: true },
      { name: "user", type: "user", required: true },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "leavegroup",
    aliases: ["leave"],
    category: "groups",
    summary: "Leave a group",
    usage: "#leavegroup <group>",
    args: [{ name: "group", type: "group", required: true }],
    available: true,
    requires: "none",
  },

  // 4. Your profile
  {
    name: "status",
    aliases: [],
    category: "profile",
    summary: "Set your status line",
    usage: "#status <status...>",
    args: [{ name: "status", type: "text", required: true, rest: true }],
    available: true,
    requires: "none",
  },
  {
    name: "avatar",
    aliases: [],
    category: "profile",
    summary: "Set your avatar (http(s) link or /uploads/ path)",
    usage: "#avatar <url>",
    args: [{ name: "url", type: "url", required: true }],
    available: true,
    requires: "none",
  },

  // 5. People and approvals (Sandesh)
  {
    name: "me",
    aliases: ["whoami"],
    category: "people",
    summary: "Your Sandesh account, permissions and counters",
    usage: "#me",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "associates",
    aliases: ["contacts"],
    category: "people",
    summary: "People and colleagues you are connected with",
    usage: "#associates",
    args: [],
    available: true,
    requires: "none",
  },
  {
    name: "find",
    aliases: ["search"],
    category: "people",
    summary: "Find a person by username, email or mobile number",
    usage: "#find <query...>",
    args: [{ name: "query", type: "text", required: true, rest: true }],
    available: true,
    requires: "none",
  },
  {
    name: "connect",
    aliases: [],
    category: "people",
    summary: "Invite someone to be your associate",
    usage: "#connect <user...>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "disconnect",
    aliases: [],
    category: "people",
    summary: "Remove an associate connection",
    usage: "#disconnect <user>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "requests",
    aliases: ["approvals"],
    category: "people",
    summary: "Your pending approvals and invitations",
    usage: "#requests [status]",
    args: [
      {
        name: "status",
        type: "enum",
        values: ["all", "pending", "accepted", "rejected"],
        required: false,
      },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "accept",
    aliases: [],
    category: "people",
    summary: "Accept a request or invitation",
    usage: "#accept <requestId>",
    args: [{ name: "requestId", type: "msgid", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "reject",
    aliases: [],
    category: "people",
    summary: "Reject a request or invitation",
    usage: "#reject <requestId>",
    args: [{ name: "requestId", type: "msgid", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "ignore",
    aliases: [],
    category: "people",
    summary: "Ignore a request or invitation",
    usage: "#ignore <requestId>",
    args: [{ name: "requestId", type: "msgid", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "myusers",
    aliases: [],
    category: "people",
    summary: "Users you host (department hosts only)",
    usage: "#myusers",
    args: [],
    available: true,
    requires: "host",
  },
  {
    name: "transfer",
    aliases: [],
    category: "people",
    summary: "Ask another host to take over one of your users (hosts only)",
    usage: "#transfer <user> <toHost>",
    args: [
      { name: "user", type: "user", required: true },
      { name: "toHost", type: "host", required: true },
    ],
    available: true,
    requires: "host",
  },

  // 6. Notifications and cards (Sandesh)
  {
    name: "notifications",
    aliases: ["notifs"],
    category: "notifs",
    summary: "Your notifications (unread first)",
    usage: "#notifications [category]",
    args: [
      {
        name: "category",
        type: "enum",
        values: ["all", "approvals", "system", "reminders"],
        required: false,
      },
    ],
    available: true,
    requires: "none",
  },
  {
    name: "markread",
    aliases: [],
    category: "notifs",
    summary: "Mark notifications as read",
    usage: "#markread <category>",
    args: [{ name: "category", type: "word", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "cards",
    aliases: [],
    category: "notifs",
    summary: "Your message cards (optionally one section)",
    usage: "#cards [section]",
    args: [{ name: "section", type: "word", required: false }],
    available: true,
    requires: "none",
  },
  {
    name: "dismiss",
    aliases: [],
    category: "notifs",
    summary: "Dismiss a card (or 'all')",
    usage: "#dismiss <cardId>",
    args: [{ name: "cardId", type: "word", required: true }],
    available: true,
    requires: "none",
  },
  {
    name: "remind",
    aliases: ["reminder"],
    category: "notifs",
    summary: "Add a reminder card for yourself",
    usage: "#remind <text...>",
    args: [{ name: "text", type: "text", required: true, rest: true }],
    available: true,
    requires: "none",
  },

  // 7. Administration (Sandesh, admins only)
  {
    name: "admin-org",
    aliases: [],
    category: "admin",
    summary: "Organisation details and headline counts",
    usage: "#admin-org",
    args: [],
    available: true,
    requires: "admin",
  },
  {
    name: "admin-users",
    aliases: [],
    category: "admin",
    summary: "List or search all registered users",
    usage: "#admin-users [query...]",
    args: [{ name: "query", type: "text", required: false, rest: true }],
    available: true,
    requires: "admin",
  },
  {
    name: "admin-admins",
    aliases: [],
    category: "admin",
    summary: "List administrators and privileged SPOCs",
    usage: "#admin-admins",
    args: [],
    available: true,
    requires: "admin",
  },
  {
    name: "admin-affiliates",
    aliases: [],
    category: "admin",
    summary: "List affiliates with their hosts and users",
    usage: "#admin-affiliates",
    args: [],
    available: true,
    requires: "admin",
  },
  {
    name: "admin-activate",
    aliases: [],
    category: "admin",
    summary: "Activate a user account",
    usage: "#admin-activate <user>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "admin",
  },
  {
    name: "admin-deactivate",
    aliases: [],
    category: "admin",
    summary: "Deactivate a user account (disconnects them)",
    usage: "#admin-deactivate <user>",
    args: [{ name: "user", type: "user", required: true }],
    available: true,
    requires: "admin",
  },

  // 8. Help
  {
    name: "help",
    aliases: ["commands"],
    category: "help",
    summary: "List all # commands or explain a specific one",
    usage: "#help [command]",
    args: [{ name: "command", type: "word", required: false }],
    available: true,
    requires: "none",
  },
];

/**
 * Filter catalog commands matching user input
 */
export function filterCatalogCommands(catalog = DEFAULT_COMMANDS_CATALOG, query = "", user = null) {
  const cleanQ = query.trim().toLowerCase().replace(/^#/, "");
  return catalog.filter((cmd) => {
    // Check permission advisory
    const meetsAdmin = cmd.requires !== "admin" || (user && user.isAdmin);
    const meetsHost = cmd.requires !== "host" || (user && (user.isHost || user.isAdmin));
    // Check match
    if (!cleanQ) return true;
    const nameMatch = cmd.name.toLowerCase().startsWith(cleanQ);
    const aliasMatch = (cmd.aliases || []).some((a) => a.toLowerCase().startsWith(cleanQ));
    return nameMatch || aliasMatch;
  });
}

/**
 * Parse an incoming command line string (e.g. "#dm alice hello there")
 */
export function parseCommandLine(line = "") {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) return null;

  // Extract command word
  const match = trimmed.match(/^#([A-Za-z][\w-]*)/);
  if (!match) return null;

  const rawCmdWord = match[1].toLowerCase();
  const rest = trimmed.slice(match[0].length).trim();

  // Find command in catalog
  const found = DEFAULT_COMMANDS_CATALOG.find(
    (c) => c.name === rawCmdWord || (c.aliases || []).includes(rawCmdWord)
  );

  return {
    rawLine: trimmed,
    cmdWord: rawCmdWord,
    matchedCommand: found || null,
    rest,
  };
}

/**
 * Check if the given line is a valid recognized hash command
 */
export function isKnownHashCommand(line = "", catalog = DEFAULT_COMMANDS_CATALOG) {
  const parsed = parseCommandLine(line);
  if (!parsed) return false;
  return catalog.some(
    (c) => c.name === parsed.cmdWord || (c.aliases || []).includes(parsed.cmdWord)
  );
}
