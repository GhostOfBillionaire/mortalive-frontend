/* Mortalive — clean frontend app
   Real matching only. No demo fallback. */

const BUILD_TAG = 'mortalive-clean-2026-06-18-2';

const SERVER_URL =
  window.MORTALIVE_SERVER_URL ||
  (location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : location.origin);

console.log(`[Mortalive] ${BUILD_TAG} loaded`);
console.log(`[Mortalive] SERVER_URL = ${SERVER_URL}`);

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
  mode: 'text',
  interest: '',
  roomId: null,
  stranger: null,
  socket: null,
  pc: null,
  localStream: null,
  isInitiator: false,
  pendingCandidates: [],
  camGranted: false,
  micMuted: false,
  camOff: false,
  onlineCount: 2847,
  onlineTimerStarted: false,
  pendingAction: null,
  replyTimer: null,
  searchId: 0,
  matchTimeout: null,
  noMatchTimer: null,
  matched: false,
  connectionReady: false
};

const AI_OPENERS = [
  'hey — I’m here if you want to chat',
  'hello 👋 what are you into lately?',
  'hi, I can keep you company for a bit',
  'what’s up? tell me something random',
  'I’m listening — start anywhere',
  'hey, how’s your day going?'
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

function setActiveMode(mode) {
  S.mode = mode === 'video' ? 'video' : 'text';
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === S.mode);
  });
}

function setPrimaryButtonsEnabled(enabled) {
  const ids = ['btn-enter'];
  ids.forEach((id) => {
    const btn = $(id);
    if (btn) {
      btn.disabled = !enabled;
      btn.classList.toggle('ready', enabled);
    }
  });
}

