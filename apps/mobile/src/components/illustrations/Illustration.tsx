import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';

export type IllustrationName =
  | 'emptyAds'
  | 'dailyDone'
  | 'offline'
  | 'blocked'
  | 'review'
  | 'success'
  | 'wallet'
  | 'offers'
  | 'notifications'
  | 'error'
  | 'welcome';

export interface IllustrationProps {
  name: IllustrationName;
  size?: number;
}

/**
 * Friendly flat illustrations in brand colours for empty / error / result states.
 * Kept simple (a few shapes each) so they are tiny and render identically on web and native.
 */
export function Illustration({ name, size = 160 }: IllustrationProps) {
  const { isDark } = useTheme();
  const forest = isDark ? palette.forest[400] : palette.forest[600];
  const forestSoft = isDark ? palette.forest[900] : palette.forest[100];
  const terracotta = palette.terracotta[400];
  const terracottaSoft = isDark ? palette.terracotta[900] : palette.terracotta[100];
  const stone = isDark ? palette.stone[700] : palette.stone[200];
  const stoneStrong = isDark ? palette.stone[500] : palette.stone[400];
  const cream = isDark ? palette.stone[800] : palette.stone[50];

  const common = { width: size, height: size, viewBox: '0 0 200 200' } as const;

  switch (name) {
    case 'emptyAds':
      // A coffee cup with a little steam - "take a break, check back soon".
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ellipse cx={100} cy={160} rx={62} ry={10} fill={stone} />
          <Path d="M55 80h84v40a30 30 0 0 1-30 30H85a30 30 0 0 1-30-30z" fill={forest} />
          <Path d="M139 90h10a14 14 0 0 1 0 28h-10" stroke={forest} strokeWidth={8} fill="none" />
          <Rect x={55} y={80} width={84} height={12} fill={forestSoft} />
          <Path d="M82 60c0-8 8-8 8-16s-8-8-8-16" stroke={terracotta} strokeWidth={5} strokeLinecap="round" fill="none" />
          <Path d="M104 60c0-8 8-8 8-16s-8-8-8-16" stroke={terracotta} strokeWidth={5} strokeLinecap="round" fill="none" />
        </Svg>
      );
    case 'dailyDone':
      // Crescent moon with a check - "done for today".
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Circle cx={100} cy={100} r={70} fill={forestSoft} />
          <Path d="M118 46a54 54 0 1 0 36 90 44 44 0 0 1-36-90z" fill={forest} />
          <Circle cx={138} cy={128} r={26} fill={terracotta} />
          <Path d="M126 128l8 8 16-16" stroke={cream} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Circle cx={60} cy={62} r={4} fill={terracotta} />
          <Circle cx={48} cy={110} r={3} fill={forest} />
        </Svg>
      );
    case 'offline':
      // Cloud with a broken link.
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Path d="M60 130a26 26 0 0 1 4-52 36 36 0 0 1 70-6 24 24 0 0 1 6 58z" fill={stone} />
          <Line x1={70} y1={150} x2={130} y2={150} stroke={stoneStrong} strokeWidth={6} strokeLinecap="round" />
          <Line x1={80} y1={166} x2={120} y2={166} stroke={stoneStrong} strokeWidth={6} strokeLinecap="round" />
          <Circle cx={140} cy={60} r={22} fill={terracotta} />
          <Line x1={130} y1={50} x2={150} y2={70} stroke={cream} strokeWidth={6} strokeLinecap="round" />
          <Line x1={150} y1={50} x2={130} y2={70} stroke={cream} strokeWidth={6} strokeLinecap="round" />
        </Svg>
      );
    case 'blocked':
      // Shield with a pause bar - calm, not alarming.
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Path d="M100 28l58 22v46c0 36-25 66-58 78-33-12-58-42-58-78V50z" fill={forestSoft} />
          <Path d="M100 44l44 17v36c0 28-19 51-44 61-25-10-44-33-44-61V61z" fill={forest} />
          <Rect x={86} y={86} width={10} height={36} rx={4} fill={cream} />
          <Rect x={104} y={86} width={10} height={36} rx={4} fill={cream} />
        </Svg>
      );
    case 'review':
      // Magnifying glass over a document.
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Rect x={52} y={40} width={80} height={110} rx={10} fill={cream} stroke={stone} strokeWidth={4} />
          <Line x1={68} y1={66} x2={116} y2={66} stroke={stone} strokeWidth={6} strokeLinecap="round" />
          <Line x1={68} y1={86} x2={104} y2={86} stroke={stone} strokeWidth={6} strokeLinecap="round" />
          <Line x1={68} y1={106} x2={110} y2={106} stroke={stone} strokeWidth={6} strokeLinecap="round" />
          <Circle cx={128} cy={118} r={28} fill={forestSoft} stroke={forest} strokeWidth={8} />
          <Line x1={148} y1={138} x2={168} y2={158} stroke={terracotta} strokeWidth={10} strokeLinecap="round" />
        </Svg>
      );
    case 'success':
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Circle cx={100} cy={100} r={70} fill={forestSoft} />
          <Circle cx={100} cy={100} r={48} fill={forest} />
          <Path d="M78 102l14 14 30-32" stroke={cream} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Circle cx={158} cy={52} r={8} fill={terracotta} />
          <Circle cx={44} cy={140} r={6} fill={terracotta} />
        </Svg>
      );
    case 'wallet':
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Rect x={36} y={60} width={128} height={90} rx={16} fill={forest} />
          <Rect x={36} y={78} width={128} height={20} fill={forestSoft} opacity={0.35} />
          <Rect x={120} y={96} width={44} height={30} rx={8} fill={terracotta} />
          <Circle cx={148} cy={111} r={6} fill={cream} />
          <Circle cx={70} cy={48} r={16} fill={terracottaSoft} />
          <Circle cx={70} cy={48} r={8} fill={terracotta} />
        </Svg>
      );
    case 'offers':
      // Clipboard + phone silhouette - surveys and app installs.
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Rect x={48} y={44} width={78} height={112} rx={12} fill={cream} stroke={stone} strokeWidth={4} />
          <Rect x={72} y={34} width={30} height={16} rx={6} fill={forest} />
          <Line x1={66} y1={80} x2={108} y2={80} stroke={stone} strokeWidth={6} strokeLinecap="round" />
          <Line x1={66} y1={100} x2={98} y2={100} stroke={stone} strokeWidth={6} strokeLinecap="round" />
          <Circle cx={72} cy={126} r={7} fill={terracotta} />
          <Rect x={112} y={88} width={52} height={90} rx={12} fill={forest} />
          <Rect x={122} y={100} width={32} height={54} rx={6} fill={forestSoft} />
          <Circle cx={138} cy={166} r={4} fill={cream} />
        </Svg>
      );
    case 'notifications':
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Path d="M64 132V98a36 36 0 0 1 72 0v34l14 14H50z" fill={forestSoft} stroke={forest} strokeWidth={6} strokeLinejoin="round" />
          <Path d="M86 160a14 14 0 0 0 28 0" stroke={forest} strokeWidth={6} fill="none" />
          <Circle cx={134} cy={64} r={16} fill={terracotta} />
          <Path d="M126 64l6 6 10-12" stroke={cream} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      );
    case 'error':
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Circle cx={100} cy={100} r={70} fill={terracottaSoft} />
          <Path d="M100 50l50 90H50z" fill={terracotta} />
          <Rect x={95} y={82} width={10} height={30} rx={5} fill={cream} />
          <Circle cx={100} cy={124} r={6} fill={cream} />
        </Svg>
      );
    case 'welcome':
    default:
      // Sunrise over hills - warm, optimistic.
      return (
        <Svg {...common} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Circle cx={100} cy={98} r={40} fill={terracotta} />
          <Circle cx={100} cy={98} r={26} fill={palette.terracotta[200]} />
          <Path d="M0 150c40-40 80-40 120-10s60 20 80 0v60H0z" fill={forest} />
          <Path d="M0 170c30-24 70-24 110-4s60 14 90 0v34H0z" fill={forestSoft} />
          <Circle cx={40} cy={50} r={5} fill={forestSoft} />
          <Circle cx={166} cy={40} r={4} fill={terracottaSoft} />
        </Svg>
      );
  }
}
