/**
 * Minimal DOM/canvas stub used to exercise the real assets/app.js wiring in
 * Node tests. It intentionally models only what the app touches.
 */
export function installDomStub(options = {}) {
  const elements = new Map();
  const listeners = [];
  let context = options.context ?? null;

  function makeElement(tag = 'DIV') {
    const element = {
      tagName: String(tag).toUpperCase(),
      id: '',
      type: '',
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      indeterminate: false,
      title: '',
      textContent: '',
      className: '',
      dataset: {},
      children: [],
      files: [],
      style: { setProperty() {}, background: '', cursor: '' },
      classList: { toggle() {}, add() {}, remove() {} },
      listeners: {},
      addEventListener(name, fn) {
        (this.listeners[name] ??= []).push(fn);
      },
      removeEventListener() {},
      append(...items) {
        this.children.push(...items);
      },
      replaceChildren(...items) {
        this.children = items;
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      getAttribute(name) {
        return this[name] ?? null;
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600 };
      },
      getContext() {
        if (!context) {
          context = new Proxy({ measureText: (text) => ({ width: String(text).length * 12 }) }, {
            get: (target, key) => (key in target ? target[key] : () => {}),
          });
        }
        return context;
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      focus() {},
      blur() {},
      click() {
        fire(this, 'click', {});
      },
      remove() {},
      contains() {
        return false;
      },
      get min() { return this._min ?? '0'; },
      set min(value) { this._min = value; },
      get max() { return this._max ?? '100'; },
      set max(value) { this._max = value; },
    };
    return element;
  }

  function fire(target, name, event = {}) {
    event.target ??= target;
    event.preventDefault ??= () => {};
    event.stopPropagation ??= () => {};
    const direct = target.listeners?.[name] ?? [];
    const registered = listeners
      .filter((entry) => entry.target === target && entry.name === name)
      .map((entry) => entry.fn);
    return [...direct, ...registered].map((fn) => fn(event));
  }

  const document = makeElement('DOCUMENT');
  document.body = makeElement('BODY');
  document.getElementById = (id) => {
    if (!elements.has(id)) {
      const element = makeElement(id === 'board' ? 'CANVAS' : 'DIV');
      element.id = id;
      elements.set(id, element);
    }
    return elements.get(id);
  };
  document.querySelector = () => makeElement();
  document.querySelectorAll = () => [];
  document.createElement = (tag) => makeElement(tag);
  document.addEventListener = (name, fn) => listeners.push({ target: document, name, fn });
  document.removeEventListener = () => {};

  const window = makeElement('WINDOW');
  window.devicePixelRatio = options.devicePixelRatio ?? 1;
  window.innerWidth = 1200;
  window.innerHeight = 900;
  window.addEventListener = (name, fn) => listeners.push({ target: window, name, fn });
  window.removeEventListener = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  globalThis.document = document;
  globalThis.window = window;
  globalThis.addEventListener = window.addEventListener;

  return {
    document,
    window,
    elements,
    listeners,
    makeElement,
    fire,
    get: (id) => document.getElementById(id),
    dispatch(target, name, event) {
      return fire(target, name, event);
    },
  };
}

export function memoryClipboard() {
  let text = '';
  return {
    get: () => text,
    set: (value) => { text = value; },
    api: {
      readText: async () => text,
      writeText: async (value) => { text = value; },
    },
  };
}
