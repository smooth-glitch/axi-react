export default function Avatar({ initials, color, imageUrl, group, className = "" }) {
  return (
    <div
      className={`avatar${group ? " group" : ""}${className ? ` ${className}` : ""}`}
      style={{ background: color || "var(--accent)" }}
    >
      {imageUrl ? <img src={imageUrl} alt="" /> : initials}
    </div>
  );
}
