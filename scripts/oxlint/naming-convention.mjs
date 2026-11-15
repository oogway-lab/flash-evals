// Oxlint JS plugin that runs `@typescript-eslint/naming-convention`, the one
// rule Oxlint has no native version of. `.oxlintrc.json` loads it through
// `jsPlugins` and enables it as `flash-evals/naming-convention`.
// https://oxc.rs/docs/guide/usage/linter/js-plugins.html
//
// Oxlint hands the rule its own TypeScript-ESTree AST, so typescript-eslint's
// parser never runs. When the rule starts, it asks for parser services and
// throws if there are none, although it only uses them to read compiler
// options from a type-checked program and falls back to `{}` without one.
// Oxlint has no parser services, so this plugin supplies the ones
// `@typescript-eslint/parser` returns when `parserOptions.project` is unset.
// The rule therefore cannot use type information here: its options must not
// use the `types` selector modifier.
import typescriptPlugin from "@typescript-eslint/eslint-plugin";

const namingConvention = typescriptPlugin.rules["naming-convention"];

const untypedParserServices = Object.freeze({
    program: null,
    esTreeNodeToTSNodeMap: new WeakMap(),
    tsNodeToESTreeNodeMap: new WeakMap(),
});

// Returns a view of `target` with `overrides` replacing some of its
// properties. The proxy wraps an empty object, not `target`: Oxlint's context
// objects have read-only properties, and a proxy must return the target's own
// value for those.
function withOverrides(target, overrides) {
    return new Proxy(
        {},
        {
            get(_, key) {
                if (Object.hasOwn(overrides, key)) {
                    return overrides[key];
                }
                const value = target[key];
                return typeof value === "function" ? value.bind(target) : value;
            },
        },
    );
}

export default {
    meta: { name: "flash-evals" },
    rules: {
        "naming-convention": {
            meta: namingConvention.meta,
            create(context) {
                const sourceCode = withOverrides(context.sourceCode, {
                    parserServices: untypedParserServices,
                });
                return namingConvention.create(
                    withOverrides(context, { sourceCode }),
                );
            },
        },
    },
};
