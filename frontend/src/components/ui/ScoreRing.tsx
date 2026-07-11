import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { T, pick, textTertiary } from '../../theme/designTokens';

export type ScoreRingProps = {
  /** 0–100 */
  value: number;
  /** Center label — defaults to rounded value + % */
  centerLabel?: string;
  size?: number;
  thickness?: number;
  color?: string;
  /** Caption under the ring */
  caption?: string;
  sizeVariant?: 'lg' | 'md' | 'sm';
};

const SIZES = {
  lg: { size: 96, thickness: 5, fontSize: '1.375rem', captionSize: '0.6875rem' },
  md: { size: 64, thickness: 4, fontSize: '1rem', captionSize: '0.625rem' },
  sm: { size: 52, thickness: 3.5, fontSize: '0.875rem', captionSize: '0.625rem' },
} as const;

/**
 * Circular score meter for compliance-style summaries.
 * Track + arc; center label + optional caption.
 */
export function ScoreRing({
  value,
  centerLabel,
  size: sizeProp,
  thickness: thicknessProp,
  color = T.accent,
  caption,
  sizeVariant = 'lg',
}: ScoreRingProps) {
  const theme = useTheme();
  const preset = SIZES[sizeVariant];
  const size = sizeProp ?? preset.size;
  const thickness = thicknessProp ?? preset.thickness;
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const label = centerLabel ?? `${Math.round(clamped)}%`;
  const track = pick(theme, '#e4e4e0', '#3f3f46');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
      <Box
        sx={{
          position: 'relative',
          width: size,
          height: size,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        role="img"
        aria-label={caption ? `${label}, ${caption}` : label}
      >
        <Box
          component="svg"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          sx={{
            position: 'absolute',
            inset: 0,
            transform: 'rotate(-90deg)',
          }}
          aria-hidden
        >
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease' }}
          />
        </Box>
        <Typography
          component="span"
          sx={{
            position: 'relative',
            zIndex: 1,
            fontFamily: T.font,
            fontWeight: 700,
            fontSize: preset.fontSize,
            letterSpacing: '-0.03em',
            color,
            lineHeight: 1,
          }}
        >
          {label}
        </Typography>
      </Box>
      {caption && (
        <Typography
          sx={{
            fontFamily: T.font,
            fontSize: preset.captionSize,
            fontWeight: 600,
            color: (t) => textTertiary(t),
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            textAlign: 'center',
            lineHeight: 1.2,
            maxWidth: size + 16,
          }}
        >
          {caption}
        </Typography>
      )}
    </Box>
  );
}
