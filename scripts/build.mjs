// Copies the storefront page into public/ for static hosts.
// Index.html stays at the repo root because Google Apps Script serves it from there.
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync('Index.html', 'public/index.html');
console.log('Built public/index.html');
