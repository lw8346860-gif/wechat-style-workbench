// Real browser Clipboard API + trusted paste. No clipboard API mocks.
// On macOS, run through preserve-clipboard-macos.swift to preserve native clipboard contents.
import assert from 'node:assert/strict';
const marker = process.env.CLIPBOARD_TEST_MARKER;
if (!marker) throw new Error('Run with the clipboard-preserving wrapper and a unique test marker');
const pageUrl = process.env.TEST_URL || 'https://mp.togma.online/index.html?view=desktop';
const sourceUrl = process.env.SOURCE_URL || '';
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } };
await new Promise(resolve => ws.onopen = resolve);
const send = (method, params = {}) => new Promise((resolve,reject) => { const id = ++sequence; pending.set(id, result => result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result)); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
  return result.result.result.value;
}
async function click(selector) {
  const rect = await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const rect=node.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
  await send('Input.dispatchMouseEvent', { type:'mousePressed', button:'left', clickCount:1, ...rect });
  await send('Input.dispatchMouseEvent', { type:'mouseReleased', button:'left', clickCount:1, ...rect });
}
async function key(key, code, command) {
  await send('Input.dispatchKeyEvent', { type:'rawKeyDown', key, code, modifiers:4, commands:command ? [command] : undefined });
  await send('Input.dispatchKeyEvent', { type:'keyUp', key, code, modifiers:4 });
}
try {
  await send('Browser.grantPermissions', { origin:new URL(pageUrl).origin, permissions:['clipboardReadWrite','clipboardSanitizedWrite'] });
  await send('Page.navigate', { url:pageUrl });
  await send('Page.bringToFront');
  for(let i=0;i<100;i++) { if(await evaluate("typeof WeChatWorkbench !== 'undefined'")) break; await new Promise(resolve=>setTimeout(resolve,100)); }
  await evaluate(`(async()=>{
    window.clipboardProbeMarker=${JSON.stringify(marker)};
    const editor=document.getElementById('editor');document.querySelector('[data-clear-guidance-sample]')?.click();
    if (${JSON.stringify(sourceUrl)}) {
      const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);
      await WeChatWorkbench.importLink(${JSON.stringify(sourceUrl)});
      const label=document.createElement('p');label.textContent=clipboardProbeMarker;editor.prepend(label);
      editor.querySelectorAll('img').forEach((image,index)=>{image.alt=clipboardProbeMarker+'-'+index;});
    } else {
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=40;const context=canvas.getContext('2d');
    const images=['#1976d2','#e65100'].map(color=>{context.fillStyle=color;context.fillRect(0,0,96,40);return canvas.toDataURL('image/png');});
    const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);
    const data=new DataTransfer();data.setData('text/html','<p>'+clipboardProbeMarker+'</p><p>图片前正文。</p><p><img alt="'+clipboardProbeMarker+'-one" src="'+images[0]+'"></p><p>两张图片之间。</p><p><img alt="'+clipboardProbeMarker+'-two" src="'+images[1]+'"></p><p>图片后正文。</p>');
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    for(let i=0;i<200&&WeChatWorkbench.mediaDiagnostics().pendingImports;i++)await new Promise(resolve=>setTimeout(resolve,25));
    }
    window.probeExpectedImages=editor.querySelectorAll('img').length;
    document.getElementById('format-all').click();
    window.probeClipboard=async()=>{
      const items=await navigator.clipboard.read();let html='';const types=[];
      for(const item of items){types.push(...item.types);if(item.types.includes('text/html'))html=await(await item.getType('text/html')).text();}
      const doc=new DOMParser().parseFromString(html,'text/html');
      return{types,images:doc.images.length,embedded:[...doc.images].filter(image=>image.src.startsWith('data:image/')).length};
    };
    const receiver=document.createElement('div');receiver.id='clipboard-test-receiver';receiver.contentEditable='true';receiver.setAttribute('style','position:fixed;top:8px;left:8px;width:500px;min-height:160px;z-index:2147483647;background:white;color:black;border:1px solid gray;');
    receiver.addEventListener('paste',event=>{window.probePaste={trusted:event.isTrusted,types:[...event.clipboardData.types],files:[...event.clipboardData.files].map(file=>file.type)};});
    document.body.append(receiver);receiver.hidden=true;
  })()`);
  await click('#copy-rich');
  await evaluate("(async()=>{for(let i=0;i<200&&document.getElementById('copy-rich').disabled;i++)await new Promise(r=>setTimeout(r,25));})()");
  const full = await evaluate('probeClipboard()');
  await evaluate("document.getElementById('clipboard-test-receiver').hidden=false;document.getElementById('clipboard-test-receiver').focus();");
  await key('v','KeyV','paste');
  await new Promise(resolve=>setTimeout(resolve,250));
  const fullPaste = await evaluate("({event:window.probePaste,images:document.getElementById('clipboard-test-receiver').querySelectorAll('img').length})");
  const expected = await evaluate('probeExpectedImages');
  assert.ok(expected >= 2);
  assert.equal(full.images,expected);
  assert.equal(full.embedded,expected);
  assert.equal(fullPaste.images,expected);
  assert.equal(fullPaste.event.trusted,true);
  await evaluate("document.getElementById('clipboard-test-receiver').hidden=true;getSelection().removeAllRanges();document.getElementById('editor').focus();");
  await click('#editor img');
  await key('c','KeyC','copy');
  await new Promise(resolve=>setTimeout(resolve,350));
  const single = await evaluate('probeClipboard()');
  await evaluate("const receiver=document.getElementById('clipboard-test-receiver');receiver.replaceChildren();receiver.hidden=false;receiver.focus();");
  await key('v','KeyV','paste');
  await new Promise(resolve=>setTimeout(resolve,250));
  const singlePaste = await evaluate("({event:window.probePaste,images:document.getElementById('clipboard-test-receiver').querySelectorAll('img').length})");
  assert.ok(single.types.includes('image/png'));
  assert.equal(singlePaste.images,1);
  console.log(JSON.stringify({full,fullPaste,single,singlePaste},null,2));
} finally { ws.close(); }
