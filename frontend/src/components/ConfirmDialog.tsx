import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  dialogPaperSx,
  dialogTitleSx,
  dialogActionsSx,
  dialogPrimaryButtonSx,
  dialogCancelButtonSx,
  dialogDangerButtonSx,
} from '../theme/designTokens';

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
      PaperProps={{ sx: (th) => dialogPaperSx(th) }}
    >
      <DialogTitle sx={(th) => dialogTitleSx(th)}>
        {title}
      </DialogTitle>
      {children && (
        <DialogContent sx={{ fontFamily: 'inherit', fontSize: '0.875rem', pt: '16px !important' }}>
          {children}
        </DialogContent>
      )}
      <DialogActions sx={(th) => dialogActionsSx(th)}>
        <Button onClick={onClose} disabled={loading} sx={(th) => dialogCancelButtonSx(th)}>
          {cancelLabel}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={(th) => (danger ? dialogDangerButtonSx(th) : dialogPrimaryButtonSx(th))}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
