import { useRef, useState, cloneElement, isValidElement, type ReactElement } from 'react';
import { Tooltip, type TooltipProps } from '@mui/material';

type AnchorProps = {
  onClick?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
};

/**
 * Drop-in replacement for MUI's `Tooltip` around clickable icon buttons.
 *
 * MUI's Tooltip re-opens on focus right after a click (the same click that
 * moves focus to the anchor), which fights any naive "close on click"
 * handler and leaves the tooltip stuck open. This wrapper suppresses that
 * post-click re-open until the pointer/focus genuinely leaves the anchor,
 * so a click always results in the tooltip closing for good, while hover
 * still works normally afterwards.
 */
export function ActionTooltip({ children, onOpen, onClose, ...props }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const suppressRef = useRef(false);

  if (!isValidElement(children)) return <Tooltip {...props}>{children}</Tooltip>;

  const child = children as ReactElement<AnchorProps>;

  return (
    <Tooltip
      {...props}
      disableInteractive
      open={open}
      onOpen={(e) => {
        if (suppressRef.current) return;
        setOpen(true);
        onOpen?.(e);
      }}
      onClose={(e) => {
        setOpen(false);
        onClose?.(e);
      }}
    >
      {cloneElement(child, {
        onClick: (e: React.MouseEvent) => {
          suppressRef.current = true;
          setOpen(false);
          child.props.onClick?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          suppressRef.current = false;
          child.props.onMouseLeave?.(e);
        },
        onBlur: (e: React.FocusEvent) => {
          suppressRef.current = false;
          child.props.onBlur?.(e);
        },
      })}
    </Tooltip>
  );
}
