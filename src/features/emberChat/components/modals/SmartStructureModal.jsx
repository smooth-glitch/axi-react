import { useState } from "react";

export default function SmartStructureModal({ prompt, onClose, onSubmit }) {
  const [formData, setFormData] = useState(() => {
    switch (prompt?.id) {
      case "leave_req":
        return { type: "Casual Leave", start: "2026-10-02", end: "2026-10-04", reason: "Enterprise Conference" };
      case "record_vitals":
        return { bp: "120/80", pulse: "74", temp: "98.4", spo2: "99%", remarks: "Normal vitals" };
      case "raise_ticket":
        return { category: "IT Infrastructure", priority: "High", subject: "VPN Access for Remote Team", details: "Need port 8080 whitelisted for Erlang node testing" };
      case "expense_claim":
        return { category: "Travel & Lodging", amount: "350.00", date: "2026-09-20", description: "Client site architecture workshop" };
      case "book_appt":
        return { doctor: "Dr. Ananya Roy (Chief Physician)", date: "2026-09-26", slot: "10:30 AM", reason: "Routine wellness consultation" };
      default:
        return { title: prompt?.label || "General Query", comments: "" };
    }
  });

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    let cardPayload;

    if (prompt.id === "leave_req") {
      cardPayload = {
        kind: "card",
        title: "Leave Application Filed",
        actionStatus: "Pending Host Approval",
        details: {
          "Leave Type": formData.type,
          "Duration": `${formData.start} to ${formData.end}`,
          "Reason": formData.reason,
          "Approver": "Assigned SPOC (HR Host)",
        },
        actions: ["Approve", "Reject"],
      };
    } else if (prompt.id === "record_vitals") {
      cardPayload = {
        kind: "card",
        title: "Patient Vitals Recorded",
        actionStatus: "Recorded",
        details: {
          "Blood Pressure": formData.bp,
          "Pulse": `${formData.pulse} bpm`,
          "Temperature": `${formData.temp} °F`,
          "SpO2": formData.spo2,
          "Notes": formData.remarks,
        },
      };
    } else if (prompt.id === "raise_ticket") {
      cardPayload = {
        kind: "card",
        title: `Support Ticket #${Math.floor(1000 + Math.random() * 9000)} Created`,
        actionStatus: "In Progress",
        details: {
          "Subject": formData.subject,
          "Category": formData.category,
          "Priority": formData.priority,
          "Assigned To": "IT Operations Host",
        },
        actions: ["View Smart View", "Close Ticket"],
      };
    } else if (prompt.id === "expense_claim") {
      cardPayload = {
        kind: "card",
        title: "Reimbursement Claim Submitted",
        actionStatus: "Pending Finance",
        details: {
          "Category": formData.category,
          "Claim Amount": `$${formData.amount}`,
          "Expense Date": formData.date,
          "Description": formData.description,
        },
        actions: ["Approve Claim", "Audit Request"],
      };
    } else if (prompt.id === "book_appt") {
      cardPayload = {
        kind: "card",
        title: "Consultation Appointment Fixed",
        actionStatus: "Confirmed",
        details: {
          "Consultant": formData.doctor,
          "Date & Time": `${formData.date} at ${formData.slot}`,
          "Reason": formData.reason,
        },
        actions: ["Reschedule", "Add to Calendar"],
      };
    } else {
      cardPayload = {
        kind: "card",
        title: prompt.label,
        actionStatus: "Processed",
        details: formData,
      };
    }

    onSubmit(cardPayload);
  };

  return (
    <div className="sandesh-modal-card-3d">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <span className="material-icons modal-header-icon">{prompt.icon || "widgets"}</span>
          <div>
            <h3>{prompt.label}</h3>
            <span className="modal-subtitle">Axpert Smart Structure • Single DC Lite Action</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close modal">
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit} className="sandesh-modal-body">
        {prompt.id === "leave_req" && (
          <>
            <div className="sandesh-input-group">
              <label>Leave Type</label>
              <div className="sandesh-input-box-3d select-box">
                <select value={formData.type} onChange={(e) => handleChange("type", e.target.value)}>
                  <option value="Casual Leave">Casual Leave (CL)</option>
                  <option value="Sick Leave">Sick / Medical Leave (SL)</option>
                  <option value="Privilege Leave">Privilege / Earned Leave (PL)</option>
                  <option value="Compensatory Off">Compensatory Off</option>
                </select>
              </div>
            </div>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Start Date</label>
                <div className="sandesh-input-box-3d">
                  <input type="date" value={formData.start} onChange={(e) => handleChange("start", e.target.value)} required />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>End Date</label>
                <div className="sandesh-input-box-3d">
                  <input type="date" value={formData.end} onChange={(e) => handleChange("end", e.target.value)} required />
                </div>
              </div>
            </div>
            <div className="sandesh-input-group">
              <label>Reason / Handover Notes</label>
              <div className="sandesh-input-box-3d">
                <input type="text" value={formData.reason} onChange={(e) => handleChange("reason", e.target.value)} placeholder="State the reason" required />
              </div>
            </div>
          </>
        )}

        {prompt.id === "record_vitals" && (
          <>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Blood Pressure (mmHg)</label>
                <div className="sandesh-input-box-3d">
                  <input type="text" value={formData.bp} onChange={(e) => handleChange("bp", e.target.value)} placeholder="120/80" required />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Pulse (bpm)</label>
                <div className="sandesh-input-box-3d">
                  <input type="number" value={formData.pulse} onChange={(e) => handleChange("pulse", e.target.value)} placeholder="72" required />
                </div>
              </div>
            </div>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Temperature (°F)</label>
                <div className="sandesh-input-box-3d">
                  <input type="text" value={formData.temp} onChange={(e) => handleChange("temp", e.target.value)} placeholder="98.6" required />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Oxygen Saturation (SpO2)</label>
                <div className="sandesh-input-box-3d">
                  <input type="text" value={formData.spo2} onChange={(e) => handleChange("spo2", e.target.value)} placeholder="99%" required />
                </div>
              </div>
            </div>
          </>
        )}

        {prompt.id === "raise_ticket" && (
          <>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Department Category</label>
                <div className="sandesh-input-box-3d select-box">
                  <select value={formData.category} onChange={(e) => handleChange("category", e.target.value)}>
                    <option value="IT Infrastructure">IT Infrastructure</option>
                    <option value="Software Access">Software &amp; License Access</option>
                    <option value="HR Support">HR &amp; People Operations</option>
                    <option value="Finance & Accounts">Finance &amp; Accounts</option>
                  </select>
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Priority</label>
                <div className="sandesh-input-box-3d select-box">
                  <select value={formData.priority} onChange={(e) => handleChange("priority", e.target.value)}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Critical / Urgent</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="sandesh-input-group">
              <label>Issue Subject</label>
              <div className="sandesh-input-box-3d">
                <input type="text" value={formData.subject} onChange={(e) => handleChange("subject", e.target.value)} placeholder="Brief summary" required />
              </div>
            </div>
            <div className="sandesh-input-group">
              <label>Detailed Description</label>
              <div className="sandesh-input-box-3d">
                <input type="text" value={formData.details} onChange={(e) => handleChange("details", e.target.value)} placeholder="Describe the problem" required />
              </div>
            </div>
          </>
        )}

        {prompt.id === "expense_claim" && (
          <>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Expense Category</label>
                <div className="sandesh-input-box-3d select-box">
                  <select value={formData.category} onChange={(e) => handleChange("category", e.target.value)}>
                    <option value="Travel & Lodging">Travel &amp; Lodging</option>
                    <option value="Client Meals">Client Meals &amp; Entertainment</option>
                    <option value="Training & Certifications">Training &amp; Certification</option>
                    <option value="Office Supplies">Office Supplies &amp; Tech</option>
                  </select>
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Claim Amount ($ USD)</label>
                <div className="sandesh-input-box-3d">
                  <input type="number" step="0.01" value={formData.amount} onChange={(e) => handleChange("amount", e.target.value)} required />
                </div>
              </div>
            </div>
            <div className="sandesh-input-group">
              <label>Expense Date</label>
              <div className="sandesh-input-box-3d">
                <input type="date" value={formData.date} onChange={(e) => handleChange("date", e.target.value)} required />
              </div>
            </div>
            <div className="sandesh-input-group">
              <label>Description / Business Justification</label>
              <div className="sandesh-input-box-3d">
                <input type="text" value={formData.description} onChange={(e) => handleChange("description", e.target.value)} required />
              </div>
            </div>
          </>
        )}

        {prompt.id === "book_appt" && (
          <>
            <div className="sandesh-input-group">
              <label>Consulting Doctor</label>
              <div className="sandesh-input-box-3d select-box">
                <select value={formData.doctor} onChange={(e) => handleChange("doctor", e.target.value)}>
                  <option value="Dr. Ananya Roy (Chief Physician)">Dr. Ananya Roy (Chief Physician)</option>
                  <option value="Dr. Vikram Patel (Cardiology)">Dr. Vikram Patel (Cardiology)</option>
                  <option value="Dr. Meera Sen (Orthopedics)">Dr. Meera Sen (Orthopedics)</option>
                </select>
              </div>
            </div>
            <div className="sandesh-form-row">
              <div className="sandesh-input-group">
                <label>Preferred Date</label>
                <div className="sandesh-input-box-3d">
                  <input type="date" value={formData.date} onChange={(e) => handleChange("date", e.target.value)} required />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Time Slot</label>
                <div className="sandesh-input-box-3d select-box">
                  <select value={formData.slot} onChange={(e) => handleChange("slot", e.target.value)}>
                    <option value="09:30 AM">09:30 AM</option>
                    <option value="10:30 AM">10:30 AM</option>
                    <option value="02:00 PM">02:00 PM</option>
                    <option value="04:30 PM">04:30 PM</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Fallback general form */}
        {!["leave_req", "record_vitals", "raise_ticket", "expense_claim", "book_appt"].includes(prompt.id) && (
          <div className="sandesh-input-group">
            <label>Notes / Context for Prompt</label>
            <div className="sandesh-input-box-3d">
              <input
                type="text"
                placeholder="Enter details..."
                value={formData.comments || ""}
                onChange={(e) => handleChange("comments", e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="sandesh-modal-actions">
          <button type="button" className="sandesh-btn-secondary-3d" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sandesh-btn-primary-3d">
            Post to Host &amp; Queue
          </button>
        </div>
      </form>
    </div>
  );
}
