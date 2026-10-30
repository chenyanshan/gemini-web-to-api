import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const pkg=read('package.json'), lock=read('package-lock.json'), manifest=read('extension/manifest.json');
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version) || pkg.version.split('.').some(n=>Number(n)>65535)){
  throw new Error('Release versions must be stable X.Y.Z versions with each component <= 65535 (Chrome manifest requirement).');
}
for(const [name,version] of [['package-lock.json',lock.version],['package-lock.json root',lock.packages[''].version],['extension/manifest.json',manifest.version]]){
  if(version!==pkg.version)throw new Error(name+' version differs from package.json: '+version+' vs '+pkg.version);
}
const tag=process.env.RELEASE_TAG;
if(tag && tag!=='v'+pkg.version)throw new Error('Release tag '+tag+' must match v'+pkg.version);
console.log('Version verified: '+(tag || pkg.version));
