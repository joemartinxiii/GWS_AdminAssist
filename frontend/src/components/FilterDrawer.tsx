import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import { ListFilter, X } from 'lucide-react';

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** Optional helper content above the close control (e.g. keyboard shortcuts). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const DRAWER_WIDTH = 380;

export function FilterDrawer({
  open,
  onClose,
  title = 'Filters',
  hasActiveFilters = false,
  onClearFilters,
  footer,
  children,
}: FilterDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          mt: 0,
          height: '100%',
          maxHeight: '100vh',
          pt: 2,
          pb: 2,
          px: 2,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexShrink: 0 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ListFilter size={22} strokeWidth={1.75} /> {title}
        </Typography>
        {hasActiveFilters && onClearFilters && (
          <Tooltip title="Remove Filters">
            <IconButton size="small" onClick={onClearFilters} color="error" aria-label="Remove filters">
              <X size={18} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{children}</Box>
      <Box sx={{ flexShrink: 0, pt: 2, borderTop: 1, borderColor: 'divider' }}>
        {footer != null && footer !== false && <Box sx={{ mb: 1.5 }}>{footer}</Box>}
        <Tooltip title="Close Drawer">
          <IconButton color="primary" onClick={onClose} aria-label="Close Drawer">
            <Typography component="span" sx={{ fontSize: '1.25rem', fontWeight: 600, lineHeight: 1 }}>&gt;</Typography>
          </IconButton>
        </Tooltip>
      </Box>
    </Drawer>
  );
}
