import { Navigate } from 'react-router-dom';
import { authService } from '../services/auth.service';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

import { isDemoMode } from '../data/demoData';
const DEMO_MODE = isDemoMode();

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  // Demo mode - bypass auth to view UI
  if (DEMO_MODE) {
    return <>{children}</>;
  }
  
  // Real auth mode
  if (!authService.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
