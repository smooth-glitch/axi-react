// Sandesh Enterprise Data & Sample Content
// Matches Sandesh and AxpertChat specifications:
// - Multi-category users (Employees, Affiliates, Doctors, Patients)
// - Preconfigured AI Hosts + Department Hosts
// - Smart Prompts & Topics/Episodes for enterprise workflows
// - Admin configuration (Branches, Departments, Designations)

export const me = {
  name: "Arjun S.",
  username: "arjun",
  role: "Enterprise Administrator",
  org: "Agile Labs Enterprise",
  category: "employee",
  branch: "Bangalore HQ",
  department: "Product Architecture",
  designation: "Chief Enterprise Architect",
  status: "Available",
  initials: "AS",
  color: "#ff7a59",
  isAdmin: true,
};

export const chats = [
  {
    id: "room-general",
    name: "General Broadcast",
    isGroup: true,
    category: "channel",
    preview: "Ravi: anyone free for lunch?",
    time: "10:42",
    unread: 2,
    topic: "Lunch & Team Catchup",
  },
  {
    id: "user-priya",
    name: "Priya Sharma",
    isGroup: false,
    category: "associate",
    designation: "HR Manager (Host)",
    preview: "Your leave request for next Friday has been approved.",
    time: "09:15",
    unread: 1,
    topic: "Leave Approval",
  },
  {
    id: "room-design",
    name: "Design & UX Guild",
    isGroup: true,
    category: "channel",
    preview: "You: Pushed the new 3D glassmorphic mockups",
    time: "Yesterday",
    unread: 0,
    topic: "Sandesh 3D UI",
  },
  {
    id: "user-ravi",
    name: "Ravi Kumar",
    isGroup: false,
    category: "associate",
    designation: "Lead Systems Engineer",
    preview: "Backend WebSocket test passed on port 8080.",
    time: "10:42",
    unread: 0,
    topic: "Erlang Node Sync",
  },
  {
    id: "user-sam",
    name: "Sam Wilson",
    isGroup: false,
    category: "associate",
    designation: "Affiliate SPOC • Transperfect",
    preview: "Submitted the revised quotation document.",
    time: "Yesterday",
    unread: 0,
    topic: "Partner Engagement",
  },
  // Department Hosts (per docx specification)
  {
    id: "host-hr",
    name: "HR Operations Desk",
    isGroup: false,
    isHost: true,
    category: "department_host",
    designation: "Central HR & People Ops",
    preview: "Smart prompt available: Request Leave, Payslip, Grievance",
    time: "Yesterday",
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
    preview: "Statement generated for Q3 reimbursements.",
    time: "Sep 21",
    unread: 0,
    topic: "Expense Claim",
  },
  // AI & Preconfigured Hosts (per chat_hosts.erl and AxpertChat spec)
  {
    id: "host-workspace",
    name: "My Workspace (Axpert)",
    isGroup: false,
    isHost: true,
    category: "ai_host",
    designation: "Core Application Assistant",
    preview: "Ready to execute tstruct tasks, smart views, and forms.",
    time: "Just now",
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
    time: "2d ago",
    unread: 0,
    topic: "AI Inquiry",
  },
];

export const onlineUsers = [
  { id: "priya", name: "Priya Sharma", initials: "PS", color: "#ff9f0a", status: "HR Host • Available", designation: "HR Manager" },
  { id: "ravi", name: "Ravi Kumar", initials: "RK", color: "#34c759", status: "In Engineering Review", designation: "Lead Systems Engineer" },
  { id: "sam", name: "Sam Wilson", initials: "SW", color: "#ff375f", status: "Affiliate Partner", designation: "Transperfect SPOC" },
  { id: "dr-ananya", name: "Dr. Ananya Roy", initials: "AR", color: "#5ac8fa", status: "Consultant Physician", designation: "Chief Medical Officer" },
];

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

