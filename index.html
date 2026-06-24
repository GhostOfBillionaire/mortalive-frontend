/* Mortalive — simplified frontend app
   Omegle-style UI, desktop-safe layout, text/video chat, demo fallback. */

const BUILD_TAG = 'mortalive-build-2026-06-22-2'; // bump this string on every deploy to confirm cache is fresh

const SERVER_URL =
  window.MORTALIVE_SERVER_URL ||
  (location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://mortalive-server-production.up.railway.app');

console.log(`[Mortalive] ${BUILD_TAG} loaded`);
console.log(`[Mortalive] SERVER_URL = ${SERVER_URL}`);
console.log(`[Mortalive] Socket.io client ${typeof io === 'undefined' ? 'NOT LOADED ✗' : 'loaded ✓'}`);

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

const S = {
  mode: 'video',
  interest: '',
  roomId: null,
  stranger: null,
  socket: null,
  pc: null,
  localStream: null,
  outgoingStream: null,
  portraitPipeline: null,
  isInitiator: false,
  pendingCandidates: [],
  camGranted: false,
  micMuted: false,
  camOff: false,
  onlineCount: 2847,
  onlineTimerStarted: false,
  pendingAction: null,
  replyTimer: null,
  demoActive: false,
  // identity
  authToken: localStorage.getItem('mortalive_token') || null,
  username: localStorage.getItem('mortalive_username') || null,
  magnetScore: null,
  isGuest: true,
  guestName: localStorage.getItem('mortalive_guest_name') || '',
  videoLayout: (function () {
    const raw = localStorage.getItem('mortalive_video_layout') || localStorage.getItem('mortalive_local_video_shape') || 'horizontal';
    const v = String(raw).toLowerCase();
    if (['vertical', 'stack', 'stacked', 'portrait', 'square'].includes(v)) return 'vertical';
    return 'horizontal';
  })()
};

const strangerPool = [
  { name: 'Nova_82', score: 310, emoji: '🦊' },
  { name: 'Theorist_X', score: 520, emoji: '🎭' },
  { name: 'Mira_Glow', score: 88, emoji: '🌸' },
  { name: 'Static_J', score: 205, emoji: '⚡' },
  { name: 'DuskRider', score: 445, emoji: '🌙' },
  { name: 'Cipher_9', score: 731, emoji: '🔮' },
  { name: 'SunKid', score: 62, emoji: '☀️' },
  { name: 'Nox_V', score: 890, emoji: '🖤' }
];

const autoReplies = [
  'haha fr though 😂',
  'okay that’s actually a good point',
  'wait what do you do?',
  'tbh I’ve been thinking about that too',
  'lmao no way',
  'that’s lowkey wild',
  'okay so hear me out…',
  'depends on what you mean',
  'I feel like most people don’t realize',
  'nah I disagree but I respect it',
  'go on…',
  'that reminds me of something',
  'honestly same',
  'ooh controversial 👀',
  'solid point ngl',
  'wait explain that more',
  'no way lol',
  'that’s actually kinda scary',
  'based',
  'wait are you serious?'
];

function $(id) {
  return document.getElementById(id);
}

function ready(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = $(id);
  if (page) page.classList.add('active');
  window.scrollTo(0, 0);
}

function toast(msg, icon = '✅') {
  let root = $('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = `${icon} ${msg}`;
  root.appendChild(el);
  setTimeout(() => (el.style.opacity = '0'), 2400);
  setTimeout(() => el.remove(), 2800);
}

function fmtTime() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setCallStatus(state, label) {
  ['conn-dot', 'call-dot'].forEach((id) => {
    const el = $(id);
    if (el) el.className = `cbd ${state}`;
  });
  ['conn-text', 'call-text'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = label;
  });
}

function updateOnlineCount() {
  const el = $('online-n') || $('online-count') || $('online-users');
  if (el) el.textContent = S.onlineCount.toLocaleString();
  const mc = $('match-count');
  if (mc) mc.textContent = S.onlineCount.toLocaleString();
}

function isCompactViewport() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function getEffectiveVideoLayout() {
  if (isCompactViewport()) return 'vertical';
  return S.videoLayout === 'vertical' ? 'vertical' : 'horizontal';
}

function syncVideoPanelButton(forcedLayout) {
  const btn = $('vc-layout');
  if (!btn) return;
  const layout = forcedLayout || getEffectiveVideoLayout();
  const isHorizontal = layout === 'horizontal';
  btn.textContent = isHorizontal ? 'Layout: Side' : 'Layout: Stack';
  btn.title = isHorizontal ? 'Switch to stacked layout' : 'Switch to side-by-side layout';
  btn.disabled = isCompactViewport();
}

function applyVideoLayout() {
  const feeds = $('video-feeds');
  const layout = getEffectiveVideoLayout();
  if (feeds) {
    feeds.classList.toggle('layout-horizontal', layout === 'horizontal');
    feeds.classList.toggle('layout-vertical', layout === 'vertical');
  }
  syncVideoPanelButton(layout);
}

function toggleVideoLayout() {
  if (isCompactViewport()) {
    applyVideoLayout();
    toast('Phone stays in stacked layout', '📱');
    return;
  }
  S.videoLayout = getEffectiveVideoLayout() === 'horizontal' ? 'vertical' : 'horizontal';
  localStorage.setItem('mortalive_video_layout', S.videoLayout);
  applyVideoLayout();
  toast(S.videoLayout === 'horizontal' ? 'Camera layout set to side-by-side' : 'Camera layout set to stacked', '🎬');
}

const PORTRAIT_TARGET_RATIO = 4 / 5;

function stopPortraitPipeline() {
  if (!S.portraitPipeline) return;

  const pipeline = S.portraitPipeline;
  try {
    if (pipeline.rafId) cancelAnimationFrame(pipeline.rafId);
  } catch (e) {}

  try {
    if (pipeline.sourceVideo) {
      pipeline.sourceVideo.pause?.();
      pipeline.sourceVideo.srcObject = null;
      pipeline.sourceVideo.removeAttribute('src');
      pipeline.sourceVideo.load?.();
    }
  } catch (e) {}

  try {
    if (pipeline.canvasStream) {
      pipeline.canvasStream.getTracks().forEach((track) => track.stop());
    }
  } catch (e) {}

  S.portraitPipeline = null;
  S.outgoingStream = null;
}

async function ensurePortraitOutgoingStream(sourceStream) {
  if (!sourceStream || !sourceStream.active) return null;

  if (
    S.outgoingStream &&
    S.portraitPipeline &&
    S.portraitPipeline.sourceStream === sourceStream &&
    S.portraitPipeline.canvasStream
  ) {
    return S.portraitPipeline.canvasStream;
  }

  stopPortraitPipeline();

  const sourceVideo = document.createElement('video');
  sourceVideo.playsInline = true;
  sourceVideo.autoplay = true;
  sourceVideo.muted = true;
  sourceVideo.srcObject = sourceStream;

  await new Promise((resolve) => {
    const done = () => resolve();
    sourceVideo.onloadedmetadata = done;
    sourceVideo.oncanplay = done;
    sourceVideo.onerror = done;
  }).catch(() => {});

  try {
    await sourceVideo.play();
  } catch (e) {}

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  const setCanvasSize = () => {
    const baseW = 960;
    canvas.width = baseW;
    canvas.height = Math.round(baseW / PORTRAIT_TARGET_RATIO);
  };
  setCanvasSize();

  const pipeline = {
    sourceStream,
    sourceVideo,
    canvas,
    canvasStream: null,
    rafId: 0
  };

  const draw = () => {
    if (sourceVideo.readyState >= 2 && sourceVideo.videoWidth && sourceVideo.videoHeight && ctx) {
      const vw = sourceVideo.videoWidth;
      const vh = sourceVideo.videoHeight;
      const sourceRatio = vw / vh;

      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;

      if (sourceRatio > PORTRAIT_TARGET_RATIO) {
        sw = vh * PORTRAIT_TARGET_RATIO;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / PORTRAIT_TARGET_RATIO;
        sy = (vh - sh) / 2;
      }

      ctx.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }
    pipeline.rafId = requestAnimationFrame(draw);
  };
  draw();

  const canvasStream = canvas.captureStream(30);
  pipeline.canvasStream = canvasStream;
  S.portraitPipeline = pipeline;
  S.outgoingStream = canvasStream;
  return canvasStream;
}

function setActiveMode(mode) {
  S.mode = mode === 'video' ? 'video' : 'text';
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === S.mode);
  });
  const modeLabel = $('mode-label');
  if (modeLabel) modeLabel.textContent = S.mode === 'video' ? 'Video' : 'Text';
}

