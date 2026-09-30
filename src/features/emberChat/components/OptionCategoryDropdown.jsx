import { useEffect, useRef, useState } from "react";
import { sandeshSocket } from "../../../services/sandeshSocket.js";

const PAGE_SIZE = 20;

// Dropdown that opens upward from a Smart Prompts pill and lists that category's options
// (options.list with category / q / page / pageSize). The server applies every "Applicable to" rule
// and does the search + paging, so nothing is filtered on the client.
//   anchor: the pill's bounding rect (the dropdown sits just above it, left-aligned)
//   refreshKey: bump it (options_changed) to reload the open list
export default function OptionCategoryDropdown({ category, anchor, refreshKey = 0, onPick, onClose }) {
  const rootRef = useRef(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // close on outside click / Escape / resize (a pill click handles its own toggle)
  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target) || e.target.closest?.("[data-prompt-pill]")) return;
      onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

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

  const width = 340;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));

  return (
    <div
      ref={rootRef}
      className="prompt-dropdown"
      style={{ left, bottom: window.innerHeight - anchor.top + 8, width }}
      role="dialog"
      aria-label={category.label}
    >
      <div className="prompt-dropdown-head">
        <span className="material-icons">{category.icon}</span>
        <strong>
          {category.label} · {total}
        </strong>
        <button type="button" className="prompt-dropdown-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="prompt-dropdown-search">
        <span className="material-icons">search</span>
        <input
          type="text"
          placeholder={`Search ${category.label.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      <div className="prompt-dropdown-list" style={{ opacity: loading && data ? 0.6 : 1 }}>
        {error ? (
          <div className="prompt-dropdown-empty">{error}</div>
        ) : !data ? (
          <div className="prompt-dropdown-empty">Loading…</div>
        ) : options.length === 0 ? (
          <div className="prompt-dropdown-empty">{q ? `No options match “${q}”` : "No options here yet"}</div>
        ) : (
          options.map((o) => (
            <button key={o.id} type="button" className="prompt-dropdown-item" onClick={() => onPick(o)}>
              <span className="material-icons">{category.icon}</span>
              <span>{o.caption}</span>
            </button>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="prompt-dropdown-pager">
          <button type="button" disabled={shownPage <= 1 || loading} onClick={() => setPage(shownPage - 1)}>
            ‹ Prev
          </button>
          <span>
            {shownPage} / {totalPages}
          </span>
          <button type="button" disabled={!data?.hasMore || loading} onClick={() => setPage(shownPage + 1)}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
