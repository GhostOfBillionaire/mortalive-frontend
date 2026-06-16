/* ════════════════════════════════════════════════════════
   MORTALIVE — Frontend App
   WebRTC video, Socket.io signaling, chat, rating, score
════════════════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://mortalive-server-production.up.railway.app/'; // ← update after deploy

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// ── STATE ────────────────────────────────────────────────
const S = {
  myScore: 142, myRank: 1204,
  mode: 'text',   // 'text' | 'video'
  pref: 'any',
  stranger: null, roomId: null,
  starRating: 0,  vibes: [],
  onlineCount: 2847,
  micMuted: false, camOff: false,
  camGranted: false,  // true once getUserMedia succeeds
  // WebRTC
  pc: null, localStream: null, socket: null, isInitiator: false,
  pendingCandidates: [], // buffer ICE while remote not set
};

const strangerPool = [
  { name: "Nova_82",     score: 310, emoji: "🦊" },
  { name: "Theorist_X",  score: 520, emoji: "🎭" },
  { name: "Mira_Glow",   score: 88,  emoji: "🌸" },
  { name: "Static_J",    score: 205, emoji: "⚡" },
  { name: "DuskRider",   score: 445, emoji: "🌙" },
  { name: "Cipher_9",    score: 731, emoji: "🔮" },
  { name: "SunKid",      score: 62,  emoji: "☀️" },
  { name: "Nox_V",       score: 890, emoji: "🖤" },
];

const lbData = [
  { name: "Cipher_9",    score: 890, emoji: "🔮", trend: "↑" },
  { name: "Nox_V",       score: 845, emoji: "🖤", trend: "→" },
  { name: "StellarMike", score: 712, emoji: "🌟", trend: "↑" },
  { name: "DuskRider",   score: 445, emoji: "🌙", trend: "↓" },
  { name: "Static_J",    score: 398, emoji: "⚡", trend: "↑" },
  { name: "Nova_82",     score: 310, emoji: "🦊", trend: "→" },
  { name: "Theorist_X",  score: 271, emoji: "🎭", trend: "↑" },
  { name: "YOU",         score: 142, emoji: "💀", trend: "→", isMe: true },
];

const autoReplies = [
  "haha fr though 😂", "okay that's actually a good point", "wait what do you do?",
  "tbh I've been thinking about that too", "lmao no way", "that's lowkey wild",
  "okay so hear me out…", "depends on what you mean", "I feel like most people don't realize",
  "nah I disagree but I respect it", "go on…", "that reminds me of something",
  "honestly same", "ooh controversial 👀", "solid point ngl", "wait explain that more",
  "no way lol", "that's actually kinda scary", "based", "wait are you serious?",
];

// ── HELPERS ──────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function toast(msg, icon = '✅') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon} ${msg}`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 2400);
  setTimeout(() => el.remove(), 2700);
}

function fmtTime() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function setCallStatus(state, label) {
  ['conn-dot','call-dot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'cbd ' + state;
  });
  ['conn-text','call-text'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
}

// ── LANDING ──────────────────────────────────────────────
const checks = { c1: false, c2: false, c3: false };

['c1','c2','c3'].forEach(id => {
  const box = document.getElementById(id);
  box.closest('.chk-row').addEventListener('click', () => {
    checks[id] = !checks[id];
    box.classList.toggle('on', checks[id]);
    const all = Object.values(checks).every(Boolean);
    const btn = document.getElementById('btn-enter');
    btn.disabled = !all;
    btn.classList.toggle('ready', all);
  });
});

document.getElementById('btn-enter').addEventListener('click', () => {
  renderLeaderboard();
  startOnlineCounter();
  // Go to camera permission page first
  showPage('pg-perm');
});

// ── CAMERA PERMISSION PAGE ───────────────────────────────
// This page explicitly triggers the browser's camera/mic permission prompt.

const permVideo  = document.getElementById('perm-video');
const permOverlay = document.getElementById('perm-overlay');
const permDot    = document.getElementById('perm-dot');
const permStsTxt = document.getElementById('perm-status-txt');
const camLbl     = document.getElementById('cam-status-lbl');
const micLbl     = document.getElementById('mic-status-lbl');

document.getElementById('btn-allow').addEventListener('click', requestCameraPermission);

async function requestCameraPermission() {
  const btn = document.getElementById('btn-allow');
  btn.disabled = true;
  btn.textContent = '⏳ Waiting for browser permission…';

  try {
    // This line is what triggers the browser's Allow/Block popup
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    // Success — show live preview
    S.localStream = stream;
    S.camGranted  = true;
    permVideo.srcObject = stream;
    permOverlay.style.display = 'none';

    // Update status dots
    permDot.className   = 'perm-dot ok';
    permStsTxt.textContent = 'Camera & mic active';
    camLbl.textContent  = 'granted';
    camLbl.className    = 'perm-row-status ok';
    micLbl.textContent  = 'granted';
    micLbl.className    = 'perm-row-status ok';

    btn.textContent = '✓ Permissions granted — Continue →';
    btn.disabled = false;
    btn.style.background = 'linear-gradient(135deg, #16a34a, #22d3a2)';

    // Also wire up lobby camera preview
    const lobbyPreview = document.getElementById('lobby-cam-preview');
    lobbyPreview.srcObject = stream;
    document.getElementById('cam-strip').classList.add('visible');

    // Auto-advance after a short delay
    setTimeout(() => enterLobby(), 1200);

  } catch (err) {
    console.warn('[Camera]', err.name, err.message);
    permDot.className   = 'perm-dot denied';
    permStsTxt.textContent = 'Permission denied';
    btn.disabled = false;

    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      camLbl.textContent = 'denied'; camLbl.className = 'perm-row-status denied';
      micLbl.textContent = 'denied'; micLbl.className = 'perm-row-status denied';
      btn.textContent = '🔁 Try again';
      document.getElementById('perm-overlay-txt').textContent = 'Permission was denied. Click the camera icon in your address bar to allow, then try again.';
      toast('Camera blocked — check your browser settings', '⚠️');
    } else if (err.name === 'NotFoundError') {
      camLbl.textContent = 'no device'; camLbl.className = 'perm-row-status denied';
      micLbl.textContent = 'no device'; micLbl.className = 'perm-row-status denied';
      btn.textContent = '📹 No camera found — continue to text';
      toast('No camera detected — text only mode', '⚠️');
      setTimeout(() => enterLobby(), 1000);
    } else {
      btn.textContent = '🔁 Retry';
      toast('Could not access camera: ' + err.message, '⚠️');
    }
  }
}

document.getElementById('btn-skip-cam').addEventListener('click', () => {
  S.camGranted = false;
  S.mode = 'text';
  enterLobby();
});

function enterLobby() {
  // Set mode toggle based on camera state
  if (!S.camGranted) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-mode="text"]').classList.add('active');
    S.mode = 'text';
  }
  showPage('pg-lobby');
}

// ── LOBBY ────────────────────────────────────────────────
function startOnlineCounter() {
  const el = document.getElementById('online-n');
  setInterval(() => {
    S.onlineCount += Math.floor(Math.random() * 22) - 11;
    S.onlineCount = Math.max(1500, Math.min(6000, S.onlineCount));
    el.textContent = S.onlineCount.toLocaleString();
  }, 3500);
}

document.getElementById('score-pill-btn').addEventListener('click', () => {
  updateScoreSheet();
  document.getElementById('sheet-overlay').classList.add('open');
});
document.getElementById('sheet-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('sheet-overlay'))
    document.getElementById('sheet-overlay').classList.remove('open');
});

// Mode toggle — if no camera and user tries video, go to permission page
document.getElementById('mode-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  const newMode = btn.dataset.mode;

  if (newMode === 'video' && !S.camGranted) {
    // Redirect to permission page
    showPage('pg-perm');
    toast('Grant camera access to use video mode', '📹');
    return;
  }

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.mode = newMode;
});

document.getElementById('chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  chip.classList.add('on');
  S.pref = chip.dataset.v;
});

document.getElementById('btn-find').addEventListener('click', startMatching);

// ── MATCHING ─────────────────────────────────────────────
let matchTimeout;

function startMatching() {
  showPage('pg-match');
  document.getElementById('match-count').textContent = S.onlineCount.toLocaleString();
  setCallStatus('connecting', 'Searching…');

  initSocket();

  // Demo fallback if no server
  matchTimeout = setTimeout(() => {
    if (!S.socket || !S.socket.connected) simulateDemoMatch();
  }, 1800 + Math.random() * 1800);
}

document.getElementById('btn-cancel').addEventListener('click', () => {
  clearTimeout(matchTimeout);
  disconnectPeer();
  showPage('pg-lobby');
});

// ── SOCKET.IO ────────────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') {
    console.log('[Mortalive] Socket.io not loaded — demo mode');
    return;
  }
  // Don't open duplicate socket
  if (S.socket && S.socket.connected) {
    S.socket.emit('queue', { mode: S.mode, pref: S.pref });
    return;
  }

  S.socket = io(SERVER_URL, { transports: ['websocket','polling'], timeout: 6000 });

  S.socket.on('connect', () => {
    console.log('[Socket] Connected:', S.socket.id);
    S.socket.emit('queue', { mode: S.mode, pref: S.pref });
  });

  S.socket.on('matched', async (data) => {
    clearTimeout(matchTimeout);
    S.roomId      = data.roomId;
    S.isInitiator = data.initiator;
    S.stranger    = {
      name:  data.peer.name  || 'Stranger',
      score: data.peer.score || 0,
      emoji: data.peer.emoji || '👤'
    };
    beginChat();
    if (S.mode === 'video') await startWebRTC();
  });

  S.socket.on('signal', async (data) => {
    if (!S.pc) return;
    try {
      if (data.type === 'offer') {
        await S.pc.setRemoteDescription(new RTCSessionDescription(data));
        // Flush buffered ICE candidates
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
          S.pendingCandidates.push(data); // buffer until remote set
        }
      }
    } catch (e) { console.error('[WebRTC signal]', e); }
  });

  S.socket.on('peer-chat', ({ text }) => appendMsg(text, 'them'));

  S.socket.on('peer-disconnected', () => {
    addSysLine('👋 Stranger disconnected');
    setCallStatus('failed', 'disconnected');
    document.getElementById('video-panel').classList.remove('has-remote');
    document.getElementById('vid-remote').style.display = 'none';
    document.getElementById('no-video-ph').style.display = 'flex';
    document.getElementById('ph-txt').textContent = 'Stranger disconnected';
  });

  S.socket.on('connect_error', (err) => {
    console.log('[Socket] Error:', err.message, '— demo mode');
  });
}

// ── WEBRTC ───────────────────────────────────────────────
async function startWebRTC() {
  console.log('[WebRTC] Starting, initiator:', S.isInitiator);

  try {
    // Re-use existing stream from permission page, or request fresh
    if (!S.localStream || !S.localStream.active) {
      S.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      S.camGranted = true;
    }

    // Show local video feed
    const localVid = document.getElementById('vid-local');
    localVid.srcObject = S.localStream;
    localVid.style.display = 'block';
    document.getElementById('no-video-ph').style.display = 'none';
    document.getElementById('ph-txt').textContent = 'Waiting for stranger's camera…';

    // Create peer connection
    S.pc = new RTCPeerConnection(ICE_CONFIG);
    S.pendingCandidates = [];

    // Add local tracks to peer connection
    S.localStream.getTracks().forEach(track => {
      S.pc.addTrack(track, S.localStream);
      console.log('[WebRTC] Added track:', track.kind);
    });

    // Handle incoming remote stream
    S.pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      const remoteVid = document.getElementById('vid-remote');
      if (event.streams && event.streams[0]) {
        remoteVid.srcObject = event.streams[0];
      } else {
        // Fallback: build stream from track
        if (!remoteVid.srcObject) remoteVid.srcObject = new MediaStream();
        remoteVid.srcObject.addTrack(event.track);
      }
      remoteVid.style.display = 'block';
      document.getElementById('no-video-ph').style.display = 'none';
      document.getElementById('video-panel').classList.add('has-remote');
      document.getElementById('quality-bar').style.display = 'flex';
      setCallStatus('connected', 'live');
      monitorQuality();
    };

    // ICE candidate handling
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
      console.log('[WebRTC ICE]', st);
      if (st === 'connected' || st === 'completed') {
        setCallStatus('connected', 'live');
      } else if (st === 'failed') {
        setCallStatus('failed', 'failed');
        toast('Video connection failed — try skipping', '⚠️');
        // Try ICE restart
        if (S.isInitiator && S.pc.restartIce) S.pc.restartIce();
      } else if (st === 'disconnected') {
        setCallStatus('failed', 'reconnecting…');
      }
    };

    S.pc.onconnectionstatechange = () => {
      console.log('[WebRTC connection]', S.pc.connectionState);
    };

    // Initiator creates the offer
    if (S.isInitiator) {
      const offer = await S.pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await S.pc.setLocalDescription(offer);
      S.socket.emit('signal', { roomId: S.roomId, type: offer.type, sdp: offer.sdp });
      console.log('[WebRTC] Offer sent');
    }

  } catch (err) {
    console.error('[WebRTC start error]', err);
    if (err.name === 'NotAllowedError') {
      toast('Camera blocked — go to lobby and grant permission', '⚠️');
      document.getElementById('ph-txt').textContent = 'Camera permission denied';
    } else if (err.name === 'NotFoundError') {
      toast('No camera/mic found on this device', '⚠️');
      document.getElementById('ph-txt').textContent = 'No camera found';
    } else {
      toast('Video error: ' + err.message, '⚠️');
    }
    document.getElementById('video-panel').classList.remove('visible');
  }
}

function monitorQuality() {
  if (!S.pc) return;
  const iv = setInterval(async () => {
    if (!S.pc || S.pc.connectionState === 'closed') { clearInterval(iv); return; }
    try {
      const stats = await S.pc.getStats();
      let rtt = null;
      stats.forEach(r => {
        if (r.type === 'remote-inbound-rtp' && r.roundTripTime != null) rtt = r.roundTripTime;
      });
      const dot = document.getElementById('qual-dot');
      const txt = document.getElementById('qual-text');
      if (rtt === null) return;
      if (rtt < 0.1)      { dot.style.background = 'var(--green)'; txt.textContent = 'HD'; }
      else if (rtt < 0.3) { dot.style.background = 'var(--amber)'; txt.textContent = 'OK'; }
      else                { dot.style.background = 'var(--red)';   txt.textContent = 'Poor'; }
    } catch(e) {}
  }, 4000);
}

// ── DEMO MODE ────────────────────────────────────────────
function simulateDemoMatch() {
  let pool = [...strangerPool];
  if (S.pref === 'high') pool = pool.filter(s => s.score > 300);
  S.stranger = pool[Math.floor(Math.random() * pool.length)];
  S.roomId   = 'demo-' + Date.now();
  beginChat();

  if (S.mode === 'video') {
    document.getElementById('video-panel').classList.add('visible');
    // Show own camera in demo
    showOwnCameraDemo();
  }
}

async function showOwnCameraDemo() {
  try {
    if (!S.localStream || !S.localStream.active) {
      S.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      S.camGranted = true;
    }
    const localVid = document.getElementById('vid-local');
    localVid.srcObject = S.localStream;
    localVid.style.display = 'block';
    document.getElementById('no-video-ph').querySelector('.ph-txt').textContent =
      'Demo mode — deploy server for live P2P video';
    toast('Camera active — deploy server for live video', '📹');
  } catch (e) {
    document.getElementById('ph-txt').textContent = 'Camera not available in demo';
  }
}

// ── BEGIN CHAT ────────────────────────────────────────────
let replyTimer;

function beginChat() {
  document.getElementById('chat-msgs').innerHTML = '';
  const s = S.stranger;

  document.getElementById('peer-ava').textContent   = s.emoji;
  document.getElementById('peer-name').textContent  = s.name;
  document.getElementById('peer-score').textContent = s.score;

  // Show/hide video panel
  if (S.mode === 'video') {
    document.getElementById('video-panel').classList.add('visible');
    document.getElementById('btn-toggle-video').classList.add('active-btn');
  } else {
    document.getElementById('video-panel').classList.remove('visible');
    document.getElementById('btn-toggle-video').classList.remove('active-btn');
  }

  showPage('pg-chat');
  setCallStatus('connecting', 'connecting');
  addSysLine(`✨ Connected to ${s.name}`);

  logSession('start', { stranger: s.name, mode: S.mode, roomId: S.roomId });

  setTimeout(() => {
    if (S.mode !== 'video') setCallStatus('connected', 'live');
  }, 800);

  // Stranger opener
  if (Math.random() > 0.35) {
    const openers = ["hey!", "hi there 👋", "hello!", "what's up?", "yo", "heyyy 👀"];
    setTimeout(() => appendMsg(openers[Math.floor(Math.random() * openers.length)], 'them'),
      800 + Math.random() * 600);
  }
}

function appendMsg(text, who) {
  const msgs = document.getElementById('chat-msgs');
  const s    = S.stranger;

  const wrap = document.createElement('div');
  wrap.className = 'msg' + (who === 'me' ? ' me' : '');

  const ava = document.createElement('div');
  ava.className   = 'msg-ava';
  ava.textContent = who === 'me' ? '💀' : (s ? s.emoji : '👤');

  const body = document.createElement('div');
  body.className  = 'msg-body';

  const bub  = document.createElement('div');
  bub.className   = 'msg-bub';
  bub.textContent = text;

  const time = document.createElement('div');
  time.className   = 'msg-time';
  time.textContent = fmtTime();

  body.appendChild(bub); body.appendChild(time);
  wrap.appendChild(ava); wrap.appendChild(body);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;

  logSession('message', { text, who, roomId: S.roomId, ts: Date.now() });
  if (who === 'me') scheduleReply();
}

function addSysLine(text) {
  const msgs = document.getElementById('chat-msgs');
  const el = document.createElement('div');
  el.className   = 'sys-line';
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function scheduleReply() {
  clearTimeout(replyTimer);
  if (Math.random() > 0.22) {
    replyTimer = setTimeout(() => {
      if (S.socket && S.socket.connected) return;
      appendMsg(autoReplies[Math.floor(Math.random() * autoReplies.length)], 'them');
    }, 1100 + Math.random() * 2800);
  }
}

// ── SEND ─────────────────────────────────────────────────
function sendMsg() {
  const inp  = document.getElementById('cin');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  appendMsg(text, 'me');
  if (S.socket && S.socket.connected) {
    S.socket.emit('chat', { roomId: S.roomId, text });
  }
}
document.getElementById('btn-send').addEventListener('click', sendMsg);
document.getElementById('cin').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

// ── VIDEO CONTROLS ────────────────────────────────────────
document.getElementById('vc-mic').addEventListener('click', () => {
  S.micMuted = !S.micMuted;
  if (S.localStream) S.localStream.getAudioTracks().forEach(t => t.enabled = !S.micMuted);
  const btn = document.getElementById('vc-mic');
  btn.textContent = S.micMuted ? '🔇' : '🎤';
  btn.classList.toggle('muted', S.micMuted);
  toast(S.micMuted ? 'Mic muted' : 'Mic on', S.micMuted ? '🔇' : '🎤');
});

document.getElementById('vc-cam').addEventListener('click', () => {
  S.camOff = !S.camOff;
  if (S.localStream) S.localStream.getVideoTracks().forEach(t => t.enabled = !S.camOff);
  const btn = document.getElementById('vc-cam');
  btn.textContent = S.camOff ? '🚫' : '📷';
  btn.classList.toggle('vid-off', S.camOff);
  toast(S.camOff ? 'Camera off' : 'Camera on', S.camOff ? '🚫' : '📷');
});

document.getElementById('vc-flip').addEventListener('click', () => {
  const v = document.getElementById('vid-local');
  const cur = v.style.transform;
  v.style.transform = cur.includes('scaleX(-1)') ? 'scaleX(1)' : 'scaleX(-1)';
});

document.getElementById('vc-fs').addEventListener('click', () => {
  const feeds = document.getElementById('video-feeds');
  if (!document.fullscreenElement) feeds.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
});

document.getElementById('btn-toggle-video').addEventListener('click', () => {
  const panel = document.getElementById('video-panel');
  const on    = panel.classList.contains('visible');
  if (on) {
    panel.classList.remove('visible');
    document.getElementById('btn-toggle-video').classList.remove('active-btn');
  } else {
    if (!S.camGranted) {
      showPage('pg-perm');
      toast('Grant camera access first', '📹');
      return;
    }
    panel.classList.add('visible');
    document.getElementById('btn-toggle-video').classList.add('active-btn');
    if (!S.localStream || !S.localStream.active) showOwnCameraDemo();
  }
});

// ── CHAT ACTIONS ──────────────────────────────────────────
document.getElementById('btn-rate-top').addEventListener('click', openRating);

document.getElementById('btn-skip').addEventListener('click', () => {
  clearTimeout(replyTimer);
  logSession('end', { reason: 'skip', roomId: S.roomId });
  disconnectPeer();
  addSysLine('↩ Skipping — searching next match…');
  setTimeout(() => startMatching(), 800);
});

document.getElementById('btn-end').addEventListener('click', () => {
  clearTimeout(replyTimer);
  logSession('end', { reason: 'ended', roomId: S.roomId });
  openRating();
});

function disconnectPeer() {
  if (S.pc) { S.pc.close(); S.pc = null; }
  // Stop remote tracks but keep local stream alive for next match
  const remoteVid = document.getElementById('vid-remote');
  if (remoteVid.srcObject) {
    remoteVid.srcObject.getTracks().forEach(t => t.stop());
    remoteVid.srcObject = null;
  }
  remoteVid.style.display = 'none';
  if (S.socket) S.socket.emit('leave', { roomId: S.roomId });
  document.getElementById('video-panel').classList.remove('visible','has-remote');
  document.getElementById('vid-local').style.display = 'none';
  document.getElementById('no-video-ph').style.display = 'flex';
  document.getElementById('quality-bar').style.display = 'none';
  document.getElementById('ph-txt').textContent = 'Waiting for video…';
  S.pendingCandidates = [];
}

// ── SESSION LOGGING ───────────────────────────────────────
async function logSession(event, data) {
  try {
    await fetch(`${SERVER_URL}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...data, ts: Date.now() })
    });
  } catch(e) { /* server may not be running in demo */ }
}

