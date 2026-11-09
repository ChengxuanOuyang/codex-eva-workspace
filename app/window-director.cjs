'use strict';

const FULLSCREEN_RESULT = Object.freeze({mode: 'fullscreen'});
const WINDOWED_RESULT = Object.freeze({mode: 'windowed'});
const FALLBACK_RESULT = Object.freeze({mode: 'fallback'});

function safeBounds(bounds) {
  const width = Number.isFinite(bounds?.width) && bounds.width > 0 ? bounds.width : 1500;
  const height = Number.isFinite(bounds?.height) && bounds.height > 0 ? bounds.height : 950;
  return Object.freeze({width, height});
}

class WindowDirector {
  constructor(window, {
    timeoutMs = 1500,
    normalBounds = {width: 1500, height: 950},
    platform = process.platform,
    setTimeout: scheduleTimeout = setTimeout,
    clearTimeout: cancelTimeout = clearTimeout
  } = {}) {
    this.window = window;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 1500;
    this.normalBounds = safeBounds(normalBounds);
    this.platform = platform;
    this.scheduleTimeout = scheduleTimeout;
    this.cancelTimeout = cancelTimeout;
    this.destroyed = false;
    this.showPromise = null;
    this.revealPromise = null;
    this.resolveReveal = null;
    this.revealSettled = false;
    this.revealFallback = false;
    this.revealStarting = false;
    this.waitObserved = false;
    this.simpleFullScreen = false;
    this.leaveFullScreenHandler = null;
    this.timeoutHandle = null;
  }

  windowState() {
    try {
      return {
        destroyed: typeof this.window?.isDestroyed === 'function' && this.window.isDestroyed(),
        failed: false
      };
    } catch {
      return {destroyed: false, failed: true};
    }
  }

  showBoot() {
    if (this.showPromise) return this.showPromise;

    let resolveShow;
    this.showPromise = new Promise(resolve => { resolveShow = resolve; });
    if (this.destroyed) {
      resolveShow(FALLBACK_RESULT);
      return this.showPromise;
    }

    const state = this.windowState();
    let fallback = state.failed;
    if (state.destroyed) {
      resolveShow(FALLBACK_RESULT);
      return this.showPromise;
    }

    const useSimpleFullScreen = !this.revealPromise && this.platform === 'darwin' &&
      typeof this.window?.setSimpleFullScreen === 'function';
    if (!this.revealPromise && !useSimpleFullScreen) {
      try {
        this.window.setFullScreen(true);
      } catch {
        fallback = true;
      }
    }

    try {
      this.window.show();
    } catch {
      fallback = true;
    }

    if (useSimpleFullScreen) {
      try {
        this.window.setSimpleFullScreen(true);
        this.simpleFullScreen = true;
      } catch {
        fallback = true;
      }
    }

    resolveShow(fallback
      ? FALLBACK_RESULT
      : this.revealPromise ? WINDOWED_RESULT : FULLSCREEN_RESULT);
    return this.showPromise;
  }

  revealWorkbench() {
    if (this.revealPromise) return this.revealPromise;

    this.revealPromise = new Promise(resolve => { this.resolveReveal = resolve; });
    if (this.destroyed) {
      this.settleReveal({fallback: true, restore: false});
      return this.revealPromise;
    }

    const state = this.windowState();
    this.revealFallback = state.failed;
    if (state.destroyed) {
      this.settleReveal({fallback: true, restore: false});
      return this.revealPromise;
    }

    if (this.simpleFullScreen) {
      try {
        this.window.setSimpleFullScreen(false);
      } catch {
        this.revealFallback = true;
      }
      this.simpleFullScreen = false;
      this.settleReveal({fallback: this.revealFallback});
      return this.revealPromise;
    }

    this.revealStarting = true;
    const completeWait = () => {
      if (this.revealStarting) {
        this.waitObserved = true;
        return;
      }
      this.settleReveal();
    };
    this.leaveFullScreenHandler = completeWait;
    try {
      this.window.once('leave-full-screen', this.leaveFullScreenHandler);
    } catch {
      this.revealFallback = true;
      this.leaveFullScreenHandler = null;
    }

    try {
      this.timeoutHandle = this.scheduleTimeout(
        completeWait,
        this.timeoutMs
      );
    } catch {
      this.revealFallback = true;
      this.timeoutHandle = null;
    }

    try {
      this.window.setFullScreen(false);
    } catch {
      this.revealFallback = true;
    } finally {
      this.revealStarting = false;
    }

    if (this.revealFallback || this.waitObserved) {
      this.settleReveal({fallback: this.revealFallback});
    }
    return this.revealPromise;
  }

  cleanupWait() {
    let fallback = false;
    if (this.timeoutHandle !== null) {
      try {
        this.cancelTimeout(this.timeoutHandle);
      } catch {
        fallback = true;
      }
      this.timeoutHandle = null;
    }

    if (this.leaveFullScreenHandler) {
      try {
        if (typeof this.window?.removeListener === 'function') {
          this.window.removeListener('leave-full-screen', this.leaveFullScreenHandler);
        } else if (typeof this.window?.off === 'function') {
          this.window.off('leave-full-screen', this.leaveFullScreenHandler);
        } else {
          fallback = true;
        }
      } catch {
        fallback = true;
      }
      this.leaveFullScreenHandler = null;
    }
    return fallback;
  }

  settleReveal({fallback = false, restore = true} = {}) {
    if (this.revealSettled) return;
    this.revealSettled = true;
    const cleanupFailed = this.cleanupWait();
    fallback = fallback || this.revealFallback || cleanupFailed;

    if (restore && !this.destroyed) {
      const state = this.windowState();
      fallback = fallback || state.failed || state.destroyed;
      if (!state.destroyed) {
        try {
          this.window.setBounds({...this.normalBounds});
        } catch {
          fallback = true;
        }
        try {
          this.window.center();
        } catch {
          fallback = true;
        }
      }
    }

    const resolve = this.resolveReveal;
    this.resolveReveal = null;
    resolve?.(fallback ? FALLBACK_RESULT : WINDOWED_RESULT);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.revealPromise && !this.revealSettled) {
      this.settleReveal({fallback: true, restore: false});
    }
  }
}

module.exports = {WindowDirector};
