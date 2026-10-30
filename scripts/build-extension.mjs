import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/extension',{recursive:true});
await build({entryPoints:['extension/background.ts','extension/content.ts','extension/popup.ts'],outdir:'dist/extension',bundle:true,format:'iife',target:'chrome116',sourcemap:true});
for(const file of ['manifest.json','popup.html','popup.css']) await copyFile(`extension/${file}`,`dist/extension/${file}`);
console.log('Chrome 扩展: dist/extension');
