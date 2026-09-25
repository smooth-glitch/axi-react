import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { ArrowLeft } from 'lucide-react';
import { IconButton, Text } from '../ui/kit';
import { useWindowWidth } from '../ui/hooks';

const Root = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${(p) => p.theme.bg};
`;

const Header = styled.header`
  flex: none;
  background: ${(p) => p.theme.surface};
  border-bottom: 1px solid ${(p) => p.theme.border};
`;

const HeaderInner = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  min-height: 64px;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.$pad}px;
  width: 100%;
  max-width: ${(p) => p.$max}px;
  margin: 0 auto;
`;

const Accent = styled.div`
  height: 2px;
  background: linear-gradient(90deg, ${(p) => p.theme.gradient[0]}, ${(p) => p.theme.gradient[1]}, ${(p) => p.theme.gradient[1]}00);
`;

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

const Footer = styled.footer`
  flex: none;
  background: ${(p) => p.theme.surface};
  border-top: 1px solid ${(p) => p.theme.border};
  box-shadow: ${(p) => p.theme.shadow.lg};
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.$pad}px;
`;

/**
 * Centre-pane page: header (optional back button, title/subtitle, actions), scrolling body, optional footer.
 * width: 'wide' (tables) | 'form' (narrow reading width) | 'full' (record forms: the whole pane).
 * The body cross-fades on every route change.
 */
export default function Page({ title, subtitle, onBack, actions, children, footer, width = 'wide' }) {
  const t = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const vw = useWindowWidth();
  const pad = vw < t.layout.tableBreakpoint ? t.spacing.lg : t.spacing.xl;
  const max = width === 'form' ? t.layout.formMaxWidth : width === 'full' ? t.layout.fullMaxWidth : t.layout.contentMaxWidth;
  const back = onBack === true ? () => (location.key === 'default' ? navigate('/') : navigate(-1)) : onBack;

  return (
    <Root>
      <Header>
        <HeaderInner $pad={pad} $max={max}>
          {back ? <IconButton icon={ArrowLeft} label="Back" onPress={back} testID="back" /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text as="h1" $variant="heading" $ellipsis style={{ margin: 0 }}>
              {title}
            </Text>
            {subtitle ? (
              <Text $variant="small" $color="textMuted" $ellipsis>
                {subtitle}
              </Text>
            ) : null}
          </div>
          {actions}
        </HeaderInner>
        <Accent />
      </Header>
      <Scroll>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: t.motion.s(t.motion.base) }}
          style={{ width: '100%', maxWidth: max, margin: '0 auto', padding: `${pad}px ${pad}px ${t.spacing.xxxl}px` }}
        >
          {children}
        </motion.div>
      </Scroll>
      {footer ? (
        <Footer $pad={pad}>
          <div style={{ width: '100%', maxWidth: max, margin: '0 auto' }}>{footer}</div>
        </Footer>
      ) : null}
    </Root>
  );
}
