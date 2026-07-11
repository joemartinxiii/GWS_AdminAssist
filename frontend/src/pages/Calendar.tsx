import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Alert,
  Snackbar,
  Popover,
  FormControl,
  Select,
  MenuItem,
  Autocomplete,
  TablePagination,
  InputAdornment,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Pencil,
  UserPlus,
  Calendar as CalendarIcon,
  ListFilter,
  ArrowLeftRight,
  RefreshCw,
  Search,
  X,
  Move,
} from 'lucide-react';
import { Calendar as BigCalendar, dateFnsLocalizer, View, Event as CalendarEventType } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { apiClient } from '../services/api.client';
import { getApiErrorMessage } from '../utils/apiError';
import { DateRangeCalendar } from '../components/DateRangeCalendar';
import { DateTimePicker } from '../components/DateTimePicker';
import { ActionTooltip } from '../components/ActionTooltip';
import { FilterToken } from '../components/ui/FilterToken';
import { T, pick, textSecondary, textTertiary, dialogPaperSx } from '../theme/designTokens';
import { tablePaginationProps } from '../components/ui/tablePaginationProps';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow, listActionsSx } from '../components/ui/ListShell';
import { ListChevron } from '../components/ui/ListChevron';
import { FlyoutSearch } from '../components/ui/FlyoutSearch';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useResizableColumns } from '../hooks/useResizableColumns';

const CAL_STATIC_SORT = { key: '_', direction: 'asc' as const };
const calNoopSort = () => {};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  location?: string;
  organizer?: {
    email: string;
    displayName?: string;
  };
  htmlLink?: string;
  status?: string;
}

// Localizer for react-big-calendar using date-fns
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { 'en-US': enUS },
});

// Create calendar with drag and drop
const DragAndDropCalendar = withDragAndDrop(BigCalendar);

function extractEmailCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (EMAIL_RE.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}

