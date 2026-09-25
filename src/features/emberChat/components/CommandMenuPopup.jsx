import { useEffect, useRef } from "react";
import { COMMAND_CATEGORIES } from "../data/hashCommandsCatalog.js";

export default function CommandMenuPopup({
  mode = "commands", // "commands" | "args"
  commands = [],
  argSuggestions = [],
  selectedIndex = 0,
  onSelectCommand,
  onSelectArg,
  currentCommand = null,
  currentArgSpec = null,
}) {
  const listRef = useRef(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(".cmd-menu-item.active");
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  if (mode === "commands" && commands.length === 0) {
    return (
      <div className="sandesh-cmd-menu-popup">
        <div className="cmd-menu-empty">
          <span className="material-icons" style={{ fontSize: "18px" }}>search_off</span>
          <span>No matching #commands</span>
        </div>
      </div>
    );
  }

  if (mode === "args" && argSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="sandesh-cmd-menu-popup" ref={listRef} role="listbox">
      {/* Header bar indicating command context */}
      <div className="cmd-menu-header">
        {mode === "commands" ? (
          <>
            <span className="material-icons cmd-header-icon">terminal</span>
            <span className="cmd-header-title">Select a #Command</span>
            <span className="cmd-header-hint">Use ↑ ↓ to navigate • Enter to select</span>
          </>
        ) : (
          <>
            <span className="material-icons cmd-header-icon">tune</span>
            <span className="cmd-header-title">
              #{currentCommand?.name} {currentArgSpec ? `<${currentArgSpec.name}>` : ""}
            </span>
            <span className="cmd-header-hint">Pick suggestion or continue typing</span>
          </>
        )}
      </div>

      <div className="cmd-menu-scroll">
        {mode === "commands" ? (
          commands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            const categoryObj = COMMAND_CATEGORIES.find((c) => c.id === cmd.category);
            return (
              <div
                key={cmd.name}
                className={`cmd-menu-item ${isSelected ? "active" : ""} ${!cmd.available ? "unavailable" : ""}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelectCommand?.(cmd)}
              >
                <div className="cmd-item-left">
                  <div className="cmd-item-hash">#</div>
                  <div className="cmd-item-titles">
                    <div className="cmd-name-line">
                      <span className="cmd-primary-name">{cmd.name}</span>
                      {cmd.aliases && cmd.aliases.length > 0 && (
                        <span className="cmd-alias-pill">
                          {cmd.aliases.map((a) => `#${a}`).join(", ")}
                        </span>
                      )}
                      {categoryObj && (
                        <span className="cmd-cat-tag">
                          {categoryObj.label}
                        </span>
                      )}
                    </div>
                    <div className="cmd-summary-line">{cmd.summary}</div>
                  </div>
                </div>

                <div className="cmd-item-right">
                  {cmd.requires && cmd.requires !== "none" ? (
                    <span className={`cmd-lock-badge req-${cmd.requires}`}>
                      {cmd.requires}
                    </span>
                  ) : (
                    <code className="cmd-usage-preview">{cmd.usage}</code>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          argSuggestions.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={item.value || idx}
                className={`cmd-menu-item arg-item ${isSelected ? "active" : ""}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelectArg?.(item)}
              >
                <div className="cmd-item-left">
                  <span className="material-icons arg-type-icon">
                    {currentArgSpec?.type === "user"
                      ? "person"
                      : currentArgSpec?.type === "group"
                      ? "groups"
                      : currentArgSpec?.type === "host"
                      ? "domain"
                      : currentArgSpec?.type === "emoji"
                      ? "mood"
                      : "label"}
                  </span>
                  <div className="arg-text-col">
                    <span className="arg-label-text">{item.label || item.value}</span>
                    {item.hint && <span className="arg-hint-text">{item.hint}</span>}
                  </div>
                </div>
                {item.sub && <span className="arg-sub-note">{item.sub}</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
