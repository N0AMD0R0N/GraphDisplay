import styled from 'styled-components';

export const Message = styled.div<{ $error?: boolean }>`
  margin-top: 8px;
  padding: 6px 9px;
  border-radius: 6px;
  font-size: 12px;
  background: ${(p) => (p.$error ? p.theme.colors.dangerSoft : p.theme.colors.surface)};
  color: ${(p) => (p.$error ? p.theme.colors.danger : p.theme.colors.muted)};
  border: 1px solid ${(p) => (p.$error ? p.theme.colors.danger : p.theme.colors.border)};
`;
