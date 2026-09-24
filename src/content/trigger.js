// Ways to open the PiP window. Chrome only opens it inside a user gesture
// in the page, so the reliable triggers are the hover button and the
// keyboard shortcut. The toolbar icon is a best effort.

// One shadow-DOM host for our page UI, so site CSS can't reach it.
PipCaptions.ui = (() => {
  let root;
  return () => {
    if (root) return root;
    const host = document.createElement('pipc-ui');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      button { position: fixed; pointer-events: auto; display: none; cursor: pointer;
        font: 600 12px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.72);
        border: 1px solid rgba(255,255,255,.35); border-radius: 6px; padding: 6px 9px; }
      button:hover { background: rgba(0,0,0,.9); }
      .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
        max-width: min(90vw, 420px); font: 13px/1.4 system-ui, sans-serif; color: #fff;
        background: rgba(20,20,20,.92); padding: 10px 14px; border-radius: 8px;
        opacity: 0; transition: opacity .2s; }
      .toast.show { opacity: 1; }
    </style>
    <button title="Picture-in-Picture with captions (Alt+Shift+P)">⧉ PiP + CC</button>
    <div class="toast" role="status"></div>`;
    root.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      PipCaptions.onButtonClick();
    });
    // Created lazily, so pages without video never get our element.
    document.documentElement.append(host);
    return root;
  };
})();

PipCaptions.toast = (() => {
  let timer;
  return (message) => {
    const el = PipCaptions.ui().querySelector('.toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), 4000);
  };
})();

PipCaptions.run = function (video) {
  PipCaptions.toggle(video).catch((err) => {
    console.error('[PiP Captions]', err);
    if (err && err.name === 'NotAllowedError') {
      PipCaptions.toast('Chrome needs a click in the page. Use the “PiP + CC” button on the video or press Alt+Shift+P.');
    } else {
      PipCaptions.toast(`Couldn’t open Picture-in-Picture: ${err && err.message}`);
    }
  });
};

// Alt+Shift+P anywhere on the page. Capture phase so site players that
// swallow key events don't get it first.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      e.stopPropagation();
      PipCaptions.run();
    }
  },
  true
);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'pipc:toggle') PipCaptions.run();
});

// Hover button. Site players cover the <video> with their own controls, so
// we hit-test pointer position against video rects instead of relying on
// mouseover targets.
(() => {
  let current = null;
  let hideTimer;
  const button = () => PipCaptions.ui().querySelector('button');

  // Cached briefly: finding videos inside shadow roots walks the whole page.
  let videos = [];
  let videosAt = 0;
  const videoAt = (x, y) => {
    if (performance.now() - videosAt > 1000) {
      videos = PipCaptions.allVideos();
      videosAt = performance.now();
    }
    return videos.find((v) => {
      const r = v.getBoundingClientRect();
      return r.width >= 200 && r.height >= 112 &&
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  };

  const hide = () => {
    if (current) button().style.display = 'none';
    current = null;
  };

  let pending = false;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const video = videoAt(e.clientX, e.clientY);
        if (!video) return hide();
        const b = button();
        const r = video.getBoundingClientRect();
        b.style.display = 'block';
        b.style.top = `${Math.max(r.top, 0) + 10}px`;
        b.style.left = `${r.right - b.offsetWidth - 10}px`;
        current = video;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 2500);
      });
    },
    { passive: true }
  );

  PipCaptions.onButtonClick = () => {
    const video = current;
    hide();
    PipCaptions.run(video);
  };
})();
