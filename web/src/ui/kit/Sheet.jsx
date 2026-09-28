import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { X } from 'lucide-react';
import { Text, Divider } from './Text';
import { IconButton } from './Button';
import { useWindowWidth } from '../hooks';

const Layer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 50;
`;

const Backdrop = styled(motion.div)`
  position: absolute;
  inset: 0;
  background: ${(p) => p.theme.overlay};
`;

const Panel = styled(motion.div)`
  position: absolute;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.theme.surface};
  border: 0 solid ${(p) => p.theme.border};
  box-shadow: ${(p) => p.theme.shadow.lg};
  color: ${(p) => p.theme.text};
  font-family: ${(p) => p.theme.fontFamily};
`;

const Head = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.lg}px ${(p) => p.theme.spacing.xl}px;
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${(p) => p.theme.spacing.sm}px ${(p) => p.theme.spacing.xl}px ${(p) => p.theme.spacing.xl}px;
`;

const Foot = styled.div`
  display: flex;
  gap: ${(p) => p.theme.spacing.md}px;
  justify-content: flex-end;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.theme.spacing.xl}px;
  border-top: 1px solid ${(p) => p.theme.border};
`;

// Slide-over panel: right-hand drawer on wide screens, bottom sheet on narrow ones. Rendered in a portal on <body>
// (above everything). Not a permanent side panel - it opens on demand and closes with Esc / backdrop / X.
export function Sheet({ visible, onClose, title, subtitle, children, footer, testID }) {
  const t = useTheme();
  const width = useWindowWidth();
  const drawer = width >= t.layout.tableBreakpoint;

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const hidden = drawer ? { x: t.layout.panelWidth } : { y: '100%' };
  const shown = drawer ? { x: 0 } : { y: 0 };
  const panelStyle = drawer
    ? { top: 0, right: 0, bottom: 0, width: t.layout.panelWidth, maxWidth: '100vw', borderLeftWidth: 1 }
    : { left: 0, right: 0, bottom: 0, maxHeight: '90%', borderTopWidth: 1, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl };

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <Layer key="sheet">
          <Backdrop
            aria-label="Close panel"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: t.motion.s(t.motion.base) }}
          />
          <Panel
            data-testid={testID}
            role="dialog"
            aria-label={title}
            initial={hidden}
            animate={shown}
            exit={hidden}
            transition={{ duration: t.motion.s(t.motion.base + 60), ease: [0.22, 1, 0.36, 1] }}
            style={panelStyle}
          >
            <Head>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text $variant="heading">{title}</Text>
                {subtitle ? (
                  <Text $variant="small" $color="textMuted">
                    {subtitle}
                  </Text>
                ) : null}
              </div>
              <IconButton icon={X} label="Close" onPress={onClose} stop={false} />
            </Head>
            <Divider />
            <Body>{children}</Body>
            {footer ? <Foot>{footer}</Foot> : null}
          </Panel>
        </Layer>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
