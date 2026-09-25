import styled from 'styled-components';

const spec = (p) => p.theme.type[p.$variant || 'body'];

// <Text $variant="title" $color="textMuted" $lines={2}>  (variants come from tokens.type, colours from theme keys)
export const Text = styled.span`
  display: ${(p) => (p.$inline ? 'inline' : 'block')};
  color: ${(p) => p.theme[p.$color || 'text']};
  font-size: ${(p) => spec(p).size}px;
  line-height: ${(p) => spec(p).line}px;
  font-weight: ${(p) => p.theme.fontWeight[spec(p).weight]};
  min-width: 0;
  ${(p) => (p.$ellipsis ? 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' : '')}
  ${(p) => (p.$lines ? `display: -webkit-box; -webkit-line-clamp: ${p.$lines}; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;` : '')}
  ${(p) => (p.$center ? 'text-align: center;' : '')}
`;

export const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: ${(p) => p.$align || 'center'};
  justify-content: ${(p) => p.$justify || 'flex-start'};
  gap: ${(p) => p.theme.spacing[p.$gap || 'md']}px;
  ${(p) => (p.$wrap ? 'flex-wrap: wrap;' : '')}
`;

export const Divider = styled.div`
  height: 1px;
  background: ${(p) => p.theme[p.$color || 'border']};
`;
