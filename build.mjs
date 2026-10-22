import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFile(path.join(root, name), 'utf8');
const [template, app, styles, vendor, mit, apache] = await Promise.all([
  read('src/template.html'), read('src/app.js'), read('src/styles.css'),
  read('vendor/xlsx.full.min.js'), read('LICENSE'), read('LICENSES/Apache-2.0.txt'),
]);
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
let output = template;
for (const [marker, value] of Object.entries({
  __SHEETJS__: vendor, __APP__: app, __STYLES__: styles,
  __MIT_TEXT__: escape(mit), __APACHE_TEXT__: escape(apache),
})) {
  if (!output.includes(marker)) throw new Error(`Missing template marker: ${marker}`);
  output = output.replaceAll(marker, () => value);
}
if (/__(SHEETJS|APP|STYLES|MIT_TEXT|APACHE_TEXT)__/.test(output)) throw new Error('Unresolved template marker');
if (process.argv.includes('--check')) {
  if (await read('index.html') !== output) throw new Error('index.html is out of date. Run: node build.mjs');
  console.log('PASS generated HTML matches source');
} else {
  await fs.writeFile(path.join(root, 'index.html'), output, 'utf8');
  console.log('Built index.html (offline standalone file)');
}
