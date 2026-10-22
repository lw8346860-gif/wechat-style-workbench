// Read-only public-resource smoke test in a disposable CDP tab. No platform login/OS clipboard.
import assert from 'node:assert/strict';
const pageUrl = process.env.TEST_URL || 'https://mp.togma.online/index.html?view=mobile';
const sourceUrl = process.env.SOURCE_URL || 'https://www.gnu.org/gnu/gnu.html';
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } };
await new Promise(resolve => ws.onopen = resolve);
const send = (method, params = {}) => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
try {
  if (new URL(pageUrl).searchParams.get('view') === 'mobile') await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: pageUrl });
  for (let i = 0; i < 100; i++) {
    const check = await send('Runtime.evaluate', { expression: "typeof WeChatWorkbench !== 'undefined'", returnByValue: true });
    if (check.result?.result?.value) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const result = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, userGesture: true, expression: `(async()=>{
    const editor=document.getElementById('editor');document.querySelector('[data-clear-guidance-sample]')?.click();
    const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);
    const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(sourceUrl)});
    editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    for(let i=0;i<1500&&WeChatWorkbench.mediaDiagnostics().pendingImports;i++)await new Promise(r=>setTimeout(r,40));
    let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{copied=await(await items[0].getType('text/html')).text();}}});
    document.getElementById('copy-rich').click();
    for(let i=0;i<300&&document.getElementById('copy-rich').disabled;i++)await new Promise(r=>setTimeout(r,40));
    const doc=new DOMParser().parseFromString(copied,'text/html');
    return {blocks:editor.children.length,images:editor.querySelectorAll('img').length,missing:editor.querySelectorAll('[data-image-missing]').length,embedded:doc.images.length,allEmbedded:[...doc.images].every(image=>image.src.startsWith('data:image/')),clean:!copied.includes('blob:')&&!/data-image-|data-format-|data-wechat-/i.test(copied),stats:WeChatWorkbench.mediaDiagnostics(),message:document.getElementById('media-status').textContent};
  })()` });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
  const value = result.result.result.value;
  assert.ok(value.blocks > 2, JSON.stringify(value));
  assert.ok(value.images > 0, JSON.stringify(value));
  assert.equal(value.missing, 0, JSON.stringify(value));
  assert.equal(value.embedded, value.images);
  assert.equal(value.allEmbedded, true);
  assert.equal(value.clean, true);
  console.log(JSON.stringify({ pageUrl, sourceUrl, ...value }, null, 2));
} finally { ws.close(); }
