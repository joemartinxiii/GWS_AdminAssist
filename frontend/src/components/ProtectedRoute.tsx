import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { authService } from '../services/auth.service';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Guards app routes by probing the HttpOnly session cookie via /api/auth/me.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'no'>('loading');

  useEffect(() => {
    let mounted = true;
    authService.checkSession().then((user) => {
      if (mounted) setStatus(user ? 'ok' : 'no');
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (status === 'loading') {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (status === 'no') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
