/**
 * Static fixtures for local MSW mocks only (`VITE_USE_MSW=true`).
 * Not imported by production UI code.
 */

// ---------------------------------------------------------------------------
// Users (Users page, Calendar user list, etc.)
// ---------------------------------------------------------------------------

export interface DemoUser {
  id: string;
  primaryEmail: string;
  name: { givenName?: string; familyName?: string; fullName: string };
  isAdmin?: boolean;
  isDelegatedAdmin?: boolean;
  delegatedAdminPrivileges?: string[];
  suspended?: boolean;
  isEnrolledIn2Sv?: boolean;
  isEnforcedIn2Sv?: boolean;
  creationTime?: string;
  lastLoginTime?: string;
  orgUnitPath?: string;
  department?: string;
  location?: string;
  phone?: string;
  notes?: string;
}

export const users: DemoUser[] = [
  { id: '1', primaryEmail: 'john.doe@example.com', name: { givenName: 'John', familyName: 'Doe', fullName: 'John Doe' }, isAdmin: false, suspended: false, isEnrolledIn2Sv: true, isEnforcedIn2Sv: true, creationTime: '2023-01-15T10:30:00Z', lastLoginTime: '2024-01-20T14:15:00Z' },
  { id: '2', primaryEmail: 'jane.smith@example.com', name: { givenName: 'Jane', familyName: 'Smith', fullName: 'Jane Smith' }, isAdmin: true, suspended: false, isEnrolledIn2Sv: true, isEnforcedIn2Sv: true, creationTime: '2022-06-10T09:00:00Z', lastLoginTime: '2024-01-22T16:45:00Z' },
  { id: '3', primaryEmail: 'bob.johnson@example.com', name: { givenName: 'Bob', familyName: 'Johnson', fullName: 'Bob Johnson' }, isAdmin: false, suspended: false, isEnrolledIn2Sv: false, isEnforcedIn2Sv: true, creationTime: '2023-08-20T11:20:00Z', lastLoginTime: '2024-01-18T10:00:00Z' },
  { id: '4', primaryEmail: 'alice.williams@example.com', name: { givenName: 'Alice', familyName: 'Williams', fullName: 'Alice Williams' }, isAdmin: false, suspended: true, isEnrolledIn2Sv: false, isEnforcedIn2Sv: false, creationTime: '2023-03-05T14:00:00Z', lastLoginTime: '2023-12-15T09:30:00Z' },
  {
    id: '5',
    primaryEmail: 'ops.delegate@example.com',
    name: { givenName: 'Ops', familyName: 'Delegate', fullName: 'Ops Delegate' },
    isAdmin: false,
    isDelegatedAdmin: true,
    delegatedAdminPrivileges: ['MANAGE_USERS', 'MANAGE_GROUPS', 'MANAGE_ORG_UNITS'],
    suspended: false,
    isEnrolledIn2Sv: true,
    isEnforcedIn2Sv: false,
    creationTime: '2023-11-01T12:00:00Z',
    lastLoginTime: '2024-01-21T08:00:00Z',
  },
];

/** Default demo user email (e.g. for Calendar, auth placeholder) */
export const demoUserEmail = 'john.doe@example.com';

/** Simple user list for Calendar user dropdown */
export const calendarUsers = [
  { id: '1', primaryEmail: 'john.doe@example.com', name: { fullName: 'John Doe' } },
  { id: '2', primaryEmail: 'jane.smith@example.com', name: { fullName: 'Jane Smith' } },
  { id: '3', primaryEmail: 'bob.johnson@example.com', name: { fullName: 'Bob Johnson' } },
  { id: '4', primaryEmail: 'alice.williams@example.com', name: { fullName: 'Alice Williams' } },
  { id: '5', primaryEmail: 'manager@example.com', name: { fullName: 'Manager' } },
];

// ---------------------------------------------------------------------------
// Drive (Drive page – files and external sharing)
// ---------------------------------------------------------------------------

export interface DemoDriveFilePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  domain?: string;
  displayName?: string;
}

export interface DemoDriveFile {
  id: string;
  name: string;
  webViewLink: string;
  modifiedTime: string;
  createdTime?: string;
  owners: Array<{ emailAddress: string; displayName?: string }>;
  mimeType: string;
  size?: string;
  path?: string;
  shared: boolean;
  permissions: DemoDriveFilePermission[];
}

