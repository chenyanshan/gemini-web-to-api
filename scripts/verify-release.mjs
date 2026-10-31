import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const prefix='gemini-web-to-api-'+version;
const release=join(root,'release');
const expected=[prefix+'-extension.zip',prefix+'-runtime.tar.gz'];
const sums=(await readFile(join(release,'SHA256SUMS.txt'),'utf8')).trim().split('\n');
if(sums.length!==expected.length)throw new Error('Unexpected checksum entries');
for(let i=0;i<expected.length;i++){
  const file=expected[i];const hash=createHash('sha256').update(await readFile(join(release,file))).digest('hex');
  if(sums[i]!==hash+'  '+file)throw new Error('Checksum mismatch: '+file);
}
const zipFiles=execFileSync('unzip',['-Z1',join(release,expected[0])],{encoding:'utf8'}).trim().split('\n').sort();
const extensionFiles=['background.js','content.js','popup.js','manifest.json','popup.html','popup.css'].sort();
if(JSON.stringify(zipFiles)!==JSON.stringify(extensionFiles))throw new Error('Unexpected extension ZIP contents');
const archive=join(release,expected[1]);
const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');
for(const path of entries){
  if(!path.startsWith(prefix+'/') || path.includes('..') || /(?:^|\/)(?:\.data|node_modules|\.git|\.env)(?:\/|$)/.test(path) || /\.map$/.test(path))throw new Error('Unexpected runtime archive path: '+path);
}
const temp=await mkdtemp(join(tmpdir(),'gemini-release-verify-'));
let child,client;
try{
  execFileSync('tar',['-xzf',archive,'-C',temp]);
  const runtime=join(temp,prefix);
  if(!(await readFile(join(runtime,'skills/gemini-ui-design/SKILL.md'),'utf8')).trim())throw new Error('Release is missing the UI design skill');
  execFileSync('npm',['ci','--omit=dev','--no-audit','--no-fund'],{cwd:runtime,stdio:'inherit'});
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const data=join(temp,'isolated-data');
  const env={...process.env,BRIDGE_DATA_DIR:data,BRIDGE_PORT:String(port)};
  child=spawn(process.execPath,[join(runtime,'dist/cli.js'),'serve'],{cwd:runtime,env,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  let config,health;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error('Runtime server failed: '+log);
    try{
      config=JSON.parse(await readFile(join(data,'connection.json'),'utf8'));
      const response=await fetch(config.url+'/api/health',{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(1000)});
      if(response.ok){health=await response.json();break;}
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!health?.ok || health.browserConnected)throw new Error('Isolated runtime health check failed');
  client=new Client({name:'release-verifier',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[join(runtime,'dist/mcp.js')],cwd:runtime,env,stderr:'pipe'}));
  const tools=await client.listTools();
  for(const name of ['gemini_files_upload','gemini_session_update','gemini_job_inspect','gemini_job_resume'])if(!tools.tools.some(t=>t.name===name))throw new Error('Release is missing MCP tool: '+name);
  const status=await client.callTool({name:'gemini_status',arguments:{}});
  if(status.isError || !JSON.parse(status.content[0].text).ok)throw new Error('Release MCP cannot reach its service');
  if(client.getServerVersion()?.version!==version)throw new Error('Release MCP version mismatch');
  console.log('PASS: checksums, archive contents, clean production install, HTTP health and MCP tools. No Gemini requests sent.');
}finally{
  await client?.close();
  if(child && child.exitCode===null){
    const stopped=once(child,'exit');child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),3000);timer.unref();
    await stopped;clearTimeout(timer);
  }
  await rm(temp,{recursive:true,force:true});
}
