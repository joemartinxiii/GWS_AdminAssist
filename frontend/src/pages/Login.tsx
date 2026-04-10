import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Typography, Box, CircularProgress, Alert } from '@mui/material';
import { authService } from '../services/auth.service';
import { T } from '../theme/designTokens';
import { FontLinks } from '../components/FontLinks';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const refreshToken = searchParams.get('refreshToken');

    if (token) {
      authService.setSessionToken(token, refreshToken || undefined);
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
