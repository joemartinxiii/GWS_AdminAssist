import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Typography, Box, CircularProgress, Alert } from '@mui/material';
import { authService } from '../services/auth.service';
import { T } from '../theme/designTokens';
import { FontLinks } from '../components/FontLinks';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: 'That account is not in an allowed Workspace domain. Sign in with your organization account.',
  not_admin: 'Your account is not a Google Workspace admin, so it cannot access this tool.',
  admin_check_failed: 'We could not verify your admin status. Check service-account delegation/scopes and try again.',
  callback_failed: 'Sign-in failed during the Google callback. Please try again.',
  no_code: 'Sign-in was interrupted. Please try again.',
};

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Tokens now arrive in the URL fragment (not the query string) to avoid
    // leaking them via server logs / Referer. Fall back to query params for
    // backward compatibility, and surface any auth-gate error.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hashParams.get('token') || searchParams.get('token');
    const refreshToken = hashParams.get('refreshToken') || searchParams.get('refreshToken');
    const authError = searchParams.get('error');

    if (authError) {
      setError(AUTH_ERROR_MESSAGES[authError] || 'Sign-in failed. Please try again.');
      // Clear the error from the URL so a refresh doesn't re-show it.
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (token) {
      authService.setSessionToken(token, refreshToken || undefined);
      // Strip the fragment so tokens don't linger in the address bar / history.
      window.history.replaceState(null, '', window.location.pathname);
      navigate('/users', { replace: true });
      return;
    }

    if (authService.isAuthenticated()) {
      navigate('/users', { replace: true });
    }
  }, [searchParams, navigate]);

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      const authUrl = await authService.getAuthUrl();
      window.location.href = authUrl;
    } catch (err: unknown) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initiate login. Backend may not be running.');
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        fontFamily: T.font,
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#18181b' : T.bg),
      }}
    >
      <FontLinks />
      <Box sx={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <Typography
          component="h1"
          sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.75rem', letterSpacing: '-0.02em', mb: 1, color: 'text.primary' }}
        >
          Workspace Admin
        </Typography>
        <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: 'text.secondary', mb: 4 }}>
          Sign in with your Google Workspace account
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2, width: '100%', fontFamily: T.font, borderRadius: T.radius }}>
            {error}
          </Alert>
        )}

        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleLogin}
          disabled={loading}
          sx={{
            mt: 2,
            fontFamily: T.font,
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: T.radius,
            py: 1.25,
            bgcolor: T.accent,
            '&:hover': { bgcolor: T.accentHover },
          }}
        >
          {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign in with Google'}
        </Button>
      </Box>
    </Box>
  );
}
