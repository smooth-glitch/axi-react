// Static sample/demo data — purely for previewing the UI.
// Replace with real data wired up to your app's state/API.

export const me = {
  name: "You",
  status: "Available",
  initials: "Y",
  color: "#5856d6",
};

export const chats = [
  {
    id: "room-general",
    name: "General",
    isGroup: true,
    preview: "Ravi: anyone free for lunch?",
    time: "10:42",
    unread: 2,
    active: true,
  },
  {
    id: "user-priya",
    name: "Priya",
    isGroup: false,
    preview: "sounds good, see you then!",
    time: "09:15",
    unread: 0,
    active: false,
  },
  {
    id: "room-design",
    name: "Design Team",
    isGroup: true,
    preview: "You: pushed the new mockups",
    time: "Yesterday",
    unread: 0,
    active: false,
  },
  {
    id: "user-ravi",
    name: "Ravi",
    isGroup: false,
    preview: "anyone free for lunch?",
    time: "10:42",
    unread: 0,
    active: false,
  },
  {
    id: "user-sam",
    name: "Sam",
    isGroup: false,
    preview: "How's the new mockup coming along?",
    time: "Yesterday",
    unread: 0,
    active: false,
  },
];

// Every entry in `onlineUsers` must resolve to a chat above (id `user-<id>`)
// -- the sidebar's "Online" list opens that chat on click, and a mismatch
// leaves the message pane empty under the wrong chat's header.

export const onlineUsers = [
  { id: "priya", name: "Priya", initials: "P", color: "#ff9f0a", status: "Available" },
  { id: "ravi", name: "Ravi", initials: "R", color: "#34c759", status: "In a meeting" },
  { id: "sam", name: "Sam", initials: "S", color: "#ff375f", status: "Away" },
];

// Keyed by chat id (see `chats` above) so switching chats in the sidebar
// actually shows that chat's own thread instead of one shared list.
export const messagesByChat = {
  "room-general": [
    { id: 1, kind: "system", text: "Ravi joined the room" },
    {
      id: 2,
      kind: "text",
      dir: "in",
      from: "Ravi",
      color: "#34c759",
      initials: "R",
      text: "Hey! Did you see the new designs?",
      time: "10:30",
      grouped: false,
    },
    {
      id: 3,
      kind: "text",
      dir: "in",
      from: "Ravi",
      color: "#34c759",
      initials: "R",
      text: "anyone free for lunch?",
      time: "10:42",
      grouped: true,
    },
    {
      id: 4,
      kind: "text",
      dir: "out",
      text: "Yes! They look great 🔥",
      time: "10:33",
      ticks: "read",
      reactions: [{ emoji: "👍", count: 2, mine: true }],
    },
    {
      id: 5,
      kind: "image",
      dir: "out",
      time: "10:34",
      ticks: "read",
      imageUrl:
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='160'><rect width='100%25' height='100%25' fill='%235856d6'/><text x='50%25' y='50%25' fill='white' font-size='16' text-anchor='middle' dy='.3em'>preview.png</text></svg>",
    },
    {
      id: 6,
      kind: "text",
      dir: "in",
      from: "Priya",
      color: "#ff9f0a",
      initials: "P",
      text: "Count me in!",
      time: "10:40",
      replyTo: { from: "Ravi", text: "anyone free for lunch?" },
    },
  ],
  "user-priya": [
    {
      id: 101,
      kind: "text",
      dir: "out",
      text: "Hey, are we still on for lunch tomorrow?",
      time: "09:10",
      ticks: "read",
    },
    {
      id: 102,
      kind: "text",
      dir: "in",
      from: "Priya",
      color: "#ff9f0a",
      initials: "P",
      text: "sounds good, see you then!",
      time: "09:15",
    },
  ],
  "room-design": [
    {
      id: 201,
      kind: "text",
      dir: "in",
      from: "Sam",
      color: "#ff375f",
      initials: "S",
      text: "How's the new mockup coming along?",
      time: "Yesterday",
      grouped: false,
    },
    {
      id: 202,
      kind: "text",
      dir: "out",
      text: "pushed the new mockups",
      time: "Yesterday",
      ticks: "read",
    },
  ],
  "user-ravi": [
    {
      id: 301,
      kind: "text",
      dir: "in",
      from: "Ravi",
      color: "#34c759",
      initials: "R",
      text: "anyone free for lunch?",
      time: "10:42",
    },
  ],
  "user-sam": [
    {
      id: 401,
      kind: "text",
      dir: "in",
      from: "Sam",
      color: "#ff375f",
      initials: "S",
      text: "How's the new mockup coming along?",
      time: "Yesterday",
    },
  ],
};

export const emojiGroups = [
  { label: "Smileys", emoji: ["😀", "😂", "🥰", "😎", "🤔", "😴", "😢", "😡", "🥳", "😮", "🙌", "🔥", "👍", "❤️", "😭", "😅", "🤩", "😇"] },
  { label: "Objects", emoji: ["📱", "💻", "🎧", "📷", "🎮", "⌚", "💡", "🔑", "📚", "🎁", "✈️", "🚗", "⚽", "🎨", "🎵", "☕", "🍕", "🍔"] },
];

// Plain-text names so the emoji search box can actually match something —
// the raw unicode characters alone aren't searchable by typed keywords.
export const emojiKeywords = {
  "😀": "grinning happy smile",
  "😂": "laughing tears joy lol",
  "🥰": "love hearts adoring",
  "😎": "cool sunglasses",
  "🤔": "thinking hmm",
  "😴": "sleepy tired sleeping",
  "😢": "sad crying",
  "😡": "angry mad rage",
  "🥳": "party celebrate birthday",
  "😮": "surprised wow shocked",
  "🙌": "praise hands celebrate",
  "🔥": "fire lit hot",
  "👍": "thumbs up like good",
  "❤️": "heart love",
  "😭": "sobbing crying sad",
  "😅": "sweat nervous laugh relief",
  "🤩": "starstruck excited amazed",
  "😇": "angel innocent halo",
  "📱": "phone mobile",
  "💻": "laptop computer",
  "🎧": "headphones music",
  "📷": "camera photo",
  "🎮": "game controller gaming",
  "⌚": "watch time",
  "💡": "idea lightbulb",
  "🔑": "key unlock",
  "📚": "books study",
  "🎁": "gift present",
  "✈️": "plane travel flight",
  "🚗": "car drive",
  "⚽": "soccer football ball",
  "🎨": "art palette paint",
  "🎵": "music note",
  "☕": "coffee drink",
  "🍕": "pizza food",
  "🍔": "burger food",
};

export const gifResults = Array.from({ length: 6 }, (_, i) => ({
  id: `gif-${i}`,
  url: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'><rect width='100%25' height='100%25' fill='%23${["e8e7fb", "8482e0", "5856d6", "423fc4", "7a78e0", "6e6e73"][i]}'/></svg>`,
}));

export const stickerResults = Array.from({ length: 6 }, (_, i) => ({
  id: `sticker-${i}`,
  url: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'><rect width='100%25' height='100%25' fill='%23${["ffd60a", "ff9f0a", "ff375f", "34c759", "5ac8fa", "af52de"][i]}'/></svg>`,
}));

export const statusPresets = ["Available", "Busy", "In a meeting", "Away", "Do not disturb"];

export const quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
