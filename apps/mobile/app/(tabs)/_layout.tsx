import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { resolveFontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/ThemeProvider';

const TABS: { name: string; icon: IconName; labelKey: string }[] = [
  { name: 'index', icon: 'home', labelKey: 'tabs.home' },
  { name: 'offers', icon: 'gift', labelKey: 'tabs.offers' },
  { name: 'wallet', icon: 'wallet', labelKey: 'tabs.wallet' },
  { name: 'profile', icon: 'user', labelKey: 'tabs.profile' },
];

export default function TabsLayout() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabIconInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          height: Platform.OS === 'web' ? 64 : undefined,
        },
        tabBarLabelStyle: { fontFamily: resolveFontFamily('medium', i18n.language), fontSize: 11 },
        sceneStyle: { backgroundColor: colors.background },
        lazy: true,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.labelKey),
            tabBarIcon: ({ color, focused }) => (
              <Icon name={tab.icon} color={String(color)} size={24} strokeWidth={focused ? 2.3 : 1.8} />
            ),
            tabBarAccessibilityLabel: t(tab.labelKey),
            tabBarButtonTestID: `tab-${tab.name}`,
          }}
        />
      ))}
    </Tabs>
  );
}
