import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
export const dataDir = resolve(process.env.BRIDGE_DATA_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../.data'));
export function config() {
  mkdirSync(dataDir, { recursive:true, mode:0o700 });
  const path = resolve(dataDir,'connection.json');
  if (!existsSync(path)) {
    const port = Number(process.env.BRIDGE_PORT || 43123);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('BRIDGE_PORT 应为 1024–65535');
    writeFileSync(path, JSON.stringify({url:`http://127.0.0.1:${port}`,token:randomBytes(32).toString('hex')},null,2), {mode:0o600,flag:'wx'});
  }
  return JSON.parse(readFileSync(path,'utf8')) as {url:string;token:string};
}
