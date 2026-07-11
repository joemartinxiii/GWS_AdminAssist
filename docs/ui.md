# UI design system

Canonical guide for visuals and interaction: Plus Jakarta Sans, Workspace-style blue (`T.accent`), Lucide icons, and flex data lists.

**Reference pages:** `Users.tsx` (people table + actions), `Drive.tsx` (permissions dialog), `SharedDrives.tsx` (list + members), `SecurityAudit.tsx` (status/severity columns).

## List & actions contract (do not break)

1. **`ListShell` → `ListHeaderRow` → `ListDataRow`** for every data table.
2. **Resizable columns:** data columns use **`useResizableColumns(tableId, defaults, minWidths)`** (`frontend/src/hooks/useResizableColumns.ts`). Spread **`cols.headerProps('id')`** on each **`ColumnHeader`** and **`cols.cellSx('id')`** on matching cells. Widths persist in `localStorage` under `gws-col-widths:v1:{tableId}`. Drag the right edge of a header to resize. **Actions** / icon-only columns stay fixed (not resizable).
3. **Checkboxes:** always wrap in **`listCheckboxSx`** (40px) in **both** header and every data row (empty box when no checkbox) so boxes line up.
4. **Trailing Actions:** **`listActionsSx`** (80px, flex-end icons). One **Actions** column — not separate Open/Details/Remove headers.
5. **Icons mean one thing:**
   - `Pencil` — edit settings / change role (actions strip only)
   - `Users` — manage members or permissions
   - `ExternalLink` — open in Google
   - `Trash2` — remove/delete (danger color)
6. **Risk chips** live in their **own fixed-width column** (Access / Sharing), not inside Role.
7. **Account status:** **Active** / **Suspended** (not “Off”).
8. Prefer **`useConfirm`** and **`useSnackbar`** over `window.confirm` / `alert`.

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

## 7. Tables (MUI `Table` where still used)

Some screens still use **`Table`** / **`useTable`** (e.g. Calendar, Email Delegation) or **`TablePagination`** next to flex lists. Prefer list primitives for new full-page data views.

- **`TableContainer`** + **`Paper`** (or `variant="outlined"`).
- **`Table`** `size="small"`, density: e.g. `'& .MuiTableCell-root': { py: 0.75 }`, `minHeight: 40` rows.
- Headers: `fontWeight: 600`. Checkbox column first when selecting; actions **`align="right"`**.
- Status: **`Chip`** `size="small"`. Row actions: **`IconButton`** `size="small"` + **`Tooltip`** + **`aria-label`**.

**Reference:** `frontend/src/hooks/useTable.tsx` (e.g. Email Delegation, Groups, Shared Drives); other pages mix **`TablePagination`** or list rows only.

---

## 8. Dialogs

- **Paper**: many modals use shared **`dialogPaperSx`** (border, radius, font family).
- **Close affordance**: Prefer **one** clear dismiss path—either a header **X** or footer **Done** / **Cancel**, not both duplicating the same action. Edit flows often use **Cancel** + primary **Save** without a header close.
- **Content**: `DialogContent` with top padding adjusted as needed (`pt: '20px !important'` where listed).
- **Sections**: small caps / tracked **Typography** for **GROUPS**, **THIRD-PARTY APPS**, etc.; **`Divider`** between blocks.

**Reference:** `EditUserDialog.tsx`, `ConfirmDialog.tsx`, Drive/Groups permission dialogs.

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
- [ ] Data: `ListShell` / `ColumnHeader` / `ListDataRow` OR table patterns above.
- [ ] Dialogs: single dismiss pattern; section headers consistent.
- [ ] Tokens from `designTokens.ts`; Lucide icons; no one-off hex for core colors.

---

*Last updated: consolidated design-system doc; list primitives live under `frontend/src/components/ui/`.*