export function Calendar() {
  const theme = useTheme();
  const cols = useResizableColumns(
    'calendar-events',
    { event: 260, start: 150, end: 150, location: 160, attendees: 240 },
    { event: 140, start: 110, end: 110, location: 100, attendees: 140 }
  );
  const [viewType, setViewType] = useState<'table' | 'calendar'>('calendar');
  const [calendarView, setCalendarView] = useState<View>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [userEmail, setUserEmail] = useState('');
  const selectedCalendarId = 'primary';
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [editMode, setEditMode] = useState<'view' | 'edit' | 'addAttendees' | 'move' | 'transfer'>('view');
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Search and filter state
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAttendee, setFilterAttendee] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filterDateAnchor, setFilterDateAnchor] = useState<HTMLElement | null>(null);
  const [moveDateAnchor, setMoveDateAnchor] = useState<HTMLElement | null>(null);
  const [tablePage, setTablePage] = useState(0);
  const [tableRowsPerPage, setTableRowsPerPage] = useState(25);

  // Form state for editing
  const [eventSummary, setEventSummary] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [newAttendeeEmail, setNewAttendeeEmail] = useState('');
  const [newAttendees, setNewAttendees] = useState<string[]>([]);
  const [moveStartDateTime, setMoveStartDateTime] = useState('');
  const [moveDurationMinutes, setMoveDurationMinutes] = useState(60);

  // Transfer state
  const [transferTargetEmail, setTransferTargetEmail] = useState('');
  const [users, setUsers] = useState<Array<{ id: string; primaryEmail: string; name: { fullName: string } }>>([]);
  const normalizedUserEmail = useMemo(() => extractEmailCandidate(userEmail), [userEmail]);
  const directorySuggestions = useMemo(
    () =>
      users.map((user) =>
        user.name?.fullName ? `${user.name.fullName} (${user.primaryEmail})` : user.primaryEmail
      ),
    [users]
  );
  const transferSuggestions = useMemo(
    () =>
      directorySuggestions.filter(
        (suggestion) => extractEmailCandidate(suggestion).toLowerCase() !== normalizedUserEmail.toLowerCase()
      ),
    [directorySuggestions, normalizedUserEmail]
  );

  useEffect(() => {
    void fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearUserSearch = () => {
    setUserEmail('');
    setEvents([]);
    setFilteredEvents([]);
  };

  const fetchUsers = async () => {
    try {
      const response = await apiClient.get('/users?maxResults=100');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
      setUsers([]);
    }
  };

  useEffect(() => {
    if (normalizedUserEmail) {
      fetchEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedUserEmail, currentDate, calendarView]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (viewType === 'table' && events.length > 0) setFiltersVisible(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [viewType, events.length]);

  // Apply filters whenever events or filters change
  useEffect(() => {
    applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, tableSearchTerm, filterDateFrom, filterDateTo, filterAttendee, filterLocation]);

  const applyFilters = () => {
    let filtered = [...events];

    // Search query (title and description)
    if (tableSearchTerm.trim()) {
      const query = tableSearchTerm.toLowerCase();
      filtered = filtered.filter(
        event =>
          event.summary?.toLowerCase().includes(query) ||
          event.description?.toLowerCase().includes(query)
      );
    }

    // Date filter (single or range via from/to)
    if (filterDateFrom || filterDateTo) {
      const startStr = filterDateFrom || filterDateTo;
      const endStr = filterDateTo || filterDateFrom;
      const start = new Date(startStr); start.setHours(0, 0, 0, 0);
      const end = new Date(endStr); end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(event => {
        const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) : event.start?.date ? new Date(event.start.date) : null;
        const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) : event.end?.date ? new Date(event.end.date) : null;
        return eventStart && eventEnd && (eventStart <= end && eventEnd >= start);
      });
    }

    // Attendee filter
    if (filterAttendee.trim()) {
      const attendeeQuery = filterAttendee.toLowerCase();
      filtered = filtered.filter(event =>
        event.attendees?.some(
          attendee =>
            attendee.email.toLowerCase().includes(attendeeQuery) ||
            attendee.displayName?.toLowerCase().includes(attendeeQuery)
        )
      );
    }

    // Location filter
    if (filterLocation.trim()) {
      const locationQuery = filterLocation.toLowerCase();
      filtered = filtered.filter(event =>
        event.location?.toLowerCase().includes(locationQuery)
      );
    }

    setFilteredEvents(filtered);
  };

  const clearFilters = () => {
    setTableSearchTerm('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterAttendee('');
    setFilterLocation('');
    setFiltersVisible(false);
  };

  const hasActiveFilters = () => {
    return !!(tableSearchTerm || filterDateFrom || filterDateTo || filterAttendee || filterLocation);
  };

  const pagedTableEvents = useMemo(
    () => filteredEvents.slice(tablePage * tableRowsPerPage, (tablePage + 1) * tableRowsPerPage),
    [filteredEvents, tablePage, tableRowsPerPage]
  );

  useEffect(() => {
    setTablePage(0);
  }, [tableSearchTerm, filterDateFrom, filterDateTo, filterAttendee, filterLocation, viewType]);

  useEffect(() => {
    const last = Math.max(0, Math.ceil(filteredEvents.length / tableRowsPerPage) - 1);
    if (tablePage > last) setTablePage(last);
  }, [filteredEvents.length, tableRowsPerPage, tablePage]);

  const fetchEvents = async () => {
    if (!normalizedUserEmail || !selectedCalendarId) return;

    try {
      setLoading(true);
      // Calculate date range based on current view
      let timeMin: Date;
      let timeMax: Date;
      
      if (calendarView === 'month') {
        // Fetch current month plus buffer
        timeMin = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        timeMax = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0);
      } else if (calendarView === 'week') {
        // Fetch current week plus buffer
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
        timeMin = new Date(weekStart);
        timeMax = new Date(weekStart);
        timeMax.setDate(timeMax.getDate() + 14);
      } else {
        // Day view - fetch current day plus buffer
        timeMin = new Date(currentDate);
        timeMin.setHours(0, 0, 0, 0);
        timeMax = new Date(currentDate);
        timeMax.setDate(timeMax.getDate() + 7);
        timeMax.setHours(23, 59, 59, 999);
      }
      
      const response = await apiClient.get(`/calendar/${encodeURIComponent(normalizedUserEmail)}/events`, {
        params: {
          calendarId: selectedCalendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          maxResults: 250,
        },
      });
      setEvents(response.data);
      setLoadError(null);
    } catch (error) {
      console.error('Error fetching events:', error);
      setEvents([]);
      setLoadError(getApiErrorMessage(error, 'Failed to load calendar data'));
    } finally {
      setLoading(false);
    }
  };

  // Convert CalendarEvent to react-big-calendar format
  // For calendar view, use all events (not filtered)
  // For table view, use filtered events
  const calendarEvents = useMemo(() => {
    const eventsToUse = viewType === 'calendar' ? events : filteredEvents;
    return eventsToUse.map(event => {
      const start = event.start?.dateTime 
        ? new Date(event.start.dateTime) 
        : event.start?.date 
        ? new Date(event.start.date) 
        : new Date();
      const end = event.end?.dateTime 
        ? new Date(event.end.dateTime) 
        : event.end?.date 
        ? new Date(event.end.date) 
        : new Date(start.getTime() + 60 * 60 * 1000);

      return {
        id: event.id,
        title: event.summary || 'No Title',
        start,
        end,
        resource: event,
      };
    });
  }, [viewType, events, filteredEvents]);

  const handleOpenEventDialog = (event: CalendarEvent | null, mode: 'view' | 'edit' | 'addAttendees' | 'move' = 'view') => {
    setSelectedEvent(event);
    setEditMode(mode);
    
    if (event) {
      setEventSummary(event.summary || '');
      setEventDescription(event.description || '');
      setEventStart(event.start?.dateTime || event.start?.date || '');
      setEventEnd(event.end?.dateTime || event.end?.date || '');
      setEventLocation(event.location || '');
      setNewAttendees([]);
      const startDateIso = event.start?.dateTime || '';
      const endDateIso = event.end?.dateTime || '';
      setMoveStartDateTime(formatDateTimeForInput(startDateIso));
      const startMs = startDateIso ? new Date(startDateIso).getTime() : 0;
      const endMs = endDateIso ? new Date(endDateIso).getTime() : 0;
      const derivedDuration = startMs > 0 && endMs > startMs ? Math.round((endMs - startMs) / 60000) : 60;
      setMoveDurationMinutes(Math.max(15, derivedDuration));
    } else {
      // New event
      setEventSummary('');
      setEventDescription('');
      setEventStart('');
      setEventEnd('');
      setEventLocation('');
      setNewAttendees([]);
      setMoveStartDateTime('');
      setMoveDurationMinutes(60);
    }
    
    setEventDialogOpen(true);
  };

  const handleCloseEventDialog = () => {
    setEventDialogOpen(false);
    setSelectedEvent(null);
    setEditMode('view');
    setNewAttendeeEmail('');
    setNewAttendees([]);
    setTransferTargetEmail('');
    setMoveStartDateTime('');
    setMoveDurationMinutes(60);
    setMoveDateAnchor(null);
  };

  const handleAddAttendee = () => {
    const normalizedAttendee = extractEmailCandidate(newAttendeeEmail);
    if (!normalizedAttendee) {
      setSnackbar({ open: true, message: 'Enter a valid attendee email address.', severity: 'error' });
      return;
    }
    if (!newAttendees.includes(normalizedAttendee)) {
      setNewAttendees([...newAttendees, normalizedAttendee]);
      setNewAttendeeEmail('');
    }
  };

  const handleRemoveAttendee = (email: string) => {
    setNewAttendees(newAttendees.filter(e => e !== email));
  };

  const handleSaveEvent = async () => {
    if (!normalizedUserEmail || !selectedCalendarId) return;

    try {
      if (editMode === 'addAttendees' && selectedEvent) {
        // Add attendees only
        const attendees = newAttendees.map(email => ({ email }));
        await apiClient.post(
          `/calendar/${encodeURIComponent(normalizedUserEmail)}/events/${selectedEvent.id}/attendees?calendarId=${selectedCalendarId}`,
          { attendees }
        );
        setSnackbar({ open: true, message: 'Attendees added successfully', severity: 'success' });
      } else if (editMode === 'move' && selectedEvent) {
        // Move event
        if (!moveStartDateTime.trim()) {
          setSnackbar({ open: true, message: 'Start date/time is required', severity: 'error' });
          return;
        }
        if (!Number.isFinite(moveDurationMinutes) || moveDurationMinutes < 15) {
          setSnackbar({ open: true, message: 'Duration must be at least 15 minutes.', severity: 'error' });
          return;
        }
        const moveStart = new Date(moveStartDateTime);
        if (Number.isNaN(moveStart.getTime())) {
          setSnackbar({ open: true, message: 'Enter a valid start date/time.', severity: 'error' });
          return;
        }
        const moveEnd = new Date(moveStart.getTime() + moveDurationMinutes * 60000);
        await apiClient.post(
          `/calendar/${encodeURIComponent(normalizedUserEmail)}/events/${selectedEvent.id}/move?calendarId=${selectedCalendarId}`,
          { newStart: moveStart.toISOString(), newEnd: moveEnd.toISOString(), timeZone: 'America/New_York' }
        );
        setSnackbar({ open: true, message: 'Event moved successfully', severity: 'success' });
      } else if (editMode === 'edit' && selectedEvent) {
        // Update event
        if (eventStart && eventEnd && new Date(eventEnd).getTime() <= new Date(eventStart).getTime()) {
          setSnackbar({ open: true, message: 'End time must be after start time.', severity: 'error' });
          return;
        }
        await apiClient.patch(
          `/calendar/${encodeURIComponent(normalizedUserEmail)}/events/${selectedEvent.id}?calendarId=${selectedCalendarId}`,
          {
            summary: eventSummary,
            description: eventDescription,
            start: { dateTime: eventStart, timeZone: 'America/New_York' },
            end: { dateTime: eventEnd, timeZone: 'America/New_York' },
            location: eventLocation,
          }
        );
        setSnackbar({ open: true, message: 'Event updated successfully', severity: 'success' });
      }

      handleCloseEventDialog();
      fetchEvents();
    } catch (error: any) {
      console.error('Error saving event:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to save event'),
        severity: 'error',
      });
    }
  };

  const handleTransferEvent = async () => {
    if (!normalizedUserEmail || !selectedCalendarId || !selectedEvent || !transferTargetEmail.trim()) {
      setSnackbar({ open: true, message: 'Please select a target user', severity: 'error' });
      return;
    }

    const targetEmail = extractEmailCandidate(transferTargetEmail.trim());
    if (!targetEmail) {
      setSnackbar({ open: true, message: 'Enter a valid target email address.', severity: 'error' });
      return;
    }

    try {
      await apiClient.post(
        `/calendar/${encodeURIComponent(normalizedUserEmail)}/events/${selectedEvent.id}/transfer?calendarId=${selectedCalendarId}`,
        {
          targetEmail,
          targetCalendarId: 'primary',
        }
      );
      setSnackbar({
        open: true,
        message: `Event ownership transferred to ${targetEmail}`,
        severity: 'success',
      });
      handleCloseEventDialog();
      fetchEvents();
    } catch (error: any) {
      console.error('Error transferring event:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to transfer event'),
        severity: 'error',
      });
    }
  };


  const handleEventSelect = (event: CalendarEventType) => {
    const calendarEvent = (event as any).resource as CalendarEvent;
    handleOpenEventDialog(calendarEvent, 'view');
  };

  const asCalendarDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

  const handleEventDrop = async ({
    event,
    start,
    end,
  }: {
    event: CalendarEventType;
    start: string | Date;
    end: string | Date;
  }) => {
    const calendarEvent = (event as any).resource as CalendarEvent;
    const s = asCalendarDate(start);
    const e = asCalendarDate(end);
    if (e.getTime() <= s.getTime()) {
      setSnackbar({ open: true, message: 'End time must be after start time.', severity: 'error' });
      return;
    }
    try {
      await apiClient.post(
        `/calendar/${encodeURIComponent(normalizedUserEmail)}/events/${calendarEvent.id}/move?calendarId=${selectedCalendarId}`,
        {
          newStart: s.toISOString(),
          newEnd: e.toISOString(),
          timeZone: 'America/New_York',
        }
      );
      setSnackbar({ open: true, message: 'Event moved successfully', severity: 'success' });
      fetchEvents();
    } catch (error: any) {
      console.error('Error moving event:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to move event'),
        severity: 'error',
      });
    }
  };

  const formatDateTime = (dateTime?: string, date?: string) => {
    if (dateTime) {
      return new Date(dateTime).toLocaleString();
    }
    if (date) {
      return new Date(date).toLocaleDateString();
    }
    return '-';
  };

  const formatDateTimeForInput = (dateTime?: string) => {
    if (!dateTime) return '';
    try {
      const date = new Date(dateTime);
      // Format as YYYY-MM-DDTHH:mm for datetime-local input
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch {
      return '';
    }
  };

  const getMoveDatePart = () => moveStartDateTime.split('T')[0] || '';
  const getMoveTimePart = () => {
    const raw = moveStartDateTime.split('T')[1] || '';
    return raw ? raw.slice(0, 5) : '09:00';
  };

  const setMoveDatePart = (datePart: string) => {
    if (!datePart) {
      setMoveStartDateTime('');
      return;
    }
    setMoveStartDateTime(`${datePart}T${getMoveTimePart()}`);
  };

  const setMoveTimePart = (timePart: string) => {
    const datePart = getMoveDatePart() || format(new Date(), 'yyyy-MM-dd');
    setMoveStartDateTime(`${datePart}T${timePart}`);
  };

  const rbcCalendarSx = useMemo(
    () => ({
      fontFamily: T.font,
      fontSize: '0.8125rem',
      color: pick(theme, T.text, '#fafafa'),

      // Toolbar nav bar
      '& .rbc-toolbar': {
        marginBottom: '16px',
        gap: '8px',
        flexWrap: 'wrap' as const,
        alignItems: 'center',
      },
      '& .rbc-toolbar-label': {
        fontSize: '0.9375rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        fontFamily: T.font,
        color: pick(theme, T.text, '#fafafa'),
      },
      '& .rbc-toolbar button': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
        fontWeight: 500,
        color: pick(theme, T.text, '#e4e4e7'),
        background: pick(theme, T.surface, '#27272a'),
        border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
        borderRadius: T.radiusSm,
        padding: '5px 12px',
        cursor: 'pointer',
        lineHeight: 1.4,
        '&:hover': {
          background: pick(theme, T.surfaceHover, '#3f3f46'),
          borderColor: pick(theme, T.textTertiary, '#52525b'),
          color: pick(theme, T.text, '#fafafa'),
        },
        '&:focus': {
          outline: 'none',
          boxShadow: `0 0 0 2px ${T.accentBorder}`,
        },
        '&.rbc-active, &.rbc-active:hover': {
          background: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)'),
          borderColor: pick(theme, T.accentBorder, '#4285f4'),
          color: pick(theme, T.accent, '#8ab4f8'),
        },
      },

      // Calendar grid borders
      '& .rbc-month-view, & .rbc-time-view': {
        borderColor: pick(theme, T.border, '#3f3f46'),
        borderRadius: T.radius,
        overflow: 'hidden',
      },
      '& .rbc-month-row': { borderColor: pick(theme, T.border, '#3f3f46') },
      '& .rbc-day-bg + .rbc-day-bg': { borderColor: pick(theme, T.border, '#3f3f46') },
      '& .rbc-time-content, & .rbc-time-header-content': { borderColor: pick(theme, T.border, '#3f3f46') },
      '& .rbc-day-slot .rbc-time-slot': { borderColor: pick(theme, T.borderSubtle, '#27272a') },
      '& .rbc-timeslot-group': { borderColor: pick(theme, T.borderSubtle, '#27272a') },

      // Day header row (Mon, Tue…)
      '& .rbc-header': {
        borderColor: pick(theme, T.border, '#3f3f46'),
        background: pick(theme, T.bg, '#141414'),
        color: textSecondary(theme),
        fontSize: '0.6875rem',
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        fontFamily: T.font,
        padding: '10px 8px',
      },
      '& .rbc-header + .rbc-header': { borderColor: pick(theme, T.border, '#3f3f46') },

      // Off-range days
      '& .rbc-off-range-bg': {
        background: pick(theme, '#f5f5f3', '#141414'),
      },
      '& .rbc-off-range': {
        color: textTertiary(theme),
      },

      // Today highlight
      '& .rbc-today': {
        backgroundColor: pick(theme, '#ebf3fe', 'rgba(26, 115, 232, 0.12)'),
      },

      // Date number
      '& .rbc-date-cell': {
        fontSize: '0.75rem',
        fontFamily: T.font,
        padding: '4px 8px',
        textAlign: 'right' as const,
        '& > a, & > button': {
          color: pick(theme, T.text, '#fafafa'),
          fontWeight: 500,
          fontFamily: T.font,
        },
      },

      // Time gutter labels
      '& .rbc-time-gutter, & .rbc-label': {
        fontSize: '0.6875rem',
        fontFamily: T.font,
        color: textTertiary(theme),
        paddingRight: '8px',
      },

      // Event pills
      '& .rbc-event, & .rbc-day-slot .rbc-background-event': {
        background: T.accent,
        border: 'none',
        borderRadius: '6px',
        fontSize: '0.75rem',
        fontFamily: T.font,
        padding: '2px 6px',
        boxShadow: 'none',
      },
      '& .rbc-event:focus': {
        outline: 'none',
        boxShadow: `0 0 0 2px ${T.accentBorder}`,
      },
      '& .rbc-event-label': { fontSize: '0.6875rem', fontWeight: 600 },
      '& .rbc-event-content': { fontWeight: 500 },
      '& .rbc-selected': { background: T.accentHover },

      // Show more
      '& .rbc-show-more': {
        fontFamily: T.font,
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: pick(theme, T.accent, '#8ab4f8'),
        background: 'transparent',
        padding: '0 4px',
      },

      // Popup (overflow events)
      '& .rbc-popup': {
        background: pick(theme, T.surface, '#18181b'),
        border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
        borderRadius: T.radius,
        boxShadow: T.shadowLg,
        fontFamily: T.font,
        fontSize: '0.8125rem',
        color: pick(theme, T.text, '#fafafa'),
      },
      '& .rbc-overlay-header': {
        fontFamily: T.font,
        fontWeight: 600,
        borderColor: pick(theme, T.border, '#3f3f46'),
      },

      // Current time indicator
      '& .rbc-current-time-indicator': {
        background: T.danger,
        height: '2px',
      },

      // Agenda view
      '& .rbc-agenda-view table.rbc-agenda-table': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
        borderColor: pick(theme, T.border, '#3f3f46'),
      },
      '& .rbc-agenda-view .rbc-agenda-date-cell, & .rbc-agenda-view .rbc-agenda-time-cell': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
        color: textSecondary(theme),
        borderColor: pick(theme, T.border, '#3f3f46'),
      },
      '& .rbc-agenda-view .rbc-agenda-event-cell': {
        fontFamily: T.font,
        borderColor: pick(theme, T.border, '#3f3f46'),
      },
      '& .rbc-agenda-empty': {
        fontFamily: T.font,
        color: textSecondary(theme),
        padding: '24px',
      },
    }),
    [theme]
  );

  const calendarEventPropGetter = useCallback(
    (event: object) => {
      const calEvent = (event as { resource?: CalendarEvent }).resource as CalendarEvent | undefined;
      const confirmed = calEvent?.status === 'confirmed';
      const bg = confirmed ? T.accent : (theme.palette.mode === 'dark' ? '#52525b' : '#71717a');
      return {
        style: {
          backgroundColor: bg,
          border: 'none',
          color: '#ffffff',
        },
      };
    },
    [theme]
  );

  return (
    <Box sx={{ fontFamily: T.font }}>
      <Box sx={{ mb: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (th) => pick(th, T.text, '#fafafa') }}>
          Calendar
        </Typography>
        {events.length > 0 && (
          <SegmentedControl
            value={viewType === 'calendar' ? 0 : 1}
            options={['Calendar', 'Table']}
            onChange={(idx) => setViewType(idx === 0 ? 'calendar' : 'table')}
          />
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Autocomplete
          size="small"
          freeSolo
          disableClearable
          options={users}
          getOptionLabel={(option) =>
            typeof option === 'string' ? option : (option.name?.fullName ? `${option.name.fullName} (${option.primaryEmail})` : option.primaryEmail)
          }
          value={users.find((u) => u.primaryEmail === normalizedUserEmail)}
          inputValue={userEmail}
          onInputChange={(_, v) => setUserEmail(v)}
          onChange={(_, newValue) => {
            setUserEmail(newValue ? (typeof newValue === 'string' ? newValue : newValue.primaryEmail) : '');
          }}
          filterOptions={(opts, { inputValue }) => {
            if (!inputValue.trim()) return opts;
            const search = inputValue.toLowerCase().trim();
            return opts.filter(
              (u) =>
                u.primaryEmail.toLowerCase().includes(search) ||
                (u.name?.fullName && u.name.fullName.toLowerCase().includes(search))
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Search user…"
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <Box component="span" sx={{ display: 'flex', color: (t: any) => textTertiary(t) }}>
                      <Search size={18} strokeWidth={1.75} />
                    </Box>
                  </InputAdornment>
                ),
                endAdornment: (
                  <>
                    {userEmail ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={handleClearUserSearch}
                          aria-label="Clear user search"
                          sx={{ p: 0.5, color: (t: any) => textTertiary(t) }}
                        >
                          <X size={16} strokeWidth={2} />
                        </IconButton>
                      </InputAdornment>
                    ) : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const u = option as { primaryEmail: string; name?: { fullName: string } };
            return (
              <Box
                component="li"
                {...props}
                key={u.primaryEmail}
                sx={{
                  fontFamily: T.font,
                  fontSize: '0.8125rem',
                  px: 1.5,
                  py: 0.75,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start !important',
                  gap: '1px',
                }}
              >
                {u.name?.fullName && (
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (t) => pick(t, T.text, '#fafafa'), lineHeight: 1.3 }}>
                    {u.name.fullName}
                  </Typography>
                )}
                <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), lineHeight: 1.3 }}>
                  {u.primaryEmail}
                </Typography>
              </Box>
            );
          }}
          componentsProps={{
            paper: {
              sx: (theme: any) => ({
                mt: 0.5,
                borderRadius: T.radius,
                border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
                bgcolor: pick(theme, T.surface, '#18181b'),
                boxShadow: theme.palette.mode === 'dark' ? '0 4px 20px rgba(0,0,0,0.35)' : T.shadowLg,
                backgroundImage: 'none',
                '& .MuiAutocomplete-listbox': {
                  fontFamily: T.font,
                  fontSize: '0.8125rem',
                  p: '4px',
                  '& .MuiAutocomplete-option': {
                    borderRadius: T.radiusSm,
                    '&[aria-selected="true"]': {
                      bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)'),
                    },
                    '&.Mui-focused': {
                      bgcolor: pick(theme, T.surfaceHover, '#27272a'),
                    },
                    '&[aria-selected="true"].Mui-focused': {
                      bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)'),
                    },
                  },
                },
                '& .MuiAutocomplete-noOptions': {
                  fontFamily: T.font,
                  fontSize: '0.8125rem',
                  color: (theme: any) => textSecondary(theme),
                },
              }),
            },
          }}
          sx={(theme: any) => ({
            width: 280,
            '& .MuiOutlinedInput-root': {
              fontFamily: T.font,
              fontSize: '0.8125rem',
              borderRadius: T.radius,
              bgcolor: pick(theme, T.surface, '#27272a'),
              '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
              '&:hover fieldset': { borderColor: pick(theme, T.textTertiary, '#52525b') },
              '&.Mui-focused fieldset': { borderColor: T.accent },
            },
            '& .MuiInputBase-input': { fontFamily: T.font, fontSize: '0.8125rem' },
            '& label': { display: 'none' },
            '& .MuiInputLabel-root': { display: 'none' },
          })}
        />
        <ActionTooltip title="Refresh data">
          <span>
            <IconButton
              size="small"
              onClick={() => normalizedUserEmail && fetchEvents()}
              disabled={!normalizedUserEmail || loading}
              aria-label="Refresh data"
              sx={{ color: (t: any) => textSecondary(t) }}
            >
              {loading ? <CircularProgress size={18} /> : <RefreshCw size={18} strokeWidth={1.75} />}
            </IconButton>
          </span>
        </ActionTooltip>
        <Box sx={{ flex: 1 }} />
        {events.length > 0 && viewType === 'table' && (
          <FlyoutSearch
            value={tableSearchTerm}
            onChange={setTableSearchTerm}
            placeholder="Search events…"
            tooltip="Search events"
          />
        )}
        {events.length > 0 && viewType === 'table' && (
          <ActionTooltip title="Filters">
            <IconButton
              size="small"
              onClick={() => setFiltersVisible((v) => !v)}
              sx={(theme: any) => ({
                color: filtersVisible || hasActiveFilters() ? T.accent : textSecondary(theme),
                bgcolor: filtersVisible ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') : 'transparent',
                borderRadius: T.radiusSm,
                '&:hover': { bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') },
              })}
            >
              <ListFilter size={18} strokeWidth={1.75} />
            </IconButton>
          </ActionTooltip>
        )}
      </Box>

      <Box>
        {loadError && !loading && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>
        )}
        {/* Inline collapsible filter panel */}
        {events.length > 0 && viewType === 'table' && (
          <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 320 : 0, opacity: filtersVisible ? 1 : 0, transition: 'max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease', mb: filtersVisible ? 2 : 0 }}>
            <Box sx={(theme: any) => ({ p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'), display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' })}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t: any) => textSecondary(t) }}>Date:</Typography>
                {filterDateFrom && filterDateTo && (
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t: any) => pick(t, T.text, '#fafafa') }}>
                    {filterDateFrom === filterDateTo ? filterDateFrom : `${filterDateFrom} – ${filterDateTo}`}
                  </Typography>
                )}
                <ActionTooltip title="Pick date or range">
                  <IconButton
                    size="small"
                    onClick={(e) => setFilterDateAnchor(e.currentTarget)}
                    aria-label="Open calendar"
                    sx={{ color: (t: any) => textSecondary(t), p: 0.5 }}
                  >
                    <CalendarIcon size={16} strokeWidth={1.75} />
                  </IconButton>
                </ActionTooltip>
                <Popover
                  open={Boolean(filterDateAnchor)}
                  anchorEl={filterDateAnchor}
                  onClose={() => setFilterDateAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  PaperProps={{ sx: { minWidth: 280 } }}
                >
                  <Box sx={{ p: 2 }}>
                    <DateRangeCalendar
                      mode="single-or-range"
                      value={{ from: filterDateFrom, to: filterDateTo }}
                      onChange={(v) => {
                        const r = typeof v === 'string' ? { from: v, to: v } : v;
                        setFilterDateFrom(r.from);
                        setFilterDateTo(r.to);
                      }}
                      onClose={() => setFilterDateAnchor(null)}
                    />
                  </Box>
                </Popover>
              </Box>
              <TextField
                size="small"
                placeholder="Attendee email or name"
                value={filterAttendee}
                onChange={(e) => setFilterAttendee(e.target.value)}
                sx={(theme: any) => ({
                  width: 200,
                  '& .MuiOutlinedInput-root': {
                    fontFamily: T.font,
                    fontSize: '0.8125rem',
                    borderRadius: T.radius,
                    bgcolor: pick(theme, T.surface, '#27272a'),
                    '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
                  },
                })}
              />
              <TextField
                size="small"
                placeholder="Location"
                value={filterLocation}
                onChange={(e) => setFilterLocation(e.target.value)}
                sx={(theme: any) => ({
                  width: 180,
                  '& .MuiOutlinedInput-root': {
                    fontFamily: T.font,
                    fontSize: '0.8125rem',
                    borderRadius: T.radius,
                    bgcolor: pick(theme, T.surface, '#27272a'),
                    '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
                  },
                })}
              />
              {hasActiveFilters() && (
                <Button
                  size="small"
                  onClick={clearFilters}
                  sx={{ fontFamily: T.font, textTransform: 'none', fontSize: '0.75rem', color: (t: any) => textSecondary(t) }}
                >
                  Clear all
                </Button>
              )}
            </Box>
          </Box>
        )}

        {/* Filter tokens when panel is collapsed */}
        {events.length > 0 && viewType === 'table' && !filtersVisible && hasActiveFilters() && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
            {(filterDateFrom || filterDateTo) && (
              <FilterToken
                label={`Date: ${filterDateFrom === filterDateTo ? filterDateFrom : `${filterDateFrom} – ${filterDateTo}`}`}
                onRemove={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
              />
            )}
            {filterAttendee && (
              <FilterToken label={`Attendee: ${filterAttendee}`} onRemove={() => setFilterAttendee('')} />
            )}
            {filterLocation && (
              <FilterToken label={`Location: ${filterLocation}`} onRemove={() => setFilterLocation('')} />
            )}
          </Box>
        )}

          {/* Calendar View - Show all events without filtering */}
          {viewType === 'calendar' && events.length > 0 && (
            <Box
              sx={(t) => ({
                mb: 3,
                border: `1px solid ${pick(t, T.border, '#3f3f46')}`,
                borderRadius: T.radiusLg,
                overflow: 'hidden',
                bgcolor: pick(t, T.surface, '#18181b'),
              })}
            >
              <Box sx={{ height: 660, p: 2.5, ...rbcCalendarSx }}>
                <DragAndDropCalendar
                  localizer={localizer as any}
                  events={calendarEvents}
                  startAccessor={(ev: object) => (ev as { start: Date }).start}
                  endAccessor={(ev: object) => (ev as { end: Date }).end}
                  style={{ height: '100%' }}
                  view={calendarView}
                  date={currentDate}
                  onView={(view) => setCalendarView(view)}
                  onNavigate={(date) => setCurrentDate(date)}
                  onSelectEvent={handleEventSelect}
                  onEventDrop={handleEventDrop}
                  draggableAccessor={() => true}
                  resizable
                  onEventResize={(args) => {
                    void handleEventDrop({
                      event: args.event,
                      start: args.start,
                      end: args.end,
                    });
                  }}
                  popup
                  eventPropGetter={calendarEventPropGetter}
                />
              </Box>
            </Box>
          )}

          {/* Table View */}
          {viewType === 'table' && filteredEvents.length > 0 && (
            <>
            <ListShell>
              <ListHeaderRow>
                <ColumnHeader label="Event" columnId="ev" sortConfig={CAL_STATIC_SORT} onSort={calNoopSort} sortable={false} {...cols.headerProps('event')} />
                <ColumnHeader label="Start" columnId="st" sortConfig={CAL_STATIC_SORT} onSort={calNoopSort} sortable={false} {...cols.headerProps('start')} />
                <ColumnHeader label="End" columnId="en" sortConfig={CAL_STATIC_SORT} onSort={calNoopSort} sortable={false} {...cols.headerProps('end')} />
                <ColumnHeader label="Location" columnId="loc" sortConfig={CAL_STATIC_SORT} onSort={calNoopSort} sortable={false} {...cols.headerProps('location')} />
                <ColumnHeader label="Attendees" columnId="att" sortConfig={CAL_STATIC_SORT} onSort={calNoopSort} sortable={false} {...cols.headerProps('attendees')} />
                <ColumnHeader label="" columnId="__open" sortConfig={CAL_STATIC_SORT} onSort={calNoopSort} sortable={false} width={36} align="right" pinEnd />
              </ListHeaderRow>
              {pagedTableEvents.map((event, idx) => (
                <ListDataRow
                  key={event.id}
                  last={idx === pagedTableEvents.length - 1}
                  onClick={() => handleOpenEventDialog(event, 'view')}
                >
                  <Box sx={cols.cellSx('event')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (th) => pick(th, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {event.summary || 'No Title'}
                    </Typography>
                    {event.description && (
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (th) => textSecondary(th), display: 'block', mt: 0.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {event.description.substring(0, 50)}
                        {event.description.length > 50 ? '…' : ''}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={cols.cellSx('start')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (th) => textSecondary(th) }}>{formatDateTime(event.start?.dateTime, event.start?.date)}</Typography>
                  </Box>
                  <Box sx={cols.cellSx('end')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (th) => textSecondary(th) }}>{formatDateTime(event.end?.dateTime, event.end?.date)}</Typography>
                  </Box>
                  <Box sx={cols.cellSx('location')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (th) => textSecondary(th), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {event.location || '—'}
                    </Typography>
                  </Box>
                  <Box sx={cols.cellSx('attendees')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (th) => textSecondary(th), lineHeight: 1.45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {event.attendees?.length
                        ? [
                            ...event.attendees.slice(0, 3).map((a) => a.displayName || a.email),
                            ...(event.attendees.length > 3 ? [`+${event.attendees.length - 3} more`] : []),
                          ].join(', ')
                        : '—'}
                    </Typography>
                  </Box>
                  <Box sx={listActionsSx}>
                    <ListChevron />
                  </Box>
                </ListDataRow>
              ))}
            </ListShell>
            <TablePagination
              component="div"
              count={filteredEvents.length}
              page={tablePage}
              onPageChange={(_, newPage) => setTablePage(newPage)}
              rowsPerPage={tableRowsPerPage}
              onRowsPerPageChange={(e) => {
                setTableRowsPerPage(parseInt(e.target.value, 10));
                setTablePage(0);
              }}
              rowsPerPageOptions={[25, 50, 100]}
              {...tablePaginationProps(theme)}
            />
            </>
          )}

          {!loading && filteredEvents.length === 0 && events.length > 0 && (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">No events match your filters</Typography>
            </Paper>
          )}

          {!loading && !normalizedUserEmail && (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">Search and select a user to view their calendar</Typography>
            </Paper>
          )}

          {!loading && events.length === 0 && normalizedUserEmail && selectedCalendarId && (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">No events found for the selected calendar</Typography>
            </Paper>
          )}
        </Box>

      {/* Event Edit Dialog */}
      <Dialog
        open={eventDialogOpen}
        onClose={handleCloseEventDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: (th) => ({
            ...dialogPaperSx(th),
            '& .MuiDialogContent-root': { pt: '20px !important' },
          }),
        }}
      >
        <DialogTitle sx={{ p: 0, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 3, pt: 2.5, pb: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa') }}>
                {editMode === 'view' && 'Event details'}
                {editMode === 'edit' && 'Edit event'}
                {editMode === 'addAttendees' && 'Add attendees'}
                {editMode === 'move' && 'Move event'}
                {editMode === 'transfer' && 'Transfer event'}
              </Typography>
              {editMode === 'view' && selectedEvent && (
                <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mt: 0.5, lineHeight: 1.4 }}>
                  {selectedEvent.summary}
                </Typography>
              )}
            </Box>
          </Box>
          {editMode === 'view' && selectedEvent && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
                px: 3,
                py: 1.5,
                borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`,
                bgcolor: (t) => pick(t, T.bg, '#141414'),
              }}
            >
              <Button
                size="small"
                variant="outlined"
                startIcon={<UserPlus size={15} strokeWidth={1.75} />}
                onClick={() => setEditMode('addAttendees')}
                sx={(th) => ({
                  fontFamily: T.font,
                  textTransform: 'none',
                  borderRadius: T.radius,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderColor: pick(th, T.border, '#5f6368'),
                  color: pick(th, T.text, '#e4e4e7'),
                  '&:hover': { borderColor: pick(th, T.accent, '#8ab4f8'), bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.08)') },
                })}
              >
                Add attendees
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Move size={15} strokeWidth={1.75} />}
                onClick={() => setEditMode('move')}
                sx={(th) => ({
                  fontFamily: T.font,
                  textTransform: 'none',
                  borderRadius: T.radius,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderColor: pick(th, T.border, '#5f6368'),
                  color: pick(th, T.text, '#e4e4e7'),
                  '&:hover': { borderColor: pick(th, T.accent, '#8ab4f8'), bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.08)') },
                })}
              >
                Move
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Pencil size={15} strokeWidth={1.75} />}
                onClick={() => setEditMode('edit')}
                sx={(th) => ({
                  fontFamily: T.font,
                  textTransform: 'none',
                  borderRadius: T.radius,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderColor: pick(th, T.border, '#5f6368'),
                  color: pick(th, T.text, '#e4e4e7'),
                  '&:hover': { borderColor: pick(th, T.accent, '#8ab4f8'), bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.08)') },
                })}
              >
                Edit
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowLeftRight size={15} strokeWidth={1.75} />}
                onClick={() => setEditMode('transfer')}
                sx={(th) => ({
                  fontFamily: T.font,
                  textTransform: 'none',
                  borderRadius: T.radius,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderColor: pick(th, T.border, '#5f6368'),
                  color: pick(th, T.text, '#e4e4e7'),
                  '&:hover': { borderColor: pick(th, T.accent, '#8ab4f8'), bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.08)') },
                })}
              >
                Transfer
              </Button>
            </Box>
          )}
        </DialogTitle>
        <DialogContent sx={{ px: 3, pb: 2.5 }}>
          {editMode === 'view' && selectedEvent && (
            <Box>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1.25 }}>
                Details
              </Typography>
              {selectedEvent.description && (
                <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), lineHeight: 1.55, mb: 2.5 }}>
                  {selectedEvent.description}
                </Typography>
              )}
              {!selectedEvent.description && <Box sx={{ mb: 1 }} />}
              <Grid container spacing={2.5}>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 0.75 }}>Start</Typography>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => pick(t, T.text, '#fafafa') }}>{formatDateTime(selectedEvent.start?.dateTime, selectedEvent.start?.date)}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 0.75 }}>End</Typography>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => pick(t, T.text, '#fafafa') }}>{formatDateTime(selectedEvent.end?.dateTime, selectedEvent.end?.date)}</Typography>
                </Grid>
                {selectedEvent.location && (
                  <Grid item xs={12}>
                    <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 0.75 }}>Location</Typography>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => pick(t, T.text, '#fafafa') }}>{selectedEvent.location}</Typography>
                  </Grid>
                )}
                {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                  <Grid item xs={12}>
                    <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 0.75 }}>Attendees</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {selectedEvent.attendees.map((attendee, idx) => (
                        <Typography key={idx} sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), lineHeight: 1.45 }}>
                          {attendee.displayName || attendee.email}
                          <Box component="span" sx={{ color: (t) => textTertiary(t), ml: 0.5 }}>
                            ({attendee.responseStatus || 'pending'})
                          </Box>
                        </Typography>
                      ))}
                    </Box>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {editMode === 'edit' && (
            <Box sx={{ mt: 0 }}>
              <TextField
                label="Event Title"
                value={eventSummary}
                onChange={(e) => setEventSummary(e.target.value)}
                fullWidth
                sx={{ mb: 2 }}
                required
              />
              <TextField
                label="Description"
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                fullWidth
                multiline
                rows={3}
                sx={{ mb: 2 }}
              />
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <DateTimePicker
                    label="Start Time"
                    value={eventStart}
                    onChange={setEventStart}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <DateTimePicker
                    label="End Time"
                    value={eventEnd}
                    onChange={setEventEnd}
                    fullWidth
                    required
                  />
                </Grid>
              </Grid>
              <TextField
                label="Location"
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                fullWidth
                sx={{ mt: 2 }}
              />
            </Box>
          )}

          {editMode === 'addAttendees' && (
            <Box sx={{ mt: 0 }}>
              <Box display="flex" gap={2} mb={2}>
                <Autocomplete
                  freeSolo
                  options={directorySuggestions}
                  value={newAttendeeEmail}
                  inputValue={newAttendeeEmail}
                  onInputChange={(_, value) => setNewAttendeeEmail(value)}
                  onChange={(_, value) => setNewAttendeeEmail(typeof value === 'string' ? value : '')}
                  fullWidth
                  filterOptions={(options, { inputValue }) => {
                    if (!inputValue.trim()) return options;
                    const search = inputValue.toLowerCase().trim();
                    return options.filter((option) => option.toLowerCase().includes(search));
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Attendee Email"
                      placeholder="Type name/email (e.g. ops)"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddAttendee()}
                    />
                  )}
                />
                <Button variant="outlined" onClick={handleAddAttendee}>
                  Add
                </Button>
              </Box>
              {newAttendees.length > 0 && (
                <Box>
                  <Typography variant="body2" gutterBottom>New Attendees:</Typography>
                  <Box display="flex" flexWrap="wrap" gap={1} alignItems="center">
                    {newAttendees.map((email, idx) => (
                      <Box key={idx} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, py: 0.25 }}>
                        <Typography sx={{ fontFamily: T.mono, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{email}</Typography>
                        <ActionTooltip title="Remove">
                          <IconButton size="small" onClick={() => handleRemoveAttendee(email)} aria-label={`Remove ${email}`} sx={{ p: 0.25 }}>
                            <X size={14} strokeWidth={1.75} />
                          </IconButton>
                        </ActionTooltip>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {editMode === 'move' && (
            <Box sx={{ mt: 0 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={8}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Button
                      variant="outlined"
                      startIcon={<CalendarIcon size={16} strokeWidth={1.75} />}
                      onClick={(e) => setMoveDateAnchor(e.currentTarget)}
                      sx={{ fontFamily: T.font, textTransform: 'none', justifyContent: 'flex-start', flex: 1 }}
                    >
                      {getMoveDatePart() || 'Select date'}
                    </Button>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <Select
                        value={getMoveTimePart()}
                        onChange={(e) => setMoveTimePart(String(e.target.value))}
                        displayEmpty
                      >
                        {Array.from({ length: 96 }, (_, idx) => {
                          const hours = String(Math.floor(idx / 4)).padStart(2, '0');
                          const minutes = String((idx % 4) * 15).padStart(2, '0');
                          const time = `${hours}:${minutes}`;
                          return (
                            <MenuItem key={time} value={time}>
                              {time}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                    <Popover
                      open={Boolean(moveDateAnchor)}
                      anchorEl={moveDateAnchor}
                      onClose={() => setMoveDateAnchor(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                      PaperProps={{ sx: { minWidth: 280 } }}
                    >
                      <Box sx={{ p: 2 }}>
                        <DateRangeCalendar
                          mode="single-or-range"
                          value={{ from: getMoveDatePart(), to: getMoveDatePart() }}
                          onChange={(v) => {
                            const selected = typeof v === 'string' ? v : v.from;
                            setMoveDatePart(selected);
                          }}
                          onClose={() => setMoveDateAnchor(null)}
                        />
                      </Box>
                    </Popover>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Duration (minutes)"
                    type="number"
                    value={moveDurationMinutes}
                    onChange={(e) => setMoveDurationMinutes(Math.max(15, Number(e.target.value) || 15))}
                    fullWidth
                    inputProps={{ min: 15, step: 15 }}
                    required
                  />
                </Grid>
                {moveStartDateTime && (
                  <Grid item xs={12}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t) }}>
                      Ends at {new Date(new Date(moveStartDateTime).getTime() + moveDurationMinutes * 60000).toLocaleString()}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          )}

          {editMode === 'transfer' && (
            <Box sx={{ mt: 0 }}>
              <Typography variant="body2" color="text.secondary" paragraph>
                Transfer ownership of this event to another user. The event moves off {normalizedUserEmail || "the current user"}&rsquo;s calendar onto the new owner&rsquo;s calendar, and they become the organizer. Only non-recurring events can be transferred.
              </Typography>
              <Autocomplete
                freeSolo
                options={transferSuggestions}
                value={transferTargetEmail}
                inputValue={transferTargetEmail}
                onInputChange={(_, value) => setTransferTargetEmail(value)}
                onChange={(_, value) => setTransferTargetEmail(typeof value === 'string' ? value : '')}
                filterOptions={(options, { inputValue }) => {
                  if (!inputValue.trim()) return options;
                  const search = inputValue.toLowerCase().trim();
                  return options.filter((option) => option.toLowerCase().includes(search));
                }}
                  fullWidth
                sx={{ mb: 2 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="New owner"
                    placeholder="Type name/email (e.g. joe)"
                    helperText="Search by name/email or type an email address"
                  />
                )}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1, justifyContent: 'flex-end' }}>
          <Button onClick={handleCloseEventDialog} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: (t) => textSecondary(t), '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') } }}>
            {editMode === 'view' ? 'Close' : 'Cancel'}
          </Button>
          {editMode === 'transfer' && (
            <Button
              variant="contained" color="secondary"
              onClick={handleTransferEvent} disabled={!transferTargetEmail.trim()}
              sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, px: 2.5 }}
            >
              Transfer ownership
            </Button>
          )}
          {editMode !== 'view' && editMode !== 'transfer' && (
            <Button
              variant="contained"
              onClick={handleSaveEvent}
              sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover }, px: 2.5 }}
            >
              Save Changes
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar((s) => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%', fontFamily: T.font, borderRadius: T.radius, alignItems: 'center' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
