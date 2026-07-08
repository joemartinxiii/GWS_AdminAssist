import { useState, type ReactNode } from 'react';
import { Button, Menu, MenuItem, IconButton, Box, useTheme } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { Download, CloudUpload, ChevronDown } from 'lucide-react';
import { menuPaperProps } from '../theme/designTokens';
import { ActionTooltip } from './ActionTooltip';

const LU = { s: 1.75 as const };

interface ExportButtonProps {
  totalItems: number;
  selectedCount: number;
  hasFilters: boolean;
  onExportAllCSV: () => void | Promise<void>;
  onExportAllDrive?: () => void | Promise<void>;
  onExportSelectedCSV?: () => void | Promise<void>;
  onExportSelectedDrive?: () => void | Promise<void>;
  onExportFilteredCSV?: () => void | Promise<void>;
  onExportFilteredDrive?: () => void | Promise<void>;
  disabled?: boolean;
  variant?: 'contained' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
  customLabel?: string;
  iconOnly?: boolean;
  tooltipTitle?: string;
  triggerSx?: SxProps<Theme>;
}

export function ExportMenuRow({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <MenuItem
      onClick={onClick}
      disabled={disabled}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        py: 1,
        pl: 1.5,
        pr: 1.25,
      }}
    >
      <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        {label}
      </Box>
      <Box
        component="span"
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          color: 'text.secondary',
          '& svg': { display: 'block' },
        }}
      >
        {icon}
      </Box>
    </MenuItem>
  );
}

export function ExportButton({
  totalItems,
  selectedCount,
  hasFilters,
  onExportAllCSV,
  onExportAllDrive,
  onExportSelectedCSV,
  onExportSelectedDrive,
  onExportFilteredCSV,
  onExportFilteredDrive,
  disabled = false,
  variant = 'outlined',
  size = 'small',
  customLabel,
  iconOnly = false,
  tooltipTitle = 'Export to CSV or Google Drive',
  triggerSx,
}: ExportButtonProps) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const actionColor = theme.palette.mode === 'dark' ? '#e8eaed' : theme.palette.grey[800];

  const triggerSxMerged: SxProps<Theme> = [
    { color: actionColor },
    ...(triggerSx ? (Array.isArray(triggerSx) ? triggerSx : [triggerSx]) : []),
  ];

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleExport = (exportFn?: () => void | Promise<void>) => {
    if (exportFn) {
      exportFn();
    }
    handleClose();
  };

  const getPrimaryLabel = () => {
    if (customLabel) return customLabel;
    if (selectedCount > 0) return `Export Selected (${selectedCount})`;
    if (hasFilters) return 'Export Filtered View';
    return 'Export All';
  };

  const hasSelected = selectedCount > 0;
  const showSelectedOptions = hasSelected && (onExportSelectedCSV || onExportSelectedDrive);
  const showFilteredOptions = hasFilters && (onExportFilteredCSV || onExportFilteredDrive);
  const isDisabled = disabled || totalItems === 0;

  const dlSm = <Download size={16} strokeWidth={LU.s} />;
  const upSm = <CloudUpload size={16} strokeWidth={LU.s} />;
  const chevTrigger = <ChevronDown size={20} strokeWidth={LU.s} />;

  const trigger = iconOnly ? (
    <ActionTooltip title={tooltipTitle}>
      <span>
        <IconButton
          onClick={handleClick}
          disabled={isDisabled}
          aria-label="Export"
          sx={triggerSxMerged}
        >
          {chevTrigger}
        </IconButton>
      </span>
    </ActionTooltip>
  ) : (
    <ActionTooltip title={tooltipTitle}>
      <span>
        <Button
          variant={variant}
          size={size}
          endIcon={chevTrigger}
          onClick={handleClick}
          disabled={isDisabled}
          sx={[
            ...(Array.isArray(triggerSxMerged) ? triggerSxMerged : [triggerSxMerged]),
            {
              textTransform: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
            },
          ]}
        >
          {getPrimaryLabel()}
        </Button>
      </span>
    </ActionTooltip>
  );

  return (
    <>
      {trigger}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: (theme) => ({
            ...(typeof menuPaperProps.PaperProps.sx === 'function'
              ? menuPaperProps.PaperProps.sx(theme)
              : {}),
            ...(open && anchorEl ? { minWidth: anchorEl.offsetWidth } : {}),
          }),
        }}
        MenuListProps={{
          dense: true,
          sx: { py: 0.5 },
        }}
      >
        {!hasSelected && !hasFilters && (
          <>
            <ExportMenuRow
              label="Export All to CSV"
              icon={dlSm}
              onClick={() => handleExport(onExportAllCSV)}
            />
            {onExportAllDrive && (
              <ExportMenuRow
                label="Export All to Drive"
                icon={upSm}
                onClick={() => handleExport(onExportAllDrive)}
              />
            )}
          </>
        )}

        {showSelectedOptions && (
          <>
            {!hasSelected && !hasFilters && (
              <MenuItem disabled divider />
            )}
            {onExportSelectedCSV && (
              <ExportMenuRow
                label={`Export Selected (${selectedCount}) to CSV`}
                icon={dlSm}
                onClick={() => handleExport(onExportSelectedCSV)}
                disabled={!hasSelected}
              />
            )}
            {onExportSelectedDrive && (
              <ExportMenuRow
                label={`Export Selected (${selectedCount}) to Drive`}
                icon={upSm}
                onClick={() => handleExport(onExportSelectedDrive)}
                disabled={!hasSelected}
              />
            )}
          </>
        )}

        {showFilteredOptions && (
          <>
            {((!hasSelected && !hasFilters) || (hasSelected && showSelectedOptions)) && (
              <MenuItem disabled divider />
            )}
            {onExportFilteredCSV && (
              <ExportMenuRow
                label="Export Filtered View to CSV"
                icon={dlSm}
                onClick={() => handleExport(onExportFilteredCSV)}
                disabled={!hasFilters}
              />
            )}
            {onExportFilteredDrive && (
              <ExportMenuRow
                label="Export Filtered View to Drive"
                icon={upSm}
                onClick={() => handleExport(onExportFilteredDrive)}
                disabled={!hasFilters}
              />
            )}
          </>
        )}
      </Menu>
    </>
  );
}
