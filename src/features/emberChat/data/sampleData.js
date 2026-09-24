// Sandesh Enterprise Data & Sample Content
// Matches Sandesh and AxpertChat specifications:
// - Multi-category users (Employees, Affiliates, Doctors, Patients)
// - Preconfigured AI Hosts + Department Hosts
// - Smart Prompts & Topics/Episodes for enterprise workflows
// - Admin configuration (Branches, Departments, Designations)

export const me = {
  name: "Sabarish",
  username: "sabarish",
  role: "Enterprise Administrator",
  org: "Agile Labs Enterprise",
  category: "employee",
  branch: "Bangalore HQ",
  department: "Executive Leadership",
  designation: "Enterprise Administrator",
  status: "Available",
  initials: "SB",
  color: "#ff7a59",
  isAdmin: true,
};

export const authorizedUsers = [
  {
    id: "sabarish",
    name: "Sabarish",
    username: "sabarish",
    role: "Enterprise Administrator",
    org: "Agile Labs Enterprise",
    category: "employee",
    branch: "Bangalore HQ",
    department: "Executive Leadership",
    designation: "Enterprise Administrator",
    status: "Admin • Available",
    initials: "SB",
    color: "#ff7a59",
    isAdmin: true,
    email: "sabarish@agilelabs.com",
    mobile: "+91 98860 11111",
  },
  {
    id: "nageshwari",
    name: "Nageshwari",
    username: "nageshwari",
    role: "HR Operations Host",
    org: "Agile Labs Enterprise",
    category: "employee",
    branch: "Bangalore HQ",
    department: "Human Resources",
    designation: "HR Manager (Host)",
    status: "HR Host • Available",
    initials: "NA",
    color: "#ff9f0a",
    isAdmin: false,
    isHost: true,
    email: "nageshwari@agilelabs.com",
    mobile: "+91 98860 22222",
  },
  {
    id: "gunn",
    name: "Gunn Kataria",
    username: "gunn",
    role: "Lead Systems Engineer",
    org: "Agile Labs Enterprise",
    category: "employee",
    branch: "Bangalore HQ",
    department: "Engineering & Architecture",
    designation: "Lead Systems Engineer",
    status: "Systems Review • Available",
    initials: "GK",
    color: "#34c759",
    isAdmin: false,
    email: "gunn.kataria@agilelabs.com",
    mobile: "+91 98860 33333",
  },
  {
    id: "anish",
    name: "Anish",
    username: "anish",
    role: "Core Platform Engineer",
    org: "Agile Labs Enterprise",
    category: "employee",
    branch: "Bangalore HQ",
    department: "Engineering & Architecture",
    designation: "Software Engineer",
    status: "Coding • Available",
    initials: "AN",
    color: "#007aff",
    isAdmin: false,
    email: "anish@agilelabs.com",
    mobile: "+91 98860 44444",
  },
  {
    id: "arjun",
    name: "Arjun",
    username: "arjun",
    role: "Systems Engineer",
    org: "Agile Labs Enterprise",
    category: "employee",
    branch: "Bangalore HQ",
    department: "Engineering & Architecture",
    designation: "Senior Systems Engineer",
    status: "In Engineering Review",
    initials: "AR",
    color: "#af52de",
    isAdmin: false,
    email: "arjun@agilelabs.com",
    mobile: "+91 98860 55555",
  },
];

