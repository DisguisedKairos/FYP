const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');

// Native CDP keeps browser verification independent from runtime dependencies.
class ChromePage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.errors = [];
    this.events = [];
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const operation = this.pending.get(message.id);
        if (!operation) return;
        this.pending.delete(message.id);
        clearTimeout(operation.timeout);
        if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
        else operation.resolve(message.result);
      } else {
        this.events.push(message);
        if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails);
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') this.errors.push(message.params.args);
        if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') this.errors.push(message.params.entry);
      }
    });
    socket.addEventListener('close', () => {
      for (const operation of this.pending.values()) {
        clearTimeout(operation.timeout);
        operation.reject(new Error(`Chrome connection closed during ${operation.method}`));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome command timed out: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }

  async waitFor(expression, message = expression, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await this.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 60));
    } while (Date.now() < deadline);
    throw new Error(`Browser wait timed out: ${message}\n${await this.evaluate('document.body.innerText.slice(0, 5000)')}`);
  }

  async navigate(url) {
    const firstEvent = this.events.length;
    const navigation = await this.send('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    if (navigation.loaderId) {
      const deadline = Date.now() + 15000;
      while (!this.events.slice(firstEvent).some(event =>
        event.method === 'Page.lifecycleEvent' &&
        event.params.loaderId === navigation.loaderId && event.params.name === 'load')) {
        if (Date.now() >= deadline) throw new Error(`Document did not finish navigating: ${url}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    // A previously loaded document can remain complete while a new navigation
    // is starting; wait for its specific loader before interacting with the DOM.
    await this.waitFor("document.readyState === 'complete'", 'committed document ready');
  }

  async click(selector) {
    const locate = `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || element.closest('[inert]')) return null;
      // Async page updates can replace the scrolled node. Reapply scrolling
      // while locating it, keeping the same visibility and hit-target checks.
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rect = element.getBoundingClientRect();
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      if (!rect.width || !rect.height || rect.x < 0 || rect.right > innerWidth + 1 || point.y < 0 || point.y > innerHeight) return null;
      const top = document.elementFromPoint(point.x, point.y);
      return top && (element === top || element.contains(top)) ? point : null;
    })()`;
    await this.waitFor(locate, `clickable ${selector}`);
    // Wait for layout and mobile navigation transitions to settle before a real
    // pointer click, as browser drivers do for element actionability.
    let point, previous, stable = 0;
    const deadline = Date.now() + 5000;
    while (stable < 2 && Date.now() < deadline) {
      point = await this.evaluate(locate);
      stable = point && JSON.stringify(point) === JSON.stringify(previous) ? stable + 1 : 0;
      previous = point;
      if (stable < 2) await new Promise(resolve => setTimeout(resolve, 70));
    }
    if (!point) throw new Error(`Element unavailable: ${selector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  }

  async fill(selector, value) {
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Input missing: ' + ${JSON.stringify(selector)});
      element.focus(); element.select();
    })()`);
    await this.send('Input.insertText', { text: String(value) });
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', {bubbles: true}))`);
  }

  async select(selector, value) {
    await this.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)});
      element.value = ${JSON.stringify(String(value))};
      element.dispatchEvent(new Event('input', {bubbles:true})); element.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  }

  async press(key) {
    const codes = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 };
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key] || 0 });
    }
  }

  async screenshot(path) {
    const image = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(image.data, 'base64'));
  }
}

async function launchChrome(t, { width = 1440, height = 1000, mobile = false, downloads } = {}) {
  const executable = process.env.CHROME_PATH || [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome',
  ].find(existsSync);
  if (!executable || !existsSync(executable)) throw new Error('Set CHROME_PATH to an installed Chromium browser.');
  const profile = mkdtempSync(join(tmpdir(), 'greenlink-chrome-'));
  const processHandle = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-gpu',
    // Windows' managed agent token cannot launch Chromium's nested GPU sandbox.
    // These observed local restrictions do not apply to the Linux CI browser.
    ...(process.platform === 'win32' ? ['--no-sandbox', '--disable-gpu-sandbox', '--in-process-gpu'] : []),
    `--window-size=${width},${height}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserOutput = '';
  processHandle.stderr.on('data', chunk => { browserOutput += chunk.toString(); });
  let page;
  t.after(async () => {
    if (page) await page.send('Browser.close').catch(() => {});
    if (processHandle.exitCode === null) processHandle.kill();
    page?.socket.close();
    for (let attempt = 0; attempt < 25; attempt++) {
      try { rmSync(profile, { recursive: true, force: true }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
  });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    // A cold hosted runner can take most of fifteen seconds just to start the
    // browser process. Keep startup bounded without changing page assertions.
    const timeout = setTimeout(() => reject(new Error(`Chrome did not start: ${output.slice(-1500)}`)), 30000);
    processHandle.once('error', error => { clearTimeout(timeout); reject(error); });
    processHandle.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chrome exited ${code}: ${output.slice(-1500)}`)); });
    processHandle.stderr.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const origin = endpoint.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.+$/, '');
  const tabs = await (await fetch(`${origin}/json/list`)).json();
  const target = tabs.find(tab => tab.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  page = new ChromePage(socket);
  try { await page.send('Page.enable'); }
  catch (error) { throw new Error(`${error.message}\nBrowser log: ${browserOutput.slice(-4000)}`); }
  await page.send('Page.setLifecycleEventsEnabled', { enabled: true });
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  if (downloads) {
    mkdirSync(downloads, { recursive: true });
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  }
  return page;
}

module.exports = { launchChrome };
