// Opens a Document Picture-in-Picture window, moves the page's <video> into
// it, and draws captions on top. Closing the window puts the video back.

PipCaptions.session = null;

PipCaptions.PIP_CSS = `
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden;
    font-family: system-ui, sans-serif; }
  video.pipc-video { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: contain; background: #000; }

  #pipc-captions { position: absolute; left: 4%; right: 4%; bottom: 6%;
    display: flex; flex-direction: column; align-items: center; gap: .15em;
    pointer-events: none; text-align: center; line-height: 1.25;
    font-size: clamp(13px, 5.5vh, 42px); transition: bottom .15s; }
  #pipc-captions span { background: rgba(0, 0, 0, .75); color: #fff;
    padding: .05em .35em; border-radius: .15em; white-space: pre-wrap; }
  body.controls-visible #pipc-captions { bottom: calc(6% + 44px); }
  body.captions-off #pipc-captions { display: none; }

  #pipc-controls { position: absolute; left: 0; right: 0; bottom: 0; height: 44px;
    display: flex; align-items: center; gap: 8px; padding: 0 10px; box-sizing: border-box;
    background: linear-gradient(transparent, rgba(0, 0, 0, .85));
    opacity: 0; transition: opacity .15s; }
  body.controls-visible #pipc-controls { opacity: 1; }
  #pipc-controls button { background: none; border: 0; color: #fff; cursor: pointer;
    font: 600 13px system-ui, sans-serif; padding: 4px 6px; border-radius: 4px; min-width: 28px; }
  #pipc-controls button:hover { background: rgba(255, 255, 255, .15); }
  #pipc-cc[aria-pressed="false"] { opacity: .5; text-decoration: line-through; }
  #pipc-seek { flex: 1; min-width: 0; accent-color: #fff; }
  #pipc-time { color: #fff; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
`;

// The biggest visible video, preferring one that is playing.
PipCaptions.pickVideo = function () {
  const score = (v) => {
    const r = v.getBoundingClientRect();
    return r.width * r.height * (v.paused ? 1 : 4);
  };
  return PipCaptions.allVideos()
    .filter((v) => v.readyState > 0 && score(v) > 0)
    .sort((a, b) => score(b) - score(a))[0];
};

// Must be called from a user gesture in the page (click or key press).
PipCaptions.toggle = async function (video) {
  if (PipCaptions.session) {
    PipCaptions.session.close();
    return;
  }
  video = video || PipCaptions.pickVideo();
  if (!video) {
    PipCaptions.toast('No video found on this page.');
    return;
  }
  if (!('documentPictureInPicture' in window)) {
    // Classic PiP still beats nothing, but it can only show the video itself.
    await video.requestPictureInPicture();
    PipCaptions.toast('This browser has no Document Picture-in-Picture, so captions can’t be shown.');
    return;
  }
  await PipCaptions.open(video);
};

PipCaptions.open = async function (video) {
  const width = 480;
  const height = video.videoWidth
    ? Math.round((width * video.videoHeight) / video.videoWidth)
    : 270;
  const pip = await documentPictureInPicture.requestWindow({ width, height });
  const doc = pip.document;
  doc.title = document.title;

  const style = doc.createElement('style');
  style.textContent = PipCaptions.PIP_CSS;
  doc.head.append(style);

  // A same-sized box keeps the page layout from jumping while the video is away.
  const rect = video.getBoundingClientRect();
  const placeholder = document.createElement('div');
  placeholder.textContent = 'Playing in Picture-in-Picture';
  placeholder.style.cssText =
    `width:${rect.width}px;height:${rect.height}px;max-width:100%;display:flex;` +
    'align-items:center;justify-content:center;background:#000;color:#aaa;' +
    'font:14px system-ui,sans-serif;';

  const saved = {
    style: video.getAttribute('style'),
    className: video.className,
    controls: video.controls,
  };

  // Captions are attached while the video is still in the page so site
  // sources can find the player around it.
  const captions = doc.createElement('div');
  captions.id = 'pipc-captions';
  let lastText = '';
  const emit = (lines) => {
    const text = lines.join('\n');
    if (text === lastText) return;
    lastText = text;
    captions.replaceChildren(
      ...lines.map((line) => {
        const span = doc.createElement('span');
        span.textContent = line;
        return span;
      })
    );
  };
  let source = PipCaptions.attachCaptions(video, emit);
  PipCaptions.log('opening', {
    captionSource: source ? source.name : 'none found',
    picked: PipCaptions.describeVideo(video),
    videosOnPage: PipCaptions.allVideos().map(PipCaptions.describeVideo),
  });

  // Moving the element synchronously keeps it playing: a media element only
  // pauses if it is still outside every document at the next stable state.
  video.replaceWith(placeholder);
  video.removeAttribute('style');
  video.controls = false; // ours replace them
  video.classList.add('pipc-video');
  doc.body.append(video, captions);
  const stopWatching = PipCaptions.watchVideo(video, pip);

  const controls = PipCaptions.buildControls(doc, video, {
    toggleCaptions() {
      const on = doc.body.classList.toggle('captions-off') === false;
      if (on && !source) source = PipCaptions.enableNativeTrack(video, emit);
      return on;
    },
  });
  doc.body.append(controls.element);

  // A site may add its text tracks after playback starts.
  const onAddTrack = () => {
    if (!source) source = PipCaptions.attachCaptions(video, emit);
  };
  video.textTracks.addEventListener('addtrack', onAddTrack);

  const close = () => pip.close();
  PipCaptions.session = { close, video, get source() { return source && source.name; } };

  pip.addEventListener('pagehide', () => {
    stopWatching();
    video.textTracks.removeEventListener('addtrack', onAddTrack);
    controls.destroy();
    if (source) source.detach();
    placeholder.replaceWith(video);
    video.className = saved.className;
    video.controls = saved.controls;
    if (saved.style === null) video.removeAttribute('style');
    else video.setAttribute('style', saved.style);
    PipCaptions.session = null;
  });
};

