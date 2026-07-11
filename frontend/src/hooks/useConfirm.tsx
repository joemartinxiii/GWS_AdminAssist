import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmEntity } from '../components/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** Optional list of affected entities shown in the confirm body. */
  entities?: ConfirmEntity[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  tone?: 'danger' | 'warning';
}

/**
 * Promise-based confirmation dialog, replacing native `window.confirm()` with
 * the app's styled `ConfirmDialog`. Usage:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title: 'Delete group?', danger: true }))) return;
 *
 * Render `confirmDialog` once in the page tree.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  const confirmDialog = options ? (
    <ConfirmDialog
      open
      title={options.title}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      danger={options.danger}
      tone={options.tone}
      entities={options.entities}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    >
      {options.message}
    </ConfirmDialog>
  ) : null;

  return { confirm, confirmDialog };
}
