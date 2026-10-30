import { resolve } from 'node:path';
import { config, dataDir } from './config.js';
const settings=config();
if(process.argv[2]==='info') {
  console.log(`服务地址: ${settings.url}\n插件配对令牌: ${settings.token}\n数据目录: ${dataDir}`);
} else if(process.argv[2]==='serve' || !process.argv[2]) {
  const { Store } = await import('./store.js');
  const { createBridge } = await import('./server.js');
  const store=new Store(resolve(dataDir,'bridge.sqlite'));
  const bridge=createBridge(store,settings.token);
  bridge.server.on('error',e=>{console.error(e.message);process.exitCode=1;store.close();});
  bridge.server.listen(Number(new URL(settings.url).port),'127.0.0.1',()=>console.log(`Gemini bridge: ${settings.url}\n运行 npm run info 查看插件配对令牌。`));
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await bridge.close();store.close();};
  process.on('SIGINT',close);process.on('SIGTERM',close);
} else {console.error('Usage: node dist/cli.js [serve|info]');process.exitCode=1;}
