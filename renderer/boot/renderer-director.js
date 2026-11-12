(function exposeRendererDirector(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroRendererDirector = api;
})(typeof globalThis === 'object' ? globalThis : this, function createRendererDirectorModule() {
  'use strict';

  function createRendererDirector({reference, canvas, preferReference = false, referenceLayer, canvasLayer}) {
    let selected = preferReference && reference ? 'reference' : 'canvas';
    let referenceFailed = false;
    let destroyed = false;
    let snapshot;
    let assets;
    let viewport;

    referenceLayer?.setAttribute('aria-hidden', 'true');
    canvasLayer?.setAttribute('aria-hidden', 'true');

    function show(mode) {
      // A replacement frame must be complete before either visibility changes.
      if (mode === 'reference') {
        if (referenceLayer) referenceLayer.hidden = false;
        if (canvasLayer) canvasLayer.hidden = true;
      } else {
        if (canvasLayer) canvasLayer.hidden = false;
        if (referenceLayer) referenceLayer.hidden = true;
      }
      selected = mode;
    }

    function fallback() {
      if (destroyed) return;
      referenceFailed = true;
      if (!snapshot) return;
      if (viewport) canvas.resize?.(viewport);
      if (destroyed) return;
      canvas.render(snapshot, assets);
      if (!destroyed) show('canvas');
    }

    function render(nextSnapshot, nextAssets) {
      if (destroyed) return;
      snapshot = Object.freeze(nextSnapshot);
      assets = nextAssets;
      if (selected === 'reference' && !referenceFailed) {
        try {
          reference.render(snapshot, assets);
          if (!destroyed) show('reference');
        } catch {
          fallback();
        }
      } else if (referenceFailed && selected === 'reference') {
        fallback();
      } else {
        canvas.render(snapshot, assets);
        if (!destroyed) show('canvas');
      }
    }

    function resize(nextViewport) {
      if (destroyed) return;
      viewport = nextViewport;
      if (selected === 'reference') {
        if (referenceFailed) return fallback();
        try {
          reference.resize(viewport);
        } catch {
          fallback();
        }
      } else {
        canvas.resize?.(viewport);
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      // Set the guard first: even renderer cleanup that reenters cannot revive a layer.
      for (const renderer of [reference, canvas]) {
        try { renderer?.destroy?.(); } catch { /* Continue cleaning the other renderer. */ }
      }
      if (referenceLayer) referenceLayer.hidden = true;
      if (canvasLayer) canvasLayer.hidden = true;
      snapshot = undefined;
      assets = undefined;
    }

    return Object.freeze({
      render, resize, destroy,
      mode: () => selected,
      lastRenderRecord: () => destroyed ? null
        : (selected === 'reference' ? reference : canvas)?.lastRenderRecord?.() ?? null
    });
  }

  return Object.freeze({createRendererDirector});
});
