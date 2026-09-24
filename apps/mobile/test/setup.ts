import '@/i18n';

jest.mock('react-native-reanimated', () => require('./mocks/reanimated'));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-ET' }],
}));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: jest.fn(async (_algo: string, input: string) => {
    // Deterministic stand-in for SHA-256 in tests (djb2, hex, zero padded).
    let hash = 5381;
    for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
    return `${hash.toString(16).padStart(8, '0')}`.repeat(8);
  }),
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
}));

jest.mock('expo-application', () => ({
  getAndroidId: jest.fn(() => 'android-id-123'),
  getIosIdForVendorAsync: jest.fn(async () => 'ios-vendor-id'),
}));

jest.mock('expo-device', () => ({
  brand: 'TestBrand',
  modelName: 'Pixel 4a',
  osName: 'Android',
  osVersion: '13',
  isDevice: true,
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: (props: Record<string, unknown>) => React.createElement(View, { ...props, testID: 'expo-image' }) };
});

jest.mock('expo-router', () => {
  const React = require('react');
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
    Redirect: ({ href }: { href: string }) => React.createElement(require('react-native').Text, { testID: 'redirect' }, href),
    Link: Passthrough,
    Stack: Object.assign(Passthrough, { Screen: () => null, Protected: Passthrough }),
    Tabs: Object.assign(Passthrough, { Screen: () => null }),
  };
});
