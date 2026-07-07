import { useCallback, useState, type ReactNode } from 'react';
import { Snackbar, Alert, type AlertColor } from '@mui/material';
import { getApiErrorMessage } from '../utils/apiError';

interface SnackbarState {
  open: boolean;
  message: string;
  severity: AlertColor;
  action?: ReactNode;
}

const INITIAL: SnackbarState = { open: false, message: '', severity: 'success' };

/**
 * Shared snackbar/toast hook so every page uses one consistent notification
 * pattern (severity, placement, duration) instead of hand-rolling `Snackbar` +
 * `Alert` state on each page. Render the returned `snackbar` element once in the
 * page tree.
 */
export function useSnackbar(autoHideDuration = 4000) {
  const [state, setState] = useState<SnackbarState>(INITIAL);

  const notify = useCallback(
    (message: string, severity: AlertColor = 'success', action?: ReactNode) =>
      setState({ open: true, message, severity, action }),
    []
  );

  const showSuccess = useCallback((message: string, action?: ReactNode) => notify(message, 'success', action), [notify]);
  const showInfo = useCallback((message: string, action?: ReactNode) => notify(message, 'info', action), [notify]);
  const showWarning = useCallback((message: string, action?: ReactNode) => notify(message, 'warning', action), [notify]);
  const showError = useCallback(
    (error: unknown, fallback?: string) => notify(getApiErrorMessage(error, fallback), 'error'),
    [notify]
  );

  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  const snackbar = (
    <Snackbar
      open={state.open}
      autoHideDuration={autoHideDuration}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={close} severity={state.severity} variant="filled" action={state.action} sx={{ width: '100%' }}>
        {state.message}
      </Alert>
    </Snackbar>
  );

  return { snackbar, notify, showSuccess, showInfo, showWarning, showError, closeSnackbar: close };
}
