import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import { Search, X } from 'lucide-react';
import { ActionTooltip } from '../ActionTooltip';
import { T, pick, textSecondary, textTertiary } from '../../theme/designTokens';

/** Expanded field width — matches Groups member search flyout. */
export const FLYOUT_SEARCH_WIDTH = 280;

export type FlyoutSearchHandle = {
  /** Expand and focus the field (e.g. ⌘K). */
  focus: () => void;
  open: () => void;
  close: () => void;
};

export interface FlyoutSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Tooltip / aria on the search icon */
  tooltip?: string;
  /** Keep expanded while value is non-empty */
  stayOpenWhenFilled?: boolean;
  disabled?: boolean;
}

/**
 * Toolbar search: icon toggles a width-animated field (Groups modal pattern).
 * Escape or click outside collapses when empty.
 */
export const FlyoutSearch = forwardRef<FlyoutSearchHandle, FlyoutSearchProps>(function FlyoutSearch(
  {
    value,
    onChange,
    placeholder = 'Search…',
    tooltip = 'Search',
    stayOpenWhenFilled = true,
    disabled = false,
  },
  ref
) {
  const [open, setOpen] = useState(!!value.trim());
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const expanded = open || (stayOpenWhenFilled && !!value.trim());

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => {
      if (!value.trim()) setOpen(false);
    },
    focus: () => {
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    },
  }));

  useEffect(() => {
    if (expanded) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!value.trim()) setOpen(false);
        else inputRef.current?.blur();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (!value.trim()) setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [expanded, value]);

  const toggle = () => {
    if (disabled) return;
    setOpen((o) => !o);
  };

  return (
    <Box ref={containerRef} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      <ActionTooltip title={tooltip}>
        <IconButton
          size="small"
          onClick={toggle}
          disabled={disabled}
          aria-label={tooltip}
          aria-expanded={expanded}
          sx={(theme) => ({
            p: 0.5,
            color: expanded || value ? T.accent : textSecondary(theme),
            bgcolor: expanded ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') : 'transparent',
            borderRadius: T.radiusSm,
            '&:hover': { bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') },
          })}
        >
          <Search size={18} strokeWidth={1.75} />
        </IconButton>
      </ActionTooltip>
      <Box
        sx={{
          overflow: 'hidden',
          width: expanded ? FLYOUT_SEARCH_WIDTH : 0,
          transition: 'width 0.2s ease',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <TextField
          size="small"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputRef={inputRef}
          InputProps={{
            ...(value
              ? {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        aria-label="Clear search"
                        onClick={() => onChange('')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') onChange('');
                        }}
                        sx={{ display: 'flex', cursor: 'pointer', color: (t) => textTertiary(t) }}
                      >
                        <X size={16} strokeWidth={2} />
                      </Box>
                    </InputAdornment>
                  ),
                }
              : {}),
          }}
          sx={(theme) => ({
            width: FLYOUT_SEARCH_WIDTH,
            minWidth: FLYOUT_SEARCH_WIDTH,
            '& .MuiOutlinedInput-root': {
              fontFamily: T.font,
              fontSize: '0.8125rem',
              borderRadius: T.radius,
              bgcolor: pick(theme, T.surface, '#27272a'),
              '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
              '&:hover fieldset': { borderColor: pick(theme, T.textTertiary, '#52525b') },
              '&.Mui-focused fieldset': { borderColor: T.accent },
            },
          })}
        />
      </Box>
    </Box>
  );
});
