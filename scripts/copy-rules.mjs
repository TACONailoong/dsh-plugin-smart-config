import fs from 'fs';
import path from 'path';

const source = path.resolve('src/rules/builtin-rules.json');
const destinationDir = path.resolve('dist/rules');
fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(source, path.join(destinationDir, 'builtin-rules.json'));