export const driveFiles: DemoDriveFile[] = [
  {
    id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    name: 'Q4 Financial Report.pdf',
    webViewLink: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view',
    modifiedTime: '2024-01-15T10:30:00Z',
    createdTime: '2024-01-10T09:00:00Z',
    owners: [{ emailAddress: 'john.doe@example.com', displayName: 'John Doe' }],
    mimeType: 'application/pdf',
    size: '2456789',
    path: '/Shared Documents/Finance/Q4 Financial Report.pdf',
    shared: true,
    permissions: [
      { id: 'p1', type: 'user', role: 'owner', emailAddress: 'john.doe@example.com' },
      { id: 'p2', type: 'user', role: 'reader', emailAddress: 'jane.smith@example.com' },
      { id: 'p2b', type: 'group', role: 'commenter', emailAddress: 'team@example.com', displayName: 'Finance Team' },
      { id: 'p2b2', type: 'domain', role: 'reader', domain: 'example.com' },
      { id: 'p2c', type: 'domain', role: 'reader', domain: 'external.com' },
      { id: 'p2d', type: 'anyone', role: 'reader' },
    ],
  },
  {
    id: '1a2b3c4d5e6f7g8h9i0jKlMnOpQrStUvWxYzAb',
    name: 'Project Proposal.docx',
    webViewLink: 'https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9i0jKlMnOpQrStUvWxYzAb/view',
    modifiedTime: '2024-01-20T14:15:00Z',
    createdTime: '2024-01-18T11:20:00Z',
    owners: [{ emailAddress: 'jane.smith@example.com', displayName: 'Jane Smith' }],
    mimeType: 'application/vnd.google-apps.document',
    size: '156789',
    path: '/My Drive/Projects/Project Proposal.docx',
    shared: false,
    permissions: [
      { id: 'p3', type: 'user', role: 'owner', emailAddress: 'jane.smith@example.com' },
    ],
  },
  {
    id: '1CdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn',
    name: 'Team Meeting Notes',
    webViewLink: 'https://drive.google.com/file/d/1CdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMn/view',
    modifiedTime: '2024-01-22T16:45:00Z',
    createdTime: '2024-01-22T16:00:00Z',
    owners: [{ emailAddress: 'bob.johnson@example.com', displayName: 'Bob Johnson' }],
    mimeType: 'application/vnd.google-apps.document',
    size: '45678',
    path: '/Shared Drive/Team/Team Meeting Notes',
    shared: true,
    permissions: [
      { id: 'p4', type: 'user', role: 'owner', emailAddress: 'bob.johnson@example.com' },
      { id: 'p5', type: 'user', role: 'writer', emailAddress: 'external@partner.com' },
    ],
  },
];

export const externalSharingReports = [
  { file: driveFiles[0], externalDomains: ['external.com'], externalEmails: [] as string[] },
  { file: driveFiles[2], externalDomains: ['partner.com'], externalEmails: ['external@partner.com'] },
];
export const externalSharingStatistics = {
  totalFiles: 2,
  uniqueExternalDomains: ['external.com', 'partner.com'],
  uniqueExternalEmails: ['external@partner.com'],
  filesByDomain: { 'external.com': 1, 'partner.com': 1 },
  totalUniqueDomains: 2,
  totalUniqueEmails: 1,
};

// ---------------------------------------------------------------------------
// Calendar (Calendar page)
// ---------------------------------------------------------------------------

export const calendars = [
  { id: 'primary', summary: 'Primary Calendar', timeZone: 'America/New_York', accessRole: 'owner', primary: true },
  { id: 'work', summary: 'Work Calendar', timeZone: 'America/New_York', accessRole: 'owner', primary: false },
];

export interface DemoCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  location?: string;
  organizer?: { email: string; displayName?: string };
  htmlLink?: string;
  status?: string;
}

