import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const [index, styles, qrcode, photoUpload, javascript] = await Promise.all([
  readFile(resolve(projectRoot, 'Index.html'), 'utf8'),
  readFile(resolve(projectRoot, 'Styles.html'), 'utf8'),
  readFile(resolve(projectRoot, 'QRCode.html'), 'utf8'),
  readFile(resolve(projectRoot, 'PhotoUpload.html'), 'utf8'),
  readFile(resolve(projectRoot, 'JavaScript.html'), 'utf8'),
]);

const output = index
  .replace("<?!= include_('Styles'); ?>", () => styles)
  .replace("<?!= include_('QRCode'); ?>", () => qrcode)
  .replace("<?!= include_('PhotoUpload'); ?>", () => photoUpload)
  .replace("<?!= include_('JavaScript'); ?>", () => javascript)
  .replace('<?!= initialTreeId ?>', JSON.stringify(''))
  .replace('<?!= appVersion ?>', JSON.stringify(packageInfo.version));

if (output.includes('<?')) {
  throw new Error('Unresolved Apps Script template directive in preview build.');
}

await mkdir(resolve(projectRoot, 'dist'), { recursive: true });
await writeFile(resolve(projectRoot, 'dist/index.html'), output, 'utf8');
process.stdout.write(`Built ${resolve(projectRoot, 'dist/index.html')}\n`);