export const sampleEpisodes = [
  {
    id: "ep-1",
    chatId: "user-priya",
    title: "Casual Leave Application (Q3)",
    status: "Approved",
    date: "Sep 22, 2026",
    summary: "Leave requested for Oct 2 - Oct 4. Approved by Priya Sharma (HR Host).",
    lastMsg: "Your leave request for next Friday has been approved.",
  },
  {
    id: "ep-2",
    chatId: "room-general",
    title: "Quarterly Team Catchup & Lunch",
    status: "Active",
    date: "Today, 10:42",
    summary: "Coordination for team lunch and design review showcase.",
    lastMsg: "Priya: Count me in!",
  },
  {
    id: "ep-3",
    chatId: "room-design",
    title: "Sandesh 3D Glassmorphic Interface Revamp",
    status: "In Progress",
    date: "Sep 23, 2026",
    summary: "Implementing realistic 3D glassmorphic theme with polished peach ambient surround.",
    lastMsg: "Pushed the new 3D glassmorphic mockups",
  },
  {
    id: "ep-4",
    chatId: "user-ravi",
    title: "Erlang Chat Backend WebSocket Handshake",
    status: "Verified",
    date: "Today, 10:30",
    summary: "Real-time protocol verified against axi-chat-backend running on 8080.",
    lastMsg: "Backend WebSocket test passed on port 8080.",
  },
];

