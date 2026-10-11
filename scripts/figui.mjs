import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';

const directory = path.resolve('node_modules/@rogieking/figui3');
const registration = /^fig(?:Editor|Lab)?Define(?:Element|CustomizedBuiltIn)$/;

// Keep upstream implementations intact. Only remove registrations for unused
// components, allowing esbuild to eliminate their unreachable classes/helpers.
export async function figuiBundle(application) {
  const modules = new Map();
  const components = new Map();
  for (const name of ['fig.js', 'fig-editor.js', 'fig-lab.js']) {
    const source = await readFile(path.join(directory, name), 'utf8');
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const printer = ts.createPrinter({ removeComments: true });
    const classes = new Map(
      ast.statements
        .filter(ts.isClassDeclaration)
        .map((node) => [node.name?.text, printer.printNode(ts.EmitHint.Unspecified, node, ast)]),
    );
    const calls = [];
    for (const statement of ast.statements) {
      const call = ts.isExpressionStatement(statement) && statement.expression;
      if (!call || !ts.isCallExpression(call) || !registration.test(call.expression.getText(ast)))
        continue;
      const [tag, constructor] = call.arguments;
      if (!tag || !ts.isStringLiteral(tag))
        throw new Error(`Unsupported FigUI3 registration in ${name}`);
      const body = classes.get(constructor.getText(ast));
      if (!body) throw new Error(`Missing FigUI3 implementation: ${tag.text}`);
      calls.push({ tag: tag.text, start: statement.getStart(ast), end: statement.end });
      components.set(tag.text, body);
    }
    modules.set(path.join(directory, name), { source, calls });
  }
  const tagsIn = (text) =>
    [...text.matchAll(/\bfig-[a-z][a-z0-9-]*/g)]
      .map((match) => match[0])
      .filter((tag) => components.has(tag));
  const used = new Set(tagsIn(application));
  // Classes contain dynamic templates, selector strings and picker mode branches.
  // Include their full dependency closure, even when a mode is initially hidden.
  for (const tag of used)
    for (const dependency of tagsIn(components.get(tag))) used.add(dependency);
  if (!used.has('fig-fill-picker')) throw new Error('FigUI3 picker dependency was not discovered');
  return {
    used: [...used].sort(),
    plugin: {
      name: 'figui-used-components',
      setup(build) {
        build.onLoad(
          { filter: /[\\/]@rogieking[\\/]figui3[\\/]fig(?:-editor|-lab)?\.js$/ },
          (args) => {
            const module = modules.get(args.path);
            if (!module) throw new Error(`Unexpected FigUI3 path: ${args.path}`);
            let contents = module.source;
            for (const call of [...module.calls].reverse())
              if (!used.has(call.tag))
                contents = contents.slice(0, call.start) + contents.slice(call.end);
            return { contents, loader: 'js', resolveDir: directory };
          },
        );
      },
    },
    async css() {
      const sources = await Promise.all(
        ['fig.css', 'fig-editor.css', 'fig-lab.css'].map((name) =>
          readFile(path.join(directory, 'dist', name), 'utf8'),
        ),
      );
      const root = postcss.parse(sources.join('\n'));
      root.walkComments((comment) => comment.remove());
      root.walkRules((rule) => {
        // Only prune selectors whose leading component cannot exist. Preserve
        // generic rules, classes, nested/pseudo selectors and all dynamic states.
        const selectors = postcss.list.comma(rule.selector).filter((selector) => {
          const tag =
            selector.match(/^\s*(fig-[\w-]+)(?=[\s.#[:>+~]|$)/)?.[1] ||
            selector.match(/^\s*\[is=["'](fig-[\w-]+)["']\]/)?.[1];
          return !tag || !components.has(tag) || used.has(tag);
        });
        if (!selectors.length) rule.remove();
        else rule.selector = selectors.join(',');
      });
      return root.toString();
    },
  };
}
