import React from 'react';
import { Outlet } from 'react-router-dom';
import styled, { useTheme } from 'styled-components';
import Sidebar from './Sidebar';
import { useWindowWidth } from '../ui/hooks';

const Frame = styled.div`
  display: flex;
  height: 100%;
  background: ${(p) => p.theme.bg};
`;

const Main = styled.main`
  flex: 1;
  min-width: 0;
  height: 100%;
`;

// Wide screens: persistent struct menu on the left + routed centre pane. Narrow: routes only
// (the home route shows the struct list full-screen).
export default function Shell() {
  const t = useTheme();
  const wide = useWindowWidth() >= t.layout.wideBreakpoint;
  return (
    <Frame>
      {wide ? <Sidebar variant="sidebar" /> : null}
      <Main>
        <Outlet />
      </Main>
    </Frame>
  );
}
