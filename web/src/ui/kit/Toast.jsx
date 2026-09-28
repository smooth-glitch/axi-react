import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Text } from './Text';
import { createLogger } from '../../core/logger';

const log = createLogger('toast');
const ToastContext = createContext({ show: () => {} });
export const useToast = () => useContext(ToastContext);

const Host = styled.div`
  font-family: ${(p) => p.theme.fontFamily};
  position: fixed;
  left: 0;
  right: 0;
  bottom: ${(p) => p.theme.spacing.lg}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  padding: 0 ${(p) => p.theme.spacing.lg}px;
  pointer-events: none;
  z-index: 2000;
`;

const Item = styled(motion.div)`
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  width: 100%;
  max-width: 520px;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.theme.spacing.lg}px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => (p.theme.mode === 'dark' ? p.theme.surfaceAlt : p.theme.nav)};
  color: ${(p) => p.theme.navText};
  box-shadow: ${(p) => p.theme.shadow.lg};
`;

const Dismiss = styled.button`
  border: 0;
  background: transparent;
  color: ${(p) => p.theme.gradient[0]};
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  font-size: ${(p) => p.theme.type.small.size}px;
  cursor: pointer;
  padding: ${(p) => p.theme.spacing.xs}px ${(p) => p.theme.spacing.sm}px;
`;

// toast.show({ title, message, type: 'success' | 'error' }) - stacked bottom-centre, auto-dismiss after ~4s.
export function ToastProvider({ children }) {
  const t = useTheme();
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const remove = useCallback((id) => setToasts((cur) => cur.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (next) => {
      log.info('show', next);
      const id = ++seq.current;
      setToasts((cur) => [...cur, { type: 'success', ...next, id }]);
      setTimeout(() => remove(id), 3800);
    },
    [remove]
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {createPortal(
        <Host role="status" aria-live="polite">
          <AnimatePresence>
            {toasts.map((x) => {
              const ok = x.type !== 'error';
              const Icon = ok ? CheckCircle2 : AlertCircle;
              return (
                <Item key={x.id} layout initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: t.motion.s(t.motion.base) }}>
                  <Icon size={18} color={ok ? t.success : t.danger} strokeWidth={2.2} style={{ flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text $variant="bodyStrong" style={{ color: t.navText }}>
                      {x.title}
                    </Text>
                    {x.message ? (
                      <Text $variant="small" style={{ color: t.navMuted }}>
                        {x.message}
                      </Text>
                    ) : null}
                  </div>
                  <Dismiss onClick={() => remove(x.id)}>Dismiss</Dismiss>
                </Item>
              );
            })}
          </AnimatePresence>
        </Host>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
