// Local ESLint rule: every user-facing string must go through i18n (`t('key')`).
// Flags literal text written directly inside JSX (`<Text>Hello</Text>`, `<Text>{'Hello'}</Text>`)
// and literal strings passed to the props listed in `TEXT_LIKE_PROPS` (e.g. `title="Hello"`).
//
// Allowed: whitespace, punctuation/symbols only (e.g. "•", "+", "/"), pure numbers, and
// strings explicitly produced by the `t()` translation function.

const TEXT_LIKE_PROPS = new Set([
  'title',
  'label',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'helperText',
  'errorText',
  'subtitle',
  'description',
  'message',
  'headerTitle',
]);

function isMeaningfulText(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Letters in any script (Latin, Ethiopic, ...) mean "words". Digit/punctuation-only strings are fine.
  return /\p{L}/u.test(trimmed);
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded user-facing text in JSX; use i18n keys instead.' },
    schema: [],
    messages: {
      hardcoded: 'Hardcoded user-facing text "{{text}}". Use t("...") from useTranslation instead.',
    },
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: 'hardcoded', data: { text: String(text).trim().slice(0, 40) } });

    return {
      JSXText(node) {
        if (isMeaningfulText(node.value)) report(node, node.value);
      },
      JSXExpressionContainer(node) {
        const parentType = node.parent && node.parent.type;
        if (parentType !== 'JSXElement' && parentType !== 'JSXFragment') return;
        const expr = node.expression;
        if (expr.type === 'Literal' && isMeaningfulText(expr.value)) report(expr, expr.value);
        if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
          const raw = expr.quasis.map((q) => q.value.cooked).join('');
          if (isMeaningfulText(raw)) report(expr, raw);
        }
      },
      JSXAttribute(node) {
        if (!node.name || !TEXT_LIKE_PROPS.has(node.name.name)) return;
        const value = node.value;
        if (!value) return;
        if (value.type === 'Literal' && isMeaningfulText(value.value)) report(value, value.value);
        if (
          value.type === 'JSXExpressionContainer' &&
          value.expression.type === 'Literal' &&
          isMeaningfulText(value.expression.value)
        ) {
          report(value.expression, value.expression.value);
        }
      },
    };
  },
};

export default {
  meta: { name: 'gize-i18n', version: '1.0.0' },
  rules: { 'no-hardcoded-jsx-text': rule },
};