export function getMockCalendarEvents(userEmail: string): DemoCalendarEvent[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const createDate = (month: number, day: number, hour = 10, minute = 0) =>
    new Date(currentYear, month, day, hour, minute).toISOString();
  const day = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
  const organizer = { email: userEmail, displayName: 'John Doe' };

  return [
    { id: 'event1', summary: 'Team Meeting', description: 'Weekly team sync', start: { dateTime: new Date(day(1).getTime() + 60 * 60 * 1000).toISOString(), timeZone: 'America/New_York' }, end: { dateTime: new Date(day(1).getTime() + 2 * 60 * 60 * 1000).toISOString(), timeZone: 'America/New_York' }, location: 'Conference Room 101', attendees: [{ email: 'jane.smith@example.com', displayName: 'Jane Smith', responseStatus: 'accepted' }, { email: 'bob.johnson@example.com', displayName: 'Bob Johnson', responseStatus: 'needsAction' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event1', status: 'confirmed' },
    { id: 'event2', summary: 'Client Presentation', description: 'Q4 results presentation', start: { dateTime: day(2).toISOString(), timeZone: 'America/New_York' }, end: { dateTime: new Date(day(2).getTime() + 90 * 60 * 1000).toISOString(), timeZone: 'America/New_York' }, location: 'Conference Room 202', attendees: [{ email: 'client@external.com', displayName: 'Client Name', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event2', status: 'confirmed' },
    { id: 'event3', summary: 'One-on-One', description: 'Weekly 1:1 with manager', start: { dateTime: day(3).toISOString(), timeZone: 'America/New_York' }, end: { dateTime: new Date(day(3).getTime() + 30 * 60 * 1000).toISOString(), timeZone: 'America/New_York' }, location: 'Virtual', attendees: [{ email: 'manager@example.com', displayName: 'Manager', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event3', status: 'confirmed' },
    { id: 'event4', summary: 'Quarterly Review', description: 'Q1 quarterly business review', start: { dateTime: createDate(1, 5, 14, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(1, 5, 16, 0), timeZone: 'America/New_York' }, location: 'Main Conference Hall', attendees: [{ email: 'ceo@example.com', displayName: 'CEO', responseStatus: 'accepted' }, { email: 'cfo@example.com', displayName: 'CFO', responseStatus: 'accepted' }, { email: 'jane.smith@example.com', displayName: 'Jane Smith', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event4', status: 'confirmed' },
    { id: 'event5', summary: 'Product Launch Planning', description: 'Planning session for new product launch', start: { dateTime: createDate(1, 12, 10, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(1, 12, 12, 0), timeZone: 'America/New_York' }, location: 'Product Team Room', attendees: [{ email: 'product.manager@example.com', displayName: 'Product Manager', responseStatus: 'accepted' }, { email: 'designer@example.com', displayName: 'UX Designer', responseStatus: 'needsAction' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event5', status: 'confirmed' },
    { id: 'event6', summary: 'Training Session', description: 'New employee onboarding', start: { dateTime: createDate(1, 15, 9, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(1, 15, 17, 0), timeZone: 'America/New_York' }, location: 'Training Room A', attendees: [{ email: 'hr@example.com', displayName: 'HR Manager', responseStatus: 'accepted' }, { email: 'new.employee@example.com', displayName: 'New Employee', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event6', status: 'confirmed' },
    { id: 'event7', summary: 'Budget Review', description: 'Annual budget review', start: { dateTime: createDate(1, 20, 13, 30), timeZone: 'America/New_York' }, end: { dateTime: createDate(1, 20, 15, 30), timeZone: 'America/New_York' }, location: 'Finance Department', attendees: [{ email: 'cfo@example.com', displayName: 'CFO', responseStatus: 'accepted' }, { email: 'finance.manager@example.com', displayName: 'Finance Manager', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event7', status: 'confirmed' },
    { id: 'event8', summary: 'Team Building Event', description: 'Company team building', start: { dateTime: createDate(1, 25, 10, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(1, 25, 16, 0), timeZone: 'America/New_York' }, location: 'Outdoor Venue', attendees: [{ email: 'jane.smith@example.com', displayName: 'Jane Smith', responseStatus: 'accepted' }, { email: 'bob.johnson@example.com', displayName: 'Bob Johnson', responseStatus: 'accepted' }, { email: 'alice.williams@example.com', displayName: 'Alice Williams', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event8', status: 'confirmed' },
    { id: 'event9', summary: 'Strategic Planning Meeting', description: 'Long-term strategic planning', start: { dateTime: createDate(2, 1, 9, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(2, 1, 17, 0), timeZone: 'America/New_York' }, location: 'Executive Boardroom', attendees: [{ email: 'ceo@example.com', displayName: 'CEO', responseStatus: 'accepted' }, { email: 'cfo@example.com', displayName: 'CFO', responseStatus: 'accepted' }, { email: 'cto@example.com', displayName: 'CTO', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event9', status: 'confirmed' },
    { id: 'event10', summary: 'Client Workshop', description: 'Interactive workshop with clients', start: { dateTime: createDate(2, 8, 10, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(2, 8, 14, 0), timeZone: 'America/New_York' }, location: 'Client Office', attendees: [{ email: 'client@external.com', displayName: 'Key Client', responseStatus: 'accepted' }, { email: 'sales.manager@example.com', displayName: 'Sales Manager', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event10', status: 'confirmed' },
    { id: 'event11', summary: 'Technology Conference', description: 'Annual tech conference', start: { dateTime: createDate(2, 15, 8, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(2, 17, 18, 0), timeZone: 'America/New_York' }, location: 'Convention Center', attendees: [{ email: 'tech.lead@example.com', displayName: 'Tech Lead', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event11', status: 'confirmed' },
    { id: 'event12', summary: 'Performance Review', description: 'Annual performance review', start: { dateTime: createDate(2, 22, 14, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(2, 22, 15, 30), timeZone: 'America/New_York' }, location: 'HR Office', attendees: [{ email: 'hr@example.com', displayName: 'HR Manager', responseStatus: 'accepted' }, { email: 'manager@example.com', displayName: 'Direct Manager', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event12', status: 'confirmed' },
    { id: 'event13', summary: 'Project Kickoff', description: 'Kickoff for new major project', start: { dateTime: createDate(3, 5, 10, 0), timeZone: 'America/New_York' }, end: { dateTime: createDate(3, 5, 12, 0), timeZone: 'America/New_York' }, location: 'Project Room', attendees: [{ email: 'project.manager@example.com', displayName: 'Project Manager', responseStatus: 'accepted' }, { email: 'jane.smith@example.com', displayName: 'Jane Smith', responseStatus: 'accepted' }, { email: 'bob.johnson@example.com', displayName: 'Bob Johnson', responseStatus: 'accepted' }], organizer, htmlLink: 'https://calendar.google.com/event?eid=event13', status: 'confirmed' },
  ];
}

// ---------------------------------------------------------------------------
// Users page – org units, 2FA audit
// ---------------------------------------------------------------------------

export const orgUnits = [
  { orgUnitPath: '/', name: 'example.com' },
  { orgUnitPath: '/Engineering', name: 'Engineering' },
  { orgUnitPath: '/Sales', name: 'Sales' },
  { orgUnitPath: '/Marketing', name: 'Marketing' },
  { orgUnitPath: '/HR', name: 'HR' },
  { orgUnitPath: '/Finance', name: 'Finance' },
  { orgUnitPath: '/Engineering/Development', name: 'Development' },
  { orgUnitPath: '/Engineering/QA', name: 'QA' },
];

export const usersWithout2FAData = {
  usersWithout2FA: [
    { id: '1', primaryEmail: 'bob.johnson@example.com', name: { givenName: 'Bob', familyName: 'Johnson', fullName: 'Bob Johnson' }, isAdmin: false, suspended: false, isEnrolledIn2Sv: false, isEnforcedIn2Sv: true },
    { id: '2', primaryEmail: 'alice.williams@example.com', name: { givenName: 'Alice', familyName: 'Williams', fullName: 'Alice Williams' }, isAdmin: false, suspended: false, isEnrolledIn2Sv: false, isEnforcedIn2Sv: false },
  ],
  usersEnforcedButNotEnrolled: [
    { id: '1', primaryEmail: 'bob.johnson@example.com', name: { givenName: 'Bob', familyName: 'Johnson', fullName: 'Bob Johnson' }, isAdmin: false, suspended: false, isEnrolledIn2Sv: false, isEnforcedIn2Sv: true },
  ],
  statistics: { total: 150, without2FA: 2, enforcedButNotEnrolled: 1 },
};

// ---------------------------------------------------------------------------
// Groups (Groups page)
// ---------------------------------------------------------------------------

export const groups = [
  { id: '1', email: 'engineering@example.com', name: 'Engineering Team', description: 'Engineering department group', directMembersCount: 25, creationTime: '2022-03-15T10:00:00.000Z' },
  { id: '2', email: 'sales@example.com', name: 'Sales Team', description: 'Sales department group', directMembersCount: 15, creationTime: '2022-06-01T09:00:00.000Z' },
  { id: '3', email: 'all-employees@example.com', name: 'All Employees', description: 'Company-wide distribution list', directMembersCount: 150, creationTime: '2021-01-10T08:00:00.000Z' },
  { id: '4', email: 'managers@example.com', name: 'Managers', description: 'Management team', directMembersCount: 12, creationTime: '2023-02-20T14:00:00.000Z' },
  { id: '5', email: 'archive-2023@example.com', name: 'Archive 2023', description: 'Legacy group, no longer used', directMembersCount: 0, creationTime: '2023-11-01T00:00:00.000Z' },
  { id: '6', email: 'project-phoenix@example.com', name: 'Project Phoenix (inactive)', description: 'Project closed', directMembersCount: 0, creationTime: '2024-01-05T12:00:00.000Z' },
  { id: '7', email: 'temp-notify@example.com', name: 'Temp Notifications', description: 'Empty placeholder group', directMembersCount: 0, creationTime: '2024-06-15T09:00:00.000Z' },
];

const engineeringMembers = [
  { id: 'e1', email: 'alice@example.com', role: 'OWNER' as const, type: 'USER' as const, status: 'ACTIVE' },
  { id: 'e2', email: 'bob@example.com', role: 'MANAGER' as const, type: 'USER' as const, status: 'ACTIVE' },
  { id: 'e3', email: 'charlie@example.com', role: 'MEMBER' as const, type: 'USER' as const, status: 'ACTIVE' },
];
const defaultMembers = [
  { id: '1', email: 'user1@example.com', role: 'MEMBER' as const, type: 'USER' as const, status: 'ACTIVE' },
  { id: '2', email: 'user2@example.com', role: 'MANAGER' as const, type: 'USER' as const, status: 'ACTIVE' },
  { id: '3', email: 'user3@example.com', role: 'MEMBER' as const, type: 'USER' as const, status: 'ACTIVE' },
];

export function getMockGroupMembers(groupEmail: string): typeof engineeringMembers {
  return groupEmail.toLowerCase() === 'engineering@example.com' ? engineeringMembers : defaultMembers;
}

/** Groups list for Users page (e.g. Add User dialog) */
export const userGroups = [
  { id: '1', email: 'engineering@example.com', name: 'Engineering', description: 'Engineering team' },
  { id: '2', email: 'developers@example.com', name: 'Developers', description: 'Development team' },
  { id: '3', email: 'all@example.com', name: 'All Employees', description: 'All company employees' },
];

// ---------------------------------------------------------------------------
// Email delegation (Email Delegation page)
// ---------------------------------------------------------------------------

export const emailDelegations = [
  { userEmail: 'john.doe@example.com', delegateEmail: 'assistant@example.com', verificationStatus: 'accepted' },
  { userEmail: 'john.doe@example.com', delegateEmail: 'manager@example.com', verificationStatus: 'accepted' },
  { userEmail: 'jane.smith@example.com', delegateEmail: 'assistant@example.com', verificationStatus: 'accepted' },
  { userEmail: 'bob.johnson@example.com', delegateEmail: 'temp-cover@example.com', verificationStatus: 'pending' },
  { userEmail: 'alice.williams@example.com', delegateEmail: 'admin@example.com', verificationStatus: 'accepted' },
];

// ---------------------------------------------------------------------------
// Shared Drives (Shared Drives page)
// ---------------------------------------------------------------------------

const gb = (n: number) => n * 1024 * 1024 * 1024;

export const sharedDrives = [
  { id: '0ABcDeFgHiJkLmNoPqRsT', name: 'Engineering Team Drive', kind: 'drive#drive', createdTime: '2023-01-15T10:00:00Z', hidden: false, organizationalUnit: 'Engineering', creator: 'admin@example.com', storageUsed: gb(12.5), storageLimit: gb(100), itemCap: 50000 },
  { id: '0XYzAbCdEfGhIjKlMnOpQ', name: 'Marketing Shared Drive', kind: 'drive#drive', createdTime: '2023-03-20T14:30:00Z', hidden: false, organizationalUnit: 'Marketing', creator: 'marketing@example.com', storageUsed: gb(8.2), storageLimit: gb(50), itemCap: 25000 },
  { id: '0QrStUvWxYzAbCdEfGhIj', name: 'HR Documents', kind: 'drive#drive', createdTime: '2023-06-10T09:15:00Z', hidden: false, organizationalUnit: 'Human Resources', creator: 'hr@example.com', storageUsed: gb(3.1), storageLimit: gb(25), itemCap: 10000 },
  { id: '0KlMnOpQrStUvWxYzAbCd', name: 'Finance Shared Drive', kind: 'drive#drive', createdTime: '2023-08-05T11:45:00Z', hidden: false, organizationalUnit: 'Finance', creator: 'finance@example.com', storageUsed: gb(22), storageLimit: gb(200), itemCap: 100000 },
];

export const sharedDrivePermissions = [
  { id: 'perm1', type: 'user', role: 'organizer', emailAddress: 'admin@example.com', displayName: 'Admin User' },
  { id: 'perm2', type: 'user', role: 'writer', emailAddress: 'jane.smith@example.com', displayName: 'Jane Smith' },
  { id: 'perm3', type: 'group', role: 'reader', emailAddress: 'engineering-team@example.com', displayName: 'Engineering Team' },
  { id: 'perm4', type: 'domain', role: 'commenter', domain: 'example.com' },
];

// ---------------------------------------------------------------------------
// Security Audit (Security Audit page) — mirrors backend hardening.service + GWS_HARDENING.md
// ---------------------------------------------------------------------------

type DemoHardeningStatus = 'pass' | 'warning' | 'fail' | 'manual' | 'info';
type DemoSeverity = 'critical' | 'high' | 'medium' | 'low';

interface DemoHardeningCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  status: DemoHardeningStatus;
  source?: 'auto' | 'manual';
  severity: DemoSeverity;
  currentValue?: string;
  recommendedValue?: string;
  rationale: string;
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

const demoHardeningChecks: DemoHardeningCheck[] = [
  {
    id: '2fa-enforcement',
    category: 'Authentication',
    name: '2-Step Verification',
    description: 'Two-step verification enforcement across users',
    status: 'warning',
    source: 'auto',
    severity: 'critical',
    currentValue: '72% of users enforced (sample)',
    recommendedValue: 'Enforced for all users',
    rationale:
      'Account takeover is the most common path into a Workspace tenant. Without enforced 2SV, a phished password is often enough.',
    recommendation: 'Enforce 2-Step Verification org-wide; prioritize admins and externally facing roles first.',
    adminConsoleUrl: 'https://admin.google.com/ac/security/2sv',
  },
  {
    id: 'password-policy',
    category: 'Authentication',
    name: 'Strong Password Policy',
    description: 'Password strength and enforcement requirements',
    status: 'manual',
    source: 'manual',
    severity: 'high',
    currentValue: 'Manual review',
    recommendedValue: 'Strong, enforced at login',
    rationale: 'Weak passwords remain a major breach vector for accounts not yet on strong 2SV methods.',
    recommendation: 'Require strong passwords (length 12+) and enforce at next sign-in.',
    adminConsoleUrl: 'https://admin.google.com/ac/security/passwordmanagement',
  },
  {
    id: 'dns-spf',
    category: 'Email',
    name: 'SPF Record',
    description: 'SPF email authentication record',
    status: 'pass',
    source: 'auto',
    severity: 'critical',
    currentValue: 'Configured',
    recommendedValue: 'Configured and enforcing',
    rationale: 'SPF tells receivers which hosts may send mail for your domain.',
    recommendation: 'Publish a single SPF record ending with -all covering all legitimate senders.',
  },
  {
    id: 'dns-dkim',
    category: 'Email',
    name: 'DKIM Record',
    description: 'DKIM email authentication record',
    status: 'warning',
    source: 'auto',
    severity: 'high',
    currentValue: 'Configured with issues',
    recommendedValue: 'Configured and enforcing',
    rationale: 'DKIM signs outbound mail so receivers can detect tampering.',
    recommendation: 'Prefer 2048-bit DKIM keys when the DNS provider allows it.',
    issues: ['DKIM key length is 1024-bit'],
  },
  {
    id: 'dns-dmarc',
    category: 'Email',
    name: 'DMARC Record',
    description: 'DMARC email authentication record',
    status: 'fail',
    source: 'auto',
    severity: 'critical',
    currentValue: 'Configured with issues',
    recommendedValue: 'Configured and enforcing',
    rationale: 'Without DMARC enforcement, spoofed CEO/finance mail remains easy.',
    recommendation: 'Move from p=none to p=quarantine or p=reject once legitimate paths are clean.',
    issues: ['Policy is p=none (no enforcement)'],
  },
  {
    id: 'gmail-read-receipts',
    category: 'Email',
    name: 'Email Read Receipts',
    description: 'Whether users can request read receipts',
    status: 'manual',
    source: 'manual',
    severity: 'low',
    currentValue: 'Manual review',
    recommendedValue: 'Do not allow',
    rationale: 'Read receipts add privacy friction and little SMB business value.',
    recommendation: 'Set to Do not allow unless a documented workflow needs receipts.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/usersettings',
  },
  {
    id: 'gmail-delegation',
    category: 'Email',
    name: 'Mail Delegation',
    description: 'Whether users can delegate mailbox access to others',
    status: 'info',
    source: 'auto',
    severity: 'medium',
    currentValue: 'Delegation allowed',
    recommendedValue: 'OFF unless there is a business need',
    rationale: 'Delegation expands the blast radius of compromised accounts when enabled org-wide.',
    recommendation: 'Prefer OFF by default; enable narrowly for EA/shared roles and document owners.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/usersettings',
  },
  {
    id: 'gmail-confidential-mode',
    category: 'Email',
    name: 'Confidential Mode',
    description: 'Whether users can send confidential-mode email',
    status: 'pass',
    source: 'auto',
    severity: 'low',
    currentValue: 'On',
    recommendedValue: 'ON',
    rationale: 'Confidential mode adds expiring links and copy restrictions for sensitive messages.',
    recommendation: 'Keep ON for most tenants; not a substitute for DLP on regulated data.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/usersettings',
  },
  {
    id: 'gmail-auto-forwarding',
    category: 'Email',
    name: 'Automatic Forwarding',
    description: 'Whether users can auto-forward incoming mail externally',
    status: 'fail',
    source: 'auto',
    severity: 'critical',
    currentValue: 'Allowed',
    recommendedValue: 'OFF',
    rationale: 'Auto-forwarding is a classic post-compromise exfiltration path for inbound mail.',
    recommendation: 'Set to OFF org-wide; allow only via controlled group/OU if truly required.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/enduseraccess',
  },
  {
    id: 'gmail-external-warning',
    category: 'Email',
    name: 'Warn for External Recipients',
    description: 'Warn users before sending externally',
    status: 'pass',
    source: 'manual',
    severity: 'medium',
    currentValue: 'On',
    recommendedValue: 'ON',
    rationale: 'A banner before external send reduces accidental disclosure of internal threads.',
    recommendation: 'Keep external-recipient warnings ON.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/gmail/enduseraccess',
  },
  {
    id: 'drive-link-sharing',
    category: 'Google Drive',
    name: 'Link Sharing (external)',
    description: 'Highest level of sharing allowed outside the organization',
    status: 'warning',
    source: 'auto',
    severity: 'critical',
    currentValue: 'On (anyone external)',
    recommendedValue: 'Off or allowlisted domains',
    rationale: 'Unrestricted external sharing is a leading cause of Drive data exposure.',
    recommendation: 'Prefer OFF or allowlisted domains; pair with the external-sharing scan.',
    adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/sharing',
  },
  {
    id: 'drive-shared-drive-creation',
    category: 'Google Drive',
    name: 'Shared Drive Creation',
    description: 'Whether members can create new shared drives',
    status: 'manual',
    source: 'manual',
    severity: 'medium',
    currentValue: 'Manual review',
    recommendedValue: 'Restricted to admins',
    rationale: 'Uncontrolled shared-drive sprawl creates orphaned data and harder offboarding.',
    recommendation: 'Restrict creation to admins unless a naming/ownership standard exists.',
    adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/sharing',
  },
  {
    id: 'drive-offline-access',
    category: 'Google Drive',
    name: 'Offline Access',
    description: 'Whether Drive files are available offline',
    status: 'warning',
    source: 'manual',
    severity: 'medium',
    currentValue: 'Enabled org-wide',
    recommendedValue: 'Disabled (or per-OU)',
    rationale: 'Offline copies increase data-at-rest exposure on lost/stolen laptops.',
    recommendation: 'Disable org-wide when possible; enable per OU with device encryption/MDM.',
    adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/data',
  },
  {
    id: 'drive-desktop',
    category: 'Google Drive',
    name: 'Drive for Desktop',
    description: 'Whether Google Drive for desktop is allowed',
    status: 'manual',
    source: 'manual',
    severity: 'medium',
    currentValue: 'Manual review',
    recommendedValue: 'OFF (or specific users)',
    rationale: 'Desktop sync expands the local data footprint and complicates offboarding.',
    recommendation: 'Default OFF; allow for approved OUs on managed devices only.',
    adminConsoleUrl: 'https://admin.google.com/ac/appsettings/55656082996/data',
  },
  {
    id: 'calendar-primary-sharing',
    category: 'Calendar',
    name: 'Primary Calendar Sharing',
    description: 'External sharing level for users’ primary calendars',
    status: 'info',
    source: 'auto',
    severity: 'medium',
    currentValue: 'See all info',
    recommendedValue: 'Org-dependent (free/busy is most private)',
    rationale: 'Broad external calendar detail can reveal sensitive meeting context.',
    recommendation: 'Prefer free/busy for external guests; document broader choices.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/calendar',
  },
  {
    id: 'calendar-external-warning',
    category: 'Calendar',
    name: 'External Invitation Warning',
    description: 'Warn users when inviting guests outside the domain',
    status: 'pass',
    source: 'auto',
    severity: 'low',
    currentValue: 'On',
    recommendedValue: 'ON',
    rationale: 'Warnings reduce accidental external invites that expose titles and attachments.',
    recommendation: 'Keep the external-guest warning ON.',
    adminConsoleUrl: 'https://admin.google.com/ac/apps/calendar',
  },
  {
    id: 'chrome-browserupdateenabled',
    category: 'Chrome Managed Browsers',
    name: 'Browser Updates',
    description: 'Browser Updates',
    status: 'pass',
    source: 'auto',
    severity: 'high',
    currentValue: 'Enabled',
    recommendedValue: 'Enabled',
    rationale: 'Outdated browsers are a primary malware entry point.',
    recommendation: 'Ensure browser updates are enabled for managed Chrome.',
  },
  {
    id: 'chrome-extensioninstallforcelist',
    category: 'Chrome Managed Browsers',
    name: 'Company-Enforced Extensions',
    description: 'Company-Enforced Extensions',
    status: 'warning',
    source: 'auto',
    severity: 'medium',
    currentValue: 'None configured',
    recommendedValue: 'At least one security extension',
    rationale: 'Forced extensions ship password managers and security tools consistently.',
    recommendation: 'Deploy a small allowlist of security-relevant extensions.',
  },
  {
    id: 'google-takeout',
    category: 'Data Download',
    name: 'Google Takeout',
    description: 'Whether users can export data via Google Takeout',
    status: 'manual',
    source: 'manual',
    severity: 'high',
    currentValue: 'Manual review',
    recommendedValue: 'OFF (allow per-OU as needed)',
    rationale: 'Takeout enables bulk export of mail and Drive — high risk if open to all users.',
    recommendation: 'Disable for general users; enable only for approved offboarding/legal OUs.',
    adminConsoleUrl: 'https://admin.google.com/ac/googletakeout/useraccess',
  },
  {
    id: 'less-secure-apps',
    category: 'Data Download',
    name: 'Less Secure Apps',
    description: 'Access for apps using less secure sign-in technology',
    status: 'fail',
    source: 'auto',
    severity: 'critical',
    currentValue: 'Allowed',
    recommendedValue: 'Disabled',
    rationale: 'Less secure apps bypass modern OAuth and often 2SV — high account-takeover risk.',
    recommendation: 'Disable for all users; migrate integrations to OAuth.',
    adminConsoleUrl: 'https://admin.google.com/ac/security/lsa',
    issues: ['Legacy integrations may still depend on LSA'],
  },
  {
    id: 'context-aware-access',
    category: 'Apps Control',
    name: 'Context-Aware Access',
    description: 'Access control based on device/context (Enterprise)',
    status: 'manual',
    source: 'manual',
    severity: 'high',
    currentValue: 'Manual review',
    recommendedValue: 'Configured when licensed',
    rationale: 'CAA gates apps by device posture and context when the SKU includes it.',
    recommendation: 'If Enterprise-licensed, define levels for sensitive apps; else waive as SKU N/A.',
    adminConsoleUrl: 'https://admin.google.com/ac/security/caa',
  },
  {
    id: 'core-apps',
    category: 'Apps Control',
    name: 'Core Apps',
    description: 'Access to core Workspace services per OU/group',
    status: 'manual',
    source: 'manual',
    severity: 'medium',
    currentValue: 'Manual review',
    recommendedValue: 'Off where not needed',
    rationale: 'Every enabled app expands the attack and data surface.',
    recommendation: 'Turn off core apps for OUs that should not have them.',
    adminConsoleUrl: 'https://admin.google.com/ac/appslist/core',
  },
  {
    id: 'additional-apps',
    category: 'Apps Control',
    name: 'Additional Apps',
    description: 'Access to additional Google services per OU/group',
    status: 'warning',
    source: 'manual',
    severity: 'medium',
    currentValue: 'Several additional apps ON for all users',
    recommendedValue: 'Off where not needed',
    rationale: 'Consumer Google services create shadow IT and unexpected data storage.',
    recommendation: 'Disable additional services org-wide unless an OU has an approved need.',
    adminConsoleUrl: 'https://admin.google.com/ac/appslist/additional',
  },
];

function demoHardeningStatistics(checks: DemoHardeningCheck[]) {
  return {
    total: checks.length,
    pass: checks.filter((c) => c.status === 'pass').length,
    warning: checks.filter((c) => c.status === 'warning').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    manual: checks.filter((c) => c.status === 'manual').length,
    info: checks.filter((c) => c.status === 'info').length,
  };
}

/** In-memory MSW waiver store (survives within a session). */
export let demoHardeningWaivers: Record<string, { reason: string; waivedBy: string; waivedAt: string }> = {};

export function setDemoHardeningWaivers(
  next: Record<string, { reason: string; waivedBy: string; waivedAt: string }>
) {
  demoHardeningWaivers = next;
}

export const hardeningData = {
  status: 'ready' as const,
  ranAt: '2026-07-09T15:00:00.000Z',
  triggeredBy: 'admin@example.com',
  durationMs: 4200,
  checks: demoHardeningChecks,
  statistics: demoHardeningStatistics(demoHardeningChecks),
  policyApi: { available: true },
  get waivers() {
    return demoHardeningWaivers;
  },
};

// ---------------------------------------------------------------------------
// Third-party apps (Users page – per user)
// ---------------------------------------------------------------------------

export const thirdPartyApps = [
  { clientId: '123456789.apps.googleusercontent.com', displayText: 'Slack', anonymous: false, scopes: ['https://www.googleapis.com/auth/calendar.readonly'], nativeApp: false },
  { clientId: '987654321.apps.googleusercontent.com', displayText: 'Zoom', anonymous: false, scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.readonly'], nativeApp: false },
  { clientId: '456789123.apps.googleusercontent.com', displayText: 'Microsoft Outlook', anonymous: false, scopes: ['https://www.googleapis.com/auth/gmail.readonly'], nativeApp: false },
];
