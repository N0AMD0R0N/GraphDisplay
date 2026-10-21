import styled from 'styled-components';
import { NODE_SIZE } from '../constants';

export const NodeBox = styled.div<{ $dimmed: boolean }>`
  width: ${NODE_SIZE.width}px;
  height: ${NODE_SIZE.height}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  opacity: ${(p) => (p.$dimmed ? p.theme.colors.dim : 1)};
  transition: opacity 0.15s;
`;
