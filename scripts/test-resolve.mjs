/**
 * Lets `node --test` import the app's TypeScript as the bundler does:
 * `../units` means `../units.ts`, and `@/x` means `src/x`. Only for tests and
 * probes — the app itself is bundled.
 */
import { registerHooks } from 'node:module';

const SRC = new URL('../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    // `@/x` is `src/x`, as tsconfig's paths say.
    if (specifier.startsWith('@/')) specifier = new URL(specifier.slice(2), SRC).href;
    try {
      return next(specifier, context);
    } catch (e) {
      if ((/^\.\.?\//.test(specifier) || specifier.startsWith('file:')) && !/\.[cm]?[jt]s$/.test(specifier)) {
        try {
          return next(`${specifier}.ts`, context);
        } catch {
          // A directory import means its index, as the bundler reads it.
          return next(`${specifier}/index.ts`, context);
        }
      }
      throw e;
    }
  },
});