export const messagesByChat = {
  "room-general": [
    { id: 1, kind: "system", text: "Ravi Kumar joined the Sandesh room" },
    {
      id: 2,
      kind: "text",
      dir: "in",
      from: "Ravi",
      color: "#34c759",
      initials: "R",
      text: "Hey! Did you see the new 3D glassmorphism designs for Sandesh?",
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
      text: "anyone free for lunch to discuss the deployment?",
      time: "10:42",
      grouped: true,
    },
    {
      id: 4,
      kind: "text",
      dir: "out",
      text: "Yes! The realistic 3D peach surrounding looks stunning 🔥",
      time: "10:33",
      ticks: "read",
      reactions: [{ emoji: "🔥", count: 2, mine: true }],
    },
    {
      id: 5,
      kind: "image",
      dir: "out",
      time: "10:34",
      ticks: "read",
      imageUrl:
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200' viewBox='0 0 360 200'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' stop-color='%23ff9472'/><stop offset='100%25' stop-color='%23f2709c'/></linearGradient></defs><rect width='100%25' height='100%25' fill='url(%23g)' rx='16'/><circle cx='180' cy='85' r='38' fill='rgba(255,255,255,0.22)'/><text x='180' y='92' fill='white' font-size='22' font-family='sans-serif' font-weight='bold' text-anchor='middle'>3D Sandesh UI</text><text x='180' y='145' fill='rgba(255,255,255,0.92)' font-size='13' font-family='sans-serif' text-anchor='middle'>Polished Peach Glassmorphism</text></svg>",
    },
    {
      id: 6,
      kind: "text",
      dir: "in",
      from: "Priya",
      color: "#ff9f0a",
      initials: "P",
      replyTo: { from: "Ravi", text: "anyone free for lunch to discuss the deployment?" },
      text: "Count me in! Let's check out the cafeteria at 1.",
      time: "10:43",
      grouped: false,
    },
  ],
  "user-priya": [
    {
      id: 101,
      kind: "card",
      dir: "out",
      time: "09:00",
      ticks: "read",
      title: "Leave Request Submitted",
      details: {
        Type: "Casual Leave",
        Dates: "Oct 02 - Oct 04 (3 Days)",
        Reason: "Attending Enterprise Architecture Conference",
        Status: "Pending Host Approval",
      },
    },
    {
      id: 102,
      kind: "text",
      dir: "in",
      from: "Priya Sharma",
      color: "#ff9f0a",
      initials: "PS",
      text: "Hi Arjun, I have reviewed your conference leave request.",
      time: "09:14",
    },
    {
      id: 103,
      kind: "card",
      dir: "in",
      from: "Priya Sharma",
      time: "09:15",
      color: "#ff9f0a",
      title: "Host Approval Action: Granted",
      actionStatus: "Approved",
      details: {
        Approver: "Priya Sharma (HR Operations SPOC)",
        Decision: "Approved with standard TA/DA allowance",
        Reference: "HR-LR-2026-8941",
      },
    },
    {
      id: 104,
      kind: "text",
      dir: "in",
      from: "Priya Sharma",
      color: "#ff9f0a",
      initials: "PS",
      text: "Your leave request for next Friday has been approved.",
      time: "09:15",
    },
  ],
  "room-design": [
    {
      id: 201,
      kind: "text",
      dir: "out",
      text: "Pushed the new 3D glassmorphic mockups with polished peach surroundings.",
      time: "Yesterday",
      ticks: "read",
    },
    {
      id: 202,
      kind: "text",
      dir: "in",
      from: "Sam",
      color: "#ff375f",
      initials: "S",
      text: "The frosted peach reflection and elevation look ultra-premium! Truly enterprise grade.",
      time: "Yesterday",
    },
  ],
  "user-ravi": [
    {
      id: 301,
      kind: "text",
      dir: "out",
      text: "Hey Ravi, how is the Erlang socket connection testing on port 8080?",
      time: "10:25",
      ticks: "read",
    },
    {
      id: 302,
      kind: "text",
      dir: "in",
      from: "Ravi Kumar",
      color: "#34c759",
      initials: "RK",
      text: "Backend WebSocket test passed on port 8080. Real-time handshake, DM routing, and presence are all green.",
      time: "10:42",
      reactions: [{ emoji: "🚀", count: 1, mine: true }],
    },
  ],
  "user-sam": [
    {
      id: 401,
      kind: "text",
      dir: "in",
      from: "Sam Wilson",
      color: "#ff375f",
      initials: "SW",
      text: "Submitted the revised quotation document for the partner integration contract.",
      time: "Yesterday",
    },
  ],
  "host-hr": [
    {
      id: 501,
      kind: "system",
      text: "Connected to Sandesh HR Operations Desk (SPOC Host)",
    },
    {
      id: 502,
      kind: "text",
      dir: "in",
      from: "HR Operations",
      color: "#ff9472",
      initials: "HR",
      text: "Welcome to Sandesh Employee Self-Service. You can select any Smart Prompt below to initiate instant HR requests or view policies.",
      time: "09:00",
    },
  ],
  "host-finance": [
    {
      id: 601,
      kind: "system",
      text: "Connected to Corporate Finance & Accounts Host",
    },
    {
      id: 602,
      kind: "card",
      dir: "in",
      from: "Finance Desk",
      time: "Sep 21",
      color: "#34c759",
      title: "Q3 Reimbursement Summary",
      details: {
        "Total Filed": "$1,420.00",
        "Approved & Paid": "$1,420.00",
        "Pending Claims": "$0.00",
      },
    },
  ],
  "host-workspace": [
    {
      id: 701,
      kind: "system",
      text: "Connected to Axpert Workspace Smart Host",
    },
    {
      id: 702,
      kind: "text",
      dir: "in",
      from: "Workspace",
      color: "#5856d6",
      initials: "WS",
      text: "You have 3 active tasks assigned today in the ERP demo project. Click 'Smart Prompts' above to interact with Axpert tstructs and smart views.",
      time: "Just now",
    },
  ],
  "host-openai": [
    {
      id: 801,
      kind: "system",
      text: "Connected to OpenAI Host via Sandesh AI Router",
    },
    {
      id: 802,
      kind: "text",
      dir: "in",
      from: "GPT-4o",
      color: "#10a37f",
      initials: "AI",
      text: "Hello Arjun! I am connected through your Sandesh enterprise platform. How can I assist with your system architecture or queries today?",
      time: "2d ago",
    },
  ],
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
    { id: "u1", name: "Arjun S.", username: "arjun", email: "arjun@agilelabs.com", mobile: "+91 98860 12345", category: "employee", branch: "Bangalore HQ", department: "Engineering & Architecture", designation: "Chief Enterprise Architect", isHost: true, hostFor: "All Employees", active: true },
    { id: "u2", name: "Priya Sharma", username: "priya", email: "priya.s@agilelabs.com", mobile: "+91 98860 23456", category: "employee", branch: "Bangalore HQ", department: "Human Resources", designation: "HR Operations Host (SPOC)", isHost: true, hostFor: "Selected Branch", active: true },
    { id: "u3", name: "Ravi Kumar", username: "ravi", email: "ravi.k@agilelabs.com", mobile: "+91 98860 34567", category: "employee", branch: "Bangalore HQ", department: "Engineering & Architecture", designation: "Lead Systems Engineer", isHost: false, hostUser: "Arjun S.", active: true },
    { id: "u4", name: "Sam Wilson", username: "sam", email: "sam.w@transperfect.com", mobile: "+1 415 555 0192", category: "affiliate", org: "Transperfect", branch: "US West", department: "Partner & Vendor Relations", designation: "Affiliate Representative", isHost: false, hostUser: "Arjun S.", active: true },
  ],
  affiliates: [
    { id: "af1", name: "Transperfect", category: "Partner / Vendor", location: "San Francisco, USA", branches: ["US West", "UK London"], hostUser: "Arjun S.", userCount: 4 },
    { id: "af2", name: "Spectre Systems", category: "Vendor", location: "Bangalore, India", branches: ["Main Facility"], hostUser: "Priya Sharma", userCount: 2 },
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