function setPrimaryButtonsEnabled(enabled) {
  ['btn-enter', 'btn-start-text', 'btn-start-video', 'btn-start'].forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('ready', enabled);
  });
}

function updateConsentState() {
  // Real <input type="checkbox" id="landing-consent"> used in the current HTML
  const terms = $('landing-consent') || $('terms') || $('terms-checkbox');
  const oldChecks = ['c1', 'c2', 'c3'].map((id) => $(id)).filter(Boolean);

  if (terms) {
    setPrimaryButtonsEnabled(!!terms.checked);
    return;
  }

  if (oldChecks.length === 3) {
    const all = oldChecks.every((box) => box.classList.contains('on'));
    setPrimaryButtonsEnabled(all);
    return;
  }

  setPrimaryButtonsEnabled(true);
}

function initConsentGate() {
  const terms = $('landing-consent') || $('terms') || $('terms-checkbox');

  if (terms) {
    terms.addEventListener('change', updateConsentState);
    updateConsentState();
    return;
  }

  const ids = ['c1', 'c2', 'c3'];
  const boxes = ids.map((id) => $(id));
  if (boxes.every(Boolean)) {
    const checks = { c1: false, c2: false, c3: false };
    ids.forEach((id) => {
      const box = $(id);
      const row = box && box.closest('.chk-row');
      if (!row) return;
      row.addEventListener('click', () => {
        checks[id] = !checks[id];
        box.classList.toggle('on', checks[id]);
        const all = Object.values(checks).every(Boolean);
        setPrimaryButtonsEnabled(all);
      });
    });
  }

  updateConsentState();
}

function startOnlineCounter() {
  if (S.onlineTimerStarted) return;
  S.onlineTimerStarted = true;
  updateOnlineCount();
  setInterval(() => {
    S.onlineCount += Math.floor(Math.random() * 22) - 11;
    S.onlineCount = Math.max(1500, Math.min(6000, S.onlineCount));
    updateOnlineCount();
  }, 3500);
}

function ensureLobbyCameraPreview() {
  const preview = $('lobby-cam-preview');
  if (preview && S.localStream) preview.srcObject = S.localStream;
  const strip = $('cam-strip');
  if (strip && S.localStream) strip.classList.add('visible');
}

function enterLobby() {
  setActiveMode(S.mode);
  showPage('pg-lobby');
  ensureLobbyCameraPreview();
  updateIdentityDisplay();
}

function updateIdentityDisplay() {
  const label = $('identity-label');
  const switchBtn = $('btn-switch-account');
  const logoutBtn = $('btn-logout');
  const scorePill = $('score-pill-btn');

  if (!S.isGuest && S.username) {
    if (label) label.textContent = `Logged in as ${S.username} · 🧲 ${S.magnetScore ?? '—'} Magnet Score`;
    if (switchBtn) switchBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
    if (scorePill) scorePill.style.display = '';
  } else {
    if (label) label.textContent = `Browsing as guest "${S.guestName || 'Guest'}" — no Magnet Score`;
    if (switchBtn) switchBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (scorePill) scorePill.style.display = 'none';
  }
}