function updateConsentState() {
  const terms = $('landing-consent') || $('terms') || $('terms-checkbox');
  if (terms) {
    setPrimaryButtonsEnabled(!!terms.checked);
    return;
  }
  const legacy = ['c1', 'c2', 'c3'].map((id) => $(id)).filter(Boolean);
  if (legacy.length === 3) {
    const all = legacy.every((box) => box.classList.contains('on'));
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

  // Legacy fallback for older landing page variants.
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

function closePeerConnection() {
  if (S.pc) {
    try { S.pc.close(); } catch (e) {}
    S.pc = null;
  }

  const remoteVid = $('vid-remote');
  if (remoteVid) {
    try {
      if (remoteVid.srcObject && remoteVid.srcObject !== S.localStream) {
        remoteVid.srcObject.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {}
    remoteVid.srcObject = null;
    remoteVid.style.display = 'none';
  }

  const localVid = $('vid-local');
  if (localVid) localVid.style.display = 'none';

  const noVideo = $('no-video-ph');
  if (noVideo) noVideo.style.display = 'flex';

  const quality = $('quality-bar');
  if (quality) quality.style.display = 'none';

  const phTxt = $('ph-txt');
  if (phTxt) phTxt.textContent = 'Waiting for video…';

  S.pendingCandidates = [];
  S.camOff = false;
  S.micMuted = false;

  const micBtn = $('vc-mic');
  if (micBtn) {
    micBtn.textContent = '🎤';
    micBtn.classList.remove('off');
  }
  const camBtn = $('vc-cam');
  if (camBtn) {
    camBtn.textContent = '📷';
    camBtn.classList.remove('off');
  }
}

function cleanupSocket({ leaveRoom = false } = {}) {
  if (!S.socket) return;

  if (leaveRoom && S.roomId && S.socket.connected) {
    try { S.socket.emit('leave', { roomId: S.roomId }); } catch (e) {}
  }

  try { S.socket.off(); } catch (e) {}
  try { S.socket.disconnect(); } catch (e) {}
  S.socket = null;
  S.connectionReady = false;
}

function resetSession({ leaveRoom = false } = {}) {
  clearTimeout(S.replyTimer);
  clearTimeout(S.matchTimeout);
  clearTimeout(S.noMatchTimer);

  if (leaveRoom && S.roomId) {
    try {
      if (S.socket && S.socket.connected) S.socket.emit('leave', { roomId: S.roomId });
    } catch (e) {}
  }

  closePeerConnection();
  cleanupSocket({ leaveRoom: false });

  S.roomId = null;
  S.stranger = null;
  S.isInitiator = false;
  S.pendingCandidates = [];
  S.matched = false;
}

async function requestCameraPermission() {
  const btn = $('btn-allow');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Waiting for browser permission…';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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

    if (S.pendingAction === 'match') {
      S.pendingAction = null;
      enterLobby();
      setTimeout(() => startMatching(), 250);
      return;
    }

    enterLobby();
  } catch (err) {
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
  }
}

function enterLobby() {
  if (!S.camGranted) S.mode = 'text';
  setActiveMode(S.mode);
  showPage('pg-lobby');
  ensureLobbyCameraPreview();
}

function initLandingControls() {
  const btn = $('btn-enter');
  if (btn) {
    btn.addEventListener('click', () => {
      startOnlineCounter();
      showPage('pg-perm');
    });
  }
}

function initPermissionControls() {
  const btnAllow = $('btn-allow');
  if (btnAllow) btnAllow.addEventListener('click', requestCameraPermission);

  const btnSkipCam = $('btn-skip-cam');
  if (btnSkipCam) {
    btnSkipCam.addEventListener('click', () => {
      S.camGranted = false;
      S.pendingAction = null;
      S.mode = 'text';
      setActiveMode('text');
      enterLobby();
    });
  }
}

function initLobbyControls() {
  const modeToggle = $('mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      const newMode = btn.dataset.mode || 'text';

      if (newMode === 'video' && !S.camGranted) {
        S.mode = 'video';
        S.pendingAction = 'match';
        showPage('pg-perm');
        toast('Allow camera first for video chat', '📹');
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

  const scoreBtn = $('score-pill-btn');
  const sheetOverlay = $('sheet-overlay');
  if (scoreBtn && sheetOverlay) {
    scoreBtn.addEventListener('click', () => sheetOverlay.classList.add('open'));
    sheetOverlay.addEventListener('click', (e) => {
      if (e.target === sheetOverlay) sheetOverlay.classList.remove('open');
    });
  }
}

function initMatchControls() {
  const btnCancel = $('btn-cancel');
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      clearTimeout(S.matchTimeout);
      clearTimeout(S.noMatchTimer);
      resetSession({ leaveRoom: true });
      enterLobby();
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
    resetSession({ leaveRoom: true });
    addSysLine('↩ Skipping — searching next match…');
    startMatching();
  });

  $('btn-end')?.addEventListener('click', () => {
    clearTimeout(S.replyTimer);
    logSession('end', { reason: 'ended', roomId: S.roomId });
    resetSession({ leaveRoom: true });
    openRating();
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
    enterLobby();
  });
}

function initGlobalDefaults() {
  setActiveMode(S.mode);
  updateOnlineCount();
  setPrimaryButtonsEnabled(false);
  if (!$('landing-consent') && !$('terms') && !$('terms-checkbox') && !$('c1') && !$('c2') && !$('c3')) {
    setPrimaryButtonsEnabled(true);
  }
}

function initSocket(searchId) {
  if (typeof io === 'undefined') {
    console.error('[Mortalive] Socket.io is not available.');
    setCallStatus('failed', 'realtime unavailable');
    toast('Realtime connection is not loaded', '⚠️');
    return;
  }

  const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    timeout: 10000,
    reconnection: true,
    reconnectionAttempts: 3,
    reconnectionDelay: 500
  });

  S.socket = socket;
  S.connectionReady = false;

  socket.on('connect', () => {
    if (searchId !== S.searchId) return;
    S.connectionReady = true;
    socket.emit('queue', { mode: S.mode, pref: S.interest });
    setCallStatus('connecting', 'Waiting for someone…');
  });

  socket.on('matched', async (data) => {
    if (searchId !== S.searchId) return;
    clearTimeout(S.matchTimeout);
    clearTimeout(S.noMatchTimer);
    S.matched = true;
    S.roomId = data.roomId;
    S.isInitiator = !!data.initiator;
    S.stranger = {
      name: (data.peer && data.peer.name) || 'Stranger',
      score: (data.peer && data.peer.score) || 0,
      emoji: (data.peer && data.peer.emoji) || '👤'
    };
    beginChat();
    if (S.mode === 'video') {
      await startWebRTC();
    }
  });

  socket.on('signal', async (data) => {
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
        socket.emit('signal', { roomId: S.roomId, type: answer.type, sdp: answer.sdp });
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

  socket.on('peer-chat', ({ text }) => appendMsg(text, 'them'));

  socket.on('peer-disconnected', () => {
    addSysLine('👋 Stranger disconnected');
    setCallStatus('failed', 'disconnected');
    const txt = $('ph-txt');
    if (txt) txt.textContent = 'Stranger disconnected';
    closePeerConnection();
  });

  socket.on('disconnect', () => {
    if (searchId !== S.searchId) return;
    if (!S.matched) setCallStatus('failed', 'reconnecting…');
  });

  socket.on('connect_error', (err) => {
    if (searchId !== S.searchId) return;
    console.log('[Socket] connect_error:', err.message);
    setCallStatus('failed', 'reconnecting…');
  });
}

function startMatching() {
  const searchId = ++S.searchId;

  clearTimeout(S.matchTimeout);
  clearTimeout(S.noMatchTimer);

  resetSession({ leaveRoom: true });

  showPage('pg-match');
  updateOnlineCount();
  setCallStatus('connecting', 'Searching…');
  setText('match-title', 'Finding your match');
  const subReset = $('match-sub');
  if (subReset) subReset.innerHTML = 'Scanning <strong id="match-count">' + S.onlineCount.toLocaleString() + '</strong> people online right now.';

  initSocket(searchId);

  S.matchTimeout = setTimeout(() => {
    if (searchId !== S.searchId) return;
    if (!S.socket || !S.socket.connected) {
      setText('match-title', 'Connecting to the server…');
      const sub = $('match-sub');
      if (sub) sub.textContent = 'Hang on while the connection comes up.';
    }
  }, 7000);

  S.noMatchTimer = setTimeout(() => {
    if (searchId !== S.searchId || S.matched) return;
    if (S.socket && S.socket.connected) {
      setText('match-title', 'Still searching…');
      const sub = $('match-sub');
      if (sub) sub.textContent = 'You are connected to the server. Waiting for another person to join the queue.';
    }
  }, 20000);
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

    S.localStream.getTracks().forEach((track) => S.pc.addTrack(track, S.localStream));

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
      if (S.socket && S.socket.connected) {
        S.socket.emit('signal', { roomId: S.roomId, type: offer.type, sdp: offer.sdp });
      }
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

function beginChat() {
  const msgs = $('chat-msgs');
  if (msgs) msgs.innerHTML = '';

  const s = S.stranger || { name: 'Stranger', score: 0, emoji: '👤' };
  setText('peer-ava', s.emoji);
  setText('peer-name', s.name);
  setText('peer-score', 'Anonymous chat · connected');

  const panel = $('video-panel');
  if (S.mode === 'video') {
    if (panel) panel.classList.add('visible');
    $('btn-toggle-video')?.classList.add('active');
  } else {
    if (panel) panel.classList.remove('visible');
    $('btn-toggle-video')?.classList.remove('active');
  }

  showPage('pg-chat');
  setCallStatus('connecting', 'connecting');
  addSysLine(`✨ Connected to ${s.name}`);
  logSession('start', { stranger: s.name, mode: S.mode, roomId: S.roomId });

  setTimeout(() => {
    if (S.mode !== 'video') setCallStatus('connected', 'live');
  }, 700);

  if (Math.random() > 0.35) {
    setTimeout(() => appendMsg(AI_OPENERS[Math.floor(Math.random() * AI_OPENERS.length)], 'them'),
      700 + Math.random() * 600);
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

function sendMsg() {
  const inp = $('cin');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  appendMsg(text, 'me');
  if (S.socket && S.socket.connected) {
    S.socket.emit('chat', { roomId: S.roomId, text });
  } else {
    toast('Still connecting to the chat server', '⚠️');
  }
}

function openRating() {
  const overlay = $('rating-overlay');
  if (!overlay) return;
  document.querySelectorAll('.star').forEach((s) => s.classList.remove('lit'));
  document.querySelectorAll('.vibe').forEach((v) => v.classList.remove('on'));
  overlay.classList.add('open');
}

function initBeforeUnload() {
  window.addEventListener('beforeunload', () => {
    try {
      if (S.socket && S.socket.connected && S.roomId) {
        S.socket.emit('leave', { roomId: S.roomId });
      }
    } catch (e) {}
    cleanupSocket({ leaveRoom: false });
    closePeerConnection();
  });
}

ready(() => {
  initGlobalDefaults();
  startOnlineCounter();
  initConsentGate();
  initLandingControls();
  initPermissionControls();
  initLobbyControls();
  initMatchControls();
  initChatControls();
  initRatingControls();
  initBeforeUnload();

  if ($('pg-land')) showPage('pg-land');

  if (navigator.mediaDevices && !navigator.mediaDevices.getUserMedia) {
    const btnAllow = $('btn-allow');
    if (btnAllow) {
      btnAllow.disabled = true;
      btnAllow.textContent = 'Camera not supported in this browser';
    }
  }
});
