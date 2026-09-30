import { useEffect, useState } from "react";
import { sandeshSocket } from "../../../../services/sandeshSocket.js";

const PAGE_SIZE = 20;

// One Smart Prompts category (options.list with category / q / page / pageSize). The server applies every
// "Applicable to" rule and does the search + paging, so nothing is filtered on the client.
// refreshKey: bump it (options_changed) to reload the open list.
export default function OptionCategoryModal({ category, refreshKey = 0, onPick, onClose }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // debounce the search box; a new query starts again from page 1
  useEffect(() => {
    const id = setTimeout(() => {
      const next = search.trim();
      setQ((prev) => {
        if (next !== prev) setPage(1);
        return next;
      });
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    sandeshSocket
      .sd("options.list", { category: category.id, q, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setData(res.data);
          setError("");
        } else {
          setError(res.error?.message || "Could not load the options.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the options.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category.id, q, page, refreshKey]);

  const options = data?.options || [];
  const total = data?.total ?? category.count;
  const shownPage = data?.page ?? page; // the server clamps the page: render from its reply
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="sandesh-modal-card-3d sandesh-groups-modal">
      <div className="sandesh-modal-header">
        <div className="modal-title-with-icon">
          <div
            className="new-group-icon-badge"
            style={{ background: "rgba(255, 122, 89, 0.15)", color: "var(--sandesh-coral-accent)" }}
          >
            <span className="material-icons">{category.icon}</span>
          </div>
          <div>
            <h3>
              {category.label} · {total}
            </h3>
            <span className="modal-subtitle">Pick one to open it</span>
          </div>
        </div>
        <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div style={{ padding: "14px 22px 4px 22px" }}>
        <div className="new-group-input-box">
          <span className="material-icons field-icon">search</span>
          <input
            type="text"
            className="new-group-input"
            placeholder={`Search ${category.label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button type="button" className="search-clear-btn" onClick={() => setSearch("")}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="sandesh-modal-body" style={{ maxHeight: "420px", padding: "12px 22px" }}>
        {error ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">error_outline</span>
            <h4>{error}</h4>
          </div>
        ) : !data && loading ? (
          <div className="commands-empty-state">
            <p>Loading…</p>
          </div>
        ) : options.length === 0 ? (
          <div className="commands-empty-state">
            <span className="material-icons empty-icon">search_off</span>
            <h4>{q ? `No options match “${q}”` : "No options here yet"}</h4>
          </div>
        ) : (
          <div className="directory-user-list" style={{ opacity: loading ? 0.6 : 1 }}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="directory-user-card"
                style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                onClick={() => onPick(o)}
              >
                <span className="material-icons" style={{ color: "var(--sandesh-coral-accent)" }}>
                  {category.icon}
                </span>
                <div className="directory-user-info">
                  <span className="directory-user-name">{o.caption}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, padding: "6px 22px 16px" }}>
          <button
            type="button"
            className="sandesh-btn-primary-3d"
            style={{ padding: "4px 12px", fontSize: 12 }}
            disabled={shownPage <= 1 || loading}
            onClick={() => setPage(shownPage - 1)}
          >
            ‹ Prev
          </button>
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {shownPage} / {totalPages}
          </span>
          <button
            type="button"
            className="sandesh-btn-primary-3d"
            style={{ padding: "4px 12px", fontSize: 12 }}
            disabled={!data?.hasMore || loading}
            onClick={() => setPage(shownPage + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
