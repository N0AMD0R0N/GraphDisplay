import styled, { css } from 'styled-components';
import { NODE_SIZE } from '../constants';

export const NodeDot = styled.div<{
  $color: string;
  $incomplete: boolean;
  $open: boolean;
  $pulse: boolean;
  $warm?: string;
}>`
  width: ${NODE_SIZE.dot}px;
  height: ${NODE_SIZE.dot}px;
  margin-top: 4px;
  border-radius: 50%;
  background: ${(p) => (p.$incomplete ? p.theme.colors.surface : p.$color)};
  border: 2px ${(p) => (p.$incomplete ? 'dashed' : 'solid')}
    ${(p) => (p.$incomplete ? p.theme.colors.incomplete : p.theme.colors.nodeRing)};
  ${(p) =>
    p.$warm &&
    css`
      border: 3px solid ${p.$warm};
      /* a soft glow, so the vulnerability marker differs from the crisp ring of a clicked node */
      box-shadow: 0 0 5px 1px ${p.$warm}b0;
    `}
  ${(p) =>
    p.$open &&
    css`
      outline: 3px solid ${p.theme.colors.accent};
      outline-offset: 1px;
    `}
  ${(p) =>
    p.$pulse &&
    css`
      animation: gd-pulse 0.8s ease-out 2;
    `}
`;
