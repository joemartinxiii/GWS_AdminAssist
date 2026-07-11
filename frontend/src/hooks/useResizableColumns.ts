import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Bump when default widths or resize policy change so stale local sizes are dropped. */
const STORAGE_PREFIX = 'gws-col-widths:v4:';
const DEFAULT_MIN = 48;

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
   * Column ids that may be drag-resized (adjusts flex weight / preferred basis).
   * Default: none. Drive file lists pass `['name']`.
   * Tables never grow past the container — columns share remaining width.
   */
  resizableIds?: readonly string[];
};

export type ResizableColumnsApi = {
  /** Preferred width / flex weight for a column id. */
  widthOf: (columnId: string) => number;
  /** sx for a data cell — flexes to fit; never forces horizontal scroll. */
  cellSx: (columnId: string) => {
    flex: string;
    minWidth: number;
    overflow: 'hidden';
    boxSizing: 'border-box';
    width?: number;
  };
  /** Props to spread onto ColumnHeader. */
  headerProps: (columnId: string) => {
    grow?: number;
    width?: number;
    minWidth: number;
    resizable: boolean;
    onResizeStart?: (e: React.MouseEvent) => void;
  };
  /** Reset to defaults and clear storage. */
  reset: () => void;
};

/**
 * Per-table column layout. Columns share the row width (no horizontal scroll).
 * Defaults are flex *weights* (and preferred basis for resizable cols).
 * Pass `options.resizableIds` to allow drag-adjusting a column’s share.
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
    const merged = { ...defaults };
    if (stored) {
      for (const id of resizableIds) {
        if (stored[id] != null) merged[id] = stored[id];
      }
    }
    return merged;
  });

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
      const preferred = widthOf(columnId);
      const minW = minOf(columnId);
      const resizable = resizableSet.has(columnId);
      // Share the row: grow by preferred weight, always allow shrink (ellipsis).
      if (resizable) {
        return {
          flex: `1 1 ${preferred}px`,
          width: preferred,
          minWidth: Math.min(minW, preferred),
          overflow: 'hidden' as const,
          boxSizing: 'border-box' as const,
        };
      }
      return {
        flex: `${preferred} 1 0px`,
        minWidth: 0,
        overflow: 'hidden' as const,
        boxSizing: 'border-box' as const,
      };
    },
    [widthOf, minOf, resizableSet]
  );

  const headerProps = useCallback(
    (columnId: string) => {
      const preferred = widthOf(columnId);
      const minW = minOf(columnId);
      const resizable = resizableSet.has(columnId);
      if (resizable) {
        return {
          width: preferred,
          minWidth: Math.min(minW, preferred),
          resizable: true,
          onResizeStart: (e: React.MouseEvent) => startResize(columnId, e),
        };
      }
      return {
        grow: preferred,
        minWidth: 0,
        resizable: false,
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
