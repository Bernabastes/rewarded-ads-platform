declare const module: { exports: unknown };
// Minimal Reanimated 4 stand-in for Jest: animated components render their plain RN counterparts,
// animations resolve immediately, and layout `entering`/`exiting` props are ignored.
const React = require('react');
const RN = require('react-native');

const identity = (value: any) => value;
const noop = () => undefined;

function animatedComponent(Component: any) {
  return React.forwardRef(function AnimatedMock(props: any, ref: any) {
    // Strip Reanimated-only props so RN does not warn about unknown props.
    const { entering: _e, exiting: _x, layout: _l, animatedProps, ...rest } = props;
    return React.createElement(Component, { ...rest, ...(animatedProps ?? {}), ref });
  });
}

const layoutAnimation = () => {
  const builder: any = {};
  for (const key of ['duration', 'delay', 'springify', 'damping', 'stiffness', 'easing', 'withInitialValues', 'build']) {
    builder[key] = () => builder;
  }
  return builder;
};

const Animated = {
  View: animatedComponent(RN.View),
  Text: animatedComponent(RN.Text),
  ScrollView: animatedComponent(RN.ScrollView),
  Image: animatedComponent(RN.Image),
  FlatList: animatedComponent(RN.FlatList),
  createAnimatedComponent: animatedComponent,
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  useSharedValue: (initial: any) => React.useRef({ value: initial }).current,
  useAnimatedStyle: (factory: () => any) => factory(),
  useAnimatedProps: (factory: () => any) => factory(),
  useDerivedValue: (factory: () => any) => ({ value: factory() }),
  useReducedMotion: () => false,
  useAnimatedReaction: noop,
  runOnJS: identity,
  runOnUI: identity,
  withSpring: identity,
  withTiming: identity,
  withDelay: (_ms: number, value: any) => value,
  withRepeat: identity,
  withSequence: (...values: any[]) => values[values.length - 1],
  cancelAnimation: noop,
  interpolate: (value: number) => value,
  Easing: {
    linear: identity,
    ease: identity,
    quad: identity,
    cubic: identity,
    inOut: identity,
    out: identity,
    in: identity,
    bezier: () => identity,
  },
  FadeIn: layoutAnimation(),
  FadeInUp: layoutAnimation(),
  FadeInDown: layoutAnimation(),
  FadeInRight: layoutAnimation(),
  FadeInLeft: layoutAnimation(),
  FadeOut: layoutAnimation(),
  FadeOutDown: layoutAnimation(),
  FadeOutUp: layoutAnimation(),
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
};
