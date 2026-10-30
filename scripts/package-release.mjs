import './check-version.mjs';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(root,'dist/extension/manifest.json'),'utf8'));
if(manifest.version!==pkg.version)throw new Error('Build the current version before packaging.');
const output=join(root,'release');
await mkdir(output,{recursive:true});
const stage=await mkdtemp(join(tmpdir(),'gemini-release-'));
const name='gemini-web-to-api-'+pkg.version;
const extensionName=name+'-extension.zip';
const runtimeName=name+'-runtime.tar.gz';
try{
  // Explicit inputs: never archive the workspace, data directory or node_modules.
  const runtime=join(stage,name);await mkdir(runtime);
  for(const file of ['package.json','package-lock.json','README.md']){
    await cp(join(root,file),join(runtime,file));
  }
  await cp(join(root,'docs/release-install.md'),join(runtime,'INSTALL.md'));
  // LICENSE is optional until the maintainer has chosen one.
  for(const file of (await readdir(root)).filter(f=>/^LICENSE(?:\..*)?$/.test(f))){
    await cp(join(root,file),join(runtime,file));
  }
  await cp(join(root,'dist'),join(runtime,'dist'),{
    recursive:true,filter:path=>!path.endsWith('.map')
  });
  // Remove old outputs only for this version; other versions remain untouched.
  await rm(join(output,extensionName),{force:true});
  await rm(join(output,runtimeName),{force:true});
  const extension=join(runtime,'dist/extension');
  const expected=['background.js','content.js','popup.js','manifest.json','popup.html','popup.css'];
  const actual=(await readdir(extension)).sort();
  if(JSON.stringify(actual)!==JSON.stringify([...expected].sort()))throw new Error('Unexpected files in extension build: '+actual.join(', '));
  execFileSync('zip',['-X','-q',join(output,extensionName),...expected],{cwd:extension,stdio:'inherit'});
  execFileSync('tar',['-czf',join(output,runtimeName),'-C',stage,name],{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});
  const checksums=await Promise.all([extensionName,runtimeName].map(async file=>{
    const hash=createHash('sha256').update(await readFile(join(output,file))).digest('hex');
    return hash+'  '+file;
  }));
  await writeFile(join(output,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
  console.log('Release artifacts: '+output);
}finally{await rm(stage,{recursive:true,force:true});}
