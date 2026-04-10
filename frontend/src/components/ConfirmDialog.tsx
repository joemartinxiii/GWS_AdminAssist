import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { T, pick, textSecondary } from '../theme/designTokens';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  danger = false,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const theme = useTheme();

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Caller handles errors; keep dialog open
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          fontFamily: T.font,
          bgcolor: pick(theme, T.surface, '#18181b'),
          backgroundImage: 'none',
          border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
          borderRadius: T.radiusLg,
          '& .MuiDialogTitle-root, & .MuiDialogContent-root, & .MuiDialogActions-root': {
            fontFamily: T.font,
          },
        },
      }}
    >
      <DialogTitle sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: pick(theme, T.text, '#fafafa'), pb: 1.5, borderBottom: `1px solid ${pick(theme, T.borderSubtle, '#27272a')}` }}>
        {title}
      </DialogTitle>
      {children && <DialogContent sx={{ fontFamily: T.font, fontSize: '0.875rem', pt: '16px !important' }}>{children}</DialogContent>}
      <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${pick(theme, T.borderSubtle, '#27272a')}`, gap: 1 }}>
        <Button
          onClick={onClose}
          disabled={loading}
          sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: textSecondary(theme), '&:hover': { bgcolor: pick(theme, '#f0f0ec', '#27272a') } }}
        >
          {cancelLabel}
        </Button>
        <Button
          onClick={handleConfirm}
          color={danger ? 'error' : 'primary'}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{
            fontFamily: T.font,
            textTransform: 'none',
            borderRadius: T.radius,
            fontSize: '0.8125rem',
            fontWeight: 500,
            px: 2.5,
            ...(danger
              ? {}
              : {
                  bgcolor: T.accent,
                  '&:hover': { bgcolor: T.accentHover },
                }),
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
