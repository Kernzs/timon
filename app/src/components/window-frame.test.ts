/**
 * The top bar as the window's title bar, in a desktop window without the
 * system's: the buttons it draws, the room it keeps for them, its drag areas.
 * In a plain browser nothing of it exists.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';

Object.defineProperty(globalThis, 'React', { value: React, configurable: true, writable: true });

const DRAWN = { controls: 'drawn' as const, maximized: false, fullScreen: false, machineName: 'Office VPS', active: true };

test('the buttons are the system\'s three, labelled, and the middle one follows the window', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { WindowControls } = await import('./window-frame');
  const html = renderToStaticMarkup(React.createElement(WindowControls, { state: DRAWN }));
  assert.match(html, /role="group" aria-label="Window controls"/);
  const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['Minimize', 'Maximize', 'Close']);
  assert.match(html, /hover:bg-destructive/, 'close warns in the theme\'s own colour');
  const maximized = renderToStaticMarkup(React.createElement(WindowControls, { state: { ...DRAWN, maximized: true } }));
  assert.deepEqual([...maximized.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]).slice(1), ['Minimize', 'Restore down', 'Close']);
  const full = renderToStaticMarkup(React.createElement(WindowControls, { state: { ...DRAWN, fullScreen: true } }));
  assert.deepEqual([...full.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]), ['Exit full screen'], 'in full screen, only the way out');
});

async function withDom(t: test.TestContext, bridge: unknown) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  if (bridge) Object.defineProperty(dom.window, 'timonDesktop', { value: { restartAfterSetup: async () => {}, windowFrame: bridge }, configurable: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'MouseEvent', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === 'window' ? dom.window : key === 'IS_REACT_ACT_ENVIRONMENT' ? true : Reflect.get(dom.window, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const act = (fn: () => void) => React.act(async () => { fn(); });
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, d] of saved) { if (d) Object.defineProperty(globalThis, key, d); else Reflect.deleteProperty(globalThis, key); }
  });
  return { dom, root, act };
}

function fakeShell(state: Record<string, unknown>) {
  const acted: string[] = [];
  let listener: ((state: unknown) => void) | null = null;
  return {
    acted,
    announce: (next: Record<string, unknown>) => listener?.(next),
    bridge: {
      get: async () => state,
      act: async (action: string) => { acted.push(action); },
      onChange: (fn: (state: unknown) => void) => { listener = fn; return () => { listener = null; }; },
    },
  };
}

test('in a browser the page carries no frame, no strip and no button', async (t) => {
  const { dom, root, act } = await withDom(t, null);
  const { WindowFrame } = await import('./window-frame');
  await act(() => root.render(React.createElement(WindowFrame)));
  const html = dom.window.document.documentElement;
  assert.equal(html.hasAttribute('data-timon-frame'), false);
  assert.equal(html.hasAttribute('data-timon-drag'), false);
  assert.equal(dom.window.document.querySelector('.timon-window-strip'), null);
  assert.equal(dom.window.document.querySelector('button'), null);
});

test('a frameless window gets its drag strip first and its buttons last, and the buttons act on it', async (t) => {
  const shell = fakeShell({ frameless: true, ...DRAWN });
  const { dom, root, act } = await withDom(t, shell.bridge);
  const { WindowFrame } = await import('./window-frame');
  const doc = dom.window.document;
  doc.body.insertAdjacentHTML('beforeend', '<header class="timon-topbar-bar"><button>page control</button></header>');
  await act(() => root.render(React.createElement(WindowFrame)));
  await act(() => {});
  assert.equal(doc.documentElement.getAttribute('data-timon-frame'), 'drawn');
  assert.equal(doc.documentElement.hasAttribute('data-timon-drag'), true);
  const strip = doc.querySelector('.timon-window-strip')!;
  const controls = doc.querySelector('.timon-window-controls')!;
  assert.ok(strip && controls);
  assert.equal(controls.parentElement, doc.body, 'the buttons are portalled to <body>');
  assert.equal(doc.body.lastElementChild, controls, 'after every drag area of the page');
  assert.ok(strip.compareDocumentPosition(doc.querySelector('header')!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the strip precedes the page');
  const button = (label: string) => doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(() => button('Maximize').click());
  await act(() => button('Close').click());
  assert.deepEqual(shell.acted, ['toggle-maximize', 'close']);
  await act(() => shell.announce({ frameless: true, ...DRAWN, maximized: true }));
  assert.ok(button('Restore down'), 'maximized by the shell, whoever asked');
  await act(() => shell.announce({ frameless: true, ...DRAWN, fullScreen: true }));
  assert.equal(doc.documentElement.getAttribute('data-timon-frame'), 'drawn-full-screen');
  assert.ok(button('Exit full screen'));
});

test('a page the shell hides drops its drag areas, and takes them back on screen', async (t) => {
  const shell = fakeShell({ frameless: true, ...DRAWN });
  const { dom, root, act } = await withDom(t, shell.bridge);
  const { WindowFrame } = await import('./window-frame');
  const doc = dom.window.document;
  let state = 'visible';
  Object.defineProperty(doc, 'visibilityState', { get: () => state, configurable: true });
  await act(() => root.render(React.createElement(WindowFrame)));
  await act(() => {});
  assert.equal(doc.documentElement.hasAttribute('data-timon-drag'), true);
  await act(() => { state = 'hidden'; doc.dispatchEvent(new dom.window.Event('visibilitychange')); });
  assert.equal(doc.documentElement.hasAttribute('data-timon-drag'), false);
  assert.equal(doc.documentElement.getAttribute('data-timon-frame'), 'drawn', 'the room stays: no relayout when it comes back');
  await act(() => { state = 'visible'; doc.dispatchEvent(new dom.window.Event('visibilitychange')); });
  assert.equal(doc.documentElement.hasAttribute('data-timon-drag'), true);
  // The shell put another machine's page on screen over this one.
  await act(() => shell.announce({ frameless: true, ...DRAWN, active: false }));
  assert.equal(doc.documentElement.hasAttribute('data-timon-drag'), false, 'a page the shell put away drags nothing');
  await act(() => shell.announce({ frameless: true, ...DRAWN, active: true }));
  assert.equal(doc.documentElement.hasAttribute('data-timon-drag'), true);
});

test('macOS keeps its traffic lights: no button drawn, room kept at the left end', async (t) => {
  const shell = fakeShell({ frameless: true, ...DRAWN, controls: 'native' });
  const { dom, root, act } = await withDom(t, shell.bridge);
  const { WindowFrame } = await import('./window-frame');
  await act(() => root.render(React.createElement(WindowFrame)));
  await act(() => {});
  assert.equal(dom.window.document.documentElement.getAttribute('data-timon-frame'), 'native');
  assert.equal(dom.window.document.querySelector('button'), null);
});

test('the top bar keeps the room the stylesheet gives the frame, and drags the window', () => {
  const topbar = readFileSync(new URL('./topbar.tsx', import.meta.url), 'utf8');
  assert.match(topbar, /pr-\[calc\(0\.75rem\+var\(--timon-window-controls-w,0px\)\)\]/);
  assert.match(topbar, /pl-\[calc\(0\.75rem\+var\(--timon-window-lights-w,0px\)\)\]/);
  assert.match(topbar, /<WindowMachineName /);
  const css = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');
  // Zero outside a frameless desktop window: a browser's top bar is unchanged.
  assert.match(css, /:root \{\s*--timon-window-controls-w: 0px;\s*--timon-window-lights-w: 0px;/);
  assert.match(css, /html\[data-timon-frame='drawn'\] \{ --timon-window-controls-w: /);
  assert.match(css, /html\[data-timon-frame='native'\] \{ --timon-window-lights-w: /);
  assert.match(css, /html\[data-timon-drag\] :is\(\.timon-window-strip, \.timon-topbar-bar\) \{\s*-webkit-app-region: drag;/);
  const noDrag = /html\[data-timon-drag\] :is\(([^)]*(?:\([^)]*\)[^)]*)*)\) \{\s*-webkit-app-region: no-drag;/.exec(css)?.[1] ?? '';
  for (const control of ['button', 'a', 'input', '[role=\'menuitem\']', '.widget-frame', '.timon-window-controls']) {
    assert.ok(noDrag.includes(control), `${control} stays clickable inside the drag area`);
  }
});
