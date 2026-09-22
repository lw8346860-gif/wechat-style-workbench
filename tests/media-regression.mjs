// Start a local server on 4319 and a disposable headless Chrome with CDP on 9333.
// No user profile, clipboard, document, or cloud data is used.
import assert from 'node:assert/strict';
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } };
await new Promise(resolve => ws.onopen = resolve);
function send(method, params = {}) { return new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
  return result.result.result.value;
}
await send('Page.navigate', { url: process.env.TEST_URL || 'http://127.0.0.1:4319/index.html?view=desktop' });
await new Promise(resolve => setTimeout(resolve, 800));
try {
  const result = await evaluate(String.raw`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const ready = async () => { for(let i=0;i<200;i++){if(!WeChatWorkbench.mediaDiagnostics().pendingImports) return; await wait(30);} throw Error('import timed out'); };
    const editor = document.getElementById('editor');
    document.querySelector('[data-clear-guidance-sample]')?.click();
    const errors=[]; addEventListener('error', event=>errors.push(event.message));
    const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const canvas=document.createElement('canvas');canvas.width=1700;canvas.height=1500;
    const context=canvas.getContext('2d');const pixels=context.createImageData(1700,1500);
    for(let n=0;n<pixels.data.length;n+=65536) crypto.getRandomValues(pixels.data.subarray(n,Math.min(n+65536,pixels.data.length)));
    for(let n=3;n<pixels.data.length;n+=4)pixels.data[n]=255;
    context.putImageData(pixels,0,0);const original=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const hash=await digest(original);
    const url=await WorkbenchMedia.dataUrl(original);
    const paste = (html,text='',files=[],rtf='') => {const data=new DataTransfer();if(html)data.setData('text/html',html);if(text)data.setData('text/plain',text);if(rtf)data.setData('text/rtf',rtf);for(const file of files)data.items.add(file);const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});editor.dispatchEvent(event);return event.defaultPrevented;};
    const selectAll = () => {const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);};
    const pasteIntercepted=paste('<p>测试总标题</p><p>这是图片之前的自然段。</p><p><img src="'+url+'"></p><p>这是图片之后的自然段。</p>');
    await ready();await wait(900);
    const importStats=WeChatWorkbench.mediaDiagnostics();
    const order=[...editor.children].map(n=>n.querySelector('img')?'IMAGE':n.textContent.trim());
    const editorChars=editor.innerHTML.length;
    document.getElementById('format-all').click();await wait(500);
    let copiedHtml='';let copyCount=0;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{copyCount++;copiedHtml=await(await items[0].getType('text/html')).text();}}});
    document.getElementById('copy-rich').click();await wait(800);
    const exported=new DOMParser().parseFromString(copiedHtml,'text/html');
    const copiedHash=await digest(await(await fetch(exported.querySelector('img').src)).blob());
    const cleanExport=!copiedHtml.includes('data-image-id')&&!copiedHtml.includes('blob:');
    const image=editor.querySelector('img');image.parentElement.remove();editor.dispatchEvent(new InputEvent('input',{bubbles:true}));await wait(500);
    document.querySelector('[data-command="undo"]').click();await wait(100);
    const undoImage=!!editor.querySelector('img[data-image-id]');
    document.querySelector('[data-command="redo"]').click();await wait(100);
    const redoImageRemoved=!editor.querySelector('img');
    // Word file:// image placeholders + bitmap clipboard, same position.
    selectAll();paste('<p>开头正文。</p><p>图片前文字<img src="file:///C:/Temp/image001.png">图片后文字</p><p>结尾正文。</p>','开头正文。图片前文字图片后文字结尾正文。',[new File([original],'image001.png',{type:'image/png'})]);
    await ready();await wait(500);
    const wordOrder=[...editor.children].map(n=>n.querySelector('img')?'IMAGE':n.textContent.trim());
    selectAll();editor.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true}));await wait(700);
    const selectionDoc=new DOMParser().parseFromString(copiedHtml,'text/html');
    const selectionHash=await digest(await(await fetch(selectionDoc.querySelector('img').src)).blob());
    // Exercise the old-browser fallback without touching the operating-system clipboard.
    navigator.clipboard.write=async()=>{throw Error('clipboard denied');};
    const execCommand=document.execCommand;
    let fallbackHtml='';
    document.execCommand=command=>{if(command!=='copy')return false;const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));fallbackHtml=data.getData('text/html');return Boolean(fallbackHtml);};
    document.getElementById('copy-rich').click();await wait(700);document.execCommand=execCommand;
    const fallbackDoc=new DOMParser().parseFromString(fallbackHtml,'text/html');
    const fallbackHash=await digest(await(await fetch(fallbackDoc.querySelector('img').src)).blob());
    navigator.clipboard.write=async items=>{copyCount++;copiedHtml=await(await items[0].getType('text/html')).text();};
    // Recover a genuine PNG from an RTF pict at its HTML placeholder.
    canvas.width=20;canvas.height=20;canvas.getContext('2d').fillRect(0,0,20,20);
    const tinyBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const tinyHex=[...new Uint8Array(await tinyBlob.arrayBuffer())].map(n=>n.toString(16).padStart(2,'0')).join('');
    const rtf='{\\rtf1{\\pict\\pngblip '+tinyHex+'}{\\nonshppict{\\pict\\pngblip '+tinyHex+'}}}';
    selectAll();paste('<p>RTF 前。</p><p><img src="file:///rtf-image.png"></p><p>RTF 后。</p>','',[],rtf);await ready();
    const rtfImageRestored=editor.querySelectorAll('img[data-image-id]').length===1 && !editor.querySelector('[data-image-missing]');
    // Pasted scripts/events and CSS URL loads must not enter the live editor.
    selectAll();paste('<p onclick="window.pasteExecuted=true" style="background:url(https://invalid.example/a)">安全文本。</p><script>window.pasteExecuted=true</script>');await ready();
    const sanitized=!editor.querySelector('script,[onclick]')&&!editor.innerHTML.includes('invalid.example')&&!window.pasteExecuted;
    // Missing clipboard image must leave a visible marker, not claim successful copy.
    selectAll();paste('<p>缺图测试。</p><p><img src="file:///C:/Temp/missing.png"></p><p>结束。</p>');await ready();
    const missing=editor.querySelectorAll('img[data-image-missing]').length;
    document.getElementById('copy-rich').click();await wait(200);
    const missingWarning=document.getElementById('media-status').textContent;
    // Failed DOCX conversion cannot delete selected article.
    const beforeFailure=editor.textContent;selectAll();const bad=new DataTransfer();bad.items.add(new File(['broken'],'bad.docx'));document.getElementById('word-file').files=bad.files;document.getElementById('word-file').dispatchEvent(new Event('change'));await ready();
    const failurePreserved=editor.textContent===beforeFailure;
    // Parse Word RTF pict + skip its alternate bitmap rendering.
    const tiny='89504e470d0a1a0a';const picts=await WorkbenchMedia.rtfPictures('{\\rtf1{\\pict\\pngblip '+tiny+'}{\\nonshppict{\\pict\\pngblip '+tiny+'}}}');
    const rtfCount=picts.length;
    // Long text input remains cheap even while original images are retained for undo.
    selectAll();paste('',Array.from({length:1200},(_,i)=>'第'+i+'段 '+('长文输入测试内容。'.repeat(10))).join('\n'));await ready();await wait(2100);
    const start=performance.now();editor.dispatchEvent(new InputEvent('input',{bubbles:true}));const inputMs=performance.now()-start;
    return {pasteIntercepted,originalBytes:original.size,importStats,order,editorChars,hash,copiedHash,selectionHash,fallbackHash,rtfImageRestored,sanitized,cleanExport,undoImage,redoImageRemoved,wordOrder,missing,missingWarning,failurePreserved,rtfCount,inputMs,paragraphs:editor.children.length,errors};
  })()`);
  assert.equal(result.pasteIntercepted, true);
  assert.deepEqual(result.order, ['测试总标题','这是图片之前的自然段。','IMAGE','这是图片之后的自然段。']);
  assert.ok(result.originalBytes > 4_000_000);
  assert.ok(result.editorChars < 6000);
  assert.equal(result.importStats.originalBytes, result.originalBytes);
  assert.equal(result.hash, result.copiedHash);
  assert.equal(result.hash, result.selectionHash);
  assert.equal(result.hash, result.fallbackHash);
  assert.equal(result.rtfImageRestored, true);
  assert.equal(result.sanitized, true);
  assert.equal(result.cleanExport, true);
  assert.equal(result.undoImage, true);
  assert.equal(result.redoImageRemoved, true);
  assert.deepEqual(result.wordOrder, ['开头正文。','图片前文字','IMAGE','图片后文字','结尾正文。']);
  assert.equal(result.missing, 1);
  assert.match(result.missingWarning, /补图/);
  assert.equal(result.failurePreserved, true);
  assert.equal(result.rtfCount, 1);
  assert.equal(result.paragraphs,1200);
  assert.ok(result.inputMs < 150);
  assert.deepEqual(result.errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally { ws.close(); }
