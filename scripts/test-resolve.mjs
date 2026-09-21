/**
 * Lets `node --test` import the app's TypeScript as the bundler does:
 * `../units` means `../units.ts`. Only for tests — the app itself is bundled.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        return next(`${specifier}.ts`, context);
      }
      throw e;
    }
  },
});
