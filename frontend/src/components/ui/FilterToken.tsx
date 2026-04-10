import { Box } from '@mui/material';
import { X } from 'lucide-react';
import { T, pick } from '../../theme/designTokens';

export function FilterToken({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.25,
        py: 0.375,
        borderRadius: '100px',
        fontSize: '0.75rem',
        fontWeight: 500,
        fontFamily: T.font,
        bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)'),
        color: pick(theme, T.accent, '#8ab4f8'),
        border: `1px solid ${pick(theme, T.accentBorder, '#4285f4')}`,
      })}
    >
      {label}
      <X
        size={14}
        strokeWidth={2}
        style={{ cursor: 'pointer', opacity: 0.6 }}
        onClick={onRemove}
      />
    </Box>
  );
}
