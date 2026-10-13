// Local, type-aware rule for R16 (design §6.9, ADR 0022): a number does not
// reach the screen except through `<Q>` or `<Num>`. It checks the children of
// JSX elements (attributes carry geometry and aria text, not visible numbers)
// and flags an expression that is a number or a bigint, or a string computed
// from a number: a template literal with a number in it, a call with a number
// for an argument or receiver (`gb(bytes)`, `x.toFixed(1)`, `String(n)`), or a
// `+` with a number operand. The modules of `<Q>` and `<Num>` are exempt in the
// config, not here.
import ts from 'typescript';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bare: 'Render this number through <Q> (a quantity) or <Num> (a number that claims nothing), not as JSX text (R16, ADR 0022).',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) {
      throw new Error('no-bare-numbers needs typed linting (parserOptions.projectService).');
    }
    const checker = services.program.getTypeChecker();

    const isNumeric = (node) => {
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
      const parts = type.isUnion() ? type.types : [type];
      return parts.length > 0 && parts.every((t) => (t.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike)) !== 0);
    };

    /** Whether the text this expression renders comes from a number. */
    const fromNumber = (node) => {
      if (isNumeric(node)) return true;
      switch (node.type) {
        case 'TemplateLiteral':
          return node.expressions.some(fromNumber);
        case 'CallExpression':
          return node.arguments.some(fromNumber) || (node.callee.type === 'MemberExpression' && fromNumber(node.callee.object));
        case 'BinaryExpression':
          return node.operator === '+' && (fromNumber(node.left) || fromNumber(node.right));
        case 'ConditionalExpression':
          return fromNumber(node.consequent) || fromNumber(node.alternate);
        case 'LogicalExpression':
          return fromNumber(node.left) || fromNumber(node.right);
        case 'TSAsExpression':
        case 'TSNonNullExpression':
        case 'ChainExpression':
          return fromNumber(node.expression);
        default:
          return false;
      }
    };

    return {
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment') return;
        if (node.expression.type === 'JSXEmptyExpression') return;
        if (fromNumber(node.expression)) context.report({ node, messageId: 'bare' });
      },
    };
  },
};

export default rule;
