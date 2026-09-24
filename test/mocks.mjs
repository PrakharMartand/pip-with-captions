// Mock player pages for the site caption sources. Each mimics how the real
// site draws captions (as DOM over the video, not text tracks), cycling
// through CAPTIONS once a second.
//
// Prime Video and Hotstar captions copy markup captured from the real sites
// (Sept 2026). The rest is our best guess at each site's player. A passing
// test means the extension handles that markup, not that the site still
// uses it.

export const CAPTIONS = [['First caption'], ['Second caption,', 'on two lines'], []];
export const EXPECTED = ['First caption', 'Second caption, | on two lines'];

// Real streaming sites send strict CSPs; the PiP window inherits the page's.
// Content scripts are exempt, and the tests check that the PiP window's
// styles still apply. This blocks inline <style> elements but not style
// attributes, which the captured caption markup relies on.
export const CSP = "style-src-elem 'self'";

export const sites = [
  {
    name: 'YouTube',
    source: 'youtube',
    url: 'https://www.youtube.com/watch?v=test',
    player: `
      <div class="html5-video-player">
        <div class="html5-video-container"><video muted></video></div>
        <div id="captions" class="ytp-caption-window-container"></div>
      </div>`,
    render: (lines) =>
      lines.length
        ? '<div class="caption-window">' +
          lines.map((l) => `<span class="caption-visual-line"><span class="ytp-caption-segment">${l}</span></span>`).join('') +
          '</div>'
        : '',
  },
  {
    name: 'Netflix',
    source: 'netflix',
    url: 'https://www.netflix.com/watch/1',
    player: `
      <div class="watch-video">
        <div class="watch-video--player-view"><video muted></video></div>
        <div id="captions" class="player-timedtext"></div>
      </div>`,
    render: (lines) =>
      lines.length
        ? `<div class="player-timedtext-text-container"><span>${lines.join('<br>')}</span></div>`
        : '',
  },
  {
    name: 'Prime Video',
    source: 'prime',
    url: 'https://www.primevideo.com/detail/test',
    // The outer classes are Prime's generated ones; only the captions-text
    // class is stable.
    player: `
      <div class="fk0grf2"><video muted></video>
        <div class="for4ikd f1kcui98"><div id="captions" class="f1iwgj00" dir="auto"></div></div>
      </div>`,
    render: (lines) =>
      lines.length
        ? '<div style="text-align: center; display: flex; flex-direction: column;">' +
          '<p style="width: 100%; margin: 0px;"><span class="fbhsa9">' +
          lines.map((l) => `<span class="atvwebplayersdk-captions-text f7j034j">${l}</span>`).join('<br>') +
          '</span></p></div>'
        : '',
  },
  {
    // Shaka Player's caption layer, as rendered on hotstar.com.
    name: 'Hotstar (Shaka Player)',
    source: 'player-library',
    url: 'https://www.hotstar.com/in/shows/test',
    player: `
      <div style="width: 100%; height: 100%; overflow: hidden;"><video muted></video>
        <div style="position: absolute; top: 0; left: 0;">
          <div id="captions" class="shaka-text-container upgraded"></div>
        </div>
      </div>`,
    render: (lines) =>
      lines.length
        ? `<div style="white-space: pre-wrap; color: white;"><span style="font-style: normal;">${lines.join('\n')}</span></div>`
        : '',
  },
  {
    // Disney+ renders its player inside a shadow root.
    name: 'Disney+',
    source: 'disney',
    url: 'https://www.disneyplus.com/play/test',
    shadow: true,
    player: `<disney-web-player><video muted></video></disney-web-player>`,
    render: (lines) =>
      lines.length
        ? '<div class="dss-subtitle-renderer-cue-window"><div class="dss-subtitle-renderer-cue">' +
          lines.map((l) => `<span class="dss-subtitle-renderer-line">${l}</span>`).join('<br>') +
          '</div></div>'
        : '',
  },
];

export function mockPage(site) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${site.name} mock</title></head>
<body>
${site.player}
<script>
  const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
  const ctx = canvas.getContext('2d');
  setInterval(() => {
    ctx.fillStyle = 'hsl(' + (Date.now() / 20) % 360 + ' 50% 40%)';
    ctx.fillRect(0, 0, 320, 180);
  }, 50);
  const video = document.querySelector('video');
  video.srcObject = canvas.captureStream(20);
  video.play();

  let container = document.getElementById('captions');
  if (${!!site.shadow}) {
    // Video and captions both live inside the shadow root.
    const shadow = document.querySelector('disney-web-player').attachShadow({ mode: 'open' });
    container = document.createElement('div');
    shadow.append(video, container);
  }
  const render = ${site.render.toString()};
  const captions = ${JSON.stringify(CAPTIONS)};
  let i = 0;
  setInterval(() => (container.innerHTML = render(captions[i++ % captions.length])), 1000);
  video.addEventListener('playing', () => (document.body.dataset.ready = '1'), { once: true });
</script>
</body></html>`;
}
