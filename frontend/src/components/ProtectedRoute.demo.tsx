// Demo version - bypasses authentication for UI preview
// To use: rename this file to ProtectedRoute.tsx (backup the original first)

import { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  // Demo mode: always allow access
  return <>{children}</>;
}
