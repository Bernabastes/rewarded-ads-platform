import { useTranslation } from 'react-i18next';
import Svg, { Circle, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

export interface CoinMarkProps {
  size?: number;
  /** Optional colour overrides (e.g. on a primary-coloured card). */
  outerColor?: string;
  innerColor?: string;
  notchColor?: string;
}

/**
 * The flat two-tone coin mark: a forest disc, a terracotta core and a small "clock hand" notch
 * (Gize = time). Deliberately matte - no gradients, shine or metallic cues.
 */
export function CoinMark({ size = 24, outerColor, innerColor, notchColor }: CoinMarkProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const outer = outerColor ?? colors.coinOuter;
  const inner = innerColor ?? colors.coinInner;
  const notch = notchColor ?? outer;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      accessibilityRole="image"
      accessibilityLabel={t('a11y.coinMark')}
      accessible
    >
      <Circle cx={50} cy={50} r={48} fill={outer} />
      <Circle cx={50} cy={50} r={31} fill={inner} />
      <Rect x={45.5} y={12} width={9} height={30} rx={3} fill={notch} />
    </Svg>
  );
}
