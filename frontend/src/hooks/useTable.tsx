import { useState, useMemo, useCallback } from 'react';
import { TableCell, TableSortLabel } from '@mui/material';
import { generateExportFilename } from '../utils/filename';

export type SortDirection = 'asc' | 'desc';

export interface SortConfig<T> {
  key: keyof T | string;
  direction: SortDirection;
}

export interface TableColumn<T> {
  id: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => React.ReactNode;
  getValue?: (row: T) => string | number | Date | null | undefined;
}

export function useTable<T extends Record<string, any>>(
  data: T[],
  columns: TableColumn<T>[],
  defaultSortKey?: string
) {
  // Ensure we have a valid default sort key
  const getDefaultSortKey = () => {
    if (defaultSortKey) return defaultSortKey;
    if (columns && columns.length > 0 && columns[0].id) return columns[0].id;
    return '';
  };

  const [sortConfig, setSortConfig] = useState<SortConfig<T>>({
    key: getDefaultSortKey(),
    direction: 'asc',
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Get sortable value from row
  const getSortValue = useCallback(
    (row: T, key: string | keyof T): string | number => {
      if (typeof key === 'string' && key.includes('.')) {
        // Handle nested keys like 'name.fullName'
        const keys = key.split('.');
        let value: any = row;
        for (const k of keys) {
          value = value?.[k];
        }
        return value ?? '';
      }
      const value = row[key as keyof T];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object' && 'fullName' in value) {
        return (value as { fullName: string }).fullName;
      }
      if (value && typeof value === 'object' && value.constructor === Date) {
        return (value as Date).getTime();
      }
      return String(value);
    },
    []
  );

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig.key || !data || data.length === 0) return data || [];

    try {
      const sorted = [...data].sort((a, b) => {
        const aValue = getSortValue(a, sortConfig.key);
        const bValue = getSortValue(b, sortConfig.key);

        if (aValue === bValue) return 0;

        const comparison = aValue < bValue ? -1 : 1;
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });

      return sorted;
    } catch (error) {
      console.error('Error sorting data:', error);
      return data;
    }
  }, [data, sortConfig, getSortValue]);

  // Filter data
  const filteredData = useMemo(() => {
    if (!searchTerm.trim() || !sortedData || sortedData.length === 0) return sortedData || [];

    try {
      const term = searchTerm.toLowerCase();
      return sortedData.filter((row) => {
        if (!columns || columns.length === 0) return true;
        return columns.some((col) => {
          try {
            const value = col.getValue
              ? col.getValue(row)
              : getSortValue(row, col.id);
            return String(value || '').toLowerCase().includes(term);
          } catch {
            return false;
          }
        });
      });
    } catch (error) {
      console.error('Error filtering data:', error);
      return sortedData;
    }
  }, [sortedData, searchTerm, columns, getSortValue]);

  // Paginated data
  const paginatedData = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredData.slice(start, start + rowsPerPage);
  }, [filteredData, page, rowsPerPage]);

  // Handle sort
  const handleSort = useCallback(
    (key: string) => {
      setSortConfig((prev) => ({
        key,
        direction:
          prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
      }));
      setPage(0); // Reset to first page when sorting
    },
    []
  );

  // Export to CSV
  const exportToCSV = useCallback(
    (filename: string = generateExportFilename('table-export')) => {
      if (filteredData.length === 0) return;

      // Get headers
      const headers = columns.map((col) => col.label);

      // Get rows
      const rows = filteredData.map((row) =>
        columns.map((col) => {
          const value = col.getValue
            ? col.getValue(row)
            : getSortValue(row, col.id);
          // Handle values that might contain commas or quotes
          const stringValue = String(value ?? '');
          if (stringValue.includes(',') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
      );

      // Create CSV content
      const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [filteredData, columns, getSortValue]
  );

  // Render sortable header cell
  const renderSortableHeader = useCallback(
    (column: TableColumn<T>) => {
      try {
        if (!column || !column.label) {
          return <TableCell />;
        }

        if (!column.sortable) {
          return (
            <TableCell align={column.align || 'left'} sx={{ fontWeight: 600 }}>{column.label}</TableCell>
          );
        }

        const isActive = sortConfig.key === column.id;
        return (
          <TableCell align={column.align || 'left'} sx={{ fontWeight: 600 }}>
            <TableSortLabel
              active={isActive}
              direction={isActive ? sortConfig.direction : 'asc'}
              onClick={() => handleSort(column.id)}
            >
              {column.label}
            </TableSortLabel>
          </TableCell>
        );
      } catch (error) {
        console.error('Error rendering sortable header:', error);
        return <TableCell sx={{ fontWeight: 600 }}>{column?.label || ''}</TableCell>;
      }
    },
    [sortConfig, handleSort]
  );

  return {
    // Data
    data: paginatedData,
    filteredData,
    sortedData,
    // Pagination
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    // Sorting
    sortConfig,
    handleSort,
    renderSortableHeader,
    // Filtering
    searchTerm,
    setSearchTerm,
    // Export
    exportToCSV,
    // Stats
    totalRows: filteredData.length,
  };
}
