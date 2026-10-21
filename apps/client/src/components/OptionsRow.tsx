import styled from 'styled-components';

export const OptionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  input,
  select {
    padding: 3px 5px;
    border: 1px solid ${(p) => p.theme.colors.border};
    border-radius: 4px;
    background: ${(p) => p.theme.colors.white};
  }
  input[type='number'] {
    width: 74px;
  }
`;
