import {readFileSync,writeFileSync} from 'node:fs';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version) || pkg.version.split('.').some(n=>Number(n)>65535))throw new Error('Use a stable X.Y.Z version supported by Chrome.');
const path='extension/manifest.json';
const manifest=JSON.parse(readFileSync(path,'utf8'));
manifest.version=pkg.version;
writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log('Chrome manifest version synchronized: '+pkg.version);
