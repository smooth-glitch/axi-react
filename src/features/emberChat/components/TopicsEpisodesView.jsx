import { useEffect, useState } from "react";
import { sampleEpisodes } from "../data/sampleData.js";

export default function TopicsEpisodesView({ chat, onSelectTopic, onNewEpisode }) {
  const [filter, setFilter] = useState("all"); // "all" | "active" | "approved"
  const [searchQuery, setSearchQuery] = useState("");
  const [episodes, setEpisodes] = useState(sampleEpisodes);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicSummary, setNewTopicSummary] = useState("");
  const [newTopicStatus, setNewTopicStatus] = useState("Active");

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && showNewModal) {
        setShowNewModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showNewModal]);

  const chatEpisodes = episodes.filter(
    (ep) =>
      ep.chatId === chat.id ||
      ep.chatId === "room-general" ||
      chat.id === "workspace" ||
      ep.chatId === "workspace"
  );

  const filteredEpisodes = chatEpisodes.filter((ep) => {
    // Filter by tab
    if (filter === "active") {
      const s = (ep.status || "").toLowerCase();
      if (s !== "active" && s !== "in progress") return false;
    } else if (filter === "approved") {
      const s = (ep.status || "").toLowerCase();
      if (s !== "approved" && s !== "verified" && s !== "resolved") return false;
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (ep.title || "").toLowerCase().includes(q);
      const matchSummary = (ep.summary || "").toLowerCase().includes(q);
      const matchMsg = (ep.lastMsg || "").toLowerCase().includes(q);
      if (!matchTitle && !matchSummary && !matchMsg) return false;
    }

    return true;
  });

  const handleCreateTopic = (e) => {
    e.preventDefault();
    if (!newTopicTitle.trim()) return;
    const newEp = {
      id: "ep-" + Date.now(),
      chatId: chat.id,
      title: newTopicTitle.trim(),
      status: newTopicStatus || "Active",
      date: "Just now",
      summary: newTopicSummary.trim() || "New workflow episode started by you",
      lastMsg: "Discussion started.",
    };
    setEpisodes([newEp, ...episodes]);
    setShowNewModal(false);
    setNewTopicTitle("");
    setNewTopicSummary("");
    setNewTopicStatus("Active");
    onNewEpisode?.(newEp);
  };

  return (
    <div className="sandesh-episodes-container">
      {/* View Header with Filters */}
      <div className="episodes-toolbar">
        <div className="toolbar-left">
          <div className="topic-header-badge">
            <span className="material-icons">topic</span>
          </div>
          <div>
            <div className="toolbar-title-wrap">
              <h4>Topics &amp; Episodes</h4>
              <span className="toolbar-chat-tag">{chat.name}</span>
            </div>
            <span className="sub">Structured conversation threads &amp; workflow episodes</span>
          </div>
        </div>

        <div className="toolbar-right">
          {/* Search box */}
          <div className="topic-search-glass">
            <span className="material-icons">search</span>
            <input
              type="text"
              placeholder="Search topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="topic-search-clear-btn"
                onClick={() => setSearchQuery("")}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Filter Chips */}
          <div className="filter-chips-3d">
            <button
              type="button"
              className={`chip ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All ({chatEpisodes.length})
            </button>
            <button
              type="button"
              className={`chip ${filter === "active" ? "active" : ""}`}
              onClick={() => setFilter("active")}
            >
              In Progress
            </button>
            <button
              type="button"
              className={`chip ${filter === "approved" ? "active" : ""}`}
              onClick={() => setFilter("approved")}
            >
              Resolved
            </button>
          </div>

          {/* Start Topic Action */}
          <button
            type="button"
            className="sandesh-btn-primary-3d btn-start-topic"
            onClick={() => setShowNewModal(true)}
          >
            <span className="material-icons" style={{ fontSize: 16 }}>add_circle_outline</span>
            <span>Start Topic</span>
          </button>
        </div>
      </div>

      {/* Episode Cards Grid */}
      <div className="episodes-grid">
        {filteredEpisodes.length === 0 ? (
          <div className="empty-episodes-card">
            <div className="empty-episodes-icon-wrap">
              <span className="material-icons">topic</span>
            </div>
            <h5>No Topics Found</h5>
            <p>
              {searchQuery
                ? `No episodes match "${searchQuery}" for the selected filter.`
                : `There are no episodes matching this filter in ${chat.name}. Start a new topic to organize workflows.`}
            </p>
            <div className="empty-episodes-actions">
              {searchQuery && (
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  onClick={() => setSearchQuery("")}
                >
                  Clear Search
                </button>
              )}
              <button
                type="button"
                className="sandesh-btn-primary-3d"
                onClick={() => setShowNewModal(true)}
              >
                <span className="material-icons" style={{ fontSize: 16 }}>add</span>
                <span>Create New Topic</span>
              </button>
            </div>
          </div>
        ) : (
          filteredEpisodes.map((ep) => (
            <div key={ep.id} className="sandesh-glass-card episode-card">
              <div className="episode-card-header">
                <span className={`status-pill status-${(ep.status || "active").toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="status-pill-dot" />
                  {ep.status}
                </span>
                <span className="episode-date">
                  <span className="material-icons date-icon">schedule</span>
                  {ep.date}
                </span>
              </div>
              <h5 className="episode-title">{ep.title}</h5>
              <p className="episode-summary">{ep.summary}</p>
              <div className="episode-footer">
                <span className="last-msg-preview" title={ep.lastMsg}>
                  <span className="material-icons chat-icon">chat_bubble_outline</span>
                  <span>{ep.lastMsg}</span>
                </span>
                <button
                  type="button"
                  className="episode-action-btn"
                  onClick={() => onSelectTopic(ep)}
                >
                  <span>Open Topic</span>
                  <span className="material-icons" style={{ fontSize: 14 }}>arrow_forward</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal to create a new topic */}
      {showNewModal && (
        <div className="new-topic-modal-overlay" onClick={() => setShowNewModal(false)}>
          <div
            className="sandesh-modal-card-3d new-topic-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sandesh-modal-header">
              <div className="modal-title-with-icon">
                <div className="topic-header-badge modal-badge">
                  <span className="material-icons">add_chart</span>
                </div>
                <div>
                  <h4>Start New Discussion Topic / Episode</h4>
                  <span className="modal-subtitle">Organize conversations into trackable project workflows</span>
                </div>
              </div>
              <button
                type="button"
                className="close-btn-3d"
                onClick={() => setShowNewModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateTopic} className="sandesh-modal-body">
              <div className="sandesh-input-group">
                <label>Topic Title <span style={{ color: "#ef4444" }}>*</span></label>
                <div className="sandesh-input-box-3d">
                  <input
                    type="text"
                    placeholder="e.g. Q3 Vendor Renewal, Cloud Infrastructure Migration"
                    value={newTopicTitle}
                    onChange={(e) => setNewTopicTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Workflow Status</label>
                <div className="sandesh-input-box-3d select-box">
                  <select
                    value={newTopicStatus}
                    onChange={(e) => setNewTopicStatus(e.target.value)}
                  >
                    <option value="Active">Active (In Progress)</option>
                    <option value="In Progress">Under Review</option>
                    <option value="Approved">Approved / Ready</option>
                  </select>
                </div>
              </div>
              <div className="sandesh-input-group">
                <label>Summary / Objective</label>
                <div className="sandesh-input-box-3d" style={{ height: "auto", minHeight: "72px", padding: "8px 12px" }}>
                  <textarea
                    placeholder="Provide context or key goals for participants in this episode..."
                    value={newTopicSummary}
                    onChange={(e) => setNewTopicSummary(e.target.value)}
                    rows={3}
                    style={{
                      width: "100%",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      resize: "none",
                      fontSize: "12.5px",
                      color: "#1e293b",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>
              <div className="sandesh-modal-actions" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="sandesh-btn-secondary-3d"
                  onClick={() => setShowNewModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="sandesh-btn-primary-3d">
                  Create Topic
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
