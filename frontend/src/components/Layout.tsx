import { useState, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  Tooltip,
  Alert,
  Button as MuiButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ThemeProvider as MuiThemeProviderNested } from '@mui/material/styles';
import {
  Menu as MenuHamburger,
  User,
  Users,
  Calendar,
  Mail,
  Folder,
  HardDrive,
  PenLine,
  Shield,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react';
import { authService } from '../services/auth.service';
import { usePermissions } from '../hooks/usePermissions';
import { Permission } from '../services/permissions.service';
import { ThemeContext } from '../App';
import { T } from '../theme/designTokens';
import { FontLinks } from './FontLinks';
import { Chip } from '@mui/material';

const LU = 1.75;
const ICON_SZ = 22;

const drawerWidthExpanded = 280;
const drawerWidthCollapsed = 72;

interface LayoutProps {
  children: React.ReactNode;
}

function buildMenuItems(): Array<{
  text: string;
  icon: ReactNode;
  path: string;
  permission: Permission | null;
}> {
  const sz = ICON_SZ;
  return [
    { text: 'People', icon: <User size={sz} strokeWidth={LU} />, path: '/users', permission: 'users.view' },
    { text: 'Groups', icon: <Users size={sz} strokeWidth={LU} />, path: '/groups', permission: 'groups.view' },
    { text: 'Calendar', icon: <Calendar size={sz} strokeWidth={LU} />, path: '/calendar', permission: 'calendar.view' },
    { text: 'Email Delegation', icon: <Mail size={sz} strokeWidth={LU} />, path: '/email-delegation', permission: 'gmail.view' },
    { text: 'Drive File Explorer', icon: <Folder size={sz} strokeWidth={LU} />, path: '/drive', permission: 'drive.view' },
    { text: 'Shared Drives', icon: <HardDrive size={sz} strokeWidth={LU} />, path: '/shared-drives', permission: 'drive.view' },
    { text: 'Email Signatures', icon: <PenLine size={sz} strokeWidth={LU} />, path: '/email-signatures', permission: 'gmail.view' },
    { text: 'Security Audit', icon: <Shield size={sz} strokeWidth={LU} />, path: '/audit', permission: 'audit.view' },
  ];
}

export function Layout({ children }: LayoutProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string; picture?: string } | null>(null);
  // Nav tooltips are explicitly controlled (rather than left to MUI's own
  // hover/focus tracking) so a click always closes them deterministically,
  // instead of relying on a mouseleave/blur that may not fire for every
  // input method.
  const [openNavTooltip, setOpenNavTooltip] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = usePermissions(); // Full hook for role display + hasPermission
  const { hasPermission, isSuperAdmin, isDelegatedAdmin } = permissions;
  const { mode, toggleColorMode } = useContext(ThemeContext);

  const muiTheme = useTheme();
  const nestedMuiTheme = useMemo(() => muiTheme, [muiTheme]);

  const menuItems = useMemo(() => buildMenuItems(), []);

  const visibleMenuItems = menuItems.filter(item =>
    !item.permission || hasPermission(item.permission)
  );

  const handleDrawerToggle = () => {
    if (isMobile) setMobileOverlayOpen(prev => !prev);
    else setSidebarExpanded(prev => !prev);
  };

  const drawerWidth = isMobile ? drawerWidthExpanded : (sidebarExpanded ? drawerWidthExpanded : drawerWidthCollapsed);
  const drawerCollapsed = isMobile ? false : !sidebarExpanded;

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    await authService.logout();
    navigate('/login');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleColorMode();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleColorMode]);

  useEffect(() => {
    let mounted = true;
    const loadCurrentUser = async () => {
      try {
        // Prefer cache from ProtectedRoute checkSession; refresh if needed
        const cached = authService.getCachedUser();
        if (cached) {
          if (mounted) setCurrentUser(cached);
          return;
        }
        const user = await authService.getCurrentUser();
        if (mounted) setCurrentUser(user);
      } catch {
        if (mounted) setCurrentUser(null);
      }
    };
    void loadCurrentUser();
    return () => {
      mounted = false;
    };
  }, []);

  const avatarLabel = useMemo(() => {
    const source = (currentUser?.name || currentUser?.email || '').trim();
    if (!source) return isSuperAdmin ? 'S' : 'A';
    const words = source.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }, [currentUser?.name, currentUser?.email, isSuperAdmin]);

  const drawer = (collapsed: boolean) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar
        sx={{
          minHeight: { xs: 56, sm: 64 },
          justifyContent: collapsed ? 'center' : 'flex-start',
          pl: 0,
          pr: collapsed ? 0 : 2,
        }}
      >
        <IconButton
          color="inherit"
          aria-label={isMobile ? (mobileOverlayOpen ? 'close menu' : 'open menu') : (sidebarExpanded ? 'collapse sidebar' : 'expand sidebar')}
          edge={collapsed ? false : 'start'}
          onClick={handleDrawerToggle}
          sx={{ mr: collapsed ? 0 : 1 }}
        >
          <MenuHamburger size={22} strokeWidth={LU} />
        </IconButton>
      </Toolbar>
      <Divider />
      <List sx={{ flexGrow: 1, px: 1, pt: 1 }}>
        {visibleMenuItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <ListItem key={item.text} disablePadding sx={{ display: 'block', mb: 0.25 }}>
              <Tooltip
                title={collapsed ? item.text : ''}
                placement="right"
                disableHoverListener={!collapsed}
                disableInteractive
                open={collapsed && openNavTooltip === item.text}
                onOpen={() => setOpenNavTooltip(item.text)}
                onClose={() => setOpenNavTooltip(null)}
              >
                <ListItemButton
                  selected={active}
                  onClick={(e) => {
                    navigate(item.path);
                    setMobileOverlayOpen(false);
                    setOpenNavTooltip(null);
                    e.currentTarget.blur();
                  }}
                  sx={(th) => ({
                    borderRadius: '8px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    px: collapsed ? 1.5 : 1.75,
                    py: 0.875,
                    color: active
                      ? '#1a73e8'
                      : th.palette.mode === 'dark' ? '#a1a1aa' : '#52525b',
                    bgcolor: active
                      ? th.palette.mode === 'dark' ? 'rgba(26,115,232,0.15)' : '#e8f0fe'
                      : 'transparent',
                    '&:hover': {
                      bgcolor: active
                        ? th.palette.mode === 'dark' ? 'rgba(26,115,232,0.20)' : '#dce8fd'
                        : th.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    },
                    '&.Mui-selected': {
                      bgcolor: th.palette.mode === 'dark' ? 'rgba(26,115,232,0.15)' : '#e8f0fe',
                      '&:hover': {
                        bgcolor: th.palette.mode === 'dark' ? 'rgba(26,115,232,0.20)' : '#dce8fd',
                      },
                    },
                  })}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, color: 'inherit' }}>
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={item.text}
                      primaryTypographyProps={{
                        fontFamily: T.font,
                        fontSize: '0.875rem',
                        fontWeight: active ? 600 : 400,
                        color: 'inherit',
                      }}
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          );
        })}
      </List>
    </Box>
  );

  const layoutTree = (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <FontLinks />
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          transition: (th) => th.transitions.create(['width', 'margin'], { duration: th.transitions.duration.enteringScreen, easing: th.transitions.easing.sharp }),
          borderBottom: '1px solid rgba(255,255,255,0.10)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton
              color="inherit"
              aria-label={mobileOverlayOpen ? 'close menu' : 'open menu'}
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 1 }}
            >
              <MenuHamburger size={22} strokeWidth={LU} />
            </IconButton>
          )}
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, fontWeight: 700, fontFamily: T.font, letterSpacing: '-0.01em' }}>
            GWS Admin Assist
          </Typography>
          <Box
            onClick={toggleColorMode}
            role="switch"
            aria-checked={mode === 'dark'}
            aria-label="Toggle color mode"
            sx={{
              display: 'inline-flex',
              borderRadius: '8px',
              bgcolor: 'rgba(255,255,255,0.1)',
              p: '3px',
              gap: '2px',
              cursor: 'pointer',
              mr: 1.5,
              flexShrink: 0,
            }}
          >
            {([
              { label: 'light', icon: <Sun size={15} strokeWidth={1.75} /> },
              { label: 'dark',  icon: <Moon size={15} strokeWidth={1.75} /> },
            ] as const).map(({ label, icon }) => {
              const active = mode === label;
              return (
                <Box
                  key={label}
                  sx={{
                    px: 1.25,
                    py: 0.5,
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: active ? (mode === 'dark' ? '#1a1a2e' : '#1a1a1a') : 'rgba(255,255,255,0.6)',
                    bgcolor: active ? '#ffffff' : 'transparent',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.18)' : 'none',
                    transition: 'all 0.18s ease',
                    userSelect: 'none',
                  }}
                >
                  {icon}
                </Box>
              );
            })}
          </Box>
          <IconButton onClick={handleMenuClick} sx={{ p: 0 }}>
            <Avatar
              src={currentUser?.picture}
              alt={currentUser?.name || currentUser?.email || 'User'}
              sx={{ width: 32, height: 32, bgcolor: isSuperAdmin ? '#2e7d32' : '#ed6c02' }}
            >
              {avatarLabel}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
          >
            <MenuItem disabled sx={{ opacity: 1, cursor: 'default' }}>
              <Chip
                label={isSuperAdmin 
                  ? 'Super Admin (Full Access)' 
                  : isDelegatedAdmin 
                    ? 'Delegated Admin (View Only)' 
                    : 'No Admin Privileges'
                }
                color={isSuperAdmin ? 'success' : isDelegatedAdmin ? 'warning' : 'default'}
                size="small"
                sx={{ fontFamily: T.font }}
              />
            </MenuItem>
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogOut size={18} strokeWidth={LU} />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 }, transition: (th) => th.transitions.create('width', { duration: th.transitions.duration.enteringScreen, easing: th.transitions.easing.sharp }) }}
      >
        <Drawer
          variant="temporary"
          open={mobileOverlayOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidthExpanded },
          }}
        >
          {drawer(false)}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              overflowX: 'hidden',
              transition: (th) => th.transitions.create('width', { duration: th.transitions.duration.enteringScreen, easing: th.transitions.easing.sharp }),
            },
          }}
          open
        >
          {drawer(drawerCollapsed)}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          height: '100vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          pt: 3,
          pb: 4,
          px: { xs: 3, sm: 5, md: 7 },
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          transition: (th) => th.transitions.create(['margin', 'width'], { duration: th.transitions.duration.enteringScreen, easing: th.transitions.easing.sharp }),
        }}
      >
        <Toolbar />
        {permissions.error && (
          <Alert
            severity="warning"
            sx={{ mx: 3, mt: 2 }}
            action={
              <MuiButton color="inherit" size="small" onClick={() => permissions.refresh()}>
                Retry
              </MuiButton>
            }
          >
            Some permissions couldn't be loaded, so parts of the app may be hidden or disabled. {permissions.error}
          </Alert>
        )}
        {children}
      </Box>
    </Box>
  );

  return <MuiThemeProviderNested theme={nestedMuiTheme}>{layoutTree}</MuiThemeProviderNested>;
}