function requestCameraPermission() {
  const btn = $('btn-allow');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Waiting for browser permission…';
  }

  return navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => {
      S.localStream = stream;
      S.camGranted = true;

      const permVideo = $('perm-video');
      const permOverlay = $('perm-overlay');
      const permDot = $('perm-dot');
      const permStsTxt = $('perm-status-txt');
      const camLbl = $('cam-status-lbl');
      const micLbl = $('mic-status-lbl');

      if (permVideo) permVideo.srcObject = stream;
      if (permOverlay) permOverlay.style.display = 'none';
      if (permDot) permDot.className = 'dot ok';
      if (permStsTxt) permStsTxt.textContent = 'Camera & mic active';
      if (camLbl) {
        camLbl.textContent = 'granted';
        camLbl.className = 'badge ok';
      }
      if (micLbl) {
        micLbl.textContent = 'granted';
        micLbl.className = 'badge ok';
      }

      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Permissions granted';
      }

      const lobbyPreview = $('lobby-cam-preview');
      if (lobbyPreview) lobbyPreview.srcObject = stream;

      const camStrip = $('cam-strip');
      if (camStrip) camStrip.classList.add('visible');

      showPage('pg-lobby');

      if (S.pendingAction === 'match') {
        S.pendingAction = null;
        // Permission just succeeded because the user wanted video mode —
        // NOW it's safe to commit S.mode to 'video' and sync the visible
        // toggle button, right before actually queuing for a match.
        setActiveMode('video');
        setTimeout(startMatching, 350);
      } else if (S.pendingAction === 'lobby-video') {
        S.pendingAction = null;
        setActiveMode('video');
      }
    })
    .catch((err) => {
      console.warn('[Camera]', err.name, err.message);

      const permDot = $('perm-dot');
      const permStsTxt = $('perm-status-txt');
      const camLbl = $('cam-status-lbl');
      const micLbl = $('mic-status-lbl');
      const permOverlay = $('perm-overlay');
      const overlayTxt = $('perm-overlay-txt');

      if (permDot) permDot.className = 'dot bad';
      if (permStsTxt) permStsTxt.textContent = 'Permission denied';
      if (camLbl) {
        camLbl.textContent = 'denied';
        camLbl.className = 'badge warn';
      }
      if (micLbl) {
        micLbl.textContent = 'denied';
        micLbl.className = 'badge warn';
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = err.name === 'NotFoundError' ? 'No camera found' : 'Try again';
      }
      if (permOverlay) permOverlay.style.display = 'flex';
      if (overlayTxt) {
        overlayTxt.textContent =
          err.name === 'NotFoundError'
            ? 'No camera was detected on this device.'
            : 'Permission was denied. Check browser settings and try again.';
      }

      toast(err.name === 'NotFoundError' ? 'No camera detected' : 'Camera blocked', '⚠️');
    });
}

