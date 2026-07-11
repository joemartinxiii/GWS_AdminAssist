import { useState, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
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
  Chip,
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
import { T, pick, textSecondary, textTertiary, PAGE_MAX_WIDTH } from '../theme/designTokens';
import { FontLinks } from './FontLinks';

const LU = 1.75;
const ICON_SZ = 20;

const drawerWidthExpanded = 240;
const drawerWidthCollapsed = 72;

interface LayoutProps {
  children: React.ReactNode;
}

type NavItem = {
  text: string;
  icon: ReactNode;
  path: string;
  permission: Permission | null;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

function buildNavSections(): NavSection[] {
  const sz = ICON_SZ;
  return [
    {
      label: 'Directory',
      items: [
        { text: 'People', icon: <User size={sz} strokeWidth={LU} />, path: '/users', permission: 'users.view' },
        { text: 'Groups', icon: <Users size={sz} strokeWidth={LU} />, path: '/groups', permission: 'groups.view' },
      ],
    },
    {
      label: 'Access',
      items: [
        { text: 'Calendar', icon: <Calendar size={sz} strokeWidth={LU} />, path: '/calendar', permission: 'calendar.view' },
        { text: 'Delegation', icon: <Mail size={sz} strokeWidth={LU} />, path: '/email-delegation', permission: 'gmail.view' },
        { text: 'Drive', icon: <Folder size={sz} strokeWidth={LU} />, path: '/drive', permission: 'drive.view' },
        { text: 'Shared drives', icon: <HardDrive size={sz} strokeWidth={LU} />, path: '/shared-drives', permission: 'drive.view' },
        { text: 'Email signatures', icon: <PenLine size={sz} strokeWidth={LU} />, path: '/email-signatures', permission: 'gmail.view' },
      ],
    },
    {
      label: 'Security',
      items: [
        { text: 'Audit', icon: <Shield size={sz} strokeWidth={LU} />, path: '/audit', permission: 'audit.view' },
      ],
    },
  ];
}

function AppMark() {
  return (
    <Box
      sx={{
        width: 32,
        height: 32,
        borderRadius: '9px',
        background: 'linear-gradient(145deg, #2b8aef, #1557b0)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 4px 12px rgba(26,115,232,0.35)',
        color: '#fff',
      }}
      aria-hidden
    >
      <Shield size={16} strokeWidth={2} />
    </Box>
  );
}

export function Layout({ children }: LayoutProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOverlayOpen, setMobileOverlayOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string; picture?: string } | null>(null);
  const [openNavTooltip, setOpenNavTooltip] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = usePermissions();
  const { hasPermission, isSuperAdmin, isDelegatedAdmin } = permissions;
  const { mode, toggleColorMode } = useContext(ThemeContext);

  const muiTheme = useTheme();
  const nestedMuiTheme = useMemo(() => muiTheme, [muiTheme]);

  const navSections = useMemo(() => buildNavSections(), []);

  const visibleSections = useMemo(
    () =>
      navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !item.permission || hasPermission(item.permission)),
        }))
        .filter((section) => section.items.length > 0),
    [navSections, hasPermission]
  );

  const handleDrawerToggle = () => {
    if (isMobile) setMobileOverlayOpen((prev) => !prev);
    else setSidebarExpanded((prev) => !prev);
  };

  const drawerWidth = isMobile ? drawerWidthExpanded : sidebarExpanded ? drawerWidthExpanded : drawerWidthCollapsed;
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
    return words
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }, [currentUser?.name, currentUser?.email, isSuperAdmin]);

  const roleLabel = isSuperAdmin ? 'Super admin' : isDelegatedAdmin ? 'Delegated admin' : 'No admin';

  const drawer = (collapsed: boolean) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', px: 1.25, py: 1.5 }}>
      {/* Brand + toggle */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 0.75,
          pb: 2,
          minHeight: 48,
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        {!collapsed && <AppMark />}
        {!collapsed && (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontFamily: T.font,
                fontWeight: 700,
                fontSize: '0.8125rem',
                letterSpacing: '-0.02em',
                color: (th) => pick(th, T.text, '#fafafa'),
                lineHeight: 1.2,
              }}
            >
              AdminAssist
            </Typography>
            <Typography
              sx={{
                fontFamily: T.font,
                fontSize: '0.6875rem',
                color: (t) => textTertiary(t),
                lineHeight: 1.2,
              }}
            >
              Workspace ops
            </Typography>
          </Box>
        )}
        {collapsed && (
          <Tooltip title="AdminAssist" placement="right">
            <Box sx={{ display: 'grid', placeItems: 'center' }}>
              <AppMark />
            </Box>
          </Tooltip>
        )}
        {!isMobile && (
          <IconButton
            color="inherit"
            aria-label={sidebarExpanded ? 'collapse sidebar' : 'expand sidebar'}
            onClick={handleDrawerToggle}
            size="small"
            sx={{
              ml: collapsed ? 0 : 'auto',
              color: (t) => textSecondary(t),
              display: collapsed ? 'none' : 'inline-flex',
            }}
          >
            <MenuHamburger size={18} strokeWidth={LU} />
          </IconButton>
        )}
      </Box>

      {collapsed && !isMobile && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
          <IconButton
            color="inherit"
            aria-label="expand sidebar"
            onClick={handleDrawerToggle}
            size="small"
            sx={{ color: (t) => textSecondary(t) }}
          >
            <MenuHamburger size={18} strokeWidth={LU} />
          </IconButton>
        </Box>
      )}

      <List sx={{ flexGrow: 1, px: 0, pt: 0 }}>
        {visibleSections.map((section) => (
          <Box key={section.label} sx={{ mt: section.label === visibleSections[0]?.label ? 0 : 1 }}>
            {!collapsed && (
              <Typography
                sx={{
                  fontFamily: T.font,
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: (t) => textTertiary(t),
                  px: 1.25,
                  pt: 1.25,
                  pb: 0.75,
                }}
              >
                {section.label}
              </Typography>
            )}
            {section.items.map((item) => {
              const active = location.pathname === item.path;
              return (
                <ListItem key={item.path} disablePadding sx={{ display: 'block', mb: 0.25, position: 'relative' }}>
                  {active && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: -6,
                        top: 8,
                        bottom: 8,
                        width: 3,
                        borderRadius: 1,
                        bgcolor: T.accent,
                        zIndex: 1,
                      }}
                    />
                  )}
                  <Tooltip
                    title={collapsed ? item.text : ''}
                    placement="right"
                    disableHoverListener={!collapsed}
                    disableInteractive
                    open={collapsed && openNavTooltip === item.path}
                    onOpen={() => setOpenNavTooltip(item.path)}
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
                        borderRadius: T.radius,
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        px: collapsed ? 1.25 : 1.25,
                        py: 1.125,
                        color: active
                          ? pick(th, T.accent, '#8ab4f8')
                          : pick(th, T.textSecondary, '#a1a1aa'),
                        bgcolor: active
                          ? pick(th, T.accentSoft, 'rgba(26,115,232,0.16)')
                          : 'transparent',
                        '&:hover': {
                          bgcolor: active
                            ? pick(th, T.accentSoft, 'rgba(26,115,232,0.20)')
                            : pick(th, 'rgba(0,0,0,0.04)', '#27272a'),
                          color: active ? pick(th, T.accent, '#8ab4f8') : pick(th, T.text, '#fafafa'),
                        },
                        '&.Mui-selected': {
                          bgcolor: pick(th, T.accentSoft, 'rgba(26,115,232,0.16)'),
                          '&:hover': {
                            bgcolor: pick(th, T.accentSoft, 'rgba(26,115,232,0.20)'),
                          },
                        },
                      })}
                    >
                      <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: 'inherit' }}>{item.icon}</ListItemIcon>
                      {!collapsed && (
                        <ListItemText
                          primary={item.text}
                          primaryTypographyProps={{
                            fontFamily: T.font,
                            fontSize: '0.8125rem',
                            fontWeight: 500,
                            color: 'inherit',
                          }}
                        />
                      )}
                    </ListItemButton>
                  </Tooltip>
                </ListItem>
              );
            })}
          </Box>
        ))}
      </List>

      {/* Rail foot — user chip */}
      <Box
        sx={{
          mt: 'auto',
          pt: 1.5,
          borderTop: (th) => `1px solid ${pick(th, T.border, '#2e2e33')}`,
        }}
      >
        <Box
          onClick={handleMenuClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleMenuClick(e as unknown as React.MouseEvent<HTMLElement>);
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 0.75,
            py: 1,
            borderRadius: T.radius,
            cursor: 'pointer',
            justifyContent: collapsed ? 'center' : 'flex-start',
            '&:hover': { bgcolor: (th) => pick(th, 'rgba(0,0,0,0.04)', '#27272a') },
          }}
        >
          <Avatar
            src={currentUser?.picture}
            alt={currentUser?.name || currentUser?.email || 'User'}
            sx={{
              width: 28,
              height: 28,
              fontSize: '0.6875rem',
              fontWeight: 600,
              bgcolor: (th) => pick(th, '#e4e4e7', '#3f3f46'),
              color: (t) => textSecondary(t),
            }}
          >
            {avatarLabel}
          </Avatar>
          {!collapsed && (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                noWrap
                sx={{
                  fontFamily: T.font,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: (th) => pick(th, T.text, '#fafafa'),
                  lineHeight: 1.3,
                }}
              >
                {currentUser?.name || currentUser?.email || 'Admin'}
              </Typography>
              <Typography
                noWrap
                sx={{
                  fontFamily: T.font,
                  fontSize: '0.6875rem',
                  color: (t) => textTertiary(t),
                  lineHeight: 1.3,
                }}
              >
                {roleLabel}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );

  const userMenu = (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
      <MenuItem disabled sx={{ opacity: 1, cursor: 'default' }}>
        <Chip
          label={
            isSuperAdmin
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
      <MenuItem
        onClick={() => {
          toggleColorMode();
          handleMenuClose();
        }}
      >
        <ListItemIcon>{mode === 'dark' ? <Sun size={18} strokeWidth={LU} /> : <Moon size={18} strokeWidth={LU} />}</ListItemIcon>
        {mode === 'dark' ? 'Light mode' : 'Dark mode'}
      </MenuItem>
      <MenuItem onClick={handleLogout}>
        <ListItemIcon>
          <LogOut size={18} strokeWidth={LU} />
        </ListItemIcon>
        Logout
      </MenuItem>
    </Menu>
  );

  const layoutTree = (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <FontLinks />
      {/* Compact top bar — theme toggle + mobile menu; brand lives in the rail */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          transition: (th) =>
            th.transitions.create(['width', 'margin'], {
              duration: th.transitions.duration.enteringScreen,
              easing: th.transitions.easing.sharp,
            }),
          borderBottom: (th) => `1px solid ${pick(th, 'rgba(0,0,0,0.08)', 'rgba(255,255,255,0.10)')}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 48, sm: 52 } }}>
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
          <Box sx={{ flexGrow: 1 }} />
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
              mr: { xs: 1.5, sm: 0 },
              flexShrink: 0,
            }}
          >
            {(
              [
                { label: 'light', icon: <Sun size={15} strokeWidth={1.75} /> },
                { label: 'dark', icon: <Moon size={15} strokeWidth={1.75} /> },
              ] as const
            ).map(({ label, icon }) => {
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
          {isMobile && (
            <IconButton onClick={handleMenuClick} sx={{ p: 0 }}>
              <Avatar
                src={currentUser?.picture}
                alt={currentUser?.name || currentUser?.email || 'User'}
                sx={{
                  width: 28,
                  height: 28,
                  fontSize: '0.6875rem',
                  bgcolor: (th) => pick(th, '#e4e4e7', '#3f3f46'),
                  color: (t) => textSecondary(t),
                }}
              >
                {avatarLabel}
              </Avatar>
            </IconButton>
          )}
        </Toolbar>
      </AppBar>
      {userMenu}
      <Box
        component="nav"
        sx={{
          width: { sm: drawerWidth },
          flexShrink: { sm: 0 },
          transition: (th) =>
            th.transitions.create('width', {
              duration: th.transitions.duration.enteringScreen,
              easing: th.transitions.easing.sharp,
            }),
        }}
      >
        <Drawer
          variant="temporary"
          open={mobileOverlayOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
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
              transition: (th) =>
                th.transitions.create('width', {
                  duration: th.transitions.duration.enteringScreen,
                  easing: th.transitions.easing.sharp,
                }),
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
          width: { xs: '100%', sm: `calc(100% - ${drawerWidth}px)` },
          transition: (th) =>
            th.transitions.create(['margin', 'width'], {
              duration: th.transitions.duration.enteringScreen,
              easing: th.transitions.easing.sharp,
            }),
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 48, sm: 52 } }} />
        <Box
          sx={{
            width: '100%',
            // Narrower than full HD so lists read denser and side margins grow.
            // Top padding matches horizontal scale for premium frame balance.
            maxWidth: PAGE_MAX_WIDTH,
            mx: 'auto',
            boxSizing: 'border-box',
            px: { xs: 3, sm: 4, md: 5, lg: 6 },
            pt: { xs: 3, sm: 4, md: 5, lg: 6 },
            pb: { xs: 5, sm: 6, md: 8, lg: 10 },
          }}
        >
          {permissions.error && (
            <Alert
              severity="warning"
              sx={{ mb: 3 }}
              action={
                <MuiButton color="inherit" size="small" onClick={() => permissions.refresh()}>
                  Retry
                </MuiButton>
              }
            >
              Some permissions couldn&apos;t be loaded, so parts of the app may be hidden or disabled.{' '}
              {permissions.error}
            </Alert>
          )}
          {children}
        </Box>
      </Box>
    </Box>
  );

  return <MuiThemeProviderNested theme={nestedMuiTheme}>{layoutTree}</MuiThemeProviderNested>;
}
