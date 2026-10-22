// Requires a disposable Chrome CDP on 9333 and the static site on 4319.
// Fixture helper uses dependency injection; production network restrictions remain active.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLinkHelper } from '../wechat-style-prototype/wechat-link-helper.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" fill="blue"/></svg>');
const largePng = Buffer.concat([png, Buffer.alloc(220000)]);
const images = new Map([['/images/one.png', largePng], ['/images/large.svg', svg], ['/images/animation.gif', gif], ['/images/retry.png', largePng]]);
const hashes = [largePng, svg, gif].map(value => createHash('sha256').update(value).digest('hex'));
let failRetry = true;
const requests = [];
const article = '<html><head><meta property="og:title" content="完整图文测试"></head><body><nav>不要导入导航</nav><article id="js_content"><h1>完整图文测试</h1><p>第一个自然段。</p><p><img src="data:image/gif;base64,' + gif.toString('base64') + '" data-src="/images/one.png"></p><p>第二个自然段。</p><picture><source srcset="/images/one.png 100w, /images/large.svg 1200w"><img src="/images/one.png"></picture><p>第三个自然段。</p><img data-original="//media.fixture.test/images/animation.gif">' + '<img class="rich_pages wxw-img" style="height:auto!important">'.repeat(22) + '<script>window.unsafe=true</script></article><footer>不要导入页脚</footer></body></html>';
const helper = createLinkHelper({ fetchResource: async (url, options) => {
  requests.push({ url, options });
  const pathname = new URL(url).pathname;
  if (pathname === '/article') return { bytes: Buffer.from(article), contentType: 'text/html; charset=utf-8', sourceUrl: url };
  if (pathname === '/images/retry.png' && failRetry) throw new Error('临时读取失败，请重试');
  if (pathname === '/images/animation.gif') await new Promise(resolve => setTimeout(resolve, 750));
  const bytes = images.get(pathname);
  if (!bytes) throw new Error('图片不存在');
  return { bytes, contentType: 'application/octet-stream', sourceUrl: url };
} });
await new Promise(resolve => helper.listen(0, '127.0.0.1', resolve));
const helperBase = `http://127.0.0.1:${helper.address().port}`;
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); } };
await new Promise(resolve => ws.onopen = resolve);
const send = (method, params = {}) => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
  return result.result.result.value;
}
try {
  await send('Page.navigate', { url: process.env.TEST_URL || 'http://127.0.0.1:4319/index.html?view=desktop' });
  await new Promise(resolve => setTimeout(resolve, 800));
  const imported = await evaluate(`(async () => {
    window.WORKBENCH_HELPER_URL = ${JSON.stringify(helperBase)};
    const editor = document.getElementById('editor'); document.querySelector('[data-clear-guidance-sample]')?.click();
    window.fixturePaste = async (html, text = '') => {
      const range = document.createRange(); range.selectNodeContents(editor); getSelection().removeAllRanges(); getSelection().addRange(range);
      const data = new DataTransfer(); if(html)data.setData('text/html',html); if(text)data.setData('text/plain',text);
      editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
      for(let i=0;i<400 && WeChatWorkbench.mediaDiagnostics().pendingImports;i++)await new Promise(r=>setTimeout(r,30));
      if(WeChatWorkbench.mediaDiagnostics().pendingImports)throw Error('import timeout');
    };
    window.fixtureCopy = async () => {
      window.fixtureHtml = '';
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{window.fixtureHtml=await(await items[0].getType('text/html')).text();}}});
      document.getElementById('copy-rich').click();
      for(let i=0;i<400 && document.getElementById('copy-rich').disabled;i++)await new Promise(r=>setTimeout(r,30));
      const doc = new DOMParser().parseFromString(window.fixtureHtml,'text/html');
      const hashes=[];
      for(const image of doc.querySelectorAll('img'))hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(image.src)).arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join(''));
      return { hashes, clean: !/blob:|data-image-|data-wechat-|data-format-|contenteditable|<script/i.test(window.fixtureHtml), embedded: [...doc.images].every(image=>image.src.startsWith('data:image/')), message: document.getElementById('media-status').textContent };
    };
    await fixturePaste('', 'https://news.fixture.test/article');
    return { order:[...editor.children].map(node=>node.querySelector('img')?'IMAGE':node.textContent.trim()), images:editor.querySelectorAll('img[data-image-id]').length, missing:!!editor.querySelector('[data-image-missing]'), previewsReady:[...editor.querySelectorAll('img')].every(image=>image.src.startsWith('blob:')), stats:WeChatWorkbench.mediaDiagnostics(), html:editor.innerHTML, copy:await fixtureCopy() };
  })()`);
  assert.deepEqual(imported.order, ['完整图文测试','第一个自然段。','IMAGE','第二个自然段。','IMAGE','第三个自然段。','IMAGE']);
  assert.equal(imported.images, 3);
  assert.equal(imported.missing, false);
  assert.equal(imported.previewsReady, true);
  assert.ok(!/不要导入|<script|data:image/.test(imported.html));
  assert.deepEqual(imported.copy.hashes, hashes);
  assert.equal(imported.copy.clean, true);
  assert.equal(imported.copy.embedded, true);
  assert.equal(requests.filter(item => item.url.endsWith('/images/one.png')).length, 1);

  // Real Chrome copying WeChat linked cards keeps a[imgurl] but excludes their
  // user-select:none img children. The clipboard also keeps empty wxw-img ghosts.
  const directPaste = await evaluate(`(async()=>{
    const base='https://native.fixture.test';
    const cards=['/images/large.svg','/images/one.png','/images/large.svg','/images/one.png'].map(path=>'<section><a linktype="image" imgurl="'+base+path+'" href="https://mp.weixin.qq.com/s/linked"><span class="h5_image_link" style="user-select:none"></span></a></section>').join('');
    const ghosts='<img class="rich_pages wxw-img" style="height:auto!important">'.repeat(22);
    await fixturePaste('<p>原生粘贴正文。</p><p><img class="wxw-img" data-src="'+base+'/images/one.png"></p>'+cards+'<p><img class="wxw-img wx_img_placeholder" data-src="'+base+'/images/animation.gif" src="data:image/svg+xml,%3Csvg%20width=%221%22%20height=%221%22%20fill-opacity=%220%22%3E%3C/svg%3E"></p>'+ghosts+'<p><img class="wxw-img" src="'+base+'/images/large.svg"></p><p>结尾正文。</p>');
    const editor=document.getElementById('editor');
    const before={images:editor.querySelectorAll('img').length,missing:editor.querySelectorAll('[data-image-missing]').length};
    const wordSlot=WorkbenchMedia.sanitizeArticle('<p><img src="file:///missing-word.png"></p>').querySelectorAll('img').length;
    const identified=WorkbenchMedia.sanitizeArticle('<p><img class="wxw-img" data-imgfileid="needed-original"></p>').querySelectorAll('img').length;
    return {...before,wordSlot,identified,copy:await fixtureCopy()};
  })()`);
  assert.equal(directPaste.images,7);
  assert.equal(directPaste.missing,0);
  assert.equal(directPaste.wordSlot,1);
  assert.equal(directPaste.identified,1);
  assert.deepEqual(directPaste.copy.hashes,[hashes[0],hashes[1],hashes[0],hashes[1],hashes[0],hashes[2],hashes[1]]);
  assert.equal(directPaste.copy.clean,true);

  const failed = await evaluate(`(async()=>{
    await fixturePaste('<p>独立网页粘贴。</p><p><img data-src="https://other.fixture.test/images/retry.png" src="data:image/gif;base64,${gif.toString('base64')}"></p><p>结尾。</p>');
    const editor=document.getElementById('editor');const copy=await fixtureCopy();
    return { missing:editor.querySelectorAll('[data-image-missing]').length,retry:!document.getElementById('retry-images').hidden,blocked:!window.fixtureHtml,order:[...editor.children].map(node=>node.querySelector('img')?'IMAGE':node.textContent.trim()),message:copy.message };
  })()`);
  assert.equal(failed.missing, 1);
  assert.equal(failed.retry, true);
  assert.equal(failed.blocked, true);
  assert.deepEqual(failed.order, ['独立网页粘贴。','IMAGE','结尾。']);
  assert.match(failed.message, /未收齐/);
  failRetry = false;
  const recovered = await evaluate(`(async()=>{
    document.getElementById('retry-images').click();
    for(let i=0;i<200&&WeChatWorkbench.mediaDiagnostics().pendingImports;i++)await new Promise(r=>setTimeout(r,30));
    return {missing:document.getElementById('editor').querySelectorAll('[data-image-missing]').length,copy:await fixtureCopy()};
  })()`);
  assert.equal(recovered.missing, 0);
  assert.deepEqual(recovered.copy.hashes, [hashes[0]]);
  assert.equal(recovered.copy.clean, true);
  console.log(JSON.stringify({ linkImport: { order: imported.order, images: imported.images, originalBytes: imported.stats.originalBytes }, clipboard: imported.copy, directPaste, missingImageProtection: failed, retryRecovered: recovered.missing === 0 }, null, 2));
} finally { ws.close(); await new Promise(resolve => helper.close(resolve)); }
