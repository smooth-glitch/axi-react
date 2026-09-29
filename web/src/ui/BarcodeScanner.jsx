import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { AlertCircle, ScanBarcode, ScanLine, X } from 'lucide-react';
import { Button, Input, Text } from './kit';

// Barcode/QR field input: a text box (so a value can still be typed or pasted) plus a
// "Scan" button that opens the device camera and decodes a code with html5-qrcode.

const Row = styled.div`
  display: flex;
  gap: ${(p) => p.theme.spacing.sm}px;
`;

const Overlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${(p) => p.theme.spacing.lg}px;
`;

const Panel = styled(motion.div)`
  width: 100%;
  max-width: 420px;
  background: ${(p) => p.theme.surface};
  border-radius: ${(p) => p.theme.radius.xl}px;
  box-shadow: ${(p) => p.theme.shadow.lg};
  overflow: hidden;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  padding: ${(p) => p.theme.spacing.lg}px;
  border-bottom: 1px solid ${(p) => p.theme.border};
`;

const CamBox = styled.div`
  position: relative;
  background: #000;
  min-height: 260px;
  & video { width: 100%; display: block; }
`;

const CloseBtn = styled.button`
  border: 0;
  background: transparent;
  color: ${(p) => p.theme.textMuted};
  cursor: pointer;
  display: flex;
  padding: ${(p) => p.theme.spacing.xs}px;
  margin-left: auto;
  border-radius: ${(p) => p.theme.radius.md}px;
  &:hover { background: ${(p) => p.theme.surfaceAlt}; }
`;

function ScannerModal({ onDetected, onClose }) {
  const t = useTheme();
  const domId = `barcode-scan-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [error, setError] = useState(null);
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;

    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const qr = new Html5Qrcode(domId, { verbose: false });
      scannerRef.current = qr;
      qr
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (stoppedRef.current) return;
            stoppedRef.current = true;
            qr.stop().then(() => qr.clear()).catch(() => {});
            onDetected(decodedText);
          },
          () => {
            // per-frame "no code found" — expected while aiming the camera, not an error
          }
        )
        .catch((err) => {
          if (cancelled) return;
          setError(err?.message?.includes('Permission') || String(err).includes('NotAllowed') ? 'Camera permission was denied. Allow it in the browser and try again.' : 'Could not start the camera on this device.');
        });
    });

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      const qr = scannerRef.current;
      if (qr) qr.stop().then(() => qr.clear()).catch(() => {});
    };
  }, [domId, onDetected]);

  return (
    <Overlay initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <Panel initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} onClick={(e) => e.stopPropagation()}>
        <Head>
          <ScanLine size={18} color={t.primary} />
          <Text $variant="bodyStrong">Scan a barcode or QR code</Text>
          <CloseBtn type="button" onClick={onClose} aria-label="Close scanner">
            <X size={18} />
          </CloseBtn>
        </Head>
        <CamBox id={domId} />
        {error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.lg }}>
            <AlertCircle size={16} color={t.danger} style={{ flex: 'none' }} />
            <Text $variant="small" $color="danger">
              {error}
            </Text>
          </div>
        ) : (
          <div style={{ padding: t.spacing.lg }}>
            <Text $variant="small" $color="textMuted">
              Point the camera at the code. It's captured automatically.
            </Text>
          </div>
        )}
      </Panel>
    </Overlay>
  );
}

export function BarcodeInput({ value, onChange, invalid, placeholder = 'Scan or type a code' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Row>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input icon={ScanBarcode} value={value ?? ''} onChangeText={onChange} invalid={invalid} placeholder={placeholder} />
        </div>
        <Button size="sm" variant="secondary" title="Scan" icon={ScanLine} onPress={() => setOpen(true)} testID="scan-barcode" />
      </Row>
      {open
        ? createPortal(
            <AnimatePresence>
              <ScannerModal
                onDetected={(text) => {
                  onChange(text);
                  setOpen(false);
                }}
                onClose={() => setOpen(false)}
              />
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
}
