import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";

/**
 * SandeshSelect - A premium custom dropdown component designed for Sandesh.
 * Replaces crude native browser selects with a smooth, glassmorphic, 3D tactile dropdown
 * while maintaining 100% compatibility with React state, native HTML5 form validation,
 * and backend payload expectations.
 */
export default function SandeshSelect({
  label,
  icon: Icon,
  value,
  onChange,
  options = [],
  required = false,
  emptyHint = "None",
  placeholder = "Select…",
  allowEmpty = true,
  disabled = false,
  align = "auto", // "left" | "right" | "auto"
  className = "",
  id,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(align === "right");
  const containerRef = useRef(null);
  const menuRef = useRef(null);

  // Normalize options into { value: string, label: string }
  const normalizedOptions = (Array.isArray(options) ? options : [])
    .map((opt) => {
      if (opt === null || opt === undefined) return null;
      if (typeof opt === "object") {
        const val =
          opt.value !== undefined
            ? opt.value
            : opt.id !== undefined
            ? opt.id
            : opt.name;
        const lbl =
          opt.label !== undefined
            ? opt.label
            : opt.name !== undefined
            ? opt.name
            : String(val);
        return { value: String(val), label: String(lbl) };
      }
      return { value: String(opt), label: String(opt) };
    })
    .filter(Boolean);

  const isEmpty = normalizedOptions.length === 0;
  const isControlDisabled = disabled || isEmpty;

  // Find currently selected option
  const selectedOption = normalizedOptions.find(
    (o) => String(o.value) === String(value)
  );

  // Determine display label
  const displayLabel = selectedOption
    ? selectedOption.label
    : value
    ? String(value)
    : "";

  // Auto-detect horizontal alignment if needed to prevent edge overflow
  useEffect(() => {
    if (!isOpen) return;
    if (align === "right") {
      setAlignRight(true);
      return;
    }
    if (align === "left") {
      setAlignRight(false);
      return;
    }
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      // If container is within 220px of right viewport edge, align menu to right
      if (viewportWidth - rect.left < 220 && rect.right > 200) {
        setAlignRight(true);
      } else {
        setAlignRight(false);
      }
    }
  }, [isOpen, align]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (isControlDisabled) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currIdx = normalizedOptions.findIndex(
          (o) => String(o.value) === String(value)
        );
        const nextIdx =
          currIdx < normalizedOptions.length - 1 ? currIdx + 1 : 0;
        if (normalizedOptions[nextIdx]) {
          onChange(normalizedOptions[nextIdx].value);
        }
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currIdx = normalizedOptions.findIndex(
          (o) => String(o.value) === String(value)
        );
        const prevIdx =
          currIdx > 0 ? currIdx - 1 : normalizedOptions.length - 1;
        if (normalizedOptions[prevIdx]) {
          onChange(normalizedOptions[prevIdx].value);
        }
      }
    } else if (e.key === "Tab") {
      setIsOpen(false);
    }
  };

  const handleSelect = (val) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      className={`sandesh-input-group ${className}`}
      ref={containerRef}
      style={{ position: "relative" }}
    >
      {label && <label htmlFor={id}>{label}</label>}

      {/* Custom styled trigger */}
      <div
        id={id}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-disabled={isControlDisabled}
        tabIndex={isControlDisabled ? -1 : 0}
        className={`sandesh-custom-select-trigger ${isOpen ? "open" : ""} ${
          isControlDisabled ? "disabled" : ""
        }`}
        onClick={() => {
          if (!isControlDisabled) {
            setIsOpen((prev) => !prev);
          }
        }}
        onKeyDown={handleKeyDown}
      >
        {Icon && <Icon size={16} className="sandesh-lucide-icon sandesh-select-icon" />}

        <span
          className={`sandesh-custom-select-label-text ${
            !displayLabel ? "placeholder" : ""
          }`}
        >
          {displayLabel || (isEmpty ? emptyHint || "None" : placeholder || "Select…")}
        </span>

        <ChevronDown
          size={14}
          className={`sandesh-custom-select-chevron ${isOpen ? "open" : ""}`}
        />
      </div>

      {/* Hidden native select for HTML5 form validation & automated DOM access */}
      <select
        tabIndex={-1}
        aria-hidden="true"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={isControlDisabled}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          height: 0,
          width: "100%",
          left: 0,
          bottom: 0,
          margin: 0,
          padding: 0,
          border: "none",
        }}
      >
        <option value="">{isEmpty ? emptyHint || "None" : placeholder || "Select…"}</option>
        {normalizedOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Floating Glassmorphic Dropdown Menu */}
      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          className={`sandesh-custom-select-menu ${
            alignRight ? "align-right" : "align-left"
          }`}
        >
          {allowEmpty && (
            <div
              role="option"
              aria-selected={!value}
              className={`sandesh-custom-select-item placeholder-item ${
                !value ? "selected" : ""
              }`}
              onClick={() => handleSelect("")}
            >
              <span className="sandesh-custom-select-item-text">
                {placeholder || "Select…"}
              </span>
              {!value && (
                <Check size={13} className="sandesh-custom-select-check" />
              )}
            </div>
          )}

          {normalizedOptions.map((o) => {
            const isSelected = String(o.value) === String(value);
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={isSelected}
                className={`sandesh-custom-select-item ${
                  isSelected ? "selected" : ""
                }`}
                onClick={() => handleSelect(o.value)}
              >
                <span className="sandesh-custom-select-item-text">{o.label}</span>
                {isSelected && (
                  <Check size={13} className="sandesh-custom-select-check" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
