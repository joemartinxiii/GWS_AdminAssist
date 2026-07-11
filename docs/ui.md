# UI design system

Canonical guide for visuals and interaction: Plus Jakarta Sans, Workspace-style blue (`T.accent`), Lucide icons, and flex data lists.

**Reference pages:** `Users.tsx` (people table + actions), `Drive.tsx` (permissions dialog), `SharedDrives.tsx` (list + members), `SecurityAudit.tsx` (status/severity columns).

## List & actions contract (do not break)

1. **`ListShell` → `ListHeaderRow` → `ListDataRow`** for every data table.
2. **Row opens detail:** whole-row click opens the page’s modal/detail (not the checkbox). Trailing **`ListChevron`** matches Security Audit.
3. **Resizable columns:** **`useResizableColumns`** + `headerProps` / `cellSx`. Persist under `gws-col-widths:v2:{tableId}`. Trailing Open-in-Google / chevron are fixed and **`pinEnd`**.
4. **Checkboxes:** **`listCheckboxSx`**; `stopPropagation` so select ≠ open.
5. **Destructive = bulk:** no per-row trash. Toolbar **Delete** when ≥1 selected. **Do not delete Workspace admins** from this app.
6. **Open in Google** may stay on the row (quiet icon) *and* in the modal.
7. **Risk chips** in their own column. Status **Active** / **Suspended**.
8. Prefer **`useConfirm`** / **`useSnackbar`**.

**Related code:**

| Area | Location |
|------|----------|
| Design tokens (`T`, `pick`, `selectMenuProps`, `menuPaperProps`, …) | `frontend/src/theme/designTokens.ts` |
| List shell, column headers, pagination helpers | `frontend/src/components/ui/` |
| App-wide MUI overrides | `frontend/src/App.tsx` |
| Shell + nav | `frontend/src/components/Layout.tsx` |
| Font loading | `frontend/src/components/FontLinks.tsx` |
| Login | `frontend/src/pages/Login.tsx` |
| Route exports | `frontend/src/pages/PageRoutes.tsx` |

Import **`T`**, **`pick`**, and menu helpers from **`designTokens.ts`** only—do not fork duplicate token objects on new pages.

---

## 1. Tokens (`T`)

Prefer tokens over ad hoc hex values so light/dark stay coherent. Use **`pick(theme, light, dark)`** when a color must track mode.

