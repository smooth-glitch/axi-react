import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import styled, { useTheme } from 'styled-components';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar';
import { useWindowWidth } from '../ui/hooks';
import { MenuContext, SheetHostContext } from './MenuContext';

const Frame = styled.div`
  position: relative;
  display: flex;
  height: 100%;
  overflow: hidden;
  background: ${(p) => p.theme.bg};
`;

const Main = styled.main`
  flex: 1;
  min-width: 0;
  height: 100%;
`;

const Backdrop = styled(motion.div)`
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(31, 41, 55, 0.28);
`;

const Drawer = styled(motion.div)`
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 21;
  width: min(320px, 88%);
  background: ${(p) => p.theme.surface};
  box-shadow: ${(p) => p.theme.shadow.lg};
  border-radius: 0 ${(p) => p.theme.radius.xl}px ${(p) => p.theme.radius.xl}px 0;
  overflow: hidden;
`;

// Wide: struct menu on the left (collapsible) + routed centre pane. Narrow: routes only; the menu opens as a drawer.
// onClose: set when the studio is shown in a modal - pages then render a close button inside the app.
export default function Shell({ onClose }) {
  const t = useTheme();
  const { pathname } = useLocation();
  const wide = useWindowWidth() >= t.layout.wideBreakpoint;
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [host, setHost] = useState(null);

  useEffect(() => setDrawer(false), [pathname, wide]);

  const visible = wide && !collapsed;
  const ctx = useMemo(
    () => ({ visible, close: onClose || null, toggle: () => (wide ? setCollapsed((c) => !c) : setDrawer((d) => !d)) }),
    [visible, wide, onClose]
  );

  return (
    <MenuContext.Provider value={ctx}>
      <SheetHostContext.Provider value={host}>
      <Frame ref={setHost}>
        {visible ? <Sidebar variant="sidebar" /> : null}
        <Main>
          <Outlet />
        </Main>
        <AnimatePresence>
          {!wide && drawer ? (
            <React.Fragment key="drawer">
              <Backdrop initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={() => setDrawer(false)} />
              <Drawer
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 320, mass: 0.9 }}
                onClick={(e) => e.target.closest('a') && setDrawer(false)}
              >
                <Sidebar variant="screen" />
              </Drawer>
            </React.Fragment>
          ) : null}
        </AnimatePresence>
      </Frame>
      </SheetHostContext.Provider>
    </MenuContext.Provider>
  );
}