function initAuthControls() {
  const tabLogin  = $('tab-login');
  const tabSignup = $('tab-signup');
  const loginForm  = $('auth-login-form');
  const signupForm = $('auth-signup-form');
  const forgotForm = $('auth-forgot-form');

  function showAuthTab(which) {
    if (forgotForm) forgotForm.style.display = 'none';
    if (which === 'login') {
      if (loginForm) loginForm.style.display = '';
      if (signupForm) signupForm.style.display = 'none';
      tabLogin?.classList.add('active');
      tabSignup?.classList.remove('active');
    } else {
      if (loginForm) loginForm.style.display = 'none';
      if (signupForm) signupForm.style.display = '';
      tabSignup?.classList.add('active');
      tabLogin?.classList.remove('active');
    }
  }

  tabLogin?.addEventListener('click', () => showAuthTab('login'));
  tabSignup?.addEventListener('click', () => showAuthTab('signup'));

  function setError(id, msg) {
    const el = $(id);
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = msg;
  }

  function afterAuthSuccess(token, username, magnetScore) {
    S.authToken = token;
    S.username = username;
    S.magnetScore = magnetScore;
    S.isGuest = false;
    localStorage.setItem('mortalive_token', token);
    localStorage.setItem('mortalive_username', username);
    toast(`Welcome, ${username}!`, '🧲');
    enterLobby();
  }

  $('btn-login')?.addEventListener('click', async () => {
    const username = ($('login-username')?.value || '').trim();
    const password = $('login-password')?.value || '';
    setError('login-error', null);
    if (!username || !password) { setError('login-error', 'Enter your username and password.'); return; }

    try {
      const res = await fetch(`${SERVER_URL}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) { setError('login-error', data.error || 'Login failed.'); return; }
      afterAuthSuccess(data.token, data.username, data.magnetScore);
    } catch (e) {
      setError('login-error', 'Could not reach the server. Try again in a moment.');
    }
  });

  $('btn-signup')?.addEventListener('click', async () => {
    const username = ($('signup-username')?.value || '').trim();
    const email    = ($('signup-email')?.value || '').trim();
    const password = $('signup-password')?.value || '';
    setError('signup-error', null);

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      setError('signup-error', 'Username must be 3-20 characters: letters, numbers, underscore only.');
      return;
    }
    if (password.length < 6) {
      setError('signup-error', 'Password must be at least 6 characters.');
      return;
    }

    try {
      const res = await fetch(`${SERVER_URL}/api/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email: email || null })
      });
      const data = await res.json();
      if (!res.ok) { setError('signup-error', data.error || 'Could not create account.'); return; }
      afterAuthSuccess(data.token, data.username, data.magnetScore);
    } catch (e) {
      setError('signup-error', 'Could not reach the server. Try again in a moment.');
    }
  });

  $('btn-forgot')?.addEventListener('click', () => {
    if (loginForm) loginForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = '';
  });
  $('btn-forgot-back')?.addEventListener('click', () => {
    if (forgotForm) forgotForm.style.display = 'none';
    showAuthTab('login');
  });
  $('btn-forgot-submit')?.addEventListener('click', async () => {
    const email = ($('forgot-email')?.value || '').trim();
    const msgEl = $('forgot-message');
    if (!email) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.textContent = data.message || 'If an account exists for that email, a reset link will be sent soon.';
      }
    } catch (e) {
      if (msgEl) { msgEl.style.display = 'block'; msgEl.textContent = 'Could not reach the server.'; }
    }
  });

  $('btn-continue-guest')?.addEventListener('click', () => {
    const name = ($('guest-name')?.value || '').trim();
    S.authToken = null;
    S.username = null;
    S.magnetScore = null;
    S.isGuest = true;
    S.guestName = name.slice(0, 24) || `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.removeItem('mortalive_token');
    localStorage.removeItem('mortalive_username');
    localStorage.setItem('mortalive_guest_name', S.guestName);
    enterLobby();
  });

  const guestInput = $('guest-name');
  if (guestInput && S.guestName) guestInput.value = S.guestName;
}

// If a session token is already stored, validate it on load and skip
// straight past the auth screen into the lobby on success.
async function tryAutoLogin() {
  if (!S.authToken) return false;
  try {
    const res = await fetch(`${SERVER_URL}/api/me`, {
      headers: { Authorization: `Bearer ${S.authToken}` }
    });
    if (!res.ok) throw new Error('invalid session');
    const data = await res.json();
    S.username = data.username;
    S.magnetScore = data.magnetScore;
    S.isGuest = false;
    return true;
  } catch (e) {
    S.authToken = null;
    localStorage.removeItem('mortalive_token');
    localStorage.removeItem('mortalive_username');
    return false;
  }
}

function initLandingActions() {
  const startText = $('btn-start-text') || $('btn-enter') || $('btn-start');
  const startVideo = $('btn-start-video');

  async function proceedPastLanding(mode) {
    S.mode = mode;
    S.pendingAction = null;
    // tryAutoLogin() was kicked off in the background at page load; this
    // just waits on that same result if it hasn't resolved yet.
    const loggedIn = S.authToken ? await tryAutoLogin() : false;
    if (loggedIn) {
      enterLobby();
    } else {
      showPage('pg-auth');
    }
  }

  if (startText) {
    startText.addEventListener('click', () => proceedPastLanding('text'));
  }

  if (startVideo) {
    startVideo.addEventListener('click', () => proceedPastLanding('video'));
  }
}

function initSetupBackButtons() {
  document.querySelectorAll('.setup-back').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'pg-land';
      showPage(target);
    });
  });
}

function initPermissionControls() {
  const btnAllow = $('btn-allow');
  if (btnAllow) btnAllow.addEventListener('click', requestCameraPermission);

  const btnSkipCam = $('btn-skip-cam');
  if (btnSkipCam) {
    btnSkipCam.addEventListener('click', () => {
      S.camGranted = false;
      S.mode = 'text';
      S.pendingAction = null;
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
      const textBtn = document.querySelector('[data-mode="text"]');
      if (textBtn) textBtn.classList.add('active');
      showPage('pg-lobby');
    });
  }
}

function initLobbyControls() {
  $('btn-switch-account')?.addEventListener('click', () => showPage('pg-auth'));

  $('btn-logout')?.addEventListener('click', async () => {
    try {
      await fetch(`${SERVER_URL}/api/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${S.authToken}` }
      });
    } catch (e) {}
    S.authToken = null;
    S.username = null;
    S.magnetScore = null;
    S.isGuest = true;
    localStorage.removeItem('mortalive_token');
    localStorage.removeItem('mortalive_username');
    toast('Logged out', '👋');
    updateIdentityDisplay();
    showPage('pg-auth');
  });

  const modeToggle = $('mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      const newMode = btn.dataset.mode || 'text';

      if (newMode === 'video' && !S.camGranted) {
        S.pendingAction = 'match';
        showPage('pg-perm');
        toast('Grant camera access to use video mode', '📹');
        return;
      }

      setActiveMode(newMode);
    });
  }

  const interestInput = $('interest-input');
  if (interestInput) {
    interestInput.addEventListener('input', () => {
      S.interest = interestInput.value.trim();
    });
  }

  const chips = $('chips');
  if (chips) {
    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      chip.classList.add('on');
      S.interest = chip.dataset.v || '';
    });
  }

  const btnFind = $('btn-find');
  if (btnFind) {
    btnFind.addEventListener('click', () => {
      const interest = $('interest-input');
      S.interest = (interest && interest.value ? interest.value : '').trim();
      if (S.mode === 'video' && !S.camGranted) {
        S.pendingAction = 'match';
        showPage('pg-perm');
        toast('Grant camera access to use video mode', '📹');
        return;
      }
      startMatching();
    });
  }
}

function initChatControls() {
  $('btn-send')?.addEventListener('click', sendMsg);

  const input = $('cin');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMsg();
      }
    });
  }

  $('btn-skip')?.addEventListener('click', () => {
    clearTimeout(S.replyTimer);
    logSession('end', { reason: 'skip', roomId: S.roomId });
    disconnectPeer();
    addSysLine('↩ Skipping — searching next match…');
    setTimeout(startMatching, 800);
  });

  $('btn-end')?.addEventListener('click', () => {
    clearTimeout(S.replyTimer);
    logSession('end', { reason: 'ended', roomId: S.roomId });
    disconnectPeer();
    showPage('pg-lobby');
  });

  $('btn-toggle-video')?.addEventListener('click', () => {
    const panel = $('video-panel');
    if (!panel) return;
    const on = panel.classList.contains('visible');

    if (on) {
      panel.classList.remove('visible');
      $('btn-toggle-video')?.classList.remove('active');
      return;
    }

    if (!S.camGranted && S.mode === 'video') {
      S.pendingAction = 'match';
      showPage('pg-perm');
      toast('Grant camera access first', '📹');
      return;
    }

    panel.classList.add('visible');
    $('btn-toggle-video')?.classList.add('active');
    if (S.demoActive && (!S.localStream || !S.localStream.active)) setupDemoVideo();
  });

  $('vc-mic')?.addEventListener('click', () => {
    S.micMuted = !S.micMuted;
    if (S.localStream) S.localStream.getAudioTracks().forEach((t) => (t.enabled = !S.micMuted));
    const btn = $('vc-mic');
    if (btn) {
      btn.textContent = S.micMuted ? '🔇' : '🎤';
      btn.classList.toggle('off', S.micMuted);
    }
    toast(S.micMuted ? 'Mic muted' : 'Mic on', S.micMuted ? '🔇' : '🎤');
  });

  $('vc-cam')?.addEventListener('click', () => {
    S.camOff = !S.camOff;
    if (S.localStream) S.localStream.getVideoTracks().forEach((t) => (t.enabled = !S.camOff));
    const btn = $('vc-cam');
    if (btn) {
      btn.textContent = S.camOff ? '🚫' : '📷';
      btn.classList.toggle('off', S.camOff);
    }
    toast(S.camOff ? 'Camera off' : 'Camera on', S.camOff ? '🚫' : '📷');
  });

  $('vc-layout')?.addEventListener('click', toggleVideoLayout);

  $('vc-flip')?.addEventListener('click', () => {
    const v = $('vid-local');
    if (!v) return;
    const cur = v.style.transform || 'scaleX(-1)';
    v.style.transform = cur.includes('scaleX(-1)') ? 'scaleX(1)' : 'scaleX(-1)';
  });

  $('vc-fs')?.addEventListener('click', () => {
    const feeds = $('video-feeds');
    if (!feeds) return;
    if (!document.fullscreenElement) feeds.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  });

  $('btn-cancel')?.addEventListener('click', () => {
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
    disconnectPeer();
    showPage('pg-lobby');
  });

  $('btn-try-demo')?.addEventListener('click', () => {
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
    if (S.socket && S.socket.connected) removeFromQueueSafely();
    simulateDemoMatch();
  });
}

function initGlobalDefaults() {
  setActiveMode(S.mode);
  updateOnlineCount();
  applyVideoLayout();
  setPrimaryButtonsEnabled(false);
  if (!$('landing-consent') && !$('terms') && !$('terms-checkbox') && !$('c1') && !$('c2') && !$('c3')) {
    setPrimaryButtonsEnabled(true);
  }
}

function initSocket() {
  if (typeof io === 'undefined') {
    console.warn('[Mortalive] Socket.io client not loaded yet — retrying in 800ms before falling back to demo mode.');
    setTimeout(() => {
      if (typeof io === 'undefined') {
        console.error('[Mortalive] Socket.io still missing after retry — check that socket.io.min.js loaded successfully (Network tab), that it deployed alongside index.html/app.js, and that you are testing the latest deploy, not a cached build.');
        return;
      }
      initSocket();
    }, 800);
    return;
  }

  if (S.socket && S.socket.connected) {
    S.socket.emit('queue', { mode: S.mode, pref: S.interest, token: S.authToken, guestName: S.guestName });
    return;
  }

  S.socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 6000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000
  });

  S.socket.on('connect', () => {
    // Fires on initial connect AND on every successful reconnect (e.g. a
    // mobile tab resuming after being backgrounded). Only re-announce to
    // the queue if we're still actually on the matching screen and haven't
    // already been matched — otherwise a reconnect mid-chat or back in the
    // lobby would silently throw the user back into search.
    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (S.matched || !onMatchingScreen) return;
    S.socket.emit('queue', { mode: S.mode, pref: S.interest, token: S.authToken, guestName: S.guestName });
  });

  S.socket.on('matched', async (data) => {
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
    S.matched = true;
    S.roomId = data.roomId;
    S.isInitiator = !!data.initiator;
    S.stranger = {
      name: (data.peer && data.peer.name) || 'Stranger',
      score: data.peer && typeof data.peer.score === 'number' ? data.peer.score : null,
      emoji: (data.peer && data.peer.emoji) || '👤',
      isGuest: !!(data.peer && data.peer.isGuest)
    };
    beginChat();
    if (S.mode === 'video') await startWebRTC();
  });

  S.socket.on('signal', async (data) => {
    if (!S.pc) return;
    try {
      if (data.type === 'offer') {
        await S.pc.setRemoteDescription(new RTCSessionDescription(data));
        for (const c of S.pendingCandidates) {
          await S.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        S.pendingCandidates = [];
        const answer = await S.pc.createAnswer();
        await S.pc.setLocalDescription(answer);
        S.socket.emit('signal', { roomId: S.roomId, type: answer.type, sdp: answer.sdp });
      } else if (data.type === 'answer') {
        await S.pc.setRemoteDescription(new RTCSessionDescription(data));
        for (const c of S.pendingCandidates) {
          await S.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        S.pendingCandidates = [];
      } else if (data.candidate !== undefined) {
        if (S.pc.remoteDescription && S.pc.remoteDescription.type) {
          await S.pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
        } else {
          S.pendingCandidates.push(data);
        }
      }
    } catch (e) {
      console.error('[WebRTC signal]', e);
    }
  });

  S.socket.on('peer-chat', ({ text }) => appendMsg(text, 'them'));

  S.socket.on('peer-disconnected', () => {
    addSysLine('👋 Stranger disconnected');
    setCallStatus('failed', 'disconnected');
    hideRemoteVideo('Stranger disconnected');
  });

  S.socket.on('connect_error', (err) => {
    console.log('[Socket] connect_error:', err.message);
  });
}

let matchTimeout = null;

function startMatching() {
  showPage('pg-match');
  updateOnlineCount();
  setCallStatus('connecting', 'Searching…');
  setText('match-title', 'Finding your match');
  const subReset = $('match-sub');
  if (subReset) subReset.innerHTML = 'Scanning <strong id="match-count">' + S.onlineCount.toLocaleString() + '</strong> people online right now.';
  const tryDemoReset = $('btn-try-demo');
  if (tryDemoReset) tryDemoReset.style.display = 'none';

  initSocket();

  S.matched = false; // reset; set to true inside the 'matched' socket handler

  clearTimeout(matchTimeout);
  clearTimeout(S.noMatchTimeout);
  S.connectFailed = false;

  // Don't guess based on a fixed timer how long a handshake "should" take —
  // that's exactly what was racing the demo fallback against normal,
  // healthy connections on slower networks (a PC behind a stricter
  // proxy/firewall can take much longer than a phone on home wifi to
  // finish the WebSocket → polling fallback dance). Instead, listen for
  // Socket.io's OWN signal that something is actually wrong, and only
  // treat it as a real failure after several consecutive failed attempts
  // (reconnection is enabled, so transient blips resolve on their own).
  let failedAttempts = 0;
  const onConnectError = (err) => {
    failedAttempts++;
    console.warn(`[Mortalive] connect_error (#${failedAttempts}):`, err?.message || err);
    if (S.matched || S.connectFailed) return;
    if (failedAttempts >= 4) {
      S.connectFailed = true;
      console.warn('[Mortalive] Server unreachable after repeated attempts — falling back to demo.');
      simulateDemoMatch();
    }
  };
  // Properly remove any leftover listener from a previous attempt before
  // attaching a new one — passing a fresh inline function to .off() (the
  // old code did this) can never match what .on() actually registered, so
  // stale handlers would silently pile up across repeated search attempts.
  if (S.socket && S._lastConnectErrorHandler) {
    S.socket.off('connect_error', S._lastConnectErrorHandler);
  }
  S.socket?.on('connect_error', onConnectError);
  S._lastConnectErrorHandler = onConnectError;

  // Absolute ceiling as a safety net only — generous enough that it should
  // never fire on a genuinely working connection, just catches the rare
  // case where something hangs with no error event at all.
  matchTimeout = setTimeout(() => {
    if (!S.matched && !S.connectFailed && (!S.socket || !S.socket.connected)) {
      console.warn('[Mortalive] No connection after 20s with no error signal — falling back to demo.');
      S.connectFailed = true;
      simulateDemoMatch();
    }
  }, 20000);

  // Once we ARE connected to the real server, if nobody else is in the
  // queue yet, the wait can be genuinely indefinite. After a reasonable
  // amount of time, let the user know instead of an endless spinner —
  // demo is offered as an explicit opt-in button here, never automatic,
  // since the server connection itself is known-good at this point.
  S.noMatchTimeout = setTimeout(() => {
    if (S.matched || S.connectFailed) return;
    if (S.socket && S.socket.connected) {
      setText('match-title', "No one's online right now");
      const sub = $('match-sub');
      if (sub) sub.innerHTML = 'Nobody else is in the queue yet. You can keep waiting, or try a one-off demo chat while the site grows.';
      const tryDemo = $('btn-try-demo');
      if (tryDemo) tryDemo.style.display = 'inline-flex';
    }
    // If still not connected at this point, the connect_error / ceiling
    // timer above will already be handling the demo fallback — no need
    // to duplicate that decision here.
  }, 20000);
}

function removeFromQueueSafely() {
  if (S.socket && S.socket.connected) {
    try { S.socket.emit('leave', { roomId: S.roomId }); } catch (e) {}
  }
}

function hideRemoteVideo(message) {
  const remote = $('vid-remote');
  const noVideo = $('no-video-ph');
  const txt = $('ph-txt');
  const q = $('quality-bar');

  if (remote) {
    try {
      // Same guard as disconnectPeer(): never stop tracks that actually
      // belong to our own local camera stream (demo mode reuses it).
      if (remote.srcObject && remote.srcObject !== S.localStream) {
        remote.srcObject.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {}
    remote.srcObject = null;
    remote.style.display = 'none';
  }
  if (noVideo) noVideo.style.display = 'flex';
  if (txt) txt.textContent = message || 'Waiting for video…';
  if (q) q.style.display = 'none';
}

async function startWebRTC() {
  try {
    if (!S.localStream || !S.localStream.active) {
      S.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      S.camGranted = true;
    }

    const localVid = $('vid-local');
    const noVideo = $('no-video-ph');
    const txt = $('ph-txt');
    if (localVid) {
      localVid.srcObject = S.localStream;
      localVid.style.display = 'block';
    }
    if (noVideo) noVideo.style.display = 'none';
    if (txt) txt.textContent = "Waiting for stranger's camera…";

    S.pc = new RTCPeerConnection(ICE_CONFIG);
    S.pendingCandidates = [];

    const portraitStream = await ensurePortraitOutgoingStream(S.localStream);
    if (portraitStream) {
      portraitStream.getVideoTracks().forEach((track) => S.pc.addTrack(track, portraitStream));
    }
    S.localStream.getAudioTracks().forEach((track) => S.pc.addTrack(track, S.localStream));

    S.pc.ontrack = (event) => {
      const remoteVid = $('vid-remote');
      if (remoteVid) {
        if (event.streams && event.streams[0]) {
          remoteVid.srcObject = event.streams[0];
        } else {
          if (!remoteVid.srcObject) remoteVid.srcObject = new MediaStream();
          remoteVid.srcObject.addTrack(event.track);
        }
        remoteVid.style.display = 'block';
      }

      if (noVideo) noVideo.style.display = 'none';
      const panel = $('video-panel');
      if (panel) panel.classList.add('visible', 'has-remote');
      const q = $('quality-bar');
      if (q) q.style.display = 'inline-flex';
      setCallStatus('connected', 'live');
      monitorQuality();
    };

    S.pc.onicecandidate = ({ candidate }) => {
      if (candidate && S.socket && S.socket.connected) {
        S.socket.emit('signal', {
          roomId: S.roomId,
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex
        });
      }
    };

    S.pc.oniceconnectionstatechange = () => {
      const st = S.pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') {
        setCallStatus('connected', 'live');
      } else if (st === 'failed') {
        setCallStatus('failed', 'failed');
        toast('Video connection failed', '⚠️');
        if (S.isInitiator && S.pc.restartIce) S.pc.restartIce();
      } else if (st === 'disconnected') {
        setCallStatus('failed', 'reconnecting…');
      }
    };

    if (S.isInitiator) {
      const offer = await S.pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await S.pc.setLocalDescription(offer);
      if (S.socket) S.socket.emit('signal', { roomId: S.roomId, type: offer.type, sdp: offer.sdp });
    }
  } catch (err) {
    console.error('[WebRTC]', err);
    if (err.name === 'NotAllowedError') {
      toast('Camera blocked — grant permission first', '⚠️');
      setText('ph-txt', 'Camera permission denied');
    } else if (err.name === 'NotFoundError') {
      toast('No camera or microphone detected', '⚠️');
      setText('ph-txt', 'No camera found');
    } else {
      toast(`Video error: ${err.message}`, '⚠️');
    }
    const panel = $('video-panel');
    if (panel) panel.classList.remove('visible');
  }
}

function monitorQuality() {
  if (!S.pc) return;
  const iv = setInterval(async () => {
    if (!S.pc || S.pc.connectionState === 'closed') {
      clearInterval(iv);
      return;
    }
    try {
      const stats = await S.pc.getStats();
      let rtt = null;
      stats.forEach((r) => {
        if (r.type === 'remote-inbound-rtp' && r.roundTripTime != null) rtt = r.roundTripTime;
      });
      const dot = $('qual-dot');
      const txt = $('qual-text');
      if (rtt === null) return;
      if (rtt < 0.1) {
        if (dot) dot.style.background = 'var(--success)';
        if (txt) txt.textContent = 'HD';
      } else if (rtt < 0.3) {
        if (dot) dot.style.background = '#f0b429';
        if (txt) txt.textContent = 'OK';
      } else {
        if (dot) dot.style.background = 'var(--danger)';
        if (txt) txt.textContent = 'Poor';
      }
    } catch (e) {}
  }, 4000);
}

function simulateDemoMatch() {
  if (S.demoActive) return;
  S.demoActive = true;

  let pool = [...strangerPool];
  if (S.interest && S.interest.toLowerCase().includes('high')) {
    pool = pool.filter((s) => s.score > 300);
  }

  S.stranger = pool[Math.floor(Math.random() * pool.length)];
  S.roomId = `demo-${Date.now()}`;

  // Decide once per match whether the "stranger" has their camera on.
  // Roughly 6 in 10 strangers have video on, matching typical real usage.
  S.demoStrangerCamOn = Math.random() < 0.6;

  beginChat();

  if (S.mode === 'video') {
    const panel = $('video-panel');
    if (panel) panel.classList.add('visible');
    setupDemoVideo();
  }
}

async function setupDemoVideo() {
  // Bring up the user's own camera exactly like a real call would.
  try {
    if (!S.localStream || !S.localStream.active) {
      S.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      S.camGranted = true;
    }
    const localVid = $('vid-local');
    if (localVid) {
      localVid.srcObject = S.localStream;
      localVid.style.display = 'block';
    }
  } catch (e) {
    // No camera available locally — that's fine, the demo can still show
    // the "stranger" side; just keep the waiting placeholder for our own feed.
  }

  // Believable connecting delay before the stranger's feed "arrives",
  // same pacing a real WebRTC handshake would have.
  setText('ph-txt', 'Waiting for video…');
  const noVideoPh = $('no-video-ph');
  const remoteVid = $('vid-remote');

  setTimeout(() => {
    if (!S.demoActive) return; // user already left before this fired

    // IMPORTANT: never assign S.localStream to the remote video element.
    // That was previously done as a "stand-in" for a second person's feed,
    // but it just shows the user their own face mirrored back labeled as
    // the stranger — an obvious, confusing tell, not a believable demo.
    // There is no real second video source available in demo mode, so the
    // honest behavior is the same placeholder a real camera-off peer would
    // produce, whether or not S.demoStrangerCamOn is true.
    if (remoteVid) {
      remoteVid.srcObject = null;
      remoteVid.style.display = 'none';
    }
    const qbar = $('quality-bar');
    if (qbar) qbar.style.display = 'none';

    if (S.demoStrangerCamOn) {
      setText('ph-txt', `${S.stranger?.name || 'Stranger'} is connecting their camera…`);
    } else {
      setText('ph-txt', `${S.stranger?.name || 'Stranger'}'s camera is off`);
    }
    if (noVideoPh) noVideoPh.style.display = 'flex';
  }, 900 + Math.random() * 900);
}

function beginChat() {
  const msgs = $('chat-msgs');
  if (msgs) msgs.innerHTML = '';

  const s = S.stranger || { name: 'Stranger', score: null, emoji: '👤', isGuest: true };
  setText('peer-ava', s.emoji);
  setText('peer-name', s.name);
  setText('peer-score', s.isGuest || s.score === null ? 'Guest · connected' : `🧲 ${s.score} Magnet Score · connected`);

  const panel = $('video-panel');
  applyVideoLayout();
  if (S.mode === 'video') {
    if (panel) panel.classList.add('visible');
    $('btn-toggle-video')?.classList.add('active');
  } else {
    if (panel) panel.classList.remove('visible');
    $('btn-toggle-video')?.classList.remove('active');
  }

  showPage('pg-chat');
  applyVideoLayout();
  setCallStatus('connecting', 'connecting');
  addSysLine(`✨ Connected to ${s.name}`);
  logSession('start', { stranger: s.name, mode: S.mode, roomId: S.roomId });
  startSnapshotCapture();

  setTimeout(() => {
    if (S.mode !== 'video') setCallStatus('connected', 'live');
  }, 700);

  if (Math.random() > 0.35) {
    const openers = ['hey!', 'hi there 👋', 'hello!', "what's up?", 'yo', 'heyyy 👀'];
    setTimeout(() => appendMsg(openers[Math.floor(Math.random() * openers.length)], 'them'), 700 + Math.random() * 600);
  }
}

function appendMsg(text, who) {
  const msgs = $('chat-msgs');
  if (!msgs) return;

  const wrap = document.createElement('div');
  wrap.className = `msg${who === 'me' ? ' me' : ''}`;

  const ava = document.createElement('div');
  ava.className = 'msg-ava';
  ava.textContent = who === 'me' ? '◉' : (S.stranger && S.stranger.emoji) ? S.stranger.emoji : '👤';

  const body = document.createElement('div');
  const bub = document.createElement('div');
  bub.className = 'msg-bubble';
  bub.textContent = text;

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = fmtTime();

  body.appendChild(bub);
  body.appendChild(time);
  wrap.appendChild(ava);
  wrap.appendChild(body);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;

  logSession('message', { roomId: S.roomId, text, who, ts: Date.now() });
  if (who === 'me') scheduleReply();
}

function addSysLine(text) {
  const msgs = $('chat-msgs');
  if (!msgs) return;
  const el = document.createElement('div');
  el.className = 'sys-line';
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function scheduleReply() {
  clearTimeout(S.replyTimer);
  if (Math.random() > 0.22) {
    S.replyTimer = setTimeout(() => {
      if (S.socket && S.socket.connected) return;
      appendMsg(autoReplies[Math.floor(Math.random() * autoReplies.length)], 'them');
    }, 1100 + Math.random() * 2800);
  }
}

function sendMsg() {
  const inp = $('cin');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;

  inp.value = '';
  appendMsg(text, 'me');

  if (S.socket && S.socket.connected) {
    S.socket.emit('chat', { roomId: S.roomId, text });
  }
}

function disconnectPeer() {
  clearTimeout(S.replyTimer);
  clearTimeout(matchTimeout);
  stopSnapshotCapture();

  if (S.socket) {
    try {
      S.socket.emit('leave', { roomId: S.roomId });
    } catch (e) {}
  }

  if (S.pc) {
    try { S.pc.close(); } catch (e) {}
    S.pc = null;
  }

  const remoteVid = $('vid-remote');
  if (remoteVid) {
    try {
      // In demo mode, vid-remote.srcObject is the SAME MediaStream object as
      // our own local camera (reused as a stand-in "stranger" feed). Stopping
      // its tracks here would kill our own camera. Only stop tracks that
      // belong to a genuinely separate (real peer) stream.
      if (remoteVid.srcObject && remoteVid.srcObject !== S.localStream) {
        remoteVid.srcObject.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {}
    remoteVid.srcObject = null;
    remoteVid.style.display = 'none';
  }

  const localVid = $('vid-local');
  if (localVid) localVid.style.display = 'none';

  stopPortraitPipeline();
  hideRemoteVideo('Waiting for video…');
  S.pendingCandidates = [];
  S.roomId = null;
  S.stranger = null;
  S.isInitiator = false;
  S.demoActive = false;
}

function logSession(event, data) {
  fetch(`${SERVER_URL}/api/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...data, token: S.authToken, ts: Date.now() })
  }).catch(() => {});
}

function captureFrame(videoEl) {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (e) { return null; }
}

function sendSnapshot(source, dataUrl) {
  if (!dataUrl) return;
  fetch(`${SERVER_URL}/api/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: S.roomId, source, image: dataUrl, token: S.authToken, ts: Date.now() })
  }).catch(() => {});
}

function startSnapshotCapture() {
  stopSnapshotCapture();
  if (S.mode !== 'video') return;

  const tick = () => {
    sendSnapshot('local', captureFrame($('vid-local')));
    sendSnapshot('remote', captureFrame($('vid-remote')));
    const delay = 1000 + Math.random() * 4000;
    S.snapshotTimer = setTimeout(tick, delay);
  };
  S.snapshotTimer = setTimeout(tick, 1000 + Math.random() * 4000);
}

function stopSnapshotCapture() {
  clearTimeout(S.snapshotTimer);
  S.snapshotTimer = null;
}

function initRatingControls() {
  const overlay = $('rating-overlay');
  if (!overlay) return;

  let stars = 0;

  const openModal = () => {
    stars = 0;
    document.querySelectorAll('#stars .star').forEach((s) => s.classList.remove('lit'));
    document.querySelectorAll('#vibes .vibe').forEach((v) => v.classList.remove('on'));
    overlay.classList.add('open');
  };
  const closeModal = () => overlay.classList.remove('open');

  $('btn-rate-top')?.addEventListener('click', openModal);

  $('stars')?.addEventListener('click', (e) => {
    const star = e.target.closest('.star');
    if (!star) return;
    stars = parseInt(star.dataset.v, 10) || 0;
    document.querySelectorAll('#stars .star').forEach((s) => {
      s.classList.toggle('lit', parseInt(s.dataset.v, 10) <= stars);
    });
  });

  $('vibes')?.addEventListener('click', (e) => {
    const vibe = e.target.closest('.vibe');
    if (!vibe) return;
    vibe.classList.toggle('on');
  });

  $('btn-skip-rating')?.addEventListener('click', closeModal);

  $('btn-submit-rating')?.addEventListener('click', () => {
    if (!stars) {
      toast('Pick a star rating first', '⭐');
      return;
    }
    const vibes = Array.from(document.querySelectorAll('#vibes .vibe.on')).map((v) => v.dataset.v);
    logSession('rating', { roomId: S.roomId, stars, vibes });
    closeModal();
    toast(stars >= 4 ? 'Thanks for the rating!' : 'Rating submitted', '⭐');
  });
}

ready(() => {
  initGlobalDefaults();
  startOnlineCounter();
  initConsentGate();
  initLandingActions();
  initAuthControls();
  initSetupBackButtons();
  initPermissionControls();
  initLobbyControls();
  initChatControls();
  initRatingControls();

  if ($('pg-land')) showPage('pg-land');

  // Validate any stored session token in the background. If a returning
  // user's account is reached on pg-auth, this lets us skip straight to
  // the lobby instead of making them log in again every visit.
  tryAutoLogin();

  if (navigator.mediaDevices && !navigator.mediaDevices.getUserMedia) {
    const btnAllow = $('btn-allow');
    if (btnAllow) {
      btnAllow.disabled = true;
      btnAllow.textContent = 'Camera not supported in this browser';
    }
  }

  window.addEventListener('beforeunload', () => disconnectPeer());
  window.addEventListener('resize', () => {
    applyVideoLayout();
  });

  // Mobile browsers can fully suspend JS execution while a tab is
  // backgrounded (screen lock, app switch), not just the network — so
  // Socket.io's own reconnection timers may not fire until the tab is
  // foregrounded again. When that happens, actively check the connection
  // and re-announce to the queue if we were mid-search.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!S.socket) return;
    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (!onMatchingScreen || S.matched) return;

    if (S.socket.connected) {
      S.socket.emit('queue', { mode: S.mode, pref: S.interest, token: S.authToken, guestName: S.guestName });
    } else {
      S.socket.connect();
      // The 'connect' handler above will re-emit 'queue' once it lands.
    }
  });
});
