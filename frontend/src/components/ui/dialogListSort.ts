/** Non-sortable column headers in dialogs still need a stable sortConfig shape */
export const DIALOG_LIST_SORT = { key: '__dialog__', direction: 'asc' as const };

export function dialogListNoopSort() {}
