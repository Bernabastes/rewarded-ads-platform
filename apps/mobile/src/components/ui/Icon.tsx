import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Small hand-drawn 24x24 stroke icon set (no icon-font dependency, identical on web and native).
 * Each entry is one or more SVG subpaths in a single `d` string.
 */
export const ICONS = {
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  gift: 'M4 12h16v8H4z M2 8h20v4H2z M12 8v12 M12 8c-2-3-6-3-6-1s3 1 6 1 M12 8c2-3 6-3 6-1s-3 1-6 1',
  wallet: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M15 15h2',
  user: 'M20 21a8 8 0 1 0-16 0 M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7z M13 5h4v14h-4z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12 M18 6 6 18',
  alert: 'M12 3 2 21h20z M12 9v5 M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 11v5 M12 8h.01',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  arrowLeft: 'M19 12H5 M11 18l-6-6 6-6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7 M18 3v4h-4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 7v5l3 2',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
  flag: 'M4 22V4 M4 4h12l-2 4 2 4H4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  arrowUpRight: 'M7 17 17 7 M8 7h9v9',
  arrowDownLeft: 'M17 7 7 17 M16 17H7V8',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
  shield: 'M12 2l8 3v6c0 5-3.5 9.4-8 11-4.5-1.6-8-6-8-11V5z',
  sliders: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4',
  video: 'M3 6a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M16 10l5-3v10l-5-3',
  clipboard:
    'M8 4h8v3H8z M6 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1 M8 12h8 M8 16h5',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  external: 'M14 3h7v7 M21 3l-9 9 M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5',
  wifiOff:
    'M2 2l20 20 M9 17a4 4 0 0 1 6 0 M5 13a10 10 0 0 1 4-2.5 M15 10.5A10 10 0 0 1 19 13 M2 9a16 16 0 0 1 5-3.5 M17 5.5A16 16 0 0 1 22 9 M12 21h.01',
  hourglass: 'M6 2h12 M6 22h12 M7 2c0 5 5 6 5 10s-5 5-5 10 M17 2c0 5-5 6-5 10s5 5 5 10',
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  calendar: 'M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4',
  trendingUp: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  circleCheck: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M8 12l3 3 5-6',
  circleX: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9 9l6 6 M15 9l-6 6',
  circleDot: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 12h.01',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z M8 8h8 M8 12h8',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z',
  heart: 'M12 21s-7-4.6-9-9a5 5 0 0 1 9-4 5 5 0 0 1 9 4c-2 4.4-9 9-9 9z',
  helpCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17h.01',
  chat: 'M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z',
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Filled glyphs (play). */
  filled?: boolean;
  accessibilityLabel?: string;
}

export function Icon({ name, size = 22, color, strokeWidth = 1.9, filled = false, accessibilityLabel }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.text;
  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path
          d={ICONS[name]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled ? stroke : 'none'}
        />
      </Svg>
    </View>
  );
}
