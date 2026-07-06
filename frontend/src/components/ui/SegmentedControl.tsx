import { Box } from '@mui/material';
import { T, pick, textSecondary } from '../../theme/designTokens';

export function SegmentedControl({
  value,
  options,
  onChange,
  testIdPrefix = 'segment',
}: {
  value: number;
  options: string[];
  onChange: (idx: number) => void;
  testIdPrefix?: string;
}) {
  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        borderRadius: T.radius,
        bgcolor: pick(theme, '#f0f0ec', '#2a2a2e'),
        p: '3px',
        gap: '2px',
        flexWrap: 'wrap',
      })}
    >
      {options.map((label, idx) => (
        <Box
          key={label}
          data-testid={`${testIdPrefix}-${label.toLowerCase().replace(/\s+/g, '-')}`}
          onClick={() => onChange(idx)}
          sx={(theme) => ({
            px: 2,
            py: 0.75,
            borderRadius: T.radiusSm,
            cursor: 'pointer',
            fontSize: '0.8125rem',
            fontWeight: value === idx ? 600 : 500,
            fontFamily: T.font,
            color: value === idx ? pick(theme, T.text, '#fff') : textSecondary(theme),
            bgcolor: value === idx ? pick(theme, T.surface, '#3a3a3e') : 'transparent',
            boxShadow: value === idx ? T.shadow : 'none',
            transition: 'all 0.15s ease',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            '&:hover': {
              color: pick(theme, T.text, '#fff'),
            },
          })}
        >
          {label}
        </Box>
      ))}
    </Box>
  );
}
