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
  invalid_state: 'Sign-in was rejected (security check failed). Please try again.',
};

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Strip any legacy token fragments from older builds (tokens must not live in the URL).
    if (window.location.hash && /token=/i.test(window.location.hash)) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const authError = searchParams.get('error');
    if (authError) {
      setError(AUTH_ERROR_MESSAGES[authError] || 'Sign-in failed. Please try again.');
      window.history.replaceState(null, '', window.location.pathname);
      setChecking(false);
      return;
    }

    let mounted = true;
    authService.checkSession().then((user) => {
      if (!mounted) return;
      if (user) {
        navigate('/users', { replace: true });
      } else {
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
    };
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

  if (checking) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#18181b' : T.bg),
        }}
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

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