export const chats = [
  {
    id: "room-general",
    name: "General Broadcast",
    isGroup: true,
    category: "channel",
    preview: "Channel ready",
    time: "now",
    unread: 0,
    topic: "Enterprise Global Channel",
  },
  // Department Hosts (per specification)
  {
    id: "host-hr",
    name: "HR Operations Desk",
    isGroup: false,
    isHost: true,
    category: "department_host",
    designation: "Central HR & People Ops • Nageshwari",
    preview: "Smart prompt available: Request Leave, Payslip, Grievance",
    time: "now",
    unread: 0,
    topic: "HR Services",
  },
  {
    id: "host-finance",
    name: "Finance & Accounts",
    isGroup: false,
    isHost: true,
    category: "department_host",
    designation: "Corporate Finance Desk",
    preview: "Corporate expense and invoice processing host",
    time: "now",
    unread: 0,
    topic: "Expense Claim",
  },
  // AI & Preconfigured Hosts
  {
    id: "host-workspace",
    name: "My Workspace (Sandesh)",
    isGroup: false,
    isHost: true,
    category: "ai_host",
    designation: "Core Application Assistant",
    preview: "Ready to execute tstruct tasks, smart views, and forms.",
    time: "now",
    unread: 0,
    topic: "Workspace Tasks",
  },
  {
    id: "host-openai",
    name: "OpenAI GPT-4o",
    isGroup: false,
    isHost: true,
    category: "ai_host",
    designation: "Enterprise AI Model",
    preview: "Ask complex analysis, code, or drafting tasks.",
    time: "now",
    unread: 0,
    topic: "AI Inquiry",
  },
];

export const onlineUsers = [];

export const smartPromptsByCategory = {
  employee: [
    { id: "leave_req", label: "Leave Request", icon: "event_note", desc: "Apply for sick or privilege leave" },
    { id: "pay_slip", label: "Get Payslip", icon: "receipt_long", desc: "Download recent payroll statement" },
    { id: "raise_ticket", label: "Raise Ticket", icon: "support_agent", desc: "Submit IT or Admin support issue" },
    { id: "expense_claim", label: "Expense Claim", icon: "payments", desc: "File travel or meal reimbursement" },
    { id: "punch_in", label: "Punch In/Out", icon: "fingerprint", desc: "Log attendance checkpoint" },
  ],
  healthcare: [
    { id: "record_vitals", label: "Record Vitals", icon: "monitor_heart", desc: "Log BP, pulse, temp and SpO2" },
    { id: "book_appt", label: "Book Appointment", icon: "calendar_month", desc: "Schedule doctor consultation" },
    { id: "lab_reports", label: "Lab Reports", icon: "biotech", desc: "View pathology & radiology findings" },
    { id: "prescribe", label: "Prescribe Medication", icon: "medication", desc: "Issue e-prescription to pharmacy" },
  ],
  customer: [
    { id: "view_balance", label: "View Balance", icon: "account_balance_wallet", desc: "Check current ledger balance" },
    { id: "pending_invoices", label: "Pending Invoices", icon: "description", desc: "Review open billing invoices" },
    { id: "my_orders", label: "My Orders", icon: "local_shipping", desc: "Track consignment & order status" },
    { id: "make_payment", label: "Make Payment", icon: "credit_card", desc: "Settle dues via secure gateway" },
  ],
  supplier: [
    { id: "submit_quote", label: "Submit Quote", icon: "request_quote", desc: "Bid on active procurement RFQ" },
    { id: "view_po", label: "View Purchase Orders", icon: "fact_check", desc: "Inspect authorized POs" },
    { id: "dispatch_note", label: "Notify Dispatch", icon: "airport_shuttle", desc: "Send consignment dispatch notice" },
  ],
};

export const sampleEpisodes = [];

export const messagesByChat = {
  "room-general": [],
  "host-hr": [],
  "host-finance": [],
  "host-workspace": [],
  "host-openai": [],
};