| Token | Role |
|--------|------|
| `accent` | Primary actions and highlights (**#1a73e8**, Workspace-style blue) |
| `accentSoft` / `accentBorder` | Chips, selection wash, subtle borders |
| `accentHover` | Contained buttons hover (**#1557b0**) |
| `text` / `textSecondary` / `textTertiary` | Hierarchy |
| `success` / `warning` / `danger` | Status dots, chips, destructive actions |
| `radius` / `radiusSm` / `radiusLg` | Corners |
| `mono` | Email addresses and IDs |

Helpers **`textSecondary(theme)`** and **`textTertiary(theme)`** wrap `pick` for body copy on surfaces like `#18181b`.

---

## 2. List surfaces (flex rows)

Data views use bordered flex lists (not legacy `Table`/`Paper` grids) for consistency with the Users page and toolbars.

- **`ListShell`** — outer bordered container (`overflow-x: auto` when columns exceed the viewport).
- **`ListHeaderRow`** — header strip under the top border.
- **`ColumnHeader`** — uppercase, tracked labels; optional sort; optional resize handle when `resizable` + `onResizeStart` (from `useResizableColumns().headerProps`). Dialogs that do not sort can use **`dialogListSort.ts`** (`DIALOG_LIST_SORT`, `dialogListNoopSort`).
- **`ListDataRow`** — row chrome, hover, optional selection wash.
- **`DialogListPagination`** — rows-per-page + range + prev/next inside modals.
- **`ExportButton`** — CSV/Drive export menus; pass **`triggerSx`** (e.g. `exportToolbarButtonSx()`) for toolbar styling.
- Gate destructive actions with **`usePermissions`** (`hasPermission`, and **`canTakeAction`** when the API allows only super admins) where applicable.

---

## 3. Layout, theme, and icons

- **Page frame (laptop-first):** `Layout` main content sits in a centered column (`maxWidth: 1440`) with **matching side and top padding** (and generous bottom). Prefer this global air over per-page hacks — Notion-style breathing room, not edge-to-edge chrome.
- **`Layout`** loads **Plus Jakarta Sans** via **`FontLinks`** and uses the app **`ThemeProvider`** so portaled menus and selects inherit **`T.font`**.
- **`FilterToken`** (`frontend/src/components/ui/FilterToken`) — inline filter chips used in the toggled filter strip (see §6).
- **`ConfirmDialog`** — standard confirm/cancel typography. Prefer the **`useConfirm`** hook (`frontend/src/hooks/useConfirm.tsx`) over native `window.confirm()`.
- **`useSnackbar`** (`frontend/src/hooks/useSnackbar.tsx`) — theme-aware success/error/info toasts; use instead of native `alert()`.
- **`DateTimePicker`** (`frontend/src/components/DateTimePicker.tsx`) — app-styled date/time popover; use instead of native `datetime-local` inputs.
- **`EditUserDialog`** — full user edit (profile, groups, apps) using the list primitives above.
- Icons: **Lucide** (`lucide-react`). **`FilterToken`**, **`DateRangeCalendar`**, and **`ExportButton`** use Lucide internally.

---

## 4. Page layout (shared MUI conventions)

- **Tabs** (when applicable): top-left, `Tabs` with `sx={{ minHeight: 40 }}`.
- **Action bar**: top-right, `Box` with `display="flex" gap={1} alignItems="center" flexWrap="wrap"`.
- **Toolbar icon color**: grey in light mode / white in dark; Filters icon uses primary when active. See **`sxToolbarIconButtons`** / **`exportToolbarButtonSx`** in `designTokens.ts`.

**Reference:** `Users.tsx` (toolbar).

---

## 5. Search

- Single **Search** icon in the toolbar; field often hidden until toggled.
- **Click** toggles a slide-out: `overflow: 'hidden'`, `width: searchOpen ? 240 : 0`, `transition: 'width 0.2s ease'`.
- **`TextField`** `size="small"`, `minWidth: 240`, optional start adornment.
- Wrap the icon in **`Tooltip`** and set **`aria-label="Search"`**.

**Reference:** `Users.tsx`.

---

## 6. Filters (inline `FilterToken` strip)

- Filtering uses a **toggled inline strip** (not a drawer). A Filters icon in the toolbar flips `filtersVisible`, revealing a row of controls above the data list.
- Individual active filters render as **`FilterToken`** chips (`frontend/src/components/ui/FilterToken`) that can be cleared individually.
- **Controls**: `FormControl size="small"`, selects often right-aligned; labels `Typography` `body2` / `text.secondary`.
- Provide a **Clear filters** affordance when any filter is active.

**Reference:** `Users.tsx` (`filtersVisible`, `UserFilters`, `FilterToken`).

---

## 7. Pagination and sorting data

Full-page data views use **ListShell** rows (not MUI `Table`). Pagination is usually **`TablePagination`** under the list. Sorting goes through **`ColumnHeader`** + page-level sort state (or `useTable` for data only).

- Prefer **`useResizableColumns`** for column widths (see contract above).
- Keep checkbox + actions columns fixed width.

**Reference:** `Users.tsx`, `Groups.tsx`, `EmailDelegation.tsx`, `frontend/src/hooks/useTable.tsx` (data helpers).

---

## 8. Dialogs (canonical = app form modals)

One surface for every modal — match **Edit user / Groups / Email** chrome, not a one-off Audit look. Tokens in **`designTokens.ts`**:

| Token | Use |
|-------|-----|
| **`dialogPaperSx`** | `PaperProps={{ sx: (t) => dialogPaperSx(t) }}` — surface + border + radius |
| **`dialogTitleSx`** | Bold title + **bottom border** |
| **`dialogActionsSx`** | Footer + **top border** |
| **`dialogPrimaryButtonSx`** | Contained Save / Confirm |
| **`dialogSecondaryButtonSx`** | Waive, Open Admin console — **soft fill + border** (readable on dark) |
| **`dialogCancelButtonSx`** | Quiet Cancel / Close |
| **`dialogDangerButtonSx`** | Delete / Remove |

- **Content**: `DialogContent` with `pt: '20px !important'` (avoid bare MUI `dividers` unless needed).
- **Sections**: small caps / tracked labels for field groups.

**Reference:** `EmailDelegation.tsx` add dialog, `ConfirmDialog.tsx`, `EditUserDialog.tsx`.

---

## 9. Inline add rows (members, permissions)

- **+** row below the list; inline row uses the same columns; last column **Cancel** (X) + **Check** to submit.
- Match list density: inputs ~`0.8125rem`, compact `py` on fields.

**Reference:** `Drive.tsx`, `SharedDrives.tsx`, `Groups.tsx`.

---

## 10. Typography notes

- Tight body: `0.8125rem` where space is tight.
- Labels: `caption` / `body2` + `text.secondary`.
- IDs, emails: `fontFamily: monospace`, `wordBreak: 'break-all'` when needed.

---

## 11. Checklist for new or updated pages

- [ ] Chrome matches Users (tabs + action bar, icon colors, tooltips).
- [ ] Search: icon + slide-out if applicable.
- [ ] Filters: toggled inline strip with `FilterToken` chips; right-aligned selects where used elsewhere.
- [ ] Data: `ListShell` / resizable `ColumnHeader` / `ListDataRow` + trailing actions.
- [ ] Dialogs: single dismiss pattern; section headers consistent.
- [ ] Tokens from `designTokens.ts`; Lucide icons; no one-off hex for core colors.

---

*Last updated: consolidated design-system doc; list primitives live under `frontend/src/components/ui/`.*
