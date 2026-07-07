import { useMemo, useState } from 'react';
import {
  TextField,
  Popover,
  Box,
  IconButton,
  Typography,
  MenuItem,
  Select,
  Button,
  InputAdornment,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format,
  parseISO,
  isValid,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  isSameDay,
  isSameMonth,
  setHours,
  setMinutes,
} from 'date-fns';
import { T, pick, textSecondary } from '../theme/designTokens';

interface DateTimePickerProps {
  label: string;
  /** ISO 8601 string, or '' when empty. */
  value: string;
  onChange: (iso: string) => void;
  required?: boolean;
  fullWidth?: boolean;
  minuteStep?: number;
  disabled?: boolean;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * App-consistent date + time picker. Replaces native `<input type="datetime-local">`
 * (whose browser-native chrome clashed with the rest of the UI) with a themed
 * MUI Popover: a month day-grid plus hour/minute selects. Emits an ISO string
 * via onChange (or '' when cleared) so callers keep storing ISO timestamps.
 */
export function DateTimePicker({
  label,
  value,
  onChange,
  required,
  fullWidth,
  minuteStep = 5,
  disabled,
}: DateTimePickerProps) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const parsed = value ? parseISO(value) : null;
  const valid = !!parsed && isValid(parsed);
  const base = valid ? (parsed as Date) : null;

  const [viewMonth, setViewMonth] = useState<Date>(base ?? new Date());

  const open = Boolean(anchorEl);
  const display = valid ? format(base as Date, "MMM d, yyyy '·' h:mm a") : '';

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth));
    const end = endOfWeek(endOfMonth(viewMonth));
    const arr: Date[] = [];
    let d = start;
    while (d <= end) {
      arr.push(d);
      d = addDays(d, 1);
    }
    return arr;
  }, [viewMonth]);

  const openPicker = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    setViewMonth(base ?? new Date());
    setAnchorEl(e.currentTarget);
  };

  const commit = (d: Date) => onChange(d.toISOString());

  const handlePickDay = (day: Date) => {
    const hrs = base ? base.getHours() : 9;
    const mins = base ? base.getMinutes() : 0;
    commit(setMinutes(setHours(day, hrs), mins));
  };

  const handlePickHour = (h: number) => commit(setHours(base ?? new Date(), h));
  const handlePickMinute = (m: number) => commit(setMinutes(base ?? new Date(), m));

  const minuteOptions = useMemo(() => {
    const opts: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) opts.push(m);
    // Ensure the current minute is selectable even if off-step.
    if (base && !opts.includes(base.getMinutes())) opts.push(base.getMinutes());
    return opts.sort((a, b) => a - b);
  }, [minuteStep, base]);

  const border = pick(theme, T.border, '#3f3f46');

  return (
    <>
      <TextField
        label={label}
        value={display}
        placeholder="Select date & time"
        onClick={openPicker}
        required={required}
        fullWidth={fullWidth}
        disabled={disabled}
        InputProps={{
          readOnly: true,
          sx: { cursor: disabled ? 'default' : 'pointer', fontFamily: T.font },
          endAdornment: (
            <InputAdornment position="end">
              <CalendarIcon size={18} color={textSecondary(theme)} />
            </InputAdornment>
          ),
        }}
        InputLabelProps={{ shrink: true }}
      />

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{
          sx: {
            p: 2,
            width: 300,
            fontFamily: T.font,
            bgcolor: pick(theme, T.surface, '#18181b'),
            border: `1px solid ${border}`,
            borderRadius: T.radiusLg,
          },
        }}
      >
        {/* Month navigation */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <IconButton size="small" onClick={() => setViewMonth((m) => addMonths(m, -1))} aria-label="Previous month">
            <ChevronLeft size={18} />
          </IconButton>
          <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.875rem' }}>
            {format(viewMonth, 'MMMM yyyy')}
          </Typography>
          <IconButton size="small" onClick={() => setViewMonth((m) => addMonths(m, 1))} aria-label="Next month">
            <ChevronRight size={18} />
          </IconButton>
        </Box>

        {/* Weekday headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.25, mb: 0.5 }}>
          {WEEKDAYS.map((w) => (
            <Typography
              key={w}
              sx={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: textSecondary(theme) }}
            >
              {w}
            </Typography>
          ))}
        </Box>

        {/* Day grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.25 }}>
          {days.map((day) => {
            const isSelected = valid && isSameDay(day, base as Date);
            const inMonth = isSameMonth(day, viewMonth);
            return (
              <Box
                key={day.toISOString()}
                component="button"
                type="button"
                onClick={() => handlePickDay(day)}
                sx={{
                  cursor: 'pointer',
                  border: 'none',
                  borderRadius: T.radius,
                  py: 0.75,
                  fontFamily: T.font,
                  fontSize: '0.8125rem',
                  bgcolor: isSelected ? T.accent : 'transparent',
                  color: isSelected ? '#fff' : inMonth ? pick(theme, T.text, '#fafafa') : textSecondary(theme),
                  opacity: inMonth ? 1 : 0.4,
                  '&:hover': { bgcolor: isSelected ? T.accentHover : pick(theme, '#f0f0ec', '#27272a') },
                }}
              >
                {format(day, 'd')}
              </Box>
            );
          })}
        </Box>

        {/* Time selects */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: textSecondary(theme) }}>Time</Typography>
          <Select
            size="small"
            value={base ? base.getHours() : ''}
            displayEmpty
            onChange={(e) => handlePickHour(Number(e.target.value))}
            sx={{ fontFamily: T.font, minWidth: 96 }}
            renderValue={(v: any) => (v === '' || v == null ? '--' : format(setHours(new Date(), Number(v)), 'h a'))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <MenuItem key={h} value={h} sx={{ fontFamily: T.font }}>
                {format(setHours(new Date(), h), 'h a')}
              </MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            value={base ? base.getMinutes() : ''}
            displayEmpty
            onChange={(e) => handlePickMinute(Number(e.target.value))}
            sx={{ fontFamily: T.font, minWidth: 72 }}
            renderValue={(v: any) => (v === '' || v == null ? '--' : String(v).padStart(2, '0'))}
          >
            {minuteOptions.map((m) => (
              <MenuItem key={m} value={m} sx={{ fontFamily: T.font }}>
                {String(m).padStart(2, '0')}
              </MenuItem>
            ))}
          </Select>
        </Box>

        {/* Footer actions */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
          <Button
            size="small"
            onClick={() => {
              onChange('');
              setAnchorEl(null);
            }}
            sx={{ fontFamily: T.font, textTransform: 'none', color: textSecondary(theme) }}
          >
            Clear
          </Button>
          <Box>
            <Button
              size="small"
              onClick={() => {
                const now = new Date();
                setViewMonth(now);
                commit(now);
              }}
              sx={{ fontFamily: T.font, textTransform: 'none', color: textSecondary(theme) }}
            >
              Now
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => setAnchorEl(null)}
              sx={{ fontFamily: T.font, textTransform: 'none', ml: 1, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
            >
              Done
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
