import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Barcode/QR field: a text box (still typeable/pasteable) plus a "Scan" button that opens
// the device camera and decodes a code with html5-qrcode.

function ScannerOverlay({ onDetected, onClose }) {
  const domId = `sandesh-barcode-scan-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [error, setError] = useState(null);
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false);
  const tracksRef = useRef([]);

  // Privacy: the camera must be off the moment scanning ends (a code was read, the dialog was
  // closed, or it unmounted). Stop the underlying media tracks directly -- synchronously -- rather
  // than relying only on Html5Qrcode.stop(), which is async and is skipped while start() is pending.
  const releaseCamera = () => {
    try {
      tracksRef.current.forEach((t) => t.stop());
    } catch (_) {
      /* already stopped */
    }
    tracksRef.current = [];
  };

  // Html5Qrcode.stop() THROWS SYNCHRONOUSLY (not a rejected promise) when called on a scanner
  // whose start() never actually got going (e.g. camera permission denied) -- calling it
  // unconditionally from a useEffect cleanup crashes the whole app with no error boundary to
  // catch it. Only stop() a scanner that's actually running, and never let this throw.
  const safeStop = (qr) => {
    releaseCamera();
    try {
      if (qr?.isScanning) {
        qr.stop()
          .then(() => {
            try {
              qr.clear();
            } catch (_) {
              /* nothing left to clear */
            }
          })
          .catch(() => {});
      } else {
        try {
          qr?.clear();
        } catch (_) {
          /* never started: nothing to clear */
        }
      }
    } catch (_) {
      /* defensive: never let a cleanup throw */
    }
  };

  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;

    // Browsers expose the camera only on HTTPS or localhost; on plain http://<ip> there is no
    // navigator.mediaDevices at all, so say so instead of a vague "could not start" error.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Camera access needs a secure (HTTPS) connection. Open this app over https:// to scan.");
      return undefined;
    }

    import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (cancelled) return;
        const qr = new Html5Qrcode(domId, { verbose: false });
        scannerRef.current = qr;
        qr
          .start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            (decodedText) => {
              if (stoppedRef.current) return;
              stoppedRef.current = true;
              safeStop(qr);
              onDetected(decodedText);
            },
            () => {
              // per-frame "no code found" -- expected while aiming the camera, not an error
            }
          )
          .then(() => {
            // Remember the live camera tracks so they can be shut off synchronously.
            const video = document.getElementById(domId)?.querySelector("video");
            tracksRef.current = video?.srcObject?.getTracks?.() || [];
            // Closed while the camera was still starting: it just turned on after the dialog is
            // gone, so turn it straight back off.
            if (cancelled || stoppedRef.current) safeStop(qr);
          })
          .catch((err) => {
            if (cancelled) return;
            setError(
              err?.message?.includes("Permission") || String(err).includes("NotAllowed")
                ? "Camera permission was denied. Allow it in the browser and try again."
                : "Could not start the camera on this device."
            );
          });
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the scanner on this device.");
      });

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      safeStop(scannerRef.current);
      releaseCamera();
    };
  }, [domId, onDetected]);

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-label="Scan a barcode or QR code"
        onClick={(e) => e.stopPropagation()}
        className="sandesh-modal-card-3d"
        style={{ width: "100%", maxWidth: 420 }}
      >
        <div className="sandesh-modal-header">
          <div className="modal-title-with-icon">
            <span className="material-icons modal-header-icon">qr_code_scanner</span>
            <h3>Scan a barcode or QR code</h3>
          </div>
          <button type="button" className="close-btn-3d" onClick={onClose} aria-label="Close scanner">
            ×
          </button>
        </div>
        <div id={domId} style={{ background: "#000", minHeight: 260 }} />
        <div className="sandesh-modal-body" style={{ paddingTop: 14 }}>
          {error ? (
            <div className="sandesh-alert sandesh-alert-danger">{error}</div>
          ) : (
            <p className="section-note">Point the camera at the code. It's captured automatically.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function BarcodeInput({ value, onChange, placeholder = "Scan or type a code" }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, width: "100%" }}>
      <input type="text" value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="sandesh-btn-link" onClick={() => setOpen(true)}>
        Scan
      </button>
      {open ? (
        <ScannerOverlay
          onDetected={(text) => {
            onChange(text);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
