import styled from 'styled-components';

export const Button = styled.button<{ $primary?: boolean }>`
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$primary ? p.theme.colors.accent : p.theme.colors.border)};
  background: ${(p) => (p.$primary ? p.theme.colors.accent : p.theme.colors.surface)};
  color: ${(p) => (p.$primary ? p.theme.colors.white : p.theme.colors.text)};
  font-weight: ${(p) => (p.$primary ? 600 : 400)};
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
