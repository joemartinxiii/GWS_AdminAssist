import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useState, useEffect, createContext } from 'react';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginRoute } from './pages/LoginRoute';
import {
  Users,
  Drive,
  SharedDrives,
  EmailDelegation,
  EmailSignatures,
  Calendar,
  Groups,
  SecurityAudit,
} from './pages/PageRoutes';
import { T, TDark } from './theme/designTokens';

// Create a context for theme mode
interface ThemeContextType {
  mode: 'light' | 'dark';
  toggleColorMode: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  mode: 'light',
  toggleColorMode: () => {},
});

function App() {
  // Get initial mode from localStorage or default to light
  const [mode, setMode] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('themeMode');
    return (saved === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
  });

  // Save to localStorage whenever mode changes
  useEffect(() => {
    localStorage.setItem('themeMode', mode);
  }, [mode]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const SCROLLING_CLASS = 'is-scrolling';

    const markScrolling = () => {
      document.body.classList.add(SCROLLING_CLASS);
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        document.body.classList.remove(SCROLLING_CLASS);
      }, 300);
    };

    window.addEventListener('scroll', markScrolling, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', markScrolling, { capture: true });
      if (timeoutId) clearTimeout(timeoutId);
      document.body.classList.remove(SCROLLING_CLASS);
    };
  }, []);

  const toggleColorMode = () => {
    setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
  };

  const theme = createTheme({
    palette: {
      mode,
      primary: {
        main: '#1a73e8',
        light: '#4a9af4',
        dark: '#1557b0',
        contrastText: '#ffffff',
      },
      secondary: {
        main: '#dc004e',
      },
      ...(mode === 'dark' ? {
        background: { default: '#09090b', paper: '#18181b' },
        text: {
          primary: '#fafafa',
          secondary: TDark.textSecondary,
          disabled: 'rgba(255,255,255,0.38)',
        },
        divider: 'rgba(255,255,255,0.08)',
      } : {
        background: { default: '#f5f5f3', paper: '#ffffff' },
        text: {
          primary: '#1a1a1a',
          secondary: '#71717a',
        },
        divider: '#e8e8e4',
      }),
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: T.font,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 700,
      h1: { letterSpacing: '-0.03em' },
      h2: { letterSpacing: '-0.02em' },
      h3: { letterSpacing: '-0.02em' },
      h4: { letterSpacing: '-0.02em' },
      h5: { letterSpacing: '-0.01em' },
      h6: { letterSpacing: '-0.01em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: `
          html, body, #root {
            font-family: ${T.font};
          }
          code, kbd, pre, .mono {
            font-family: ${T.mono};
          }
          /* Thin overlay scrollbars that appear while actively scrolling */
          ::-webkit-scrollbar {
            width: 0;
            height: 0;
            background: transparent;
            transition: width 0.2s ease, height 0.2s ease;
          }

          ::-webkit-scrollbar-track {
            background: transparent;
          }

          ::-webkit-scrollbar-thumb {
            background: transparent;
            border-radius: 3px;
            border: 1px solid transparent;
            background-clip: content-box;
            transition: background-color 0.2s ease;
          }

          *:hover::-webkit-scrollbar,
          body.is-scrolling ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }

          *:hover::-webkit-scrollbar-thumb,
          body.is-scrolling ::-webkit-scrollbar-thumb {
            background: rgba(107,114,128,0.55);
          }

          /* Dark mode scrollbars */
          [data-theme="dark"] ::-webkit-scrollbar-thumb {
            background: transparent;
            background-clip: content-box;
          }

          [data-theme="dark"] body.is-scrolling ::-webkit-scrollbar-thumb,
          body.is-scrolling [data-theme="dark"] ::-webkit-scrollbar-thumb {
            background: rgba(75,85,99,0.4);
            background-clip: content-box;
          }

          [data-theme="dark"] *:hover::-webkit-scrollbar-thumb,
          *:hover [data-theme="dark"] ::-webkit-scrollbar-thumb {
            background: rgba(75,85,99,0.4);
            background-clip: content-box;
          }

          /* Make scrollbar more visible during active interaction */
          ::-webkit-scrollbar-thumb:hover {
            background: rgba(75,85,99,0.75);
            background-clip: content-box;
          }

          [data-theme="dark"] ::-webkit-scrollbar-thumb:hover {
            background: rgba(75,85,99,0.7);
            background-clip: content-box;
          }

          ::-webkit-scrollbar-corner {
            background: transparent;
          }

          * {
            scrollbar-width: none;
          }

          *:hover {
            scrollbar-width: thin;
            scrollbar-color: rgba(107,114,128,0.55) transparent;
          }

          body.is-scrolling * {
            scrollbar-width: thin;
            scrollbar-color: rgba(107,114,128,0.55) transparent;
          }

          [data-theme="dark"] body.is-scrolling *,
          body.is-scrolling [data-theme="dark"] * {
            scrollbar-color: rgba(75,85,99,0.4) transparent;
          }
        `,
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontFamily: T.font,
            fontWeight: 500,
            borderRadius: '8px',
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' },
            '&:active': { boxShadow: 'none' },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: '12px' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { fontSize: '0.875rem', fontFamily: T.font },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            fontFamily: T.font,
            borderRadius: '8px',
            fontSize: '0.8125rem',
          },
          input: {
            fontSize: '0.8125rem',
            lineHeight: 1.43,
          },
          inputSizeSmall: {
            fontSize: '0.8125rem',
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { fontSize: '0.8125rem' },
          input: { fontSize: '0.8125rem' },
          inputMultiline: { fontSize: '0.8125rem' },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            fontFamily: T.font,
            fontSize: '0.8125rem',
            '&.MuiInputLabel-sizeSmall': { fontSize: '0.8125rem' },
            '&.Mui-focused': { fontSize: '0.8125rem' },
          },
          shrink: {
            fontSize: '0.75rem',
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select: { fontSize: '0.8125rem' },
        },
      },
      MuiMenuItem: {
        styleOverrides: { root: { fontFamily: T.font, fontSize: '0.8125rem' } },
      },
      MuiListItemText: {
        styleOverrides: { primary: { fontFamily: T.font } },
      },
      MuiChip: {
        styleOverrides: { root: { fontFamily: T.font } },
      },
      MuiTab: {
        styleOverrides: { root: { fontFamily: T.font, textTransform: 'none' } },
      },
      MuiTooltip: {
        // `disableInteractive` drops the "stays open while pointer moves onto
        // the tooltip" tracking, which is what let tooltips get stuck open
        // (and stack up) after clicking icon buttons that receive focus.
        defaultProps: { disableInteractive: true },
      },
    },
  });

  return (
    <ThemeContext.Provider value={{ mode, toggleColorMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/auth/callback" element={<LoginRoute />} />
          <Route path="/auth/error" element={<LoginRoute />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout>
                  <Navigate to="/users" replace />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <Layout>
                  <Users />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/drive"
            element={
              <ProtectedRoute>
                <Layout>
                  <Drive />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/shared-drives"
            element={
              <ProtectedRoute>
                <Layout>
                  <SharedDrives />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/email-delegation"
            element={
              <ProtectedRoute>
                <Layout>
                  <EmailDelegation />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/email-signatures"
            element={
              <ProtectedRoute>
                <Layout>
                  <EmailSignatures />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <Layout>
                  <Calendar />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/groups"
            element={
              <ProtectedRoute>
                <Layout>
                  <Groups />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute>
                <Layout>
                  <SecurityAudit />
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
    </ThemeContext.Provider>
  );
}

export default App;
