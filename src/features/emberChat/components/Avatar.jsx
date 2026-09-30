import { useState } from "react";
import { sandeshApi } from "../../../services/sandeshApi.js";

export default function Avatar({
  initials = "",
  color,
  imageUrl,
  group,
  size = 40,
  className = "",
}) {
  const [imgError, setImgError] = useState(false);
  const pixelSize = typeof size === "number" ? `${size}px` : size;
  const cleanInitials = typeof initials === "string" ? initials.slice(0, 2).toUpperCase() : "";

  const resolvedUrl = imageUrl && !imgError
    ? (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")
      ? imageUrl
      : `${sandeshApi.getServerOrigin()}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`)
    : null;

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
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt={cleanInitials || "DP"}
          loading="lazy"
          onError={() => setImgError(true)}
          style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
        />
      ) : (
        <span className="dp-initials">{cleanInitials || "•"}</span>
      )}
    </div>
  );
}