// ── RATING ────────────────────────────────────────────────
function openRating() {
  S.starRating = 0; S.vibes = [];
  document.querySelectorAll('.star').forEach(s => s.classList.remove('lit'));
  document.querySelectorAll('.vibe').forEach(v => v.classList.remove('on'));
  document.getElementById('pts-row').style.display = 'none';
  document.getElementById('rating-overlay').classList.add('open');
}

document.getElementById('stars').addEventListener('click', e => {
  const star = e.target.closest('.star');
  if (!star) return;
  S.starRating = parseInt(star.dataset.v);
  document.querySelectorAll('.star').forEach(s =>
    s.classList.toggle('lit', parseInt(s.dataset.v) <= S.starRating));
  refreshPts();
});

document.getElementById('vibes').addEventListener('click', e => {
  const v = e.target.closest('.vibe');
  if (!v) return;
  v.classList.toggle('on');
  const val = v.dataset.v;
  const idx = S.vibes.indexOf(val);
  if (idx === -1) S.vibes.push(val); else S.vibes.splice(idx, 1);
  refreshPts();
});

function refreshPts() {
  if (!S.starRating) { document.getElementById('pts-row').style.display = 'none'; return; }
  const pts = calcPts(S.starRating, S.vibes.length);
  document.getElementById('pts-val').textContent = (pts >= 0 ? '+' : '') + pts;
  document.getElementById('pts-row').style.display = 'flex';
}