// Diagnostics go to the page's DevTools console, prefixed so they're easy
// to filter. Details are JSON so they survive copy-paste into a bug report.
PipCaptions.log = function (message, details) {
  console.info(`[PiP Captions] ${message}` + (details ? ` ${JSON.stringify(details)}` : ''));
};

PipCaptions.describeVideo = function (v) {
  const r = v.getBoundingClientRect();
  return {
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    paused: v.paused,
    time: Math.round(v.currentTime),
    readyState: v.readyState,
    networkState: v.networkState,
    drm: !!v.mediaKeys,
    src: (v.currentSrc || v.src || (v.srcObject ? 'srcObject' : 'none')).slice(0, 60),
    error: v.error && v.error.code,
  };
};

// Sites whose player reacts badly to its <video> moving show up here: the
// video is emptied, the site builds a new one, or it takes the video back.
PipCaptions.watchVideo = function (video, pip) {
  const events = ['emptied', 'abort', 'error', 'stalled', 'ended'];
  const onEvent = (e) => PipCaptions.log(`video ${e.type}`, PipCaptions.describeVideo(video));
  events.forEach((ev) => video.addEventListener(ev, onEvent));

  const page = new MutationObserver((records) => {
    const added = records.some((r) =>
      [...r.addedNodes].some(
        (n) => n.nodeType === 1 && (n.localName === 'video' || n.querySelector('video'))
      )
    );
    if (added) PipCaptions.log('the page added a new <video> while PiP is open; the site may have rebuilt its player');
  });
  page.observe(document.documentElement, { childList: true, subtree: true });

  const pipWindow = new MutationObserver(() => {
    if (!pip.document.contains(video)) PipCaptions.log('the site took the video out of the PiP window');
  });
  pipWindow.observe(pip.document.body, { childList: true });

  return () => {
    events.forEach((ev) => video.removeEventListener(ev, onEvent));
    page.disconnect();
    pipWindow.disconnect();
  };
};

// For pages whose tracks are all "disabled": turn the first one on (hidden,
// since we do the drawing) and attach to it.
PipCaptions.enableNativeTrack = function (video, emit) {
  const track = [...video.textTracks].find(
    (t) => t.kind === 'subtitles' || t.kind === 'captions'
  );
  if (!track) return null;
  track.mode = 'hidden';
  return PipCaptions.attachCaptions(video, emit);
};

PipCaptions.formatTime = function (s) {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

PipCaptions.buildControls = function (doc, video, { toggleCaptions }) {
  const bar = doc.createElement('div');
  bar.id = 'pipc-controls';
  bar.innerHTML = `
    <button id="pipc-play" title="Play/pause (Space)"></button>
    <input id="pipc-seek" type="range" min="0" max="1000" value="0" aria-label="Seek">
    <span id="pipc-time"></span>
    <button id="pipc-cc" title="Captions (C)" aria-pressed="true">CC</button>`;
  const play = bar.querySelector('#pipc-play');
  const seek = bar.querySelector('#pipc-seek');
  const time = bar.querySelector('#pipc-time');
  const cc = bar.querySelector('#pipc-cc');

  let seeking = false;
  const render = () => {
    play.textContent = video.paused ? '▶' : '❚❚';
    const d = video.duration;
    seek.disabled = !Number.isFinite(d); // live streams
    if (!seeking && Number.isFinite(d) && d > 0) seek.value = (video.currentTime / d) * 1000;
    time.textContent = `${PipCaptions.formatTime(video.currentTime)} / ${PipCaptions.formatTime(d)}`;
    doc.body.classList.toggle('paused', video.paused);
    if (video.paused) show();
  };

  let hideTimer;
  const show = () => {
    doc.body.classList.add('controls-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) doc.body.classList.remove('controls-visible');
    }, 2000);
  };

  const togglePlay = () => (video.paused ? video.play() : video.pause());
  const flipCaptions = () => cc.setAttribute('aria-pressed', String(toggleCaptions()));
  play.onclick = togglePlay;
  cc.onclick = flipCaptions;
  seek.oninput = () => {
    seeking = true;
    if (Number.isFinite(video.duration)) video.currentTime = (seek.value / 1000) * video.duration;
  };
  seek.onchange = () => (seeking = false);

  const onKey = (e) => {
    if (e.key === ' ' || e.key === 'k') togglePlay();
    else if (e.key === 'ArrowLeft') video.currentTime -= 5;
    else if (e.key === 'ArrowRight') video.currentTime += 5;
    else if (e.key === 'c') flipCaptions();
    else return;
    e.preventDefault();
    show();
  };

  const events = ['play', 'pause', 'timeupdate', 'durationchange'];
  events.forEach((ev) => video.addEventListener(ev, render));
  doc.addEventListener('mousemove', show);
  doc.addEventListener('keydown', onKey);
  render();
  show();

  return {
    element: bar,
    destroy() {
      clearTimeout(hideTimer);
      events.forEach((ev) => video.removeEventListener(ev, render));
    },
  };
};
