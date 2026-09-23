// Caption sources. Each one watches the page for the current caption and
// calls emit(lines) with an array of strings (empty array = no caption).
//
//   { name, matches(location), attach(video, emit) -> detach() | null }
//
// attach() runs while the video is still in the page, so a source can find
// the site's player around it. It returns null when it has nothing to offer,
// and the next source gets a turn. Site sources come first; `native` is the
// fallback for any page that uses real <track> elements.

// Watch a DOM subtree and re-read captions once per batch of mutations.
// MutationObserver callbacks are microtasks, so this keeps working while the
// tab is in the background (where requestAnimationFrame and timers stall),
// which is exactly when PiP is in use.
PipCaptions.observeDom = function (root, read, emit) {
  const flush = () => emit(read());
  const mo = new MutationObserver(flush);
  mo.observe(root, { subtree: true, childList: true, characterData: true });
  flush();
  return () => mo.disconnect();
};

PipCaptions.splitLines = function (texts) {
  return texts
    .flatMap((t) => t.split('\n'))
    .map((s) => s.trim())
    .filter(Boolean);
};

// innerText keeps <br> as line breaks; textContent is the fallback for
// nodes that aren't rendered.
PipCaptions.textLines = function (nodes) {
  return PipCaptions.splitLines(nodes.map((n) => n.innerText || n.textContent || ''));
};

// YouTube draws captions as DOM inside the player; there are no text tracks.
PipCaptions.sources.push({
  name: 'youtube',
  matches: (loc) => /(^|\.)youtube(-nocookie)?\.com$/.test(loc.hostname),
  attach(video, emit) {
    const player = video.closest('.html5-video-player');
    if (!player) return null;
    const read = () => {
      const lines = player.querySelectorAll('.caption-visual-line');
      if (lines.length) return PipCaptions.textLines([...lines]);
      return PipCaptions.textLines([...player.querySelectorAll('.ytp-caption-segment')]);
    };
    return PipCaptions.observeDom(player, read, emit);
  },
});

// Netflix renders timed text into .player-timedtext. Experimental: Netflix
// markup changes often, and its player may not like the video moving.
PipCaptions.sources.push({
  name: 'netflix',
  matches: (loc) => /(^|\.)netflix\.com$/.test(loc.hostname),
  attach(video, emit) {
    const root = document.querySelector('.watch-video') || document.body;
    const read = () =>
      PipCaptions.textLines([...root.querySelectorAll('.player-timedtext-text-container')]);
    return PipCaptions.observeDom(root, read, emit);
  },
});

// Standard <track kind="subtitles|captions">. We switch the chosen track to
// "hidden" so the browser still fires cue events but doesn't draw it, and
// draw it ourselves so size and style match the PiP window.
PipCaptions.sources.push({
  name: 'native',
  matches: () => true,
  attach(video, emit) {
    const tracks = [...video.textTracks].filter(
      (t) => t.kind === 'subtitles' || t.kind === 'captions'
    );
    const track =
      tracks.find((t) => t.mode === 'showing') || tracks.find((t) => t.mode === 'hidden');
    if (!track) return null;

    const previousMode = track.mode;
    track.mode = 'hidden';
    const onCueChange = () => {
      const cues = [...(track.activeCues || [])];
      // getCueAsHTML() drops WebVTT markup like <v Speaker> and <i>.
      const texts = cues.map((c) => (c.getCueAsHTML ? c.getCueAsHTML().textContent : c.text));
      emit(PipCaptions.splitLines(texts));
    };
    track.addEventListener('cuechange', onCueChange);
    onCueChange();
    return () => {
      track.removeEventListener('cuechange', onCueChange);
      track.mode = previousMode;
    };
  },
});

// First source that matches this site and finds captions wins.
PipCaptions.attachCaptions = function (video, emit) {
  for (const source of PipCaptions.sources) {
    if (!source.matches(location)) continue;
    const detach = source.attach(video, emit);
    if (detach) return { name: source.name, detach };
  }
  return null;
};
