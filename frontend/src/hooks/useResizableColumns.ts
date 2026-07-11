import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_PREFIX = 'gws-col-widths:v1:';
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
  /** Props to spread onto ColumnHeader for a resizable column. */
  headerProps: (columnId: string) => {
    width: number;
    minWidth: number;
    resizable: boolean;
    onResizeStart: (e: React.MouseEvent) => void;
  };
  /** Reset to defaults and clear storage. */
  reset: () => void;
};

/**
 * Per-table column widths with drag-to-resize and localStorage persistence.
 * Use the same column ids on headers and cells.
 */
export function useResizableColumns(
  tableId: string,
  defaults: Record<string, number>,
  minWidths: Record<string, number> = {}
): ResizableColumnsApi {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const stored = loadStored(tableId);
    return { ...defaults, ...(stored || {}) };
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
      return changed ? next : prev;
    });
  }, [defaults, tableId]);

  useEffect(() => {
    saveStored(tableId, widths);
  }, [tableId, widths]);

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
    [widthOf, minOf]
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
    (columnId: string) => ({
      width: widthOf(columnId),
      minWidth: minOf(columnId),
      resizable: true as const,
      onResizeStart: (e: React.MouseEvent) => startResize(columnId, e),
    }),
    [widthOf, minOf, startResize]
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
