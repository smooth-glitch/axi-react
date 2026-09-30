import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import styled, { useTheme } from 'styled-components';
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

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  background: ${(p) => p.theme.overlay};
`;

const Drawer = styled.div`
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 21;
  width: min(320px, 88%);
  box-shadow: ${(p) => p.theme.shadow.lg};
`;

// Wide: struct menu on the left (collapsible) + routed centre pane. Narrow: routes only; the menu opens as a drawer.
export default function Shell() {
  const t = useTheme();
  const { pathname } = useLocation();
  const wide = useWindowWidth() >= t.layout.wideBreakpoint;
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [host, setHost] = useState(null);

  useEffect(() => setDrawer(false), [pathname, wide]);

  const visible = wide && !collapsed;
  const ctx = useMemo(
    () => ({ visible, toggle: () => (wide ? setCollapsed((c) => !c) : setDrawer((d) => !d)) }),
    [visible, wide]
  );

  return (
    <MenuContext.Provider value={ctx}>
      <SheetHostContext.Provider value={host}>
      <Frame ref={setHost}>
        {visible ? <Sidebar variant="sidebar" /> : null}
        <Main>
          <Outlet />
        </Main>
        {!wide && drawer ? (
          <>
            <Backdrop onClick={() => setDrawer(false)} />
            <Drawer onClick={(e) => e.target.closest('a') && setDrawer(false)}>
              <Sidebar variant="screen" />
            </Drawer>
          </>
        ) : null}
      </Frame>
      </SheetHostContext.Provider>
    </MenuContext.Provider>
  );
}
