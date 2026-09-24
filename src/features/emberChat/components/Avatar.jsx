export default function Avatar({
  initials = "",
  color,
  imageUrl,
  group,
  size = 40,
  className = "",
}) {
  const pixelSize = typeof size === "number" ? `${size}px` : size;
  const cleanInitials = typeof initials === "string" ? initials.slice(0, 2).toUpperCase() : "";

  return (
    <div
      className={`avatar sandesh-whatsapp-dp${group ? " group" : ""}${className ? ` ${className}` : ""}`}
      style={{
        background: color || "var(--sandesh-coral-accent)",
        width: pixelSize,
        height: pixelSize,
        minWidth: pixelSize,
        minHeight: pixelSize,
        maxWidth: pixelSize,
        maxHeight: pixelSize,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
        aspectRatio: "1 / 1",
      }}
      title={cleanInitials}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={cleanInitials || "DP"}
          style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
        />
      ) : (
        <span className="dp-initials">{cleanInitials || "•"}</span>
      )}
    </div>
  );
}
