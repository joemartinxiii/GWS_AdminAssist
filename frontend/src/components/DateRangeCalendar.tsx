import { useState } from 'react';
import { Box, IconButton, Typography, Button } from '@mui/material';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isWithinInterval,
  parseISO,
  isBefore,
} from 'date-fns';

export type DateRangeValue = { from: string; to: string };

interface DateRangeCalendarProps {
  /** Unified: one calendar for single date or range. First click = start (or single), second click = end. */
  mode?: 'single' | 'range' | 'single-or-range';
  value: string | DateRangeValue;
  onChange: (value: string | DateRangeValue) => void;
  onClose?: () => void;
}

function toRangeValue(value: string | DateRangeValue): { from: string; to: string } {
  if (typeof value === 'string') return { from: value || '', to: value || '' };
  return { from: value?.from ?? '', to: value?.to ?? '' };
}

export function DateRangeCalendar({ mode = 'single-or-range', value, onChange, onClose }: DateRangeCalendarProps) {
  const rangeVal = toRangeValue(value);
  const rangeFrom = rangeVal.from;
  const rangeTo = rangeVal.to;
  const isUnified = mode === 'single-or-range';
  const pendingSecondClick = isUnified && rangeFrom && rangeTo && rangeFrom === rangeTo;

  const [viewDate, setViewDate] = useState(() => {
    if (rangeFrom) return parseISO(rangeFrom);
    return new Date();
  });

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const handleDayClick = (d: Date) => {
    const dateStr = format(d, 'yyyy-MM-dd');
    if (mode === 'single') {
      onChange(dateStr);
      onClose?.();
      return;
    }
    if (mode === 'range' || isUnified) {
      if (!rangeFrom || !pendingSecondClick) {
        onChange({ from: dateStr, to: dateStr });
        if (mode === 'range') return;
        return;
      }
      const startDate = parseISO(rangeFrom);
      const [from, to] = isBefore(d, startDate) ? [d, startDate] : [startDate, d];
      onChange({ from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') });
      onClose?.();
    }
  };

  const isSelected = (d: Date) => {
    if (!rangeFrom) return false;
    const from = parseISO(rangeFrom);
    if (!rangeTo || rangeFrom === rangeTo) return isSameDay(d, from);
    const to = parseISO(rangeTo);
    return isWithinInterval(d, { start: from, end: to }) || isSameDay(d, from) || isSameDay(d, to);
  };

  const isRangeStart = (d: Date) => rangeFrom && isSameDay(d, parseISO(rangeFrom));
  const isRangeEnd = (d: Date) => rangeTo && isSameDay(d, parseISO(rangeTo));
  const isInRange = (d: Date) => {
    if (!rangeFrom || !rangeTo || rangeFrom === rangeTo) return false;
    const from = parseISO(rangeFrom);
    const to = parseISO(rangeTo);
    return isWithinInterval(d, { start: from, end: to }) && !isSameDay(d, from) && !isSameDay(d, to);
  };

  return (
    <Box sx={{ minWidth: 280 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <IconButton size="small" onClick={() => setViewDate((d) => subMonths(d, 1))} aria-label="Previous month">
          <ChevronLeft size={20} strokeWidth={1.75} />
        </IconButton>
        <Typography variant="subtitle2">{format(viewDate, 'MMMM yyyy')}</Typography>
        <IconButton size="small" onClick={() => setViewDate((d) => addMonths(d, 1))} aria-label="Next month">
          <ChevronRight size={20} strokeWidth={1.75} />
        </IconButton>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, textAlign: 'center' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <Typography key={day} variant="caption" sx={{ py: 0.5, fontWeight: 600, color: 'text.secondary' }}>
            {day}
          </Typography>
        ))}
        {days.map((day) => {
          const sameMonth = isSameMonth(day, viewDate);
          const selected = isSelected(day);
          const rangeStartDay = isRangeStart(day);
          const rangeEndDay = isRangeEnd(day);
          const inRange = isInRange(day);
          return (
            <Button
              key={day.toISOString()}
              size="small"
              onClick={() => handleDayClick(day)}
              sx={{
                minWidth: 32,
                minHeight: 32,
                p: 0,
                color: sameMonth ? 'text.primary' : 'text.disabled',
                borderRadius: 1,
                ...(selected && {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' },
                }),
                ...(inRange && { bgcolor: 'action.selected' }),
                ...(rangeStartDay && (mode === 'range' || isUnified) && { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }),
                ...(rangeEndDay && (mode === 'range' || isUnified) && { borderTopRightRadius: 4, borderBottomRightRadius: 4 }),
              }}
            >
              {format(day, 'd')}
            </Button>
          );
        })}
      </Box>
      {(mode === 'range' || isUnified) && (rangeFrom || rangeTo) && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {isUnified && pendingSecondClick && (
            <Typography variant="caption" color="text.secondary">
              Click another date for range, or Done for single
            </Typography>
          )}
          <Button size="small" onClick={onClose}>
            Done
          </Button>
        </Box>
      )}
    </Box>
  );
}
