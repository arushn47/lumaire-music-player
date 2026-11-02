import { build } from 'esbuild';
import path from 'node:path';

await build({
  entryPoints: ['src-tauri/android-streaming/policy/entry.mjs'],
  outfile: 'src-tauri/gen/android/app/build/generated/background-policy/background-policy.mjs',
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2023',
  external: ['qjs:std', 'qjs:os'], mainFields: ['module', 'main'],
  plugins: [{ name: 'native-background-transport', setup(builder) {
    builder.onLoad({ filter: /[\\/]adapters[\\/]native\.ts$/ }, () => ({
      contents: `const call = async (method,args) => globalThis.backgroundRpc(method,args);
        export const library = {
          lookupCatalog: id => call('lookup',{id}),
          searchCatalog: (query,limit) => call('catalogSearch',{query,limit}),
          recommendCatalog: id => call('recommendations',{id}),
        };`, loader: 'js', resolveDir: path.resolve('src/adapters'),
    }));
  }}],
});
