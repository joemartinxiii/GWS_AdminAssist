import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Bump when default widths or resize policy change so stale local sizes are dropped. */
const STORAGE_PREFIX = 'gws-col-widths:v3:';
const DEFAULT_MIN = 64;

function loadStored(tableId: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function saveStored(tableId: string, widths: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify(widths));
  } catch {
    /* private mode / quota */
  }
}

export type FixedColumnsOptions = {
  /**
   * Column ids that may be drag-resized. Default: none (all widths fixed).
   * Drive file lists pass `['name']` so the file name can grow.
   */
  resizableIds?: readonly string[];
};

export type ResizableColumnsApi = {
  /** Current pixel width for a column id (falls back to defaults). */
  widthOf: (columnId: string) => number;
  /** sx for a data cell matching the header width. */
  cellSx: (columnId: string) => {
    width: number;
    minWidth: number;
    flex: string;
    overflow: 'hidden';
    boxSizing: 'border-box';
  };
  /** Props to spread onto ColumnHeader (fixed unless id is in resizableIds). */
  headerProps: (columnId: string) => {
    width: number;
    minWidth: number;
    resizable: boolean;
    onResizeStart?: (e: React.MouseEvent) => void;
  };
  /** Reset to defaults and clear storage. */
  reset: () => void;
};

/**
 * Per-table column widths. Columns are fixed by default.
 * Pass `options.resizableIds` for the rare columns that should drag-resize
 * (persisted under `gws-col-widths:v3:{tableId}`).
 */
export function useResizableColumns(
  tableId: string,
  defaults: Record<string, number>,
  minWidths: Record<string, number> = {},
  options: FixedColumnsOptions = {}
): ResizableColumnsApi {
  const resizableIds = options.resizableIds ?? [];
  const canResizeAny = resizableIds.length > 0;
  const resizableKey = resizableIds.join('\0');
  const resizableSet = useMemo(() => new Set(resizableIds), [resizableKey]);

  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (!canResizeAny) return { ...defaults };
    const stored = loadStored(tableId);
    // Only restore widths for columns that are still resizable; others stay at defaults.
    const merged = { ...defaults };
    if (stored) {
      for (const id of resizableIds) {
        if (stored[id] != null) merged[id] = stored[id];
      }
    }
    return merged;
  });

  // Keep newly added default keys available without wiping user sizes.
  useEffect(() => {
    setWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(defaults)) {
        if (next[k] == null) {
          next[k] = v;
          changed = true;
        }
      }
      // Non-resizable columns always snap back to defaults (ignore stale sizes).
      for (const [k, v] of Object.entries(defaults)) {
        if (!resizableSet.has(k) && next[k] !== v) {
          next[k] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [defaults, tableId, resizableSet]);

  useEffect(() => {
    if (!canResizeAny) {
      try {
        localStorage.removeItem(STORAGE_PREFIX + tableId);
      } catch {
        /* ignore */
      }
      return;
    }
    const toStore: Record<string, number> = {};
    for (const id of resizableIds) {
      if (widths[id] != null) toStore[id] = widths[id];
    }
    saveStored(tableId, toStore);
  }, [tableId, widths, canResizeAny, resizableIds]);

  const widthOf = useCallback(
    (columnId: string) => {
      return widths[columnId] ?? defaultsRef.current[columnId] ?? DEFAULT_MIN;
    },
    [widths]
  );

  const minOf = useCallback(
    (columnId: string) => minWidths[columnId] ?? DEFAULT_MIN,
    [minWidths]
  );

  const startResize = useCallback(
    (columnId: string, e: React.MouseEvent) => {
      if (!resizableSet.has(columnId)) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widthOf(columnId);
      const minW = minOf(columnId);

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        const next = Math.max(minW, Math.round(startW + (ev.clientX - startX)));
        setWidths((prev) => (prev[columnId] === next ? prev : { ...prev, [columnId]: next }));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widthOf, minOf, resizableSet]
  );

  const cellSx = useCallback(
    (columnId: string) => {
      const w = widthOf(columnId);
      return {
        width: w,
        minWidth: w,
        flex: `0 0 ${w}px`,
        overflow: 'hidden' as const,
        boxSizing: 'border-box' as const,
      };
    },
    [widthOf]
  );

  const headerProps = useCallback(
    (columnId: string) => {
      const resizable = resizableSet.has(columnId);
      return {
        width: widthOf(columnId),
        minWidth: minOf(columnId),
        resizable,
        ...(resizable ? { onResizeStart: (e: React.MouseEvent) => startResize(columnId, e) } : {}),
      };
    },
    [widthOf, minOf, startResize, resizableSet]
  );

  const reset = useCallback(() => {
    setWidths({ ...defaultsRef.current });
    try {
      localStorage.removeItem(STORAGE_PREFIX + tableId);
    } catch {
      /* ignore */
    }
  }, [tableId]);

  return useMemo(
    () => ({ widthOf, cellSx, headerProps, reset }),
    [widthOf, cellSx, headerProps, reset]
  );
}
