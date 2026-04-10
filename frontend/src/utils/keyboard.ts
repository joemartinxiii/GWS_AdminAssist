/** Modifier label for shortcuts (⌘ on Apple platforms, Ctrl+ elsewhere). */
export function modLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+';
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
}

/** Human-readable shortcut, e.g. "⌘K" or "Ctrl+K". */
export function shortcut(parts: string[]): string {
  const m = modLabel();
  if (m === '⌘') {
    return parts.map((p) => `⌘${p}`).join(' ');
  }
  return parts.map((p) => `Ctrl+${p}`).join(' ');
}
