import styled from 'styled-components';
import { NODE_SIZE } from '../constants';

export const NodeLabel = styled.div`
  margin-top: 4px;
  max-width: ${NODE_SIZE.width - 2}px;
  font-size: 12px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${(p) => p.theme.colors.text};
`;
