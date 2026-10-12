import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateRuntime({ apiUrl, siteUrl }) {
  let api;
  let site;
  try {
    api = new URL(apiUrl);
    site = new URL(siteUrl);
  } catch {
    throw new Error('Provide FOREST_ID_API_URL and FOREST_ID_SITE_URL, or --api-url and --site-url.');
  }
  if (api.protocol !== 'https:' || api.hostname !== 'script.google.com' || api.port || api.username || api.password || api.search || api.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(api.pathname)) {
    throw new Error('API URL must be a canonical HTTPS script.google.com/macros/s/DEPLOYMENT/exec URL without account routing, query, or fragment.');
  }
  if (site.protocol !== 'https:' || !/^[a-z0-9-]+\.github\.io$/.test(site.hostname) || site.port || site.username || site.password || site.search || site.hash || !/^\/(?:[A-Za-z0-9_.-]+\/?)*$/.test(site.pathname)) {
    throw new Error('Site URL must be an HTTPS OWNER.github.io project or account base URL without query, fragment, or credentials.');
  }
  if (!site.pathname.endsWith('/')) site.pathname += '/';
  return { mode: 'production', apiUrl: api.href, siteUrl: site.href };
}

export async function buildPages({ apiUrl, siteUrl, outDir = resolve(projectRoot, 'dist-pages') }) {
  const runtime = validateRuntime({ apiUrl, siteUrl });
  const [index, styles, qrcode, photoUpload, javascript, packageJson] = await Promise.all([
    readFile(resolve(projectRoot, 'Index.html'), 'utf8'),
    readFile(resolve(projectRoot, 'Styles.html'), 'utf8'),
    readFile(resolve(projectRoot, 'QRCode.html'), 'utf8'),
    readFile(resolve(projectRoot, 'PhotoUpload.html'), 'utf8'),
    readFile(resolve(projectRoot, 'JavaScript.html'), 'utf8'),
    readFile(resolve(projectRoot, 'package.json'), 'utf8'),
  ]);
  const version = JSON.parse(packageJson).version;
  const bootstrap = '<script>window.FOREST_ID_RUNTIME = ' + JSON.stringify(runtime).replace(/</g, '\\u003c') + ';</script>\n';
  const output = index
    .replace("<?!= include_('Styles'); ?>", () => styles)
    .replace("<?!= include_('QRCode'); ?>", () => qrcode)
    .replace("<?!= include_('PhotoUpload'); ?>", () => photoUpload)
    .replace("<?!= include_('JavaScript'); ?>", () => bootstrap + javascript)
    .replace('<?!= initialTreeId ?>', JSON.stringify(''))
    .replace('<?!= appVersion ?>', JSON.stringify(version));

  if (output.includes('<?')) throw new Error('Unresolved Apps Script template directive in Pages build.');
  const outputDirectory = resolve(outDir);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputDirectory, 'index.html'), output, 'utf8'),
    writeFile(resolve(outputDirectory, '.nojekyll'), '', 'utf8'),
  ]);
  return { path: resolve(outputDirectory, 'index.html'), runtime, version };
}

function readArguments(argv) {
  const args = {};
  const supported = { '--api-url': 'apiUrl', '--site-url': 'siteUrl', '--out-dir': 'outDir' };
  for (let index = 0; index < argv.length; index += 1) {
    const [name, ...valueParts] = argv[index].split('=');
    if (!supported[name]) throw new Error('Unknown argument: ' + name);
    const value = valueParts.length ? valueParts.join('=') : argv[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + name);
    args[supported[name]] = value;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await buildPages({
      apiUrl: process.env.FOREST_ID_API_URL,
      siteUrl: process.env.FOREST_ID_SITE_URL,
      ...readArguments(process.argv.slice(2)),
    });
    process.stdout.write(`Built production Pages site: ${result.path}\nSite: ${result.runtime.siteUrl}\nAPI: ${result.runtime.apiUrl}\n`);
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
