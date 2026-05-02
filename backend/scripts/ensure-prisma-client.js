import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const prismaClientEntry = path.join(backendRoot, 'src', 'generated', 'prisma', 'index.js');

if(fs.existsSync(prismaClientEntry)) {
  console.log('Prisma client already exists, skip generate.');
  process.exit(0);
}

console.log('Prisma client not found, generating...');
execSync('prisma generate', {
  cwd: backendRoot,
  stdio: 'inherit'
});
