#!/usr/bin/env node
/**
 * Fast electron build using esbuild (transpile-only, no type checking).
 * ~10-50x faster than `tsc` for dev builds.
 * Run `npm run typecheck:electron` separately for type safety.
 */

const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'dist-electron');

// Only independently loaded runtime files are entries. Everything imported by
// main/preload is bundled once; treating every source file as an entry duplicated
// the full dependency graph hundreds of times and inflated dist-electron to 500MB.
const entryPoints = {
  'electron/main': path.resolve(rootDir, 'electron/main.ts'),
  'electron/preload': path.resolve(rootDir, 'electron/preload.ts'),
  'electron/audio/whisper/whisperWorker': path.resolve(rootDir, 'electron/audio/whisper/whisperWorker.ts'),
  'electron/rag/vectorSearchWorker': path.resolve(rootDir, 'electron/rag/vectorSearchWorker.ts'),
};

// Native/runtime packages must be resolved by Node from the packaged app.
// In particular, sharp's ESM entrypoint uses import.meta.url when it creates
// its native-module require. Bundling that ESM into this CommonJS output turns
// import.meta into an empty object and crashes at startup with
// createRequire(undefined).
const runtimeExternals = [
  'electron',
  'better-sqlite3',
  'keytar',
  'sharp',
  'sqlite-vec',
  '@vectorize-io/hindsight-client',
];

const mustRemainExternal = ['better-sqlite3', 'keytar', 'sharp', 'sqlite-vec'];

function assertRuntimePackagesWereNotBundled(metafile) {
  const bundledInputs = Object.keys(metafile.inputs).map((input) => input.replaceAll('\\', '/'));
  const accidentallyBundled = mustRemainExternal.filter((packageName) => {
    const packagePath = `/node_modules/${packageName}/`;
    return bundledInputs.some((input) => `/${input}`.includes(packagePath));
  });

  if (accidentallyBundled.length > 0) {
    throw new Error(
      `Native runtime package(s) were bundled into Electron CommonJS output: ${accidentallyBundled.join(', ')}`,
    );
  }
}

const start = Date.now();

fs.rmSync(outDir, { recursive: true, force: true });

build({
  entryPoints,
  bundle: true,           // resolve all static + dynamic imports so postProcessor
                         // is inlined and the path rewrite works (vs bundle:false
                         // which copies files as-is and leaves unresolved relative paths)
  outdir: outDir,
  outbase: rootDir,       // preserve directory structure (electron/main.ts → dist-electron/electron/main.js)
  platform: 'node',
  target: 'node20',
  format: 'cjs',          // Electron loads package.json main as CommonJS in this repo
                          // (package.json has no "type": "module").
  minify: process.env.NODE_ENV === 'production',
  legalComments: 'none',
  external: runtimeExternals,
  metafile: true,
  sourcemap: process.env.MIAODA_BUILD_SOURCEMAP === '1',
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.js': 'js',
  },
  // (An eval-only DNS-pin banner used to live here. It rerouted dns.lookup for
  // the retired upstream gateway host to dns.resolve4, working around spurious
  // macOS ENOTFOUND under the real-UI eval's rapid relaunch load. Nothing in the
  // app contacts that host anymore, so the banner was dead weight on every
  // bundle. If a future host needs the same workaround, see electron/audio/
  // dnsHelpers.ts, which does the equivalent for STT WebSocket endpoints.)
  logLevel: 'warning',
}).then((result) => {
  assertRuntimePackagesWereNotBundled(result.metafile);
  console.log(`[build-electron] Done in ${Date.now() - start}ms`);
}).catch((err) => {
  console.error('[build-electron] Build failed:', err.message);
  process.exit(1);
});
