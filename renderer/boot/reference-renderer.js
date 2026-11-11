/*
 * DOM companion to the retained Canvas renderer. Continuous-stage and persistent
 * anchor structure adapted from https://github.com/Iris-change/eva-codex-workbench
 * at 9733eb192e8ef97d3e7469ede544cad2a6186519: intro.html, intro.js,
 * unified-sequence.js and stage-layout.js. MIT code scope only; no upstream
 * NERV marks, characters or voice/audio are copied or embedded here.
 */
(function exposeReferenceRenderer(root, factory) {
  const layout = typeof module === 'object' && module.exports
    ? require('./reference-layout.js') : root?.ProjectZeroReferenceLayout;
  const api = factory(layout);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroReferenceRenderer = api;
})(typeof globalThis === 'object' ? globalThis : this, function createReferenceRendererModule(layout) {
  'use strict';
  if (!layout?.referenceFrame) throw new Error('REFERENCE_LAYOUT_UNAVAILABLE');
  const {REFERENCE_LAYOUT, referenceFrame, isReferenceFrame} = layout;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATHS = Object.freeze({
    core: 'M0 -14 12 -7V7L0 14 -12 7V-7ZM0 -6 5 -3V3L0 6 -5 3V-3Z',
    link: 'M-3 -10H-10L-15 -5V5L-10 10H-3M3 -10H10L15 -5V5L10 10H3M-7 0H7',
    data: 'M-13 -12H13V12H-13ZM-8 -6H8M-8 0H8M-8 6H4',
    shield: 'M0 -15 13 -9V2L7 11 0 16 -7 11 -13 2V-9ZM-6 0 -1 5 8 -5',
    render: 'M-15 -11H15V9H-15ZM-7 15H7M0 9V15M-8 -5H8M-8 1H4',
    pilot: 'M-6 -6V-12L0 -16 6 -12V-6L0 -2ZM-13 15V7L-7 2H7L13 7V15Z'
  });

  function createReferenceRenderer(root, options = {}) {
    if (!root?.ownerDocument || !root.classList.contains('reference-sequence')) {
      throw new TypeError('REFERENCE_ROOT_REQUIRED');
    }
    const document = root.ownerDocument;
    const window = document.defaultView;
    const recordEnabled = options.exposeRenderRecord === true;
    let destroyed = false;
    let renderCount = 0;
    let rendered = false;
    let markSource = null;

    function element(tag, className, text, parent) {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      parent?.append(node);
      return node;
    }
    function svgElement(tag, attributes, parent) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
      parent?.append(node);
      return node;
    }
    function slot(className, tag = 'div') {
      const existing = root.querySelector(`.${className}`);
      const node = existing || element(tag, className, undefined, root);
      node.replaceChildren();
      return node;
    }
    function css(name, value) {
      const property = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      root.style.setProperty(`--reference-${property}`, String(value));
    }
    for (const [name, value] of Object.entries(REFERENCE_LAYOUT.palette)) css(name, value);
    css('title-font', REFERENCE_LAYOUT.typography.title);
    css('code-font', REFERENCE_LAYOUT.typography.code);
    const geometry = REFERENCE_LAYOUT.geometry;
    css('center-x', `${geometry.center.x}px`);
    css('center-y', `${geometry.center.y}px`);
    css('title-y', `${geometry.titleY}px`);
    css('node-diameter', `${geometry.nodes.radius * 2}px`);
    css('border-inset', `${geometry.border.inset}px`);
    css('border-width', `${geometry.border.width}px`);
    css('corner-size', `${geometry.border.corner}px`);
    css('grid-step', `${geometry.grid.step}px`);
    const header = slot('reference-header', 'header');
    const grid = slot('reference-grid');
    const left = slot('reference-node-column--left');
    left.classList.add('reference-node-column');
    const right = slot('reference-node-column--right');
    right.classList.add('reference-node-column');
    const center = slot('reference-center');
    const scan = slot('reference-scan-field');
    const footer = slot('reference-footer', 'footer');
    const flash = slot('reference-flash');
    flash.hidden = true;
    const slots = [header, grid, left, right, center, scan, footer, flash];
    const unit = element('strong', 'reference-unit', REFERENCE_LAYOUT.header.unit, header);
    const pilot = element('span', 'reference-pilot', REFERENCE_LAYOUT.header.pilot, header);
    element('span', 'reference-header-code', REFERENCE_LAYOUT.header.code, header);
    for (const corner of ['tl', 'tr', 'bl', 'br']) element('i', `reference-corner reference-corner--${corner}`, undefined, grid);
    const nodes = Array.from({length: 12}, (_, index) => {
      const parent = index % 2 ? right : left;
      const node = element('div', 'reference-node', undefined, parent);
      const svg = svgElement('svg', {viewBox: '-48 -48 96 96', 'aria-hidden': 'true'}, node);
      svgElement('polygon', {class: 'reference-node-hex', points: '0,-48 41.57,-24 41.57,24 0,48 -41.57,24 -41.57,-24'}, svg);
      const icon = svgElement('path', {class: 'reference-node-icon', d: ICON_PATHS[REFERENCE_LAYOUT.nodeIcons[Math.floor(index / 2)]]}, svg);
      const label = element('span', 'reference-node-label', '', node);
      return {node, icon, label};
    });
    const heading = element('h1', 'reference-heading', '', center);
    const subtitle = element('p', 'reference-subtitle', '', center);
    const hub = element('div', 'reference-hub', undefined, center);
    const mark = element('div', 'reference-mark', undefined, hub);
    const fallback = element('div', 'reference-fallback-mark', undefined, mark);
    element('strong', '', 'PROJECT ZERO', fallback);
    element('span', '', 'SYSTEM 00', fallback);
    const rings = svgElement('svg', {class: 'reference-rings', viewBox: '-280 -280 560 560', 'aria-hidden': 'true'}, hub);
    for (const radius of geometry.rings) svgElement('circle', {
      class: 'reference-ring-guide', cx: 0, cy: 0, r: radius
    }, rings);
    const progressRing = svgElement('circle', {class: 'reference-ring-progress', cx: 0, cy: 0,
      r: geometry.rings[0], pathLength: 360, transform: 'rotate(-90)', 'stroke-dasharray': '0 360'}, rings);
    const metric = element('output', 'reference-metric', '', hub);
    const complete = element('div', 'reference-completion', 'EVANGELION-00', hub);
    const cue = element('div', 'reference-cue', undefined, center);
    const cueJa = element('p', 'reference-cue-ja', '', cue);
    const cueZh = element('p', 'reference-cue-zh', '', cue);
    element('span', 'reference-footer-left', REFERENCE_LAYOUT.footer.left, footer);
    element('span', 'reference-footer-right', REFERENCE_LAYOUT.footer.right, footer);
    const ticks = element('div', 'reference-ticks', undefined, footer);
    for (let index = 0; index < 33; index += 1) element('i', '', undefined, ticks);

    function validPrivateMark(image) {
      if (typeof window?.HTMLImageElement !== 'function' || !(image instanceof window.HTMLImageElement)
        || image.complete !== true || image.naturalWidth <= 0 || image.naturalHeight <= 0) return false;
      try {
        const url = new window.URL(image.currentSrc || image.src, document.baseURI);
        return url.origin === window.location.origin && url.pathname === '/private/boot-mark.webp'
          && !url.search && !url.hash;
      } catch { return false; }
    }

    function setMark(assets) {
      const image = validPrivateMark(assets?.mark) ? assets.mark : null;
      if (image === markSource) return;
      markSource = image;
      mark.querySelector('img')?.remove();
      fallback.hidden = Boolean(image);
      if (image) {
        // Only the already-decoded, fixed private endpoint is referenced. No
        // caller-supplied URL, event handler or cloned markup enters the DOM.
        const privateImage = document.createElement('img');
        privateImage.src = '/private/boot-mark.webp';
        privateImage.alt = '';
        privateImage.decoding = 'sync';
        mark.append(privateImage);
      }
    }

    function render(snapshot, assets = {}) {
      if (destroyed) return;
      const frame = isReferenceFrame(snapshot) ? snapshot : referenceFrame(snapshot);
      root.dataset.stage = frame.stage;
      root.dataset.motion = frame.reducedMotion ? 'reduced' : 'full';
      root.dataset.centerMode = frame.center.mode;
      heading.textContent = frame.center.title;
      subtitle.textContent = frame.center.subtitle;
      metric.textContent = frame.center.metric;
      metric.hidden = frame.center.mode !== 'sync';
      rings.hidden = frame.center.mode !== 'sync';
      rings.style.display = rings.hidden ? 'none' : '';
      mark.hidden = frame.center.mode !== 'mark';
      complete.hidden = frame.center.mode !== 'complete';
      progressRing.setAttribute('stroke-dasharray', `${frame.center.ringDegrees} 360`);
      scan.hidden = !frame.scan.visible;
      scan.style.height = `${frame.scan.height}px`;
      flash.hidden = !frame.flash.visible;
      cueJa.textContent = frame.cue.ja;
      cueZh.textContent = frame.cue.zh;
      cue.hidden = !frame.cue.ja && !frame.cue.zh;
      frame.nodes.forEach((state, index) => {
        const {node, icon, label} = nodes[index];
        node.hidden = !state.visible;
        node.classList.toggle('is-active', state.active);
        node.style.left = `${state.x}px`;
        node.style.top = `${state.y}px`;
        icon.dataset.icon = state.icon;
        label.textContent = state.label;
      });
      setMark(assets);
      renderCount += 1;
      rendered = true;
    }

    function resize(viewport) {
      if (destroyed) return;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      css('scale', Math.min(width / REFERENCE_LAYOUT.logicalSize.width, height / REFERENCE_LAYOUT.logicalSize.height));
    }

    function visible(node) {
      if (!node.isConnected) return false;
      let current = node;
      while (current && current !== document.documentElement) {
        const style = window.getComputedStyle(current);
        if (current.hidden || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        current = current.parentElement;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function lastRenderRecord() {
      if (!recordEnabled || destroyed || !rendered) return null;
      const visibleNodes = nodes.filter(({node}) => visible(node));
      const activeNodeCount = visibleNodes.filter(({node}) => node.classList.contains('is-active')).length;
      const metricText = visible(metric) ? metric.textContent : '';
      const scanVisible = visible(scan);
      const ringVisible = visible(rings);
      const styles = window.getComputedStyle(root);
      const privateImage = mark.querySelector('img');
      const record = {
        renderCount, stage: root.dataset.stage, headingText: visible(heading) ? heading.textContent : '',
        header: Object.freeze({unit: visible(unit) ? unit.textContent : '', pilot: visible(pilot) ? pilot.textContent : ''}),
        visibleNodeCount: visibleNodes.length, activeNodeCount, activeNodes: activeNodeCount,
        nodeLabels: Object.freeze(visibleNodes.map(({label}) => label.textContent)),
        iconStates: Object.freeze(visibleNodes.map(({node, icon}) => `${icon.dataset.icon}:${node.classList.contains('is-active') ? 'active' : 'idle'}`)),
        metricText, progress: metricText ? Number.parseFloat(metricText) : null, progressDrawn: Boolean(metricText),
        scanVisible, scanHeight: scanVisible ? Number.parseFloat(window.getComputedStyle(scan).height) : 0,
        ringDegrees: ringVisible ? Number.parseFloat(window.getComputedStyle(progressRing).strokeDasharray) : 0,
        flashVisible: visible(flash), cue: Object.freeze({ja: visible(cueJa) ? cueJa.textContent : '', zh: visible(cueZh) ? cueZh.textContent : ''}),
        mark: !visible(mark) ? 'not-drawn' : privateImage && visible(privateImage)
          && privateImage.complete && privateImage.naturalWidth > 0 ? 'private' : visible(fallback) ? 'fallback' : 'not-drawn',
        reducedMotion: root.dataset.motion === 'reduced',
        computed: Object.freeze({backgroundColor: styles.backgroundColor, titleFontFamily: window.getComputedStyle(heading).fontFamily})
      };
      return Object.freeze(record);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      slots.forEach(node => node.replaceChildren());
      markSource = null;
    }
    resize();
    return Object.freeze({render, resize, lastRenderRecord, destroy});
  }
  return Object.freeze({createReferenceRenderer});
});
