import { useState } from "react";
import { sampleEpisodes } from "../data/sampleData.js";

export default function TopicsEpisodesView({ chat, onSelectTopic, onNewEpisode }) {
  const [filter, setFilter] = useState("all"); // "all" | "active" | "approved" | "pending"
  const [episodes, setEpisodes] = useState(sampleEpisodes);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicSummary, setNewTopicSummary] = useState("");

  const chatEpisodes = episodes.filter((ep) => ep.chatId === chat.id || ep.chatId === "room-general");

  const filteredEpisodes = chatEpisodes.filter((ep) => {
    if (filter === "active") return ep.status.toLowerCase() === "active" || ep.status.toLowerCase() === "in progress";
    if (filter === "approved") return ep.status.toLowerCase() === "approved" || ep.status.toLowerCase() === "verified";
    return true;
  });

  const handleCreateTopic = (e) => {
    e.preventDefault();
    if (!newTopicTitle) return;
    const newEp = {
      id: "ep-" + Date.now(),
      chatId: chat.id,
      title: newTopicTitle,
      status: "Active",
      date: "Just now",
      summary: newTopicSummary || "New topic started by you",
      lastMsg: "Discussion started.",
    };
    setEpisodes([newEp, ...episodes]);
    setShowNewModal(false);
    setNewTopicTitle("");
    setNewTopicSummary("");
    onNewEpisode?.(newEp);
  };

  return (
    <div className="sandesh-episodes-container">
      {/* View Header with Filters */}
      <div className="episodes-toolbar">
        <div className="toolbar-left">
          <span className="material-icons topic-icon">topic</span>
          <div>
            <h4>Topics &amp; Episodes</h4>
            <span className="sub">Structured conversation threads &amp; workflows with {chat.name}</span>
          </div>
        </div>
        <div className="toolbar-right">
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
          <button
            type="button"
            className="sandesh-btn-mini-primary"
            onClick={() => setShowNewModal(true)}
          >
            + Start Topic
          </button>
        </div>
      </div>

      {/* Episode Cards Grid */}
      <div className="episodes-grid">
        {filteredEpisodes.length === 0 ? (
          <div className="empty-episodes-card">
            <span className="material-icons">inventory_2</span>
            <p>No episodes found for this filter in {chat.name}.</p>
            <button
              type="button"
              className="sandesh-btn-primary-3d"
              onClick={() => setShowNewModal(true)}
            >
              Create First Episode
            </button>
          </div>
        ) : (
          filteredEpisodes.map((ep) => (
            <div key={ep.id} className="sandesh-glass-card episode-card">
              <div className="episode-card-header">
                <span className={`status-pill status-${ep.status.toLowerCase().replace(/\s+/g, "-")}`}>
                  {ep.status}
                </span>
                <span className="episode-date">{ep.date}</span>
              </div>
              <h5 className="episode-title">{ep.title}</h5>
              <p className="episode-summary">{ep.summary}</p>
              <div className="episode-footer">
                <span className="last-msg-preview">
                  <span className="material-icons chat-icon">chat_bubble_outline</span>
                  {ep.lastMsg}
                </span>
                <button
                  type="button"
                  className="sandesh-btn-link"
                  onClick={() => onSelectTopic(ep)}
                >
                  View Messages →
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal to create a new topic */}
      {showNewModal && (
        <div className="sandesh-modal-card-3d new-topic-modal">
          <div className="sandesh-modal-header">
            <h4>Start New Discussion Topic / Episode</h4>
            <button type="button" className="close-btn-3d" onClick={() => setShowNewModal(false)}>
              ×
            </button>
          </div>
          <form onSubmit={handleCreateTopic} className="sandesh-modal-body">
            <div className="sandesh-input-group">
              <label>Topic Name</label>
              <div className="sandesh-input-box-3d">
                <input
                  type="text"
                  placeholder="e.g. Q3 Vendor Renewal, License Request"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="sandesh-input-group">
              <label>Summary / Objective</label>
              <div className="sandesh-input-box-3d">
                <input
                  type="text"
                  placeholder="Brief context for participants"
                  value={newTopicSummary}
                  onChange={(e) => setNewTopicSummary(e.target.value)}
                />
              </div>
            </div>
            <div className="sandesh-modal-actions">
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
      )}
    </div>
  );
}
