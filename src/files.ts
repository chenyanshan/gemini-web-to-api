import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {basename,extname,isAbsolute} from 'node:path';
import {MAX_FILE_BYTES} from './protocol.js';
const types:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json','.html':'text/html','.css':'text/css','.js':'text/javascript','.ts':'text/plain','.tsx':'text/plain','.jsx':'text/plain','.svg':'image/svg+xml','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
export async function readAttachment(path:string) {
  if(!isAbsolute(path))throw new Error('附件路径必须是绝对路径');
  const handle=await open(path,constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();
    if(!stat.isFile() || !stat.size || stat.size>MAX_FILE_BYTES)throw new Error('附件必须是 1 字节至 20 MiB 的普通文件');
    // Bound the actual read as well: the file can change after stat().
    const buffer=Buffer.alloc(MAX_FILE_BYTES+1);let size=0;
    while(size<buffer.length){const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
    if(!size || size>MAX_FILE_BYTES)throw new Error('附件大小超出限制');
    const bytes=buffer.subarray(0,size);
    let mimeType=types[extname(path).toLowerCase()] || 'application/octet-stream';
    if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mimeType='image/png';
    else if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)mimeType='image/jpeg';
    else if(bytes.subarray(0,5).toString()==='%PDF-')mimeType='application/pdf';
    return {name:basename(path),mimeType,bytes};
  } finally {await handle.close();}
}
