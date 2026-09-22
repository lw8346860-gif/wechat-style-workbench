import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const folder = fs.mkdtempSync(join(tmpdir(), 'workbench-docx-'));
const fixture = join(folder, 'two-images.docx');
const manifest = JSON.parse(execFileSync('python3', ['tests/make_word_fixture.py', fixture], { encoding: 'utf8' }));
const base64 = fs.readFileSync(fixture).toString('base64');
const tabs=await(await fetch('http://127.0.0.1:9333/json')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0;const waiting=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){waiting.get(m.id)?.(m);waiting.delete(m.id);}};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{const n=++id;waiting.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
try {
  await send('Page.navigate',{url:process.env.TEST_URL || 'http://127.0.0.1:4319/index.html?view=mobile'});
  await new Promise(r=>setTimeout(r,700));
  const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,userGesture:true,expression:`(async()=>{
    const editor=document.getElementById('editor');document.querySelector('[data-clear-guidance-sample]')?.click();
    const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);
    const bytes=Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'two-images.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
    editor.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
    for(let i=0;i<200&&WeChatWorkbench.mediaDiagnostics().pendingImports;i++)await new Promise(r=>setTimeout(r,30));
    const order=[...editor.children].map(n=>n.querySelector('img')?'IMAGE':n.textContent.trim());
    let html='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{html=await(await items[0].getType('text/html')).text();}}});
    document.getElementById('copy-rich').click();await new Promise(r=>setTimeout(r,350));
    const doc=new DOMParser().parseFromString(html,'text/html');const hashes=[];
    for(const image of doc.querySelectorAll('img'))hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await(await fetch(image.src)).blob()).arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join(''));
    return{order,hashes,message:document.getElementById('media-status').textContent,stats:WeChatWorkbench.mediaDiagnostics()};
  })()`});
  if(result.result.exceptionDetails)throw Error(result.result.exceptionDetails.exception?.description);
  const value=result.result.result.value;
  assert.deepEqual(value.order,['DOCX 前段。','IMAGE','DOCX 中段。','IMAGE','DOCX 后段。']);
  assert.deepEqual(value.hashes,manifest.hashes);
  console.log(JSON.stringify(value,null,2));
}finally{ws.close();fs.unlinkSync(fixture);fs.rmdirSync(folder);}
