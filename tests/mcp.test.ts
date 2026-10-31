import {it,expect} from 'vitest';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import type {AddressInfo} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Store} from '../src/store.js';
import {createBridge} from '../src/server.js';
it('exposes working MCP tools and forwards model/thinking configuration through the local API',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gemini-mcp-'));const store=new Store(':memory:');const bridge=createBridge(store,'test');
 bridge.server.listen(0,'127.0.0.1');await once(bridge.server,'listening');
 writeFileSync(join(dir,'connection.json'),JSON.stringify({url:`http://127.0.0.1:${(bridge.server.address() as AddressInfo).port}`,token:'test'}));
 const client=new Client({name:'integration-test',version:'1.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',resolve('src/mcp.ts')],env:{...process.env,BRIDGE_DATA_DIR:dir} as Record<string,string>,stderr:'pipe'});
 try {
  await client.connect(transport);
  const listed=await client.listTools();expect(listed.tools.map(t=>t.name)).toContain('gemini_job_resume');
  const response=await client.callTool({name:'gemini_session_create',arguments:{label:'UI test'}});
  const data=JSON.parse((response.content as {text:string}[])[0].text);expect(data.model).toBe('3.1 pro');expect(data.thinkingLevel).toBe('high');expect(data.revision).toBe(0);
  const update=await client.callTool({name:'gemini_session_update',arguments:{session_id:data.id,expected_revision:0,model:'4 argon',thinking_level:'low'}});
  expect(update.isError).toBe(false);const updated=JSON.parse((update.content as {text:string}[])[0].text);expect(updated).toMatchObject({model:'4 argon',thinkingLevel:'low',revision:1});
  const filePath=join(dir,'brief.txt');writeFileSync(filePath,'UI test fixture');
  const uploaded=await client.callTool({name:'gemini_files_upload',arguments:{paths:[filePath]}});
  expect(uploaded.isError).not.toBe(true);const files=JSON.parse((uploaded.content as {text:string}[])[0].text);
  expect(files.attachment_ids).toHaveLength(1);
  const submit=await client.callTool({name:'gemini_submit',arguments:{session_id:data.id,request_id:'attachment-key',prompt:'UI',expected_revision:1,attachment_ids:files.attachment_ids}});
  expect(submit.isError).not.toBe(true);const job=JSON.parse((submit.content as {text:string}[])[0].text);
  expect(job.attachments[0].name).toBe('brief.txt');
  expect(store.fileBytes(files.attachment_ids[0]).toString()).toBe('UI test fixture');
  const health=await client.callTool({name:'gemini_status',arguments:{}});expect(health.isError).toBe(false);
 } finally {await client.close();await bridge.close();store.close();rmSync(dir,{recursive:true,force:true});}
},15000);