function calcPts(stars, vibeCount) {
  return ({ 5:50, 4:30, 3:10, 2:-20, 1:-20 }[stars] || 0) + vibeCount * 2;
}

document.getElementById('btn-skip-rating').addEventListener('click', () => {
  document.getElementById('rating-overlay').classList.remove('open');
  S.myScore += 5;
  updateScoreDisplay();
  toast('+5 Magnet points for completing the chat', '⚡');
  showPage('pg-lobby');
});

document.getElementById('btn-submit-rating').addEventListener('click', () => {
  if (!S.starRating) { toast('Pick a star rating first', '⭐'); return; }
  document.getElementById('rating-overlay').classList.remove('open');
  const pts = calcPts(S.starRating, S.vibes.length) + 5;
  if (S.stranger) S.stranger.score = Math.max(0, S.stranger.score + pts);
  S.myScore += Math.floor(Math.random() * 8) + 3;
  updateScoreDisplay();
  logSession('rating', { stars: S.starRating, vibes: S.vibes, pts, roomId: S.roomId });
  toast(S.starRating >= 4 ? '✨ Great rating submitted!' : '👍 Rating submitted', '🧲');
  showPage('pg-lobby');
});

// ── SCORE ────────────────────────────────────────────────
function updateScoreDisplay() {
  document.getElementById('my-score-lbl').textContent = S.myScore;
  document.getElementById('s-my-score').textContent   = S.myScore;
  lbData.find(l => l.isMe).score = S.myScore;
  S.myRank = Math.max(1, S.myRank - Math.floor(Math.random() * 4));
  document.getElementById('s-my-rank').textContent = '#' + S.myRank.toLocaleString();
}

function updateScoreSheet() {
  document.getElementById('s-my-score').textContent = S.myScore;
  document.getElementById('s-my-rank').textContent  = '#' + S.myRank.toLocaleString();
  lbData.find(l => l.isMe).score = S.myScore;
  renderLeaderboard();
}

function renderLeaderboard() {
  const lb = document.getElementById('lb');
  lb.innerHTML = '';
  [...lbData].sort((a,b) => b.score - a.score).forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (e.isMe ? ' is-me' : '');
    const rankLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i+1);
    const trendColor = e.trend === '↑' ? 'var(--green)' : e.trend === '↓' ? 'var(--red)' : 'var(--text-3)';
    row.innerHTML = `
      <div class="${i < 3 ? 'lb-rank gold' : 'lb-rank'}">${rankLabel}</div>
      <div class="lb-ava">${e.emoji}</div>
      <div class="lb-name">${e.name}${e.isMe ? ' <span style="font-size:10px;color:var(--text-3)">(you)</span>' : ''}</div>
      <div class="lb-score">${e.score}</div>
      <div class="lb-trend" style="color:${trendColor}">${e.trend}</div>
    `;
    lb.appendChild(row);
  });
}
