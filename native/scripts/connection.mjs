#!/usr/bin/env node
import {readFile, mkdir, writeFile, chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = fileURLToPath(new URL('../Local/connection.json', import.meta.url));
const url = new URL(process.argv[2] || 'http://127.0.0.1:8787');
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Physical devices need your HTTPS backend URL. Loopback HTTP is only for the simulator.');
if(url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use only the backend origin, without credentials, query or path.');
const env = await readFile(root + 'backend/.env', 'utf8');
const match = env.match(/^API_TOKEN\s*=\s*(.+)$/m);
const token = match?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
if(!token || token.length < 32) throw new Error('Set API_TOKEN in backend/.env first.');
await mkdir(fileURLToPath(new URL('../Local/', import.meta.url)), {recursive:true, mode:0o700});
await writeFile(output, JSON.stringify({baseURL:url.origin,token}, null, 2), {mode:0o600});
await chmod(output, 0o600);
console.log('Saved native/Local/connection.json (private, Git-ignored). Press and hold Tuck’s avatar in the Debug iPhone app to import it.');
