import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  Box,
  IconButton,
  Typography,
} from '@mui/material';
import { X, AlertTriangle } from 'lucide-react';
import {
  T,
  pick,
  textSecondary,
  textTertiary,
  dialogPaperSx,
  dialogActionsSx,
  dialogPrimaryButtonSx,
  dialogCancelButtonSx,
  dialogDangerButtonSx,
} from '../theme/designTokens';

export type ConfirmEntity = {
  name: string;
  detail?: string;
};

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Optional list of affected entities (bulk delete, etc.). */
  entities?: ConfirmEntity[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean;
  /** Soft warning chrome instead of danger (default: danger when `danger`). */
  tone?: 'danger' | 'warning';
}

export function ConfirmDialog({
  open,
  title,
  children,
  entities,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  danger = false,
  tone,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const iconTone = tone ?? (danger ? 'danger' : 'warning');

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
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: (th) => ({ ...dialogPaperSx(th), maxWidth: 420 }) }}
    >
      <DialogTitle
        sx={(th) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          fontFamily: T.font,
          fontWeight: 700,
          fontSize: '1rem',
          letterSpacing: '-0.02em',
          color: pick(th, T.text, '#fafafa'),
          pr: 1,
          pb: 0,
          borderBottom: 'none',
        })}
      >
        <Box
          sx={(th) => ({
            width: 40,
            height: 40,
            borderRadius: '10px',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            bgcolor:
              iconTone === 'danger'
                ? pick(th, T.dangerSoft, 'rgba(220, 38, 38, 0.12)')
                : pick(th, T.warningSoft, 'rgba(217, 119, 6, 0.15)'),
            color: iconTone === 'danger' ? pick(th, T.danger, '#f87171') : pick(th, T.warning, '#fbbf24'),
          })}
        >
          <AlertTriangle size={18} strokeWidth={2} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
        <IconButton
          size="small"
          onClick={onClose}
          disabled={loading}
          aria-label="Close"
          sx={{ color: (t) => textTertiary(t), flexShrink: 0 }}
        >
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </DialogTitle>
      {(children || (entities && entities.length > 0)) && (
        <DialogContent sx={{ fontFamily: T.font, fontSize: '0.875rem', pt: '8px !important' }}>
          {children}
          {entities && entities.length > 0 && (
            <Box
              sx={(th) => ({
                mt: 1.75,
                border: `1px solid ${pick(th, T.border, '#3f3f46')}`,
                borderRadius: T.radius,
                overflow: 'hidden',
              })}
            >
              {entities.map((ent, i) => (
                <Box
                  key={`${ent.name}-${ent.detail ?? i}`}
                  sx={(th) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    px: 1.5,
                    py: 1,
                    borderBottom:
                      i < entities.length - 1 ? `1px solid ${pick(th, T.border, '#3f3f46')}` : 'none',
                  })}
                >
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      color: (t) => pick(t, T.text, '#fafafa'),
                    }}
                  >
                    {ent.name}
                  </Typography>
                  {ent.detail && (
                    <Typography
                      sx={{
                        fontFamily: T.mono,
                        fontSize: '0.75rem',
                        color: (t) => textSecondary(t),
                        ml: 'auto',
                      }}
                    >
                      {ent.detail}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
      )}
      <DialogActions sx={(th) => dialogActionsSx(th)}>
        <Box sx={{ flex: 1 }} />
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
