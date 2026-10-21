import { NODE_SIZE } from '../constants';

export const HANDLE_X = (NODE_SIZE.width - NODE_SIZE.dot) / 2;

export const handleStyle = (side: 'left' | 'right') => ({
  opacity: 0,
  width: 1,
  height: 1,
  top: 4 + NODE_SIZE.dot / 2,
  [side]: HANDLE_X,
});
