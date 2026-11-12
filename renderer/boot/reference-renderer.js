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
    css('title-y', `${geometry.headingY}px`);
    css('node-width', `${geometry.nodes.width}px`);
    css('node-height', `${geometry.nodes.height}px`);
    for (const [name, value] of Object.entries(REFERENCE_LAYOUT.typography)) {
      if (typeof value === 'number') css(name, `${value}px`);
    }
    css('border-inset', `${geometry.border.inset}px`);
    css('border-width', `${geometry.border.width}px`);

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
    const headerMark = element('div', 'reference-header-mark', '', header);
    const unit = element('strong', 'reference-unit', REFERENCE_LAYOUT.header.unit, header);
    const pilot = element('span', 'reference-pilot', REFERENCE_LAYOUT.header.pilot, header);
    element('span', 'reference-header-code', REFERENCE_LAYOUT.header.code, header);

    const nodes = Array.from({length: 12}, (_, index) => {
      const parent = index % 2 ? right : left;
      const node = element('div', 'reference-node', undefined, parent);
      const svg = svgElement('svg', {viewBox: '-104 -72 208 144', 'aria-hidden': 'true'}, node);
      svgElement('polygon', {class: 'reference-node-hex', points: '-60,-68 60,-68 102,0 60,68 -60,68 -102,0'}, svg);
      const label = element('span', 'reference-node-label', '', node);
      node.dataset.side = index % 2 ? 'right' : 'left';
      node.dataset.row = Math.floor(index / 2);
      return {node, label};
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
    element('small', 'reference-metric-caption', '同步率', metric);
    const complete = element('div', 'reference-completion', 'EVANGELION-00', center);
    element('span', 'reference-completion-code', 'CODEX / 本地链路已建立', complete);
    element('i', 'reference-completion-badge', '◎', complete);
    const liquidSvg = svgElement('svg', {class: 'reference-liquid-front', preserveAspectRatio: 'none', 'aria-hidden': 'true'}, scan);
    const liquidFront = svgElement('path', {fill: 'none'}, liquidSvg);
    const cue = slot('reference-cue');
    slots.push(cue);
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
      headerMark.replaceChildren();
      fallback.hidden = Boolean(image);
      if (image) {
        // Only the already-decoded, fixed private endpoint is referenced. No
        // caller-supplied URL, event handler or cloned markup enters the DOM.
        const privateImage = document.createElement('img');
        privateImage.src = '/private/boot-mark.webp';
        privateImage.alt = '';
        privateImage.decoding = 'sync';
        mark.append(privateImage);
        const mini = document.createElement('img');
        mini.src = '/private/boot-mark.webp';
        mini.alt = '';
        headerMark.append(mini);
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
      metric.replaceChildren(document.createTextNode(frame.center.metric));
      element('small', 'reference-metric-caption', '同步率', metric);
      hub.style.opacity = String(frame.center.opacity);
      heading.style.opacity = String(frame.center.opacity);
      subtitle.style.opacity = String(frame.center.opacity);
      metric.hidden = frame.center.mode !== 'sync';
      rings.hidden = frame.center.mode !== 'sync';
      rings.style.display = rings.hidden ? 'none' : '';
      mark.hidden = frame.center.mode !== 'mark';
      complete.hidden = frame.center.mode !== 'complete';
      progressRing.setAttribute('stroke-dasharray', `${frame.center.ringDegrees} 360`);
      scan.hidden = !frame.scan.visible;
      scan.style.height = `${frame.scan.height}px`;
      scan.style.opacity = String(frame.scan.opacity);
      const points = frame.scan.waveOffsets.map((offset, index) => [index * 60, offset]);
      scan.style.clipPath = `polygon(${points.map(([x, y]) => `${x}px ${Math.max(0, y + 7)}px`).join(',')},100% 100%,0 100%)`;
      liquidSvg.setAttribute('viewBox', `0 0 1920 ${Math.max(1, frame.scan.height)}`);
      liquidFront.setAttribute('d', points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${Math.max(0, y + 7)}`).join(' '));
      flash.hidden = !frame.flash.visible;
      cueJa.textContent = frame.cue.ja;
      cueZh.textContent = frame.cue.zh;
      cue.hidden = !frame.cue.ja && !frame.cue.zh;
      frame.nodes.forEach((state, index) => {
        const {node, label} = nodes[index];
        node.hidden = !state.visible;
        node.classList.toggle('is-active', state.active);
        node.style.left = `${state.x}px`;
        node.style.top = `${state.y}px`;
        node.style.opacity = String(state.opacity);
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
      const metricText = visible(metric) ? metric.firstChild.textContent : '';
      const scanVisible = visible(scan);
      const ringVisible = visible(rings);
      const styles = window.getComputedStyle(root);
      const privateImage = mark.querySelector('img');
      const record = {
        renderCount, stage: root.dataset.stage, headingText: visible(heading) ? heading.textContent : '',
        header: Object.freeze({unit: visible(unit) ? unit.textContent : '', pilot: visible(pilot) ? pilot.textContent : ''}),
        visibleNodeCount: visibleNodes.length, activeNodeCount, activeNodes: activeNodeCount,
        totalNodeCount: nodes.length,
        nodeLabels: Object.freeze(visibleNodes.map(({label}) => label.textContent)),
        nodes: Object.freeze(nodes.map(({node, label}) => Object.freeze({
          side: node.dataset.side, row: Number(node.dataset.row), visible: visible(node),
          opacity: Number(window.getComputedStyle(node).opacity),
          active: visible(node) && node.classList.contains('is-active'), label: label.textContent
        }))),
        nodeGeometry: Object.freeze(nodes.map(({node}) => {
          const style = window.getComputedStyle(node);
          return Object.freeze({x: Number.parseFloat(style.left), y: Number.parseFloat(style.top),
            width: Number.parseFloat(style.width), height: Number.parseFloat(style.height)});
        })),
        centerGeometry: Object.freeze({x: Number.parseFloat(window.getComputedStyle(hub).left),
          y: Number.parseFloat(window.getComputedStyle(hub).top),
          ringRadius: Number(rings.querySelector('.reference-ring-guide').getAttribute('r'))}),
        footer: Object.freeze({left: footer.querySelector('.reference-footer-left').textContent,
          right: footer.querySelector('.reference-footer-right').textContent}),
        iconStates: Object.freeze([]),
        metricText, progress: metricText ? Number.parseFloat(metricText) : null, progressDrawn: Boolean(metricText),
        scanVisible, scanHeight: scanVisible ? Number.parseFloat(window.getComputedStyle(scan).height) : 0,
        scanOpacity: scanVisible ? Number(window.getComputedStyle(scan).opacity) : 0,
        scanWavePath: scanVisible ? liquidFront.getAttribute('d') : '',
        ringDegrees: ringVisible ? Number.parseFloat(window.getComputedStyle(progressRing).strokeDasharray) : 0,
        flashVisible: visible(flash), cue: Object.freeze({ja: visible(cueJa) ? cueJa.textContent : '', zh: visible(cueZh) ? cueZh.textContent : ''}),
        mark: !visible(mark) ? 'not-drawn' : privateImage && visible(privateImage)
          && privateImage.complete && privateImage.naturalWidth > 0 ? 'private' : visible(fallback) ? 'fallback' : 'not-drawn',
        reducedMotion: root.dataset.motion === 'reduced',
        computed: Object.freeze({backgroundColor: styles.backgroundColor, titleFontFamily: window.getComputedStyle(heading).fontFamily,
          headingSize: window.getComputedStyle(heading).fontSize, headingSpacing: window.getComputedStyle(heading).letterSpacing,
          metricSize: window.getComputedStyle(metric).fontSize, metricSpacing: window.getComputedStyle(metric).letterSpacing,
          nodeSize: window.getComputedStyle(nodes[0].label).fontSize, nodeSpacing: window.getComputedStyle(nodes[0].label).letterSpacing,
          borderWidth: window.getComputedStyle(grid).borderLeftWidth,
          nodeFill: window.getComputedStyle(nodes[0].node.querySelector('polygon')).fill}),
        centerMode: root.dataset.centerMode, completionText: visible(complete) ? complete.firstChild.textContent : '',
        subtitleText: visible(subtitle) ? subtitle.textContent : ''
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
