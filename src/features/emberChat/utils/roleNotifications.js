/**
 * Role-Based Priority Notifications Generator
 * 
 * Generates and synchronizes notifications categorized strictly by priority color codes:
 *   - High Priority = Red (#ef4444)
 *   - Medium Priority = Yellow (#f59e0b)
 *   - Low Priority = Grey (#64748b)
 *   - Resolved = Green (#10b981)
 */
export function buildInitialRoleNotifications(currentUser, approvals = [], serverNotifs = []) {
  const role = (currentUser?.role || "User").toLowerCase();
  const isAdmin = currentUser?.isAdmin || role === "admin";
  const category = (currentUser?.category || "employee").toLowerCase();

  const list = [];

  // 1. Backend Approvals (for Admin or Department Hosts)
  if (approvals && approvals.length > 0) {
    approvals.forEach((req) => {
      const isPending = req.status === "pending";
      list.push({
        id: `appr-${req.id}`,
        priority: isPending ? "high" : "resolved",
        category: "approvals",
        title: req.title || `Access Request: @${req.name || req.username}`,
        message:
          req.details ||
          `${req.name || req.username} requested ${req.type} access. Immediate approval needed.`,
        time: req.time || "Recently",
        icon: isPending ? "how_to_reg" : "verified_user",
        read: !isPending,
        actionType: "approvals",
        actionLabel: isPending ? "Review Approval" : "View Record",
        data: req,
      });
    });
  }

  // 2. Server notifications from WebSocket / push
  if (serverNotifs && serverNotifs.length > 0) {
    serverNotifs.forEach((sn) => {
      let priority = "low";
      if (sn.priority) {
        priority = sn.priority.toLowerCase();
      } else if (
        sn.category === "approvals" ||
        sn.title?.toLowerCase().includes("urgent") ||
        sn.title?.toLowerCase().includes("critical")
      ) {
        priority = "high";
      } else if (
        sn.category === "reminders" ||
        sn.title?.toLowerCase().includes("pending") ||
        sn.title?.toLowerCase().includes("schedule")
      ) {
        priority = "medium";
      }

      list.push({
        id: `srv-${sn.id || Math.random()}`,
        priority,
        category: sn.category || "system",
        title: sn.title || "System Notice",
        message: sn.text || sn.message || "",
        time: sn.time || "Just now",
        icon:
          sn.icon ||
          (priority === "high"
            ? "error_outline"
            : priority === "medium"
            ? "warning_amber"
            : "info"),
        read: !!sn.read,
        data: sn,
      });
    });
  }

  // 3. Role-specific preset notifications based on user role & category
  if (isAdmin) {
    list.push(
      {
        id: "notif-adm-high-1",
        priority: "high",
        category: "security",
        title: "2FA Policy Compliance Audit",
        message: "3 administrative accounts require Two-Factor Authentication activation before next billing cycle.",
        time: "15m ago",
        icon: "security",
        read: false,
        actionType: "admin_console",
        actionLabel: "Security Setup",
      },
      {
        id: "notif-adm-high-2",
        priority: "high",
        category: "system",
        title: "Erlang Node Live Sync Verification",
        message: "Erlang OTP backend active on ws://localhost:8080. Live socket sync enabled.",
        time: "25m ago",
        icon: "sync_alt",
        read: false,
        actionType: "system_status",
        actionLabel: "Check Status",
      },
      {
        id: "notif-adm-med-1",
        priority: "medium",
        category: "operations",
        title: "Department Quota Utilization",
        message: "Engineering & Architecture department reached 85% of assigned data bin quota.",
        time: "1h ago",
        icon: "storage",
        read: false,
        actionType: "admin_console",
        actionLabel: "Inspect Quotas",
      },
      {
        id: "notif-adm-med-2",
        priority: "medium",
        category: "system",
        title: "Scheduled Database Backup",
        message: "Nightly automated snapshot scheduled for 02:00 UTC. No downtime expected.",
        time: "2h ago",
        icon: "backup",
        read: true,
        actionType: "backup_view",
        actionLabel: "View Schedule",
      },
      {
        id: "notif-adm-low-1",
        priority: "low",
        category: "broadcast",
        title: "Enterprise Broadcast Channel Active",
        message: "Broadcast channel #room-general has active streams and all hosts initialized.",
        time: "3h ago",
        icon: "campaign",
        read: true,
        actionType: "open_chat",
        actionLabel: "Open Channel",
        chatId: "room-general",
      },
      {
        id: "notif-adm-res-1",
        priority: "resolved",
        category: "approvals",
        title: "User Role Assignment Completed",
        message: "Senior Solutions Consultant role permissions synchronized across all branches.",
        time: "Yesterday",
        icon: "check_circle",
        read: true,
        actionType: "admin_console",
        actionLabel: "Audit Log",
      },
      {
        id: "notif-adm-res-2",
        priority: "resolved",
        category: "security",
        title: "SSL / TLS Certificate Renewed",
        message: "Enterprise SSL certificates successfully validated with 365 days validity.",
        time: "2 days ago",
        icon: "verified",
        read: true,
      }
    );
  } else if (category === "healthcare") {
    list.push(
      {
        id: "notif-hc-high-1",
        priority: "high",
        category: "vitals",
        title: "Critical Vitals Alert - Bed #04",
        message: "Patient BP elevated (158/98 mmHg) and heart rate fluctuating. Attending review requested.",
        time: "10m ago",
        icon: "monitor_heart",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "record_vitals",
        actionLabel: "Record Vitals",
      },
      {
        id: "notif-hc-med-1",
        priority: "medium",
        category: "appointments",
        title: "Upcoming Consultation at 03:30 PM",
        message: "Specialist consultation scheduled with Dr. Arjun in OPD Wing B.",
        time: "45m ago",
        icon: "calendar_month",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "book_appt",
        actionLabel: "View Schedule",
      },
      {
        id: "notif-hc-low-1",
        priority: "low",
        category: "lab",
        title: "Pathology Routine Panel Published",
        message: "Standard metabolic results published for review in medical records.",
        time: "2h ago",
        icon: "biotech",
        read: true,
        actionType: "smart_prompt",
        actionPrompt: "lab_reports",
        actionLabel: "Check Report",
      },
      {
        id: "notif-hc-res-1",
        priority: "resolved",
        category: "pharmacy",
        title: "Prescription Dispensed Successfully",
        message: "Hospital pharmacy issued e-prescription medication batch #RX-9920.",
        time: "Yesterday",
        icon: "medication",
        read: true,
      }
    );
  } else {
    // Default Enterprise Employee
    list.push(
      {
        id: "notif-emp-high-1",
        priority: "high",
        category: "action",
        title: "Project Milestone Sign-off Due",
        message: "Quarterly sprint documentation requires your sign-off before 05:00 PM today.",
        time: "20m ago",
        icon: "assignment_late",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "raise_ticket",
        actionLabel: "Review Task",
      },
      {
        id: "notif-emp-high-2",
        priority: "high",
        category: "attendance",
        title: "Punch-In Checkpoint Reminder",
        message: "Morning attendance checkpoint is pending confirmation for your workstation.",
        time: "35m ago",
        icon: "fingerprint",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "punch_in",
        actionLabel: "Punch In Now",
      },
      {
        id: "notif-emp-med-1",
        priority: "medium",
        category: "payroll",
        title: "Monthly Payslip Generated",
        message: "Your monthly salary statement has been computed and is ready for download.",
        time: "1h ago",
        icon: "receipt_long",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "pay_slip",
        actionLabel: "View Payslip",
      },
      {
        id: "notif-emp-med-2",
        priority: "medium",
        category: "claims",
        title: "Expense Claim #EXP-4109 Under Review",
        message: "Client travel reimbursement claim has been forwarded to Corporate Finance Desk.",
        time: "2h ago",
        icon: "payments",
        read: false,
        actionType: "smart_prompt",
        actionPrompt: "expense_claim",
        actionLabel: "Inspect Claim",
      },
      {
        id: "notif-emp-low-1",
        priority: "low",
        category: "associates",
        title: "New Team Associate Connected",
        message: "Arjun connected with you. You can now exchange direct messages and share notes.",
        time: "4h ago",
        icon: "person_pin",
        read: true,
        actionType: "open_chat",
        actionLabel: "Say Hello",
        chatId: "user-arjun",
      },
      {
        id: "notif-emp-low-2",
        priority: "low",
        category: "system",
        title: "Sandesh Enterprise Version Live",
        message: "Workspace connected to live Erlang backend with real-time WebSocket protocol.",
        time: "Today",
        icon: "info",
        read: true,
      },
      {
        id: "notif-emp-res-1",
        priority: "resolved",
        category: "leave",
        title: "Privilege Leave Approved",
        message: "Your 2-day leave application was approved by Department Head.",
        time: "Yesterday",
        icon: "event_available",
        read: true,
      },
      {
        id: "notif-emp-res-2",
        priority: "resolved",
        category: "support",
        title: "IT Support Ticket #T-882 Resolved",
        message: "VPN connection certificate updated and verified by Enterprise IT team.",
        time: "2 days ago",
        icon: "task_alt",
        read: true,
      }
    );
  }

  return list;
}