// Admin Console Master Data (per Sandesh-f6f6f3.docx specification)
export const initialAdminData = {
  branches: [
    { id: "b1", name: "Bangalore HQ", country: "India", city: "Bangalore", zip: "560001", active: true },
    { id: "b2", name: "Mumbai Financial Center", country: "India", city: "Mumbai", zip: "400051", active: true },
    { id: "b3", name: "London European Hub", country: "United Kingdom", city: "London", zip: "EC2A 4NE", active: true },
  ],
  departments: [
    { id: "d1", name: "Executive Leadership", description: "Corporate board and strategy" },
    { id: "d2", name: "Human Resources", description: "Talent, People Ops, and compliance" },
    { id: "d3", name: "Engineering & Architecture", description: "Core platform and microservices" },
    { id: "d4", name: "Finance & Accounts", description: "Ledgers, invoicing, and audits" },
    { id: "d5", name: "Partner & Vendor Relations", description: "Affiliate SPOC and vendor procurement" },
  ],
  designations: [
    { id: "dg1", name: "Enterprise Administrator", description: "Full privileges over users and rules" },
    { id: "dg2", name: "Chief Enterprise Architect", description: "Systems design and infrastructure" },
    { id: "dg3", name: "HR Operations Host (SPOC)", description: "Employee host and onboarding manager" },
    { id: "dg4", name: "Senior Solutions Consultant", description: "Customer solution architect" },
    { id: "dg5", name: "Affiliate Representative", description: "External partner focal point" },
  ],
  users: [
    { id: "u1", name: "Sabarish", username: "sabarish", email: "sabarish@agilelabs.com", mobile: "+91 98860 11111", category: "employee", branch: "Bangalore HQ", department: "Executive Leadership", designation: "Enterprise Administrator", isHost: true, hostFor: "All Employees", active: true },
    { id: "u2", name: "Nageshwari", username: "nageshwari", email: "nageshwari@agilelabs.com", mobile: "+91 98860 22222", category: "employee", branch: "Bangalore HQ", department: "Human Resources", designation: "HR Manager (Host)", isHost: true, hostFor: "Selected Branch", active: true },
    { id: "u3", name: "Gunn Kataria", username: "gunn", email: "gunn.kataria@agilelabs.com", mobile: "+91 98860 33333", category: "employee", branch: "Bangalore HQ", department: "Engineering & Architecture", designation: "Lead Systems Engineer", isHost: false, hostUser: "Sabarish", active: true },
    { id: "u4", name: "Anish", username: "anish", email: "anish@agilelabs.com", mobile: "+91 98860 44444", category: "employee", branch: "Bangalore HQ", department: "Engineering & Architecture", designation: "Software Engineer", isHost: false, hostUser: "Sabarish", active: true },
    { id: "u5", name: "Arjun", username: "arjun", email: "arjun@agilelabs.com", mobile: "+91 98860 55555", category: "employee", branch: "Bangalore HQ", department: "Engineering & Architecture", designation: "Senior Systems Engineer", isHost: false, hostUser: "Sabarish", active: true },
  ],
  affiliates: [
    { id: "af1", name: "Transperfect", category: "Partner / Vendor", location: "San Francisco, USA", branches: ["US West", "UK London"], hostUser: "Sabarish", userCount: 4 },
    { id: "af2", name: "Spectre Systems", category: "Vendor", location: "Bangalore, India", branches: ["Main Facility"], hostUser: "Nageshwari", userCount: 2 },
  ],
};

// Master preset data for profile & content drawer
export const emojiGroups = [
  { label: "Smileys", emoji: ["😀", "😂", "🥰", "😎", "🤔", "😴", "😢", "😡", "🥳", "😮", "🙌", "🔥", "👍", "❤️", "😭", "😅", "🤩", "😇"] },
  { label: "Objects", emoji: ["📱", "💻", "🎧", "📷", "🎮", "⌚", "💡", "🔑", "📚", "🎁", "✈️", "🚗", "⚽", "🎨", "🎵", "☕", "🍕", "🍔"] },
];

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
  url: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'><rect width='100%25' height='100%25' fill='%23${["e8e7fb", "8482e0", "ff7a59", "ff9472", "7a78e0", "6e6e73"][i]}'/></svg>`,
}));

export const stickerResults = Array.from({ length: 6 }, (_, i) => ({
  id: `sticker-${i}`,
  url: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'><rect width='100%25' height='100%25' fill='%23${["ffd60a", "ff9f0a", "ff375f", "34c759", "5ac8fa", "af52de"][i]}'/></svg>`,
}));

export const statusPresets = ["Available", "Busy", "In a meeting", "Away", "Do not disturb"];

export const quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

