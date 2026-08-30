// FRESH BUILD MARKER — 2026-08-21 00:03 IST — v40 Messages enhancement merge; stable baseline preserved
// V132 width/fullscreen: desktop keeps video-left/chat-right; portrait fullscreen reserves controls so both feeds fit.
/* Mortalive — simplified frontend app
   Omegle-style UI, desktop-safe layout, text/video chat, demo fallback. */

const BUILD_TAG = 'mortalive-build-2026-08-30-v179-dynamic-island-search-audited'; // bump this string on every deploy to confirm cache is fresh
// V131 engineer note: restore the Talk video DOM defensively before real or synthetic playback.
// Random maintenance note: keep profile controls resilient across rerenders.
// Security audit v47: public media endpoints are retired; admin media stays session-gated.

// Shared typed numeric coercion for hot progress/engagement/follow paths.
const toNum = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };

const SERVER_URL =
  window.MORTALIVE_SERVER_URL ||
  (location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://mortalive-server.onrender.com');

console.log(`[Mortalive] ${BUILD_TAG} loaded`);
// V128: Talk state machine — real-user first → 30-second priority → synthetic fallback → indefinite cycle.

console.log(`[Mortalive] SERVER_URL = ${SERVER_URL}`);
console.log(`[Mortalive] Socket.io client ${typeof io === 'undefined' ? 'NOT LOADED ✗' : 'loaded ✓'}`);

// Runtime WebRTC configuration is supplied by the authenticated backend config endpoint.
// Keep only a public STUN fallback here so the frontend has no TURN credentials embedded.
let ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const S = {
  mode: 'video',
  interest: '',
  roomId: null,
  // Stable identifier for one continuous solo searching phase.
  // It lets the admin snapshot viewer group search frames together even
  // before a real room exists. Once matched, snapshots switch to S.roomId.
  searchSessionId: null,
  stranger: null,
  socket: null,
  pc: null,
  localStream: null,
  isInitiator: false,
  pendingCandidates: [],
  camGranted: false,
  micMuted: false,
  camOff: false,
  onlineCount: 0,
  onlineTimerStarted: false,
  pendingAction: null,
  replyTimer: null,
  noMatchTimeout: null,
  realUserCheckTimer: null,
  matchQueueHeartbeat: null,
  // synthetic video fallback
  syntheticActive: false,
  syntheticSkipCount: 0,
  syntheticVideos: [],
  syntheticCurrentIndex: 0,
  syntheticVideoId: null,
  syntheticVideoStartTime: null,
  syntheticSearchTimer: null,
  searchSnapshotTimer: null,  // fires every 2s while user is on the matching/searching screen
  // identity
  authToken: localStorage.getItem('mortalive_token') || null,
  username: localStorage.getItem('mortalive_username') || null,
  userId: localStorage.getItem('mortalive_user_id') || null,
  accountData: null, // Stores DB profile data (bio, display name, etc.)
  userLinks: [],     // Stores DB profile social links
  crockroachScore: null,
  isGuest: !localStorage.getItem('mortalive_token'),
  guestName: localStorage.getItem('mortalive_guest_name') || '',
  videoLayout: 'horizontal',
  chatStartedAt: null,
  talkDurationTimer: null,
  chatCounted: false,
  progress: null,
  profile: null,
  profileViewUserId: null,
  profileViewData: null,
  selectedFeedPhoto: null,
  selectedProfilePhoto: null,
  // V129: monotonically increasing Talk search generation. Every search/fallback
  // timer carries the generation so an old timer cannot strand a newer search.
  talkSearchGeneration: 0,
  talkFallbackTimer: null,
  talkNextBusy: false,
  // V138: Typing indicators & Interest feedback
  peerTyping: false,
  peerTypingTimeout: null,
  peerInterest: null,
  typingIndicatorTimerId: null
};

// EXPLICIT GLOBAL BINDING: Allows index.html inline scripts to accurately read the guest state
window.S = S;

// ── Retired-media compatibility constants ───────────────────
const SYNTHETIC_SKIP_LIMIT = Number.POSITIVE_INFINITY; // retired media path; no Talk session cap
const SEARCH_SNAPSHOT_MAX = Number.POSITIVE_INFINITY; // no client-side search snapshot cap
try { localStorage.removeItem('mortalive_resume_match_v1'); } catch (_) {}

function isSyntheticPlayback() {
  return !!(S.syntheticActive || (S.stranger && S.stranger.isSynthetic));
}

function clearSyntheticSearchTimer() {
  clearTimeout(S.syntheticSearchTimer);
  S.syntheticSearchTimer = null;
}

function prepareVideoElement(videoEl) {
  if (!videoEl) return;
  videoEl.setAttribute('playsinline', '');
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.style.width = '100%';
  videoEl.style.height = '100%';
  videoEl.style.maxWidth = '100%';
  videoEl.style.maxHeight = '100%';
  videoEl.style.minWidth = '0';
  videoEl.style.minHeight = '0';
  // Crop videos to fit square container without stretching
  videoEl.style.objectFit = 'cover';
  videoEl.style.objectPosition = 'center center';
  videoEl.style.background = '#000';
  if (videoEl.parentElement) {
    videoEl.parentElement.style.overflow = 'hidden';
    videoEl.parentElement.style.minWidth = '0';
    videoEl.parentElement.style.minHeight = '0';
  }
}

function ensureTalkVideoPanel() {
  const chatBody = $('pg-chat')?.querySelector('.chat-body');
  if (!chatBody) return null;
  let panel = $('video-panel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.className = 'video-panel visible has-remote';
  panel.id = 'video-panel';
  panel.innerHTML = `
    <div class="video-feeds" id="video-feeds">
      <div class="no-video" id="no-video-ph">
        <div class="big">📹</div>
        <div id="ph-txt" style="font-size:13px;margin-top:4px;">Waiting for video…</div>
      </div>
      <div class="video-wrapper remote">
        <video id="vid-remote" autoplay playsinline></video>
      </div>
      <div class="video-wrapper local">
        <video id="vid-local" autoplay playsinline muted></video>
      </div>
      <div class="quality" id="quality-bar">
        <span class="qdot" id="qual-dot"></span>
        <span id="qual-text">HD</span>
      </div>
    </div>
    <div class="video-controls">
      <button class="vc-btn" id="vc-mic" title="Mute microphone">🎤 Mic</button>
      <button class="vc-btn" id="vc-cam" title="Toggle camera">📷 Cam</button>
      <button class="vc-btn" id="vc-flip" title="Flip camera">🔄 Flip</button>
      <button class="vc-btn" id="vc-fs" title="Fullscreen">⛶ Full</button>
    </div>
    <div class="fs-controls" id="fs-controls">
      <button class="fs-next-btn" id="btn-skip-fs" title="Next">Next</button>
      <div class="fs-emoji-btns">
        <button class="fs-emoji-btn" id="fs-mic" title="Mic">🎤</button>
        <button class="fs-emoji-btn" id="fs-cam" title="Cam">📷</button>
        <button class="fs-emoji-btn" id="fs-flip" title="Flip">🔄</button>
        <button class="fs-emoji-btn" id="fs-exit" title="Exit">⛶</button>
      </div>
    </div>`;

  chatBody.insertBefore(panel, chatBody.querySelector('.chat-panel') || null);

  // Bind the dynamically-created controls directly. The normal static HTML
  // path is still bound by initChatControls(); this fallback exists only for
  // older cached HTML that was missing the video panel entirely.
  const mic = panel.querySelector('#vc-mic');
  const cam = panel.querySelector('#vc-cam');
  const flip = panel.querySelector('#vc-flip');
  const fs = panel.querySelector('#vc-fs');
  const nextFs = panel.querySelector('#btn-skip-fs');
  const exitFs = panel.querySelector('#fs-exit');
  mic?.addEventListener('click', () => {
    S.micMuted = !S.micMuted;
    S.localStream?.getAudioTracks().forEach(t => { t.enabled = !S.micMuted; });
    mic.textContent = S.micMuted ? '🔇 Mic' : '🎤 Mic';
  });
  cam?.addEventListener('click', () => {
    S.camOff = !S.camOff;
    S.localStream?.getVideoTracks().forEach(t => { t.enabled = !S.camOff; });
    cam.textContent = S.camOff ? '🚫 Cam' : '📷 Cam';
  });
  flip?.addEventListener('click', () => {
    const v = $('vid-local');
    if (v) v.style.transform = (v.style.transform || 'scaleX(-1)').includes('scaleX(-1)') ? 'scaleX(1)' : 'scaleX(-1)';
  });
  fs?.addEventListener('click', async () => {
    const panelEl = $('video-panel');
    if (!panelEl) return;
    if (!document.fullscreenElement) {
      try { await panelEl.requestFullscreen?.(); } catch (_) {}
    } else {
      try { await document.exitFullscreen?.(); } catch (_) {}
    }
  });
  nextFs?.addEventListener('click', () => $('btn-skip')?.click());
  panel.querySelector('#fs-mic')?.addEventListener('click', () => { panel.querySelector('#vc-mic')?.click(); syncFsButtonStates(); });
  panel.querySelector('#fs-cam')?.addEventListener('click', () => { panel.querySelector('#vc-cam')?.click(); syncFsButtonStates(); });
  panel.querySelector('#fs-flip')?.addEventListener('click', () => panel.querySelector('#vc-flip')?.click());
  exitFs?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    else document.webkitExitFullscreen?.();
  });
  return panel;
}

function prepareVideoSurfaces() {
  ['vid-local', 'vid-remote', 'lobby-cam-preview', 'perm-video'].forEach((id) => prepareVideoElement($(id)));
}

function syncLocalCameraPreview() {
  prepareVideoSurfaces();
  const localVid = $('vid-local');
  if (!localVid) return;
  if (S.localStream && S.localStream.active) {
    localVid.srcObject = S.localStream;
    localVid.muted = true;
    localVid.style.display = 'block';
    const panel = $('video-panel');
    if (panel && S.mode === 'video') panel.classList.add('visible');
  }
}

function showSearchScreen() {
  showPage('pg-match');
  updateOnlineCount();
  setCallStatus('connecting', 'Searching…');
  setText('match-title', 'Finding your match');
  const subReset = $('match-sub');
  if (subReset) subReset.innerHTML = 'Scanning <strong id="match-count">' + S.onlineCount.toLocaleString() + '</strong> people online right now.';
  // Start continuous snapshot capture while the user is on the real
  // matchmaking/search screen. startSearchSnapshots() safely restarts
  // the current search capture timer.
  startSearchSnapshots();
}

// AI bot responses used when user picks "Chat with AI" after exhausting videos
const BOT_REPLIES = [
  "That's interesting — tell me more!",
  "haha yeah I feel that",
  "what got you into that?",
  "honestly same energy",
  "okay wait, explain that part again",
  "that's a pretty solid take",
  "I've been thinking about this lately too",
  "ngl that surprised me",
  "go on…",
  "what would you do differently?",
  "that tracks actually",
  "interesting — most people don't think about it that way",
  "okay I kind of agree",
  "that's wild lol",
  "wait really? how long has that been going on?"
];

const PROGRESS_KEY = 'mortalive_progress_v3';
const PROFILE_KEY = 'mortalive_profile_v3';

const PROGRESS_BADGES = Object.freeze([
  { id: 'rookie', label: 'Rookie', minScore: 0, minCompletions: 0, minStreak: 0 },
  { id: 'momentum', label: 'Momentum', minScore: 120, minCompletions: 3, minStreak: 1 },
  { id: 'streak-3', label: '3-Day Streak', minScore: 160, minCompletions: 5, minStreak: 3 },
  { id: 'bronze', label: 'Bronze', minScore: 220, minCompletions: 8, minStreak: 2 },
  { id: 'silver', label: 'Silver', minScore: 420, minCompletions: 15, minStreak: 4 },
  { id: 'gold', label: 'Gold', minScore: 700, minCompletions: 28, minStreak: 6 },
  { id: 'top10', label: 'Top 10%', minScore: 980, minCompletions: 40, minStreak: 7 }
]);

const PROFILE_THEMES = Object.freeze({
  aurora: {
    name: 'Aurora',
    accent: 'rgba(90, 177, 255, .95)',
    glow: 'rgba(90, 177, 255, .22)',
    frame: 'Liquid Glass'
  },
  dusk: {
    name: 'Dusk',
    accent: 'rgba(168, 120, 255, .96)',
    glow: 'rgba(168, 120, 255, .24)',
    frame: 'Mirror Halo'
  },
  ember: {
    name: 'Ember',
    accent: 'rgba(255, 146, 86, .95)',
    glow: 'rgba(255, 146, 86, .22)',
    frame: 'Signal Flame'
  }
});

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function clampNum(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function weekKey(date = new Date()) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function defaultProgress() {
  return Object.freeze({
    baseScore: 0,
    bonusScore: 0,
    completions: 0,
    streak: 0,
    bestStreak: 0,
    weeklyPoints: 0,
    weeklyCompletions: 0,
    lastActiveDay: '',
    lastCompletionDay: '',
    lastWeekKey: '',
    badges: ['rookie'],
    shareCount: 0,
    totalMessages: 0,
    profileTheme: 'aurora',
    profileFrame: 'Liquid Glass',
    featuredQuote: 'Building momentum one connection at a time.',
    pinnedNote: 'Connect with the world, build your crockroach Score, and unlock your profile.',
    avatarFrame: 'halo',
    lastSyncedAt: 0
  });
}

function defaultProfile() {
  return Object.freeze({
    theme: 'aurora',
    frame: 'Liquid Glass',
    quote: 'Building momentum one connection at a time.',
    pinned: 'Connect with the world, build your crockroach Score, and unlock your profile.',
    accent: 'rgba(90, 177, 255, .95)',
    pattern: 'mesh'
  });
}

function loadProgress() {
  const stored = loadJson(PROGRESS_KEY, null);
  const progress = { ...defaultProgress(), ...(stored || {}) };
  for (const k of ['baseScore','bonusScore','completions','streak','bestStreak',
                    'weeklyPoints','weeklyCompletions','totalMessages','shareCount']) {
    progress[k] = toNum(progress[k]);
  }
  progress.badges = Array.isArray(progress.badges) && progress.badges.length ? progress.badges : ['rookie'];
  progress.profileTheme = typeof progress.profileTheme === 'string' ? progress.profileTheme : 'aurora';
  progress.profileFrame = typeof progress.profileFrame === 'string' ? progress.profileFrame : 'Liquid Glass';
  progress.featuredQuote = typeof progress.featuredQuote === 'string' ? progress.featuredQuote : defaultProgress().featuredQuote;
  progress.pinnedNote = typeof progress.pinnedNote === 'string' ? progress.pinnedNote : defaultProgress().pinnedNote;
  progress.avatarFrame = typeof progress.avatarFrame === 'string' ? progress.avatarFrame : 'halo';
  return progress;
}

function loadProfile() {
  const stored = loadJson(PROFILE_KEY, null);
  const profile = { ...defaultProfile(), ...(stored || {}) };
  if (!PROFILE_THEMES[profile.theme]) profile.theme = 'aurora';
  if (typeof profile.frame !== 'string') profile.frame = defaultProfile().frame;
  if (typeof profile.quote !== 'string') profile.quote = defaultProfile().quote;
  if (typeof profile.pinned !== 'string') profile.pinned = defaultProfile().pinned;
  if (typeof profile.accent !== 'string') profile.accent = defaultProfile().accent;
  if (typeof profile.pattern !== 'string') profile.pattern = 'mesh';
  return profile;
}

function getProgressScore(progress = null) {
  const safeProgress = progress || S.progress || defaultProgress();
  return toNum(safeProgress.baseScore) + toNum(safeProgress.bonusScore);
}

function getCurrentProgress() {
  if (!S.progress) S.progress = loadProgress();
  return S.progress;
}

function getCurrentProfile() {
  if (!S.profile) S.profile = loadProfile();
  return S.profile;
}

function persistProgress() {
  saveJson(PROGRESS_KEY, getCurrentProgress());
}

function persistProfile() {
  saveJson(PROFILE_KEY, getCurrentProfile());
}

function computeWeeklyRank(progress) {
  const score = getProgressScore(progress);
  const completions = toNum(progress.completions);
  const streak = toNum(progress.streak);
  const weeklyPoints = toNum(progress.weeklyPoints);
  const power = score * 1.1 + completions * 18 + streak * 22 + weeklyPoints * 0.8;
  return clampNum(Math.round(6200 / Math.max(42, power / 5)), 1, 9999);
}

function computeTopPercentile(progress) {
  const score = getProgressScore(progress);
  const completions = toNum(progress.completions);
  const streak = toNum(progress.streak);
  const weeklyPoints = toNum(progress.weeklyPoints);
  const power = score + completions * 12 + streak * 20 + weeklyPoints * 0.9;
  return clampNum(Math.round(100 - power / 18), 1, 99);
}

function computeGoalText(progress) {
  const score = getProgressScore(progress);
  const completions = toNum(progress.completions);
  const streak = toNum(progress.streak);
  const percentile = computeTopPercentile(progress);

  if (score < 220) return `${220 - score} more points to unlock Bronze`;
  if (completions < 8) return `${8 - completions} more chats to unlock Bronze`;
  if (streak < 3) return `${3 - streak} more days to unlock a streak badge`;
  if (percentile > 10) return `Push for Top ${percentile > 25 ? '25' : '10'}%`;
  return 'You are close to a highlight card unlock';
}

function computeUnlockedBadges(progress) {
  const score = getProgressScore(progress);
  const completions = toNum(progress.completions);
  const streak = toNum(progress.streak);
  return PROGRESS_BADGES.filter((badge) => {
    return score >= badge.minScore && completions >= badge.minCompletions && streak >= badge.minStreak;
  }).map((badge) => badge.label);
}

function updateDerivedProgress() {
  const progress = getCurrentProgress();
  const nowWeek = weekKey();
  if (progress.lastWeekKey !== nowWeek) {
    progress.lastWeekKey = nowWeek;
    progress.weeklyPoints = 0;
    progress.weeklyCompletions = 0;
  }
  progress.badges = computeUnlockedBadges(progress);
  progress.topPercentile = computeTopPercentile(progress);
  progress.weeklyRank = computeWeeklyRank(progress);

  const score = getProgressScore(progress);
  const profile = getCurrentProfile();
  if (score >= 700) {
    progress.profileTheme = 'dusk';
    progress.profileFrame = 'Gold Halo';
    profile.theme = 'dusk';
    profile.frame = 'Gold Halo';
    profile.accent = PROFILE_THEMES.dusk.accent;
  } else if (score >= 420) {
    progress.profileTheme = 'aurora';
    progress.profileFrame = 'Silver Glow';
    profile.theme = 'aurora';
    profile.frame = 'Silver Glow';
    profile.accent = PROFILE_THEMES.aurora.accent;
  } else {
    progress.profileTheme = 'ember';
    progress.profileFrame = 'Glass Spark';
    profile.theme = 'ember';
    profile.frame = 'Glass Spark';
    profile.accent = PROFILE_THEMES.ember.accent;
  }
  progress.lastSyncedAt = Date.now();
  persistProgress();
  persistProfile();
}

function streakAdvanceOnCompletion(progress) {
  const today = dayKey();
  if (progress.lastCompletionDay === today) return false;
  if (progress.lastCompletionDay) {
    const prev = new Date(`${progress.lastCompletionDay}T00:00:00Z`);
    const cur = new Date(`${today}T00:00:00Z`);
    const diff = Math.round((cur - prev) / 86400000);
    progress.streak = diff === 1 ? toNum(progress.streak) + 1 : 1;
  } else {
    progress.streak = 1;
  }
  progress.bestStreak = Math.max(toNum(progress.bestStreak), progress.streak);
  progress.lastCompletionDay = today;
  progress.lastActiveDay = today;
  return true;
}

function syncThemeHints() {
  const progress = getCurrentProgress();
  const profile = getCurrentProfile();
  const theme = PROFILE_THEMES[profile.theme] || PROFILE_THEMES.aurora;
  document.documentElement.style.setProperty('--reward-accent', theme.accent);
  document.documentElement.style.setProperty('--reward-glow', theme.glow);
  document.documentElement.style.setProperty('--reward-frame', theme.frame);
  document.body.dataset.progressTheme = progress.profileTheme || profile.theme || 'aurora';
  document.body.dataset.progressTier = getProgressScore(progress) >= 700 ? 'gold' : getProgressScore(progress) >= 420 ? 'silver' : 'starter';
}

function formatProgressLine(progress = getCurrentProgress()) {
  const score = getProgressScore(progress);
  const completions = toNum(progress.completions);
  const streak = toNum(progress.streak);
  const badges = Array.isArray(progress.badges) ? progress.badges.length : 0;
  const percentile = progress.topPercentile || computeTopPercentile(progress);
  const rank = progress.weeklyRank || computeWeeklyRank(progress);
  return {
    score,
    completions,
    streak,
    badges,
    percentile,
    rank,
    goal: computeGoalText(progress)
  };
}

function updateProgressText() {
  const progress = getCurrentProgress();
  const profile = getCurrentProfile();
  const summary = formatProgressLine(progress);

  const stats = {
    'progress-score': `${summary.score}`,
    'progress-streak': `${summary.streak} day${summary.streak === 1 ? '' : 's'}`,
    'progress-completions': `${summary.completions}`,
    'progress-percentile': `Top ${summary.percentile}%`,
    'progress-rank': `#${summary.rank}`,
    'progress-goal': summary.goal,
    'progress-badges': summary.badges ? progress.badges.join(' · ') : 'Rookie',
    'progress-frame': progress.profileFrame || profile.frame,
    'progress-quote': profile.quote || progress.featuredQuote || '',
    'progress-pinned': profile.pinned || progress.pinnedNote || ''
  };

  Object.entries(stats).forEach(([id, value]) => {
    const el = $(id);
    if (el && value !== undefined && value !== null) el.textContent = value;
  });

  const scorePill = $('score-pill-btn');
  if (scorePill) {
    scorePill.textContent = S.isGuest ? 'Guest mode' : `🧲 ${summary.score} crockroach Score · ${summary.badges} badges`;
    scorePill.title = S.isGuest
      ? 'Guest sessions do not earn status'
      : `Top ${summary.percentile}% · #${summary.rank} weekly rank`;
  }

  syncThemeHints();
}

function syncAuthProgress(baseScore) {
  const progress = getCurrentProgress();
  const incoming = Number(baseScore);
  if (Number.isFinite(incoming) && incoming >= 0) {
    progress.baseScore = Math.max(toNum(progress.baseScore), incoming);
  }
  updateDerivedProgress();
  persistProgress();
  updateProgressText();
  // If local bonusScore accumulated while the user was offline, push the
  // merged total back to Supabase now that they're authenticated again.
  scheduleSyncScoreToSupabase();
}

function bootProgressState() {
  S.progress = loadProgress();
  S.profile = loadProfile();
  updateDerivedProgress();
  updateProgressText();
}

// ── Supabase score sync ──────────────────────────────────────────────────────
// Debounced so rapid events (messages, micro-completions) batch into one write.
let _scoreSync = null;
async function syncScoreToSupabase() {
  if (S.isGuest || !S.userId || !sb) return;
  const score = getProgressScore(getCurrentProgress());
  const progress = getCurrentProgress();
  try {
    const { error } = await sb.from('accounts').update({
      crockroach_score: score,
      updated_at: new Date().toISOString()
    }).eq('id', S.userId);
    if (error) throw error;
    console.log(`[Score] Synced ${score} pts to Supabase ✓`);
  } catch (e) {
    console.warn('[Score] Supabase sync failed:', e?.message || e);
  }
}

function scheduleSyncScoreToSupabase() {
  clearTimeout(_scoreSync);
  _scoreSync = setTimeout(syncScoreToSupabase, 2500);
}

function awardProgress(kind, amount = 1, meta = {}) {
  const progress = getCurrentProgress();
  if (S.isGuest) return progress;

  const delta = toNum(amount, 1) || 1;
  const source = kind || 'activity';
  progress.bonusScore = Math.max(0, toNum(progress.bonusScore) + delta);
  progress.weeklyPoints = Math.max(0, (toNum(progress.weeklyPoints)) + delta);
  progress.totalMessages = Math.max(0, (toNum(progress.totalMessages)) + (meta.message ? 1 : 0));
  progress.lastActiveDay = dayKey();

  if (meta.completion) {
    progress.completions = Math.max(0, (toNum(progress.completions)) + 1);
    progress.weeklyCompletions = Math.max(0, (toNum(progress.weeklyCompletions)) + 1);
    streakAdvanceOnCompletion(progress);
    const bonus = clampNum(10 + Math.floor((meta.durationMs || 0) / 20000), 10, 24);
    progress.bonusScore = Math.max(0, toNum(progress.bonusScore) + bonus);
    progress.weeklyPoints = Math.max(0, (toNum(progress.weeklyPoints)) + bonus);
  }

  if (meta.streakReset) {
    progress.streak = 0;
  }

  progress.badges = computeUnlockedBadges(progress);
  progress.topPercentile = computeTopPercentile(progress);
  progress.weeklyRank = computeWeeklyRank(progress);
  progress.lastSyncedAt = Date.now();

  persistProgress();
  scheduleSyncScoreToSupabase(); // keep Supabase accounts.crockroach_score in sync
  updateProgressText();

  if (meta.completion) {
    const goal = computeGoalText(progress);
    if (source === 'chat_complete') {
      toast(`+${delta} crockroach Score · ${goal}`, '🧲');
    } else {
      toast(`Milestone reached · ${goal}`, '🏁');
    }
  } else if (source === 'message' && (toNum(progress.totalMessages)) % 5 === 0) {
    toast(`+${delta} progress`, '✨');
  }

  return progress;
}

function formatTalkDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
function stopTalkDurationTimer() {
  clearInterval(S.talkDurationTimer);
  S.talkDurationTimer = null;
}
function startTalkDurationTimer() {
  stopTalkDurationTimer();
  const render = () => {
    const started = Number(S.chatStartedAt) || Date.now();
    const el = $('talk-duration');
    if (el) el.textContent = formatTalkDuration(Date.now() - started);
  };
  render();
  S.talkDurationTimer = setInterval(render, 1000);
}

function finalizeChatProgress(reason = 'completed') {
  if (S.chatCounted) return;
  const started = S.chatStartedAt || Date.now();
  const durationMs = Math.max(0, Date.now() - started);
  S.chatStartedAt = null;
  S.chatCounted = true;

  if (S.isGuest) return;
  if (reason !== 'completed' && reason !== 'peer-disconnected') return;
  if (durationMs < 6000) return;

  awardProgress('chat_complete', 1, { completion: true, durationMs });
  // Tell feed.html to show the "just ended a chat — share something" banner.
  try { sessionStorage.setItem('mortalive_just_chatted', '1'); } catch (e) {}
}

function resetChatProgress() {
  S.chatStartedAt = null;
  S.chatCounted = false;
}

function copyProgressShareCard() {
  initProfilePostComposer();
  if (S.userId) hydrateProfilePosts(S.userId).catch((error) => console.warn('[Posts] hydration warning:', error));

  const progress = getCurrentProgress();
  const summary = formatProgressLine(progress);
  const profile = getCurrentProfile();
  const text = [
    `Mortalive status`,
    `${S.username || S.guestName || 'Guest'} · ${summary.score} crockroach Score`,
    `${summary.streak} day streak · ${summary.completions} completions`,
    `Top ${summary.percentile}% · #${summary.rank} weekly`,
    `Frame: ${profile.frame || 'Liquid Glass'}`
  ].join('\n');

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      progress.shareCount = (toNum(progress.shareCount)) + 1;
      persistProgress();
      updateProgressText();
      toast('Share card copied', '📋');
    }).catch(() => toast('Could not copy share card', '⚠️'));
  } else {
    toast('Clipboard is not supported here', '⚠️');
  }
  return text;
}

function ensureProgressSheet() {
  let overlay = $('progress-overlay');
  if (overlay) {
    // Respect the HTML-owned modal when present, but make its lifecycle
    // deterministic even if app.js is used without the latest index.html.
    overlay.style.pointerEvents = 'auto';
    overlay.setAttribute('aria-hidden', 'false');
    if (!overlay.dataset.mortaliveProgressBound) {
      overlay.dataset.mortaliveProgressBound = '1';
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeProgressSheet();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeProgressSheet();
      });
    }
    const close = $('progress-close');
    if (close && !close.dataset.mortaliveBound) {
      close.dataset.mortaliveBound = '1';
      close.addEventListener('click', closeProgressSheet);
    }
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.id = 'progress-overlay';
  overlay.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:980',
    'align-items:center',
    'justify-content:center',
    'padding:18px',
    'background:rgba(8,14,28,.58)',
    'backdrop-filter:blur(16px) saturate(130%)',
    'pointer-events:none'
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'width:min(720px,100%)',
    'max-height:min(84vh,880px)',
    'overflow:auto',
    'border-radius:28px',
    'padding:20px',
    'background:linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.08))',
    'border:1px solid rgba(255,255,255,.20)',
    'box-shadow:0 30px 80px rgba(0,0,0,.38)',
    'color:#fff',
    'pointer-events:auto'
  ].join(';');

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeProgressSheet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProgressSheet();
  });
  return overlay;
}

function closeProgressSheet() {
  const overlay = $('progress-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.style.pointerEvents = 'none';
  overlay.classList.remove('active', 'open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('mortalive-progress-open');
}

function openProgressSheet() {
  if (S.isGuest) {
    toast('Sign in to view your status', '👤');
    return;
  }
  const overlay = ensureProgressSheet();
  updateDerivedProgress();
  updateProgressText();

  const badgesWrap = overlay.querySelector('#progress-badges');
  if (badgesWrap) {
    const badges = getCurrentProgress().badges || [];
    badgesWrap.innerHTML = badges.length
      ? badges.map((badge) => `<span style="display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.15);font-size:13px;font-weight:700;">${badge}</span>`).join('')
      : '<span style="opacity:.75;">No badges yet</span>';
  }

  overlay.style.display = 'flex';
  overlay.style.pointerEvents = 'auto';
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('mortalive-progress-open');
}


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



// Phase 1 app boundary: Now extended to include the Coming Soon pages
const TALK_PAGE_IDS = new Set([
  'pg-land',
  'pg-auth',
  'pg-perm',
  'pg-lobby',
  'pg-match',
  'pg-chat',
  'pg-feed',
  'pg-messages',
  'pg-profile'
]);

function showPage(id, options = {}) {
  // Guests may view OTHER users' public profiles (read-only).
  // They are still blocked from their own profile page, Feed, and Messages.
  const isGuestPublicProfile =
    S.isGuest &&
    id === 'pg-profile' &&
    options.profileUserId;

  if (S.isGuest && ['pg-feed', 'pg-messages', 'pg-profile'].includes(id) && !isGuestPublicProfile) {
    toast('Sign in to access this page', '🔒');
    id = 'pg-auth';
    setTimeout(() => { $('tab-login')?.click(); }, 0);
  }
  if (!TALK_PAGE_IDS.has(id)) {
    console.warn('[Mortalive] Blocked navigation to non-Talk page:', id);
    return;
  }
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = $(id);
  if (page) page.classList.add('active');
  window.scrollTo(0, 0);
  window.dispatchEvent(new CustomEvent('mortalive-auth-state'));
  if (id !== 'pg-profile') closeProgressSheet();

  if (id === 'pg-lobby') {
    const backBtn = $('pg-lobby')?.querySelector('.setup-back');
    if (backBtn) {
      backBtn.style.display = (!S.isGuest && !!S.authToken) ? 'none' : '';
    }
    if (typeof refreshLobbyStats === 'function') refreshLobbyStats();
  }

  if (id === 'pg-profile') {
    const requestedUserId = options.profileUserId || null;

    if (S.isGuest && requestedUserId) {
      // Guest viewing a public profile — read-only, no auth required.
      S.profileViewUserId = requestedUserId;
      S.profileViewData = null;
      initPublicProfilePage(requestedUserId).catch((error) => {
        console.warn('[Profile] guest public profile navigation warning:', error);
        toast(error?.message || 'Could not load profile.', '⚠️');
      });
    } else if (!S.isGuest && S.userId) {
      S.profileViewUserId = requestedUserId && requestedUserId !== S.userId ? requestedUserId : null;
      S.profileViewData = null;
      if (S.profileViewUserId) {
        initPublicProfilePage(S.profileViewUserId).catch((error) => {
          console.warn('[Profile] public profile navigation warning:', error);
          toast(error?.message || 'Could not load profile.', '⚠️');
        });
      } else {
        document.body.classList.remove('profile-viewing-public');
        if (S.accountData) initProfilePage();
        else hydrateAccountData(S.userId, { rerender: true }).catch((error) => console.warn('[Profile] navigation hydration warning:', error));
        initProfilePostComposer();
        hydrateProfilePosts(S.userId).catch((error) => console.warn('[Profile] posts hydration warning:', error));
        hydrateProfileGallery(S.userId).catch((error) => console.warn('[Gallery] hydration warning:', error));
      }
    }
  }

  if (id === 'pg-feed') {
    S.profileViewUserId = null;
    S.profileViewData = null;
    document.body.classList.remove('profile-viewing-public');
    initFeedPage();

  // Profile controls use delegated events because the profile card is
  // hydrated/rerendered after startup. Bind once at bootstrap so Edit
  // Profile and Share remain functional after every profile refresh.
  bindProfileEvents();
    if (!S.isGuest && S.userId) {
      syncFeedSidebar();
      fetchFeedPage(true);
    }
  }

  if (id === 'pg-messages') {
    initMessages();
  }
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

// Reusable confirm dialog — replaces all native confirm() calls.
// Returns a Promise<boolean>. Danger variant styles the confirm button red.
function showConfirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('mortalive-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mortalive-confirm-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2000',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:18px',
      'background:rgba(0,0,0,.44)', 'backdrop-filter:blur(12px)',
      '-webkit-backdrop-filter:blur(12px)'
    ].join(';');

    const confirmBtnStyle = danger
      ? 'background:var(--danger);color:#fff;box-shadow:0 4px 14px rgba(220,38,38,.28);'
      : 'background:linear-gradient(145deg,var(--primary),var(--secondary));color:#fff;box-shadow:0 4px 14px rgba(26,110,245,.28);';

    overlay.innerHTML = `
      <div style="
        width:min(380px,100%);background:#fff;border:1px solid var(--border);
        border-radius:var(--r-lg);box-shadow:var(--elev-4);padding:28px;text-align:center;
        animation:toastIn .18s var(--ease-out,cubic-bezier(.16,1,.3,1));
      ">
        <div style="font-size:36px;margin-bottom:12px;">${danger ? '⚠️' : '❓'}</div>
        <div style="font-size:18px;font-weight:800;letter-spacing:-.03em;color:var(--on-surface);margin-bottom:10px;">${title || 'Are you sure?'}</div>
        ${body ? `<div style="font-size:13.5px;color:var(--on-surface-3);line-height:1.65;margin-bottom:20px;">${body}</div>` : '<div style="margin-bottom:20px;"></div>'}
        <div style="display:flex;gap:10px;">
          <button id="mc-cancel" style="
            flex:1;padding:13px;border-radius:var(--r-sm);border:1.5px solid var(--border-strong);
            background:#fff;color:var(--on-surface);font-size:14px;font-weight:700;cursor:pointer;
          ">${cancelLabel}</button>
          <button id="mc-confirm" style="
            flex:1;padding:13px;border-radius:var(--r-sm);border:0;
            font-size:14px;font-weight:700;cursor:pointer;${confirmBtnStyle}
          ">${confirmLabel}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('#mc-confirm').addEventListener('click', () => cleanup(true));
    overlay.querySelector('#mc-cancel').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); cleanup(false); }
    });
  });
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setCallStatus(state, label) {
  const connDot = $('conn-dot');
  if (connDot) connDot.className = `dot ${state}`;
  const callDot = $('call-dot');
  if (callDot) callDot.className = `conn-dot ${state}`;
  ['conn-text', 'call-text'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = label;
  });
}

function updateOnlineCount() {
  const formatted = Number(S.onlineCount || 0).toLocaleString();
  ['online-n','online-n-hero','online-count','online-users','app-topbar-online-count'].forEach(id => {
    const el = $(id);
    if (el) el.textContent = formatted;
  });
  const mc = $('match-count');
  if (mc) mc.textContent = formatted;
}

const PRESENCE_MODEL = {
  min: 4000,
  max: 70000,
  center: 24000,
  jitter: 0.12
};

function samplePresenceNumber(previous = PRESENCE_MODEL.center) {
  const r = Math.random();
  let target;
  if (r < 0.10) target = PRESENCE_MODEL.min + Math.random() * 6500;
  else if (r > 0.90) target = PRESENCE_MODEL.max - Math.random() * 9000;
  else target = PRESENCE_MODEL.min + Math.pow(Math.random(), 0.72) * (PRESENCE_MODEL.max - PRESENCE_MODEL.min);
  const blended = previous * 0.72 + target * 0.28;
  return Math.round(Math.max(PRESENCE_MODEL.min, Math.min(PRESENCE_MODEL.max, blended)));
}

async function fetchPresenceSource() {
  try {
    if (!SERVER_URL) return null;
    const res = await fetch(`${SERVER_URL}/api/presence`, { cache: 'no-store' });
    if (!res.ok) return null;
    const payload = await res.json();
    const value = Number(payload?.count ?? payload?.online ?? payload?.onlineCount);
    return Number.isFinite(value) ? Math.round(value) : null;
  } catch (_) {
    return null;
  }
}

async function refreshOnlinePresence() {
  const sourceValue = await fetchPresenceSource();
  S.onlineCount = sourceValue != null
    ? Math.round(Math.max(PRESENCE_MODEL.min, Math.min(PRESENCE_MODEL.max, sourceValue)))
    : samplePresenceNumber(S.onlineCount || PRESENCE_MODEL.center);
  updateOnlineCount();
}

function isCompactViewport() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function getEffectiveVideoLayout() {
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

function isFullscreenVideoMode() {
  const panel = $('video-panel');
  const fs = document.fullscreenElement;
  return !!(panel && fs && (fs === panel || panel.contains(fs)));
}

// V130: Talk desktop composition is intentionally video-left / chat-right.
function applyVideoLayout() {
  // Layout is now entirely CSS-driven:
  //   Desktop normal     → 2 squares side by side (grid-template-columns: 1fr 1fr)
  //   Desktop fullscreen → 2 squares side by side filling the screen
  //   Mobile normal      → 2 squares stacked (grid-template-columns: 1fr)
  //   Mobile fullscreen  → 2 squares stacked filling the screen
  // No class toggling needed — just ensure video surfaces are prepared.
  prepareVideoSurfaces();
}

function toggleVideoLayout() {
  if (isCompactViewport()) {
    S.videoLayout = 'vertical';
    applyVideoLayout();
    toast('Phone stays in stacked layout', '📱');
    return;
  }
  S.videoLayout = getEffectiveVideoLayout() === 'horizontal' ? 'vertical' : 'horizontal';
  localStorage.setItem('mortalive_video_layout', S.videoLayout);
  applyVideoLayout();
  toast(S.videoLayout === 'horizontal' ? 'Camera layout set to side-by-side' : 'Camera layout set to stacked', '🎬');
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
  ['btn-enter', 'continue-btn', 'btn-start-text', 'btn-start-video', 'btn-start'].forEach((id) => {
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

// Landing Continue gating is intentionally owned by app.js only.
function initConsentGate() {
  const terms = $('landing-consent') || $('terms') || $('terms-checkbox');

  if (terms) {
    const sync = () => updateConsentState();
    terms.addEventListener('change', sync);
    terms.addEventListener('input', sync);
    terms.addEventListener('click', sync);
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
  S.onlineCount = samplePresenceNumber(PRESENCE_MODEL.center);
  updateOnlineCount();
  refreshOnlinePresence();
  setInterval(() => {
    // Prefer a real backend presence source; otherwise use a smooth procedural estimate.
    refreshOnlinePresence();
  }, 6500);
}

function ensureLobbyCameraPreview() {
  const preview = $('lobby-cam-preview');
  if (preview && S.localStream) preview.srcObject = S.localStream;
  const strip = $('cam-strip');
  if (strip) strip.style.display = S.localStream ? 'flex' : 'none';
}

function enterLobby() {
  // Returning to the site/lobby must never auto-start Talk.
  // A stored login session is only an authentication state, not consent
  // to begin matchmaking again.
  try { clearMatchResumeIntent(); } catch (_) {}
  stopMatchQueueHeartbeat?.();
  stopSearchSnapshots?.();
  clearTimeout(talkOptionsPopupTimer);
  document.getElementById('synthetic-exhaustion-overlay')?.remove();
  setActiveMode(S.mode);
  showPage('pg-lobby');
  ensureLobbyCameraPreview();
  updateDerivedProgress();
  updateProgressText();
  updateIdentityDisplay();
}

function updateIdentityDisplay() {
  const label = $('identity-label');
  const switchBtn = $('btn-switch-account');
  const logoutBtn = $('btn-logout');
  const scorePill = $('score-pill-btn');
  const progress = getCurrentProgress();
  const summary = formatProgressLine(progress);

  // Use localStorage as a reliable fallback if S gets out of sync during load
  const displayUsername = S.username || localStorage.getItem('mortalive_username');

  if (!S.isGuest && displayUsername) {
    if (label) label.textContent = `Logged in as ${displayUsername} · 🧲 ${summary.score} crockroach Score · ${summary.streak} streak · #${summary.rank}`;
    if (switchBtn) switchBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
    if (scorePill) scorePill.style.display = '';
  } else {
    if (label) label.textContent = `Browsing as guest "${S.guestName || 'Guest'}" — status is locked until sign-in`;
    if (switchBtn) switchBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (scorePill) scorePill.style.display = 'none';
  }

  updateProgressText();
  window.dispatchEvent(new CustomEvent('mortalive-auth-state'));
}


function refreshLaunchpadCopy() {
  // Intentionally left blank: landing page copy is owned by index.html.
  // app.js should only manage behavior, not overwrite UI text.
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
      if (camStrip) camStrip.style.display = 'flex';

      queueSnapshotBurst('permission', 2, ['perm-video', 'lobby-cam-preview', 'vid-local'], 140, 320);

      showPage('pg-lobby');

      if (S.pendingAction === 'match') {
        S.pendingAction = null;
        // Permission just succeeded because the user clicked "Find" while
        // in video mode without a camera yet — NOW it's safe to commit
        // S.mode to 'video' and sync the visible toggle button, right
        // before actually queuing for a match.
        // P0 FIX: use beginRealUserPrioritySearch so the 30-second synthetic
        // fallback timer is registered even for this permission-grant entry path.
        setActiveMode('video');
        setTimeout(() => beginRealUserPrioritySearch({ fallbackToSynthetic: true, reason: 'first-search', priorityWindowMs: 30 * 1000 }), 350);
      } else if (S.pendingAction === 'lobby-video') {
        // Permission succeeded because the user just clicked the "Video
        // Chat" mode tab in the lobby (not "Find") — switch the mode and
        // stay right here in the lobby. Do NOT auto-start a match.
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

// Supabase client — initialized in index.html as window.sb
// Supabase + TURN configuration is loaded from /api/public-config at startup.
// The Supabase anon key is intentionally public, but keeping it out of source
// prevents configuration drift and keeps all runtime configuration centralized.
// Secret values (service-role/admin/TURN credentials) remain server-side.
let sb = window.sb || null;
let _publicConfigPromise = null;

async function loadPublicRuntimeConfig() {
  if (_publicConfigPromise) return _publicConfigPromise;
  _publicConfigPromise = (async () => {
    const configUrl = `${SERVER_URL.replace(/\/$/, '')}/api/public-config`;
    const res = await fetch(configUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`Runtime config request failed (${res.status})`);
    const config = await res.json();
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
      throw new Error('Runtime config is missing Supabase publishable configuration.');
    }

    if (!window.supabase?.createClient) {
      throw new Error('Supabase client library is unavailable.');
    }

    window.sb = supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { detectSessionInUrl: true }
    });
    sb = window.sb;

    // Video/reel runtime configuration is retired. Do not hydrate ICE/TURN
    // settings from the public backend configuration endpoint.
    window.MORTALIVE_PUBLIC_CONFIG = {
      supabaseUrl: config.supabaseUrl,
      mediaRetired: true
    };
    return config;
  })();
  return _publicConfigPromise;
}

// Captured synchronously, before Supabase's client has a chance to
// parse/strip the URL — tells "just followed a confirmation link"
// apart from "ordinary page load with an already-persisted session".
// Only used to gate the link-based sign-in fallback below; never
// touched again after this.
const _arrivedViaAuthRedirect = /access_token=|refresh_token=|[?&]code=/.test(
  window.location.hash + window.location.search
);

// Holds the in-progress OTP request (which email it was sent to, and
// whether we're mid-signup or mid-password-reset) so the verify step
// knows what to check the code against and what to do once it's valid.
let _otpContext = null; // { mode: 'signup' | 'reset', source: 'login'|null, email }
let _resendCooldownTimer = null;

// Shared 60s cooldown across every "send a code" entry point (signup's
// "Create account", forgot-password's "Send code", and the OTP screen's
// "Resend code"). Client-side check that surfaces instantly as a toast
// instead of waiting on a round trip to Supabase's own rate-limit error.
const OTP_COOLDOWN_MS = 60 * 1000;
let _lastOtpRequestAt = 0;

// Resolve a public username → { id, username, display_name } or null.
// Used for shareable profile URLs (?user=username).
async function lookupUserByUsername(username) {
  if (!sb || !username) return null;
  const clean = String(username).trim().replace(/^@/, '');
  if (!clean) return null;
  try {
    const { data, error } = await sb
      .from('accounts')
      .select('id, username, display_name')
      .ilike('username', clean)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function initAuthControls() {
  const tabGuest  = $('tab-guest');
  const tabLogin  = $('tab-login');
  const tabSignup = $('tab-signup');
  const guestForm  = $('auth-guest-form');
  const loginForm  = $('auth-login-form');
  const signupForm = $('auth-signup-form');
  const forgotForm = $('auth-forgot-form');
  const otpForm    = $('auth-otp-form');
  const resetForm  = $('auth-reset-form');

  // Holds the verified session/user from an OTP verify — used by the
  // "set new password" step (forgot-password flow only; signup verifies
  // and logs straight in without this).
  let _pendingResetUser = null;
  // Holds the password the person typed on the signup form, from the
  // moment we send the OTP until it's verified and we can call
  // updateUser({ password }) to actually set it.
  let _pendingSignupPassword = null;
  // Set true for the duration of any Supabase call we already handle
  // manually (password login, typed-code verify) so the global
  // onAuthStateChange listener below — which exists to catch sign-ins
  // that happen with no button click at all, i.e. the email's
  // "Confirm & continue" button — doesn't also try to process the
  // exact same sign-in a second time.
  let _suppressAutoSignedIn = false;

  function hideForgotFlow() {
    clearInterval(_resendCooldownTimer);
    _otpContext = null;
    _pendingResetUser = null;
    _pendingSignupPassword = null;
    if (forgotForm) forgotForm.style.display = 'none';
    if (otpForm)    otpForm.style.display    = 'none';
    if (resetForm)  resetForm.style.display  = 'none';
  }

  function showAuthTab(which) {
    hideForgotFlow();
    if (guestForm)  guestForm.style.display  = which === 'guest'  ? '' : 'none';
    if (loginForm)  loginForm.style.display  = which === 'login'  ? '' : 'none';
    if (signupForm) signupForm.style.display = which === 'signup' ? '' : 'none';
    tabGuest?.classList.toggle('active',  which === 'guest');
    tabLogin?.classList.toggle('active',  which === 'login');
    tabSignup?.classList.toggle('active', which === 'signup');
  }

  // Wire up auth tabs — guest is back as a proper tab
  tabGuest?.addEventListener('click', () => showAuthTab('guest'));
  tabLogin?.addEventListener('click', () => showAuthTab('login'));
  tabSignup?.addEventListener('click', () => showAuthTab('signup'));

  function setError(id, msg) {
    const el = $(id);
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = msg;
  }

  function friendlyAuthError(error) {
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('rate limit') || msg.includes('too many')) {
      return 'Too many attempts — please wait a moment and try again.';
    }
    if (msg.includes('invalid login credentials')) {
      return 'Incorrect email or password.';
    }
    if (msg.includes('email not confirmed')) {
      return 'Please confirm your email first — check your inbox for the link we sent.';
    }
    if (msg.includes('user already registered') || msg.includes('already registered')) {
      return 'An account with that email already exists — try logging in instead.';
    }
    if (msg.includes('invalid') && msg.includes('token')) {
      return 'That code is incorrect or has expired. Please try again.';
    }
    if (msg.includes('expired')) {
      return 'That code has expired. Send a new one.';
    }
    return error?.message || 'Something went wrong. Please try again.';
  }

  // Returns true (and shows a toast + inline error) if a code was sent
  // less than 60s ago from either the "send code" or "resend" button.
  // Callers should bail out immediately when this returns true.
  function blockIfOnCooldown(errorTargetId) {
    const remaining = OTP_COOLDOWN_MS - (Date.now() - _lastOtpRequestAt);
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      toast(`Please wait ${secs}s before requesting another code`, '⏳');
      setError(errorTargetId, `You can request a new code in ${secs}s.`);
      return true;
    }
    return false;
  }

  function afterAuthSuccess(token, username, crockroachScore, userId) {
    S.authToken = token;
    S.username = username;
    S.userId = userId || null;
    S.crockroachScore = crockroachScore;
    S.isGuest = false;

    localStorage.setItem('mortalive_token', token);
    localStorage.setItem('mortalive_username', username);
    if (userId) localStorage.setItem('mortalive_user_id', userId);

    // Centralized DB hydration prevents the profile from remaining empty
    // when auth succeeds before accounts/user_links have finished loading.
    if (userId) {
      hydrateAccountData(userId, { rerender: true }).catch((error) => {
        console.warn('[Profile] post-auth hydration warning:', error);
      });
    }

    syncAuthProgress(crockroachScore);
    toast(`Welcome, ${username}!`, '🧲');

    // If the user arrived via a shared profile link (?user=...) but wasn't
    // logged in, we saved the username in sessionStorage — open that profile now.
    try {
      const pending = sessionStorage.getItem('mortalive_pending_profile_user');
      if (pending) {
        sessionStorage.removeItem('mortalive_pending_profile_user');
        lookupUserByUsername(pending).then(found => {
          if (!found) { enterLobby(); return; }
          if (found.id === (userId || null)) showPage('pg-profile');
          else showPage('pg-profile', { profileUserId: found.id });
        }).catch(() => enterLobby());
        return;
      }
    } catch (_) {}

    enterLobby();
  }

  // Toggles a password field between hidden (•••) and plain text.
  // Shared by the login, signup, and reset-password fields.
  function wireupPasswordToggle(inputId, btnId) {
    const input = $(inputId);
    const btn   = $(btnId);
    if (!input || !btn) return;
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? '👁️' : '🙈';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  }
  wireupPasswordToggle('login-password',  'btn-login-pw-toggle');
  wireupPasswordToggle('signup-password', 'btn-signup-pw-toggle');
  wireupPasswordToggle('reset-password',  'btn-reset-pw-toggle');

  // ── Log in with email + password ──
  $('btn-login')?.addEventListener('click', async () => {
    const email    = ($('login-email')?.value    || '').trim();
    const password = $('login-password')?.value  || '';
    setError('login-error', null);
    
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('login-error', 'Enter a valid email address.');
      return;
    }
    if (!password) {
      setError('login-error', 'Enter your password.');
      return;
    }

    const btn = $('btn-login');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    _suppressAutoSignedIn = true;
    
    try {
      // ── The Permanent Fix: Secure RPC Probe ──
      const { data: emailStatus, error: rpcError } = await sb.rpc('check_email_status', { p_email: email });

      if (emailStatus === 'unverified') {
        // Account exists but is unverified. Safely resend OTP and slide to verification.
        await sb.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: window.location.href }
        });

        _lastOtpRequestAt = Date.now();
        _otpContext = { mode: 'signup', source: 'login', email };
        _pendingSignupPassword = password; // Set password after verify

        showOtpStep(email);

        // Dynamically alter OTP screen text
        const otpLabel = document.querySelector('#auth-otp-form label[for="otp-code"]');
        if (otpLabel) otpLabel.textContent = 'Account unverified. Enter the 6-digit code:';

        toast('Account unverified. Code sent to your email.', '📩');
        return;
      }

      // If verified or not_found, proceed normally. Supabase will handle the error safely.
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      
      if (error) {
        setError('login-error', friendlyAuthError(error));
        return;
      }
      
      const user = data?.user;
      const session = data?.session;
      if (!session || !user) {
        setError('login-error', 'Login succeeded but no session was returned. Try again.');
        return;
      }
      const profile = await fetchUserProfile(user.id);
      const links = await fetchUserLinks(user.id);
      S.accountData = profile; 
      S.userLinks = links;
      
      const username =
        profile?.username ||
        user.user_metadata?.username ||
        user.email?.split('@')[0] ||
        'User';
      const crockroachScore = profile?.crockroach_score ?? profile?.crockroachScore ?? 0;
      afterAuthSuccess(session.access_token, username, crockroachScore, user.id);
    } catch (e) {
      setError('login-error', 'Could not reach Supabase. Try again in a moment.');
    } finally {
      _suppressAutoSignedIn = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in →'; }
    }
  });

  // ── Live username availability check (Instagram-style) ──
  let _usernameCheckTimer = null;
  let _usernameCheckToken = 0; // guards against out-of-order async replies
  let _usernameCheck = { username: null, available: null }; // available: null=unknown, true/false=result for `username`

  function setUsernameStatus(state, msg) {
    const el = $('signup-username-status');
    if (!el) return;
    el.className = 'username-status' + (state ? ` username-status-${state}` : '');
    el.textContent = msg || '';
    el.style.display = msg ? 'flex' : 'none';
  }

  async function checkUsernameAvailability(username) {
    const myToken = ++_usernameCheckToken;
    setUsernameStatus('pending', 'Checking availability…');
    try {
      const { data, error } = await sb.rpc('is_username_taken', { p_username: username });
      if (myToken !== _usernameCheckToken) return; // a newer keystroke superseded this check
      if (error) {
        console.warn('is_username_taken check failed:', error.message);
        _usernameCheck = { username, available: null };
        setUsernameStatus(null, '');
        return;
      }
      const taken = !!data;
      _usernameCheck = { username, available: !taken };
      setUsernameStatus(
        taken ? 'bad' : 'ok',
        taken ? '✕ That username is taken — try another.' : '✓ Username is available'
      );
    } catch (e) {
      if (myToken !== _usernameCheckToken) return;
      _usernameCheck = { username, available: null };
      setUsernameStatus(null, '');
    }
  }

  const usernameInput = $('signup-username');
  usernameInput?.addEventListener('input', () => {
    const val = usernameInput.value.trim();
    clearTimeout(_usernameCheckTimer);
    _usernameCheckToken++; // invalidate any in-flight check immediately
    if (!val) {
      setUsernameStatus(null, '');
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(val)) {
      setUsernameStatus('bad', '3–24 characters: letters, numbers, underscore only.');
      return;
    }
    _usernameCheckTimer = setTimeout(() => checkUsernameAvailability(val), 450);
  });
  // Catches the case where someone types then tabs/clicks away fast
  // enough that the debounce timer hasn't fired yet.
  usernameInput?.addEventListener('blur', () => {
    const val = usernameInput.value.trim();
    if (/^[a-zA-Z0-9_]{3,24}$/.test(val) && _usernameCheck.username !== val) {
      clearTimeout(_usernameCheckTimer);
      checkUsernameAvailability(val);
    }
  });

  // ── Sign up: validate fields, then verify identity via a 6-digit
  // emailed code (instead of a confirmation link) before actually
  // creating the account with the password they chose. ──
  $('btn-signup')?.addEventListener('click', async () => {
    const username = ($('signup-username')?.value || '').trim();
    const fullName = ($('signup-fullname')?.value || '').trim();
    const email    = ($('signup-email')?.value    || '').trim();
    const password = $('signup-password')?.value  || '';
    const terms    = $('signup-terms');
    setError('signup-error', null);

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      setError('signup-error', 'Username must be 3–24 characters: letters, numbers, underscore only.');
      return;
    }
    if (_usernameCheck.username === username && _usernameCheck.available === false) {
      setError('signup-error', 'That username is taken — please choose a different one.');
      $('signup-username')?.focus();
      return;
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('signup-error', 'Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('signup-error', 'Password must be at least 8 characters.');
      return;
    }
    if (terms && !terms.checked) {
      setError('signup-error', 'Please agree to the Terms of Service and Privacy Policy.');
      return;
    }
    if (blockIfOnCooldown('signup-error')) return;

    const btn = $('btn-signup');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending code…'; }
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          // Picked up by the handle_new_user() DB trigger to populate
          // the public.accounts row.
          data: { username, full_name: fullName },
          // So the email's "Confirm & continue" button lands back on
          // this exact page instead of whatever Site URL is configured
          // in the Supabase dashboard.
          emailRedirectTo: window.location.href
        }
      });
      if (error) {
        setError('signup-error', friendlyAuthError(error));
        return;
      }
      _lastOtpRequestAt = Date.now();
      toast('Code sent — check your email!', '📩');
      // Held onto until the code is verified, then used to actually set
      // their password via updateUser() — see btn-otp-verify below.
      _pendingSignupPassword = password;
      _otpContext = { mode: 'signup', email };
      showOtpStep(email);
    } catch (e) {
      setError('signup-error', 'Could not reach Supabase. Try again in a moment.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create account →'; }
    }
  });

  // ── Forgot password: show the "request a code" step ──
  $('btn-forgot')?.addEventListener('click', () => {
    if (loginForm) loginForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = '';
    setError('forgot-error', null);
    const forgotEmail = $('forgot-email');
    const loginEmail  = $('login-email');
    if (forgotEmail && loginEmail?.value) forgotEmail.value = loginEmail.value;
  });
  $('btn-forgot-back')?.addEventListener('click', () => {
    hideForgotFlow();
    showAuthTab('login');
  });

  // ── Forgot password step 1: send the 6-digit code ──
  $('btn-forgot-send')?.addEventListener('click', async () => {
    const email = ($('forgot-email')?.value || '').trim();
    setError('forgot-error', null);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('forgot-error', 'Enter a valid email address.');
      return;
    }
    if (blockIfOnCooldown('forgot-error')) return;

    const btn = $('btn-forgot-send');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.href }
      });
      if (error) {
        setError('forgot-error', friendlyAuthError(error));
        return;
      }
      _lastOtpRequestAt = Date.now();
      toast('Code sent — check your email!', '📩');
      _otpContext = { mode: 'reset', email };
      showOtpStep(email);
    } catch (e) {
      setError('forgot-error', 'Could not reach Supabase. Try again in a moment.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send code →'; }
    }
  });

  function showOtpStep(email) {
    if (guestForm)  guestForm.style.display  = 'none';
    if (loginForm)  loginForm.style.display  = 'none';
    if (signupForm) signupForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'none';
    if (otpForm)    otpForm.style.display    = '';
    if (resetForm)  resetForm.style.display  = 'none';
    const display = $('otp-email-display');
    if (display) display.textContent = `Code sent to ${email}`;
    setError('otp-error', null);
    const codeInput = $('otp-code');
    if (codeInput) { codeInput.value = ''; codeInput.focus(); }
    startResendCooldown(60);
  }

  function startResendCooldown(seconds) {
    const btn = $('btn-otp-resend');
    if (!btn) return;
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `Resend in ${remaining}s`;
    clearInterval(_resendCooldownTimer);
    _resendCooldownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(_resendCooldownTimer);
        btn.disabled = false;
        btn.textContent = 'Resend code';
      } else {
        btn.textContent = `Resend in ${remaining}s`;
      }
    }, 1000);
  }

  // ── Forgot password step 2: verify the code, then move to step 3 ──
  $('btn-otp-verify')?.addEventListener('click', async () => {
    const code = ($('otp-code')?.value || '').trim();
    setError('otp-error', null);
    if (!_otpContext?.email) {
      setError('otp-error', 'Session expired — please start again.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('otp-error', 'Enter the 6-digit code from your email.');
      return;
    }

    const btn = $('btn-otp-verify');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
    _suppressAutoSignedIn = true;
    try {
      const { data, error } = await sb.auth.verifyOtp({
        email: _otpContext.email,
        token: code,
        type: 'email'
      });
      if (error) {
        setError('otp-error', friendlyAuthError(error));
        return;
      }

      const session = data?.session;
      const user    = data?.user || session?.user;
      if (!session || !user) {
        setError('otp-error', 'Verification succeeded but no session was returned. Try again.');
        return;
      }

      if (_otpContext.mode === 'signup') {
        // Identity confirmed — set the password they chose on the
        // signup form, then log them straight in. No separate
        // "set new password" step needed; we already have it.
        clearInterval(_resendCooldownTimer);
        const password = _pendingSignupPassword;
        _otpContext = null;
        _pendingSignupPassword = null;
        try {
          if (password) await sb.auth.updateUser({ password });
        } catch (pwErr) {
          console.warn('Could not set chosen password after signup verify:', pwErr);
          // Not fatal — they're verified and logged in either way; they
          // can set a password later via "Forgot password?" if this failed.
        }
        const profile = await fetchUserProfile(user.id);
        const links = await fetchUserLinks(user.id);
        S.accountData = profile;
        S.userLinks = links;
        const username =
          profile?.username ||
          user.user_metadata?.username ||
          user.email?.split('@')[0] ||
          'User';
        const crockroachScore = profile?.crockroach_score ?? profile?.crockroachScore ?? 0;
        afterAuthSuccess(session.access_token, username, crockroachScore, user.id);
        return;
      }

      // Reset-password mode: code confirmed identity — now let them
      // pick a new password instead of logging straight in.
      clearInterval(_resendCooldownTimer);
      _pendingResetUser = { user, session };
      if (otpForm)   otpForm.style.display   = 'none';
      if (resetForm) resetForm.style.display = '';
      setError('reset-error', null);
      const pw = $('reset-password');
      if (pw) { pw.value = ''; pw.focus(); }
    } catch (e) {
      setError('otp-error', 'Could not reach Supabase. Try again in a moment.');
    } finally {
      _suppressAutoSignedIn = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Verify code →'; }
    }
  });

  // ── Resend the code to the same email ──
  $('btn-otp-resend')?.addEventListener('click', async () => {
    if (!_otpContext?.email) return;
    setError('otp-error', null);
    // The button is already disabled by startResendCooldown()'s own timer
    // for the normal case; this is a defense-in-depth check against the
    // same shared 60s window used by the "send code" button.
    if (blockIfOnCooldown('otp-error')) return;
    try {
      const { error } = await sb.auth.signInWithOtp({
        email: _otpContext.email,
        options: {
          // Prevent accidentally registering the user if they came from the login fallback
          shouldCreateUser: _otpContext.mode === 'signup' && _otpContext.source !== 'login',
          emailRedirectTo: window.location.href
        }
      });
      if (error) {
        setError('otp-error', friendlyAuthError(error));
        return;
      }
      _lastOtpRequestAt = Date.now();
      toast('Code sent — check your email!', '📩');
      startResendCooldown(60);
    } catch (e) {
      setError('otp-error', 'Could not reach Supabase. Try again in a moment.');
    }
  });

  // ── Back to the previous step (signup form, or the forgot-password
  // "request a code" step, depending on how we got here) ──
  $('btn-otp-back')?.addEventListener('click', () => {
    clearInterval(_resendCooldownTimer);
    const mode = _otpContext?.mode;
    const source = _otpContext?.source;
    _otpContext = null;
    _pendingResetUser = null;
    _pendingSignupPassword = null;
    if (otpForm) otpForm.style.display = 'none';
    if (source === 'login') {
      if (loginForm) loginForm.style.display = '';
    } else if (mode === 'signup') {
      if (signupForm) signupForm.style.display = '';
    } else {
      if (forgotForm) forgotForm.style.display = '';
    }
  });

  // ── Forgot password step 3: set the new password ──
  $('btn-reset-submit')?.addEventListener('click', async () => {
    const newPassword = $('reset-password')?.value || '';
    setError('reset-error', null);
    if (!_pendingResetUser?.session) {
      setError('reset-error', 'Session expired — please start again.');
      return;
    }
    if (newPassword.length < 8) {
      setError('reset-error', 'Password must be at least 8 characters.');
      return;
    }

    const btn = $('btn-reset-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const { data, error } = await sb.auth.updateUser({ password: newPassword });
      if (error) {
        setError('reset-error', friendlyAuthError(error));
        return;
      }
      const user    = data?.user || _pendingResetUser.user;
      const session = _pendingResetUser.session;
      const profile = await fetchUserProfile(user.id);
      const links = await fetchUserLinks(user.id);
      S.accountData = profile;
      S.userLinks = links;
      
      const username =
        profile?.username ||
        user.user_metadata?.username ||
        user.email?.split('@')[0] ||
        'User';
      const crockroachScore = profile?.crockroach_score ?? profile?.crockroachScore ?? 0;

      _otpContext = null;
      _pendingResetUser = null;
      toast('Password updated!', '✅');
      afterAuthSuccess(session.access_token, username, crockroachScore, user.id);
    } catch (e) {
      setError('reset-error', 'Could not reach Supabase. Try again in a moment.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Set new password →'; }
    }
  });

  $('btn-continue-guest')?.addEventListener('click', () => {
    const name = ($('guest-name')?.value || '').trim();
    S.authToken   = null;
    S.username    = null;
    S.userId      = null;
    S.accountData = null;
    S.userLinks   = [];
    S.crockroachScore = null;
    S.isGuest     = true;
    S.guestName   = name.slice(0, 24) || `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    updateProgressText();
    localStorage.removeItem('mortalive_token');
    localStorage.removeItem('mortalive_username');
    localStorage.removeItem('mortalive_user_id');
    localStorage.setItem('mortalive_guest_name', S.guestName);
    enterLobby();
  });

  const guestInput = $('guest-name');
  if (guestInput && S.guestName) guestInput.value = S.guestName;

  // ── Handles a sign-in that happened with no button click on THIS
  // page — i.e. someone clicked the "Confirm & continue" button in the
  // email instead of typing the 6-digit code. Reached two ways:
  //  1. Same browser, a DIFFERENT tab than the one showing the OTP
  //     screen (the common case — email links usually open a new tab).
  //     Supabase's client syncs sessions across tabs of the same origin
  //     automatically, so this tab's onAuthStateChange fires too, and
  //     _pendingSignupPassword is still sitting in this tab's memory
  //     since it never navigated away.
  //  2. This exact tab, reloaded fresh by following the link directly
  //     (memory is wiped by the navigation — no password to fall back
  //     on, so we ask for one via the same screen used for password
  //     reset).
  async function handleLinkBasedSignIn(user, session) {
    // Abort UI changes if this is just a cross-domain session transfer from invitation.mortalive.com
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('transfer') === '1') return;

    if (_pendingSignupPassword) {
      const password = _pendingSignupPassword;
      clearInterval(_resendCooldownTimer);
      _otpContext = null;
      _pendingSignupPassword = null;
      try {
        await sb.auth.updateUser({ password });
      } catch (pwErr) {
        console.warn('Could not set chosen password after link-based confirm:', pwErr);
      }
      const profile = await fetchUserProfile(user.id);
      const links = await fetchUserLinks(user.id);
      S.accountData = profile;
      S.userLinks = links;
      
      const username =
        profile?.username ||
        user.user_metadata?.username ||
        user.email?.split('@')[0] ||
        'User';
      const crockroachScore = profile?.crockroach_score ?? profile?.crockroachScore ?? 0;
      afterAuthSuccess(session.access_token, username, crockroachScore, user.id);
      return;
    }

    // No password in memory. Only treat this as "just followed a
    // confirmation link" if the URL this page loaded with actually
    // looks like a Supabase auth redirect — never on an ordinary
    // revisit where a session simply already existed.
    if (!_arrivedViaAuthRedirect || S.authToken) return;

    showPage('pg-auth');
    if (guestForm)  guestForm.style.display  = 'none';
    if (loginForm)  loginForm.style.display  = 'none';
    if (signupForm) signupForm.style.display = 'none';
    if (forgotForm) forgotForm.style.display = 'none';
    if (otpForm)    otpForm.style.display    = 'none';
    if (resetForm)  resetForm.style.display  = '';
    clearInterval(_resendCooldownTimer);
    _otpContext = null;
    _pendingResetUser = { user, session };
    setError('reset-error', null);
    toast('Email confirmed — set a password to finish.', '✅');
    const pw = $('reset-password');
    if (pw) { pw.value = ''; pw.focus(); }
  }

  // Keep S.* in sync if the Supabase session changes in another tab, or
  // expires/gets revoked while this tab is open — and catch sign-ins
  // that happen via the email's link button rather than a click here.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      S.authToken = null;
      S.username = null;
      S.userId = null;
      S.accountData = null;
      S.userLinks = [];
      S.crockroachScore = null;
      S.isGuest = true;

      _autoLoginPromise = null;
      _profileHydrationPromise = null;
      _profileHydrationUserId = null;

      localStorage.removeItem('mortalive_token');
      localStorage.removeItem('mortalive_username');
      localStorage.removeItem('mortalive_user_id');
      updateIdentityDisplay();
      _feedPosts = [];
      _feedOffset = 0;
      _feedHasMore = true;
      _feedLoading = false;
      _commentCache = new Map();
      _feedEngagement = new Map();
      _commentLoading = new Set();
      return;
    }

    // Automatically catch when Supabase successfully loads a session (initial
    // or token refresh) and keep the DB-backed profile in sync as well.
    if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event) && session) {
      if (event === 'SIGNED_IN' && !_suppressAutoSignedIn) {
        handleLinkBasedSignIn(session.user, session);
      }

      if (session.access_token) {
        const nextUserId = session.user.id;
        const switchedUser = S.userId && S.userId !== nextUserId;

        S.authToken = session.access_token;
        S.userId = nextUserId;
        S.isGuest = false;

        if (switchedUser) {
          S.accountData = null;
          S.userLinks = [];
        }

        S.username =
          session.user.user_metadata?.username ||
          localStorage.getItem('mortalive_username') ||
          S.username ||
          'User';

        localStorage.setItem('mortalive_token', S.authToken);
        localStorage.setItem('mortalive_user_id', S.userId);

        updateIdentityDisplay();
        syncFeedSidebar();

        hydrateAccountData(S.userId, { rerender: true }).catch((error) => {
          console.warn('[Profile] auth-state hydration warning:', error);
        });
      }
    }
  });
}
// Fetches the row from public.accounts for the given auth user id.
async function fetchUserProfile(userId) {
  try {
    const { data, error } = await sb
      .from('accounts')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[Profile] accounts lookup:', error.message);
      return null;
    }

    return data || null;
  } catch (e) {
    console.warn('[Profile] accounts lookup failed:', e);
    return null;
  }
}

// Fetches the row(s) from public.user_links for the given auth user id.
async function fetchUserLinks(userId) {
  try {
    const { data, error } = await sb
      .from('user_links')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}


// Centralized profile hydration.
// The latest build stores DB profile data separately from local progress.
// This helper makes hydration deterministic across login, refresh,
// direct profile navigation, and session changes.
let _profileHydrationPromise = null;
let _profileHydrationUserId = null;

async function hydrateAccountData(userId, options = {}) {
  const rerender = options.rerender !== false;

  if (!userId || S.isGuest) return false;

  // Reuse a request already in flight for the same authenticated user.
  if (_profileHydrationPromise && _profileHydrationUserId === userId) {
    return _profileHydrationPromise;
  }

  _profileHydrationUserId = userId;

  let requestPromise;
  requestPromise = (async () => {
    try {
      const [profile, links] = await Promise.all([
        fetchUserProfile(userId),
        fetchUserLinks(userId)
      ]);

      // Never apply data from an account that is no longer active.
      if (S.userId !== userId || S.isGuest) return false;

      S.accountData = profile || null;
      S.userLinks = Array.isArray(links) ? links : [];

      const dbUsername =
        S.accountData?.username ||
        S.username ||
        localStorage.getItem('mortalive_username') ||
        'User';

      const dbScore =
        S.accountData?.crockroach_score ??
        S.accountData?.crockroachScore ??
        S.crockroachScore ??
        0;

      S.username = dbUsername;
      S.crockroachScore = dbScore;
      localStorage.setItem('mortalive_username', dbUsername);

      if (rerender && $('pg-profile')?.classList.contains('active')) {
        initProfilePage();
        if (typeof window.renderProfileInfoRow === 'function') window.renderProfileInfoRow();
      }
      // Always sync feed sidebar so avatar_url is applied regardless of which
      // page is currently visible — ensures avatar is ready the instant the
      // user navigates to feed, without requiring a second round-trip.
      syncFeedSidebar();
      if ($('pg-feed')?.classList.contains('active')) {
        fetchFeedPage(true);
      }

      return !!profile;
    } catch (error) {
      console.warn('[Profile] hydration failed:', error);

      if (S.userId !== userId || S.isGuest) return false;

      if (rerender && $('pg-profile')?.classList.contains('active')) {
        initProfilePage();
        if (typeof window.renderProfileInfoRow === 'function') window.renderProfileInfoRow();
      }

      return false;
    } finally {
      if (_profileHydrationPromise === requestPromise) {
        _profileHydrationPromise = null;
        _profileHydrationUserId = null;
      }
    }
  })();

  _profileHydrationPromise = requestPromise;
  return requestPromise;
}


// If a Supabase session already exists (page reload / return visit), log
// the user in automatically and skip past the auth screen.
let _autoLoginPromise = null;
async function tryAutoLogin() {
  if (_autoLoginPromise) return _autoLoginPromise;

  _autoLoginPromise = (async () => {
    try {
      // Supabase Auth is the only authentication authority.
      const { data: sessionData, error: sessionError } =
        await sb.auth.getSession();
      const session = sessionData?.session;

      if (sessionError || !session?.access_token || !session.user?.id) {
        throw new Error(sessionError?.message || 'no valid Supabase session');
      }

      const { data: userData, error: userError } =
        await sb.auth.getUser(session.access_token);
      const user = userData?.user;

      if (userError || !user || user.id !== session.user.id) {
        throw new Error(userError?.message || 'invalid Supabase session');
      }

      // Commit authenticated state BEFORE any optional profile/UI work.
      S.authToken = session.access_token;
      S.userId = user.id;
      S.isGuest = false;

      localStorage.setItem('mortalive_token', S.authToken);
      localStorage.setItem('mortalive_user_id', S.userId);
      localStorage.removeItem('mortalive_guest_name');

      // Profile enrichment is best-effort. It must never invalidate Auth.
      try {
        const profile = await fetchUserProfile(user.id);
        const links = await fetchUserLinks(user.id);
        S.accountData = profile;
        S.userLinks = links;
      } catch (profileError) {
        console.warn('[Profile] accounts enrichment failed:', profileError);
      }

      const username =
        S.accountData?.username ||
        user.user_metadata?.username ||
        user.email?.split('@')[0] ||
        'User';

      const crockroachScore =
        S.accountData?.crockroach_score ??
        S.accountData?.crockroachScore ??
        (Number(user.user_metadata?.crockroach_score) || 0);

      S.username = username;
      S.crockroachScore = crockroachScore;

      localStorage.setItem('mortalive_username', S.username);

      // UI/progress enrichment is also non-auth-critical.
      try {
        syncAuthProgress(crockroachScore);
        updateIdentityDisplay();
        updateProgressText();
        // Pre-paint the feed sidebar avatar before any page routing runs,
        // so the photo is present on first navigate rather than after a delay.
        syncFeedSidebar();
      } catch (uiError) {
        console.warn('[Auth] UI hydration warning:', uiError);
      }

      return true;
    } catch (e) {
      // Only a genuinely missing/invalid Supabase session may produce Guest.
      console.warn('[Auth] No valid Supabase session:', e?.message || e);

      // Clear the cached promise so future clicks can genuinely retry
      _autoLoginPromise = null;

      S.authToken = null;
      S.username = null;
      S.userId = null;
      S.accountData = null;
      S.userLinks = [];
      S.crockroachScore = null;
      S.isGuest = true;

      localStorage.removeItem('mortalive_token');
      localStorage.removeItem('mortalive_username');
      localStorage.removeItem('mortalive_user_id');

      return false;
    }
  })();

  return _autoLoginPromise;
}

function initLandingActions() {
  const continueBtn = $('btn-enter') || $('btn-start');

  async function proceedPastLanding() {
    S.pendingAction = null;
    // tryAutoLogin() was kicked off in the background at page load; this
    // just waits on that same result if it hasn't resolved yet.
    const loggedIn = await tryAutoLogin();
    if (loggedIn) {
      enterLobby();
    } else {
      showPage('pg-auth');
      $('tab-login')?.click();
      $('login-email')?.focus?.();
    }
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', proceedPastLanding);
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
  $('btn-switch-account')?.addEventListener('click', () => { showPage('pg-auth'); $('tab-login')?.click(); $('login-email')?.focus?.(); });
  $('score-pill-btn')?.addEventListener('click', openProgressSheet);

  $('btn-logout')?.addEventListener('click', async () => {
    try {
      await sb.auth.signOut();
    } catch (e) {}
    S.authToken   = null;
    S.username    = null;
    S.userId      = null;
    S.accountData = null;
    S.userLinks   = [];
    S.crockroachScore = null;
    S.isGuest     = true;
    _autoLoginPromise = null; // allow fresh login attempt
    localStorage.removeItem('mortalive_token');
    localStorage.removeItem('mortalive_username');
    localStorage.removeItem('mortalive_user_id');
    toast('Logged out', '👋');
    updateIdentityDisplay();
    updateProgressText();
    showPage('pg-auth');
    $('tab-login')?.click();
    $('login-email')?.focus?.();
  });

  const modeToggle = $('mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      const newMode = btn.dataset.mode || 'text';

      if (newMode === 'video' && !S.camGranted) {
        // FIX: this used to set S.pendingAction = 'match', which is the
        // code path meant for clicking "Find" — after granting permission
        // it would immediately call startMatching() and yank the user
        // straight into a search, even though all they did was tap the
        // "Video Chat" mode tab. Using 'lobby-video' here means the
        // permission handler just switches the mode and leaves them in
        // the lobby, matching what they actually asked for.
        S.pendingAction = 'lobby-video';
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
      // P0 FIX: Route through beginRealUserPrioritySearch so the 30-second
      // synthetic fallback timer is always registered on the very first search.
      // Previously, calling startMatching() directly left no fallback timer and
      // caused the infinite "Finding your match / Searching…" screen.
      beginRealUserPrioritySearch({ fallbackToSynthetic: true, reason: 'first-search', priorityWindowMs: 30 * 1000 });
    });
  }
}

/**
 * V136 canonical synthetic transition.
 * Manual Next and natural video end share one state transition.
 */
function transitionFromSyntheticTalk(reason = 'synthetic-ended', quickCheckMs = null) {
  if (!S.syntheticActive || S.talkNextBusy) return false;

  S.talkNextBusy = true;
  const currentVideoId = S.syntheticVideoId;

  if (reason === 'synthetic-skipped') {
    S.syntheticSkipCount = toNum(S.syntheticSkipCount) + 1;
  }

  S.syntheticCurrentIndex += 1;
  rememberSyntheticVideo(currentVideoId);

  logSession('end', {
    reason,
    roomId: S.roomId,
    videoId: currentVideoId,
    durationMs: Math.max(0, Date.now() - (S.syntheticVideoStartTime || Date.now()))
  });

  beginRealUserPrioritySearch({
    fallbackToSynthetic: true,
    reason,
    priorityWindowMs: 10 * 1000
  });

  window.setTimeout(() => { S.talkNextBusy = false; }, 450);
  return true;
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
    
    // V138: Typing indicator
    let typingActive = false;
    input.addEventListener('input', () => {
      const hasText = input.value.trim().length > 0;
      if (hasText && !typingActive) {
        typingActive = true;
        emitTypingStatus(true);
        clearTimeout(S.typingIndicatorTimerId);
        S.typingIndicatorTimerId = setTimeout(() => {
          typingActive = false;
          emitTypingStatus(false);
        }, 3000);
      }
    });
  }

  const handleNext = () => {
    clearTimeout(S.replyTimer);

    if (S.syntheticActive) {
      return transitionFromSyntheticTalk('synthetic-skipped', 10 * 1000);
    }

    if (S.talkNextBusy) return;
    S.talkNextBusy = true;
    finalizeChatProgress('skipped');
    logSession('end', { reason: 'skip', roomId: S.roomId });
    disconnectPeer();
    beginRealUserPrioritySearch({
      fallbackToSynthetic: true,
      reason: 'real-skipped',
      priorityWindowMs: 30 * 1000
    });
    window.setTimeout(() => { S.talkNextBusy = false; }, 450);
  };

  window.mortaliveTalkNext = handleNext;
  $('btn-skip')?.addEventListener('click', handleNext);
  $('btn-skip-fs')?.addEventListener('click', handleNext);
  if ($('btn-skip')) $('btn-skip').dataset.mortaliveTalkBound = '1';
  if ($('btn-skip-fs')) $('btn-skip-fs').dataset.mortaliveTalkBound = '1';

  $('btn-end')?.addEventListener('click', () => {
    clearMatchResumeIntent();
    stopMatchQueueHeartbeat();
    clearTimeout(S.replyTimer);
    clearRealUserCheckTimer();
    clearSyntheticSearchTimer();

    if (S.syntheticActive) {
      stopSyntheticVideo();
      logSession('end', { reason: 'ended_synthetic', roomId: S.roomId, videoId: S.syntheticVideoId });
    } else {
      finalizeChatProgress('completed');
      logSession('end', { reason: 'ended', roomId: S.roomId });
      disconnectPeer();
    }

    showPage('pg-lobby');
    updateIdentityDisplay();
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

  /* Layout toggle kept for future use
  $('vc-layout')?.addEventListener('click', toggleVideoLayout);
  */

  $('vc-flip')?.addEventListener('click', () => {
    const v = $('vid-local');
    if (!v) return;
    const cur = v.style.transform || 'scaleX(-1)';
    v.style.transform = cur.includes('scaleX(-1)') ? 'scaleX(1)' : 'scaleX(-1)';
  });

$('vc-fs')?.addEventListener('click', () => {
  const panel = $('video-panel');
  if (!panel) return;
  dedupeFullscreenControls();
  if (!document.fullscreenElement) {
    // Snapshot BEFORE requestFullscreen — Android rotates the device after this
    // call, so by fullscreenchange screen.orientation already says "landscape".
    S.fsEnteredAsPortrait = getIsPortrait();
    const req = panel.requestFullscreen?.();
    if (req) {
      req.then(() => {
        // Apply grid immediately using the pre-rotation snapshot
        applyFsGrid();
        // Lock orientation so Android can't auto-rotate away from portrait
        if (S.fsEnteredAsPortrait) {
          screen.orientation?.lock?.('portrait').catch(() => {});
        }
        setTimeout(applyFsGrid, 200); // re-check after transition fully settles
      }).catch(() => {});
    }
  } else {
    screen.orientation?.unlock?.();
    S.fsEnteredAsPortrait = null;
    document.exitFullscreen?.();
  }
  setTimeout(() => { applyVideoLayout(); prepareVideoSurfaces(); }, 0);
});


  $('btn-cancel')?.addEventListener('click', () => {
    clearMatchResumeIntent();
    stopMatchQueueHeartbeat();
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
    clearRealUserCheckTimer();
    clearTalkFallbackTimer();
    clearTimeout(talkOptionsPopupTimer);
    S.talkSearchGeneration += 1;
    talkOptionsPopupTimer = null;
    stopSearchSnapshots(); // stop the 2s search loop before leaving pg-match
    disconnectPeer();
    showPage('pg-lobby');
  });


}

function initGlobalDefaults() {
  bootProgressState();
  setActiveMode(S.mode);
  updateOnlineCount();
  applyVideoLayout();
  refreshLaunchpadCopy();
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
    if (S.syntheticActive) {
      console.warn('[Talk] Ignoring real-user match while synthetic playback is active.');
      try { S.socket?.emit('leave', { roomId: data.roomId }); } catch (_) {}
      return;
    }
    clearMatchResumeIntent();
    stopMatchQueueHeartbeat();
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
    clearRealUserCheckTimer();
    clearTimeout(talkOptionsPopupTimer);
    talkOptionsPopupTimer = null;
    clearSyntheticSearchTimer(); // BUG FIX: was missing () — timer was never actually cleared
    stopSearchSnapshots(); // stop the 2s search loop — connected chat takes over
    S.matched = true;
    S.roomId = data.roomId;
    // From this point forward snapshots belong to the dual-user room.
    S.searchSessionId = null;
    S.isInitiator = !!data.initiator;
    S.stranger = {
      name: (data.peer && data.peer.name) || 'Stranger',
      score: data.peer && typeof data.peer.score === 'number' ? data.peer.score : null,
      emoji: (data.peer && data.peer.emoji) || '👤',
      userId: data.peer && data.peer.id ? data.peer.id : null,
      isGuest: !!(data.peer && data.peer.isGuest),
      interest: data.peer && data.peer.interest ? data.peer.interest : null
    };
    // V138: Store peer's interest for feedback display
    S.peerInterest = S.stranger.interest;
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

  // V138: Typing indicators
  S.socket.on('peer-typing', ({ isTyping }) => {
    S.peerTyping = !!isTyping;
    clearTimeout(S.peerTypingTimeout);
    if (isTyping) {
      updateTypingIndicator();
      // Auto-hide typing after 5 seconds if no update
      S.peerTypingTimeout = setTimeout(() => {
        S.peerTyping = false;
        updateTypingIndicator();
      }, 5000);
    } else {
      updateTypingIndicator();
    }
  });

  S.socket.on('peer-disconnected', () => {
    finalizeChatProgress('peer-disconnected');
    addSysLine('👋 Stranger disconnected');
    setCallStatus('failed', 'disconnected');
    hideRemoteVideo('Stranger disconnected');
  });

  S.socket.on('connect_error', (err) => {
    console.log('[Socket] connect_error:', err.message);
  });
}

let matchTimeout = null;
let talkOptionsPopupTimer = null;


function setMatchResumeIntent() {
  try {
    localStorage.setItem('mortalive_resume_match_v2', JSON.stringify({
      ts: Date.now(),
      mode: S.mode === 'video' ? 'video' : 'text',
      interest: String(S.interest || '').slice(0, 120)
    }));
  } catch (_) {}
}

function clearLegacyMatchResumeIntent() {
  try { localStorage.removeItem('mortalive_resume_match_v1'); } catch (_) {}
}

function clearMatchResumeIntent() {
  try {
    localStorage.removeItem('mortalive_resume_match_v2');
    localStorage.removeItem('mortalive_resume_match_v1');
  } catch (_) {}
}

function getMatchResumeIntent() {
  try {
    const raw = localStorage.getItem('mortalive_resume_match_v2') || localStorage.getItem('mortalive_resume_match_v1');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const ts = Number(data?.ts || 0);
    if (!ts || Date.now() - ts > 30 * 60 * 1000) {
      clearMatchResumeIntent();
      return null;
    }
    return {
      mode: data?.mode === 'video' ? 'video' : 'text',
      interest: String(data?.interest || '').slice(0, 120)
    };
  } catch (_) {
    return null;
  }
}

function startMatchQueueHeartbeat() {
  clearInterval(S.matchQueueHeartbeat);
  S.matchQueueHeartbeat = setInterval(() => {
    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (S.matched || !onMatchingScreen) {
      clearInterval(S.matchQueueHeartbeat);
      S.matchQueueHeartbeat = null;
      return;
    }
    if (S.socket?.connected) {
      try {
        S.socket.emit('queue', {
          mode: S.mode === 'video' ? 'video' : 'text',
          pref: S.interest,
          token: S.authToken,
          guestName: S.guestName
        });
      } catch (_) {}
    }
  }, 5000);
}

function stopMatchQueueHeartbeat() {
  clearInterval(S.matchQueueHeartbeat);
  S.matchQueueHeartbeat = null;
}

function resumePendingMatchIntent() {
  // V121: intentionally disabled.
  // A persisted Supabase session means "stay logged in", not "start Talk".
  // The user must explicitly press Find a match from the Talk lobby.
  clearMatchResumeIntent();
  return false;
}


function clearRealUserCheckTimer() {
  clearTimeout(S.realUserCheckTimer);
  S.realUserCheckTimer = null;
}

function startRealUserCheckTimer(checkDurationMs = 30 * 1000, onTimeout = null) {
  clearRealUserCheckTimer();
  // P0 FIX: Unified to 30 seconds to match the global policy everywhere else.
  // The old 10-minute fallback contradicted the 30-second priority window.
  const duration = Math.max(1000, Number(checkDurationMs) || 30 * 1000);
  S.realUserCheckTimer = setTimeout(() => {
    S.realUserCheckTimer = null;
    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (!onMatchingScreen || S.matched) return;
    if (typeof onTimeout === 'function') {
      try { onTimeout(); } catch (err) { console.warn('[Talk] priority-window fallback failed:', err?.message || err); }
      return;
    }
    if (S.socket?.connected) {
      try { S.socket.emit('queue', { mode: S.mode === 'video' ? 'video' : 'text', pref: S.interest, token: S.authToken, guestName: S.guestName }); } catch (_) {}
      startMatchQueueHeartbeat();
    }
  }, duration);
}

function clearTalkFallbackTimer() {
  clearTimeout(S.talkFallbackTimer);
  S.talkFallbackTimer = null;
}

function beginRealUserPrioritySearch({
  fallbackToSynthetic = false,
  reason = 'searching',
  priorityWindowMs = 30 * 1000,
  quickCheckMs = null
} = {}) {
  clearRealUserCheckTimer();
  clearSyntheticSearchTimer();
  clearTalkFallbackTimer();
  stopSyntheticVideo();

  const generation = ++S.talkSearchGeneration;
  const totalWindow = Math.max(1000, Number(priorityWindowMs) || 30 * 1000);
  const quickWindow = quickCheckMs == null
    ? null
    : Math.max(1000, Math.min(totalWindow, Number(quickCheckMs) || 10000));

  // Arm the authoritative fallback BEFORE any socket/UI work. This prevents
  // a synchronous/re-entrant queue path from ever leaving first search without
  // a fallback timer.
  if (fallbackToSynthetic) {
    S.talkFallbackTimer = setTimeout(() => {
      if (generation !== S.talkSearchGeneration) return;
      S.talkFallbackTimer = null;

      const onMatchingScreen = $('pg-match')?.classList.contains('active');
      if (!onMatchingScreen || S.matched || S.syntheticActive) return;

      console.log(`[Talk] ${Math.round(totalWindow / 1000)}-second real-user priority window expired; offering synthetic Talk video.`);
      beginSyntheticMatch();
    }, totalWindow);
  }

  const message = reason === 'synthetic-ended'
    ? '↩ Video ended — searching for real people…'
    : '↩ Searching for another real person…';

  startMatching();

  // Restore/reassert the active generation after startMatching() so the
  // timer cannot be invalidated by setup code.
  S.talkSearchGeneration = generation;
  addSysLine(message);

  if (fallbackToSynthetic && quickWindow && quickWindow < totalWindow) {
    setTimeout(() => {
      if (generation !== S.talkSearchGeneration) return;
      const onMatchingScreen = $('pg-match')?.classList.contains('active');
      if (!onMatchingScreen || S.matched || S.syntheticActive) return;
      console.log('[Talk] 10-second real-user check completed; continuing to prioritize real users.');
    }, quickWindow);
  }
}

function startMatching() {
  // Explicit user action (or an already-authorized fallback transition) is the
  // only way to enter matchmaking. Preserve one searchSessionId per continuous
  // solo-search phase.
  const alreadySearching = $('pg-match')?.classList.contains('active') && !S.matched && S.searchSessionId;
  if (!alreadySearching) {
    S.searchSessionId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    S.roomId = null;
  }

  const requestedMode = S.mode === 'video' ? 'video' : 'text';

  // Important V129 ordering: mark the state BEFORE touching Socket.IO so a
  // very fast 'matched' event cannot be overwritten by this function.
  S.matched = false;
  S.connectFailed = false;

  setMatchResumeIntent();
  clearSyntheticSearchTimer();
  showSearchScreen();
  initSocket();

  clearTimeout(matchTimeout);
  clearTimeout(S.noMatchTimeout);
  S.noMatchTimeout = null;

  let failedAttempts = 0;
  const onConnectError = (err) => {
    failedAttempts += 1;
    console.warn(`[Mortalive] connect_error (#${failedAttempts}):`, err?.message || err);
    if (S.matched || S.connectFailed) return;

    if (failedAttempts >= 4) {
      S.connectFailed = true;
      console.warn('[Mortalive] Server unreachable after repeated attempts — synthetic fallback timer remains authoritative.');
    }
  };

  if (S.socket && S._lastConnectErrorHandler) {
    S.socket.off('connect_error', S._lastConnectErrorHandler);
  }
  S.socket?.on('connect_error', onConnectError);
  S._lastConnectErrorHandler = onConnectError;

  // Re-announce the exact active mode. Never hard-code text during video Talk.
  if (S.socket?.connected && !S.matched) {
    try {
      S.socket.emit('queue', {
        mode: requestedMode,
        pref: S.interest,
        token: S.authToken,
        guestName: S.guestName
      });
    } catch (_) {}
  }

  // If the socket itself never connects, retain a bounded safety fallback.
  // The generation-safe real-user priority timer handles the normal path.
  matchTimeout = setTimeout(() => {
    if (S.matched || S.connectFailed) return;
    if (!S.socket?.connected) {
      console.warn('[Talk] Socket did not connect within safety window; synthetic fallback remains available.');
    }
  }, 20000);

  clearTimeout(talkOptionsPopupTimer);
  startMatchQueueHeartbeat();
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
    // Stop any real WebRTC tracks (never stop our own local stream).
    try {
      if (remote.srcObject && remote.srcObject !== S.localStream) {
        remote.srcObject.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {}
    remote.srcObject = null;
    // Also clear src in case this was a synthetic video file.
    if (remote.src) {
      remote.onended = null;
      remote.pause();
      remote.src = '';
      remote.removeAttribute('src');
    }
    remote.style.display = 'none';
  }
  if (noVideo) noVideo.style.display = 'flex';
  if (txt) txt.textContent = message || 'Waiting for video…';
  if (q) q.style.display = 'none';
}

async function startWebRTC() {
  ensureTalkVideoPanel();
  try {
    if (!S.localStream || !S.localStream.active) {
      S.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      S.camGranted = true;
    }

    const localVid = $('vid-local');
    const noVideo = $('no-video-ph');
    const txt = $('ph-txt');
    
    if (localVid) {
      prepareVideoElement(localVid);
      localVid.srcObject = S.localStream;
      localVid.style.display = 'block';
      localVid.muted = true;
    }
    if (noVideo) noVideo.style.display = 'none';
    if (txt) txt.textContent = "Waiting for stranger's camera…";

    S.pc = new RTCPeerConnection(ICE_CONFIG);
    S.pendingCandidates = [];

    S.localStream.getTracks().forEach((track) => S.pc.addTrack(track, S.localStream));

    S.pc.ontrack = (event) => {
      const remoteVid = $('vid-remote');
      if (remoteVid) {
        prepareVideoElement(remoteVid);
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

// ═══════════════════════════════════════════════════════════════════
// SYNTHETIC VIDEO FALLBACK — ACTIVE
// When no real user is found within the 30-second priority window,
// Talk falls back to synthetic video clips. This is NOT a session cap.
// User can cycle: real → synthetic → real → synthetic indefinitely.
// Synthetic never auto-connects two users; real always has priority.
// ═══════════════════════════════════════════════════════════════════

async function fetchSyntheticVideoBatch(limit = 1, excludeIds = []) {
  try {
    const params = new URLSearchParams({ limit: String(Math.min(20, Math.max(1, Number(limit) || 1))) });
    const exclusions = Array.from(new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String))).slice(-40);
    if (exclusions.length) params.set('exclude', exclusions.join(','));
    const res = await fetch(`${SERVER_URL}/api/synthetic-videos?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.videos) ? data.videos : [];
  } catch (e) {
    console.warn('[Synthetic] Talk fallback inventory unavailable:', e?.message || e);
    return [];
  }
}

function getSyntheticSeenIds() {
  if (!Array.isArray(S.syntheticSeenIds)) S.syntheticSeenIds = [];
  return S.syntheticSeenIds.map(String);
}
function rememberSyntheticVideo(videoId) {
  if (videoId == null) return;
  const id = String(videoId);
  const ids = getSyntheticSeenIds().filter(existing => existing !== id);
  ids.push(id);
  S.syntheticSeenIds = ids.slice(-40);
}

function shuffleSyntheticVideos(videos = []) {
  const out = Array.isArray(videos) ? videos.filter(Boolean).slice() : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function scheduleSyntheticSearchResume(delayMs = 900) {
  clearSyntheticSearchTimer();
  S.syntheticSearchTimer = setTimeout(() => {
    S.syntheticSearchTimer = null;
    if (S.matched || !$('pg-match')?.classList.contains('active')) return;
    beginSyntheticMatch();
  }, Math.max(250, Number(delayMs) || 900));
}

async function beginSyntheticMatch() {
  ensureTalkVideoPanel();
  clearSyntheticSearchTimer();
  clearRealUserCheckTimer();
  stopSearchSnapshots();
  stopMatchQueueHeartbeat();
  // A synthetic chat is not a live queue participant. Cancel the real-user
  // queue before playback so a newly arriving person cannot be paired into
  // this synthetic session in the background.
  if (S.socket?.connected) {
    try { S.socket.emit('cancel-queue'); } catch (_) {}
  }

  // Fetch a new batch of up to 6 when the current one is exhausted.
  if (!Array.isArray(S.syntheticVideos) || !S.syntheticVideos.length ||
      S.syntheticCurrentIndex >= S.syntheticVideos.length) {
    const batch = await fetchSyntheticVideoBatch(6, getSyntheticSeenIds());
    if (!batch.length) {
      // V140: preserve recent synthetic IDs during inventory refill so a
      // skipped video cannot immediately reappear when the normal request
      // returns no eligible rows.
      const recentSkips = Array.isArray(S.syntheticSeenIds)
        ? S.syntheticSeenIds.slice(-5)
        : [];
      S.syntheticSeenIds = [];
      const refill = await fetchSyntheticVideoBatch(6, recentSkips);
      if (!refill.length) {
        console.warn('[Synthetic] No Talk fallback inventory; returning to real-user search.');
        beginRealUserPrioritySearch({ fallbackToSynthetic: true, reason: 'no-synthetic-inventory' });
        return;
      }
      S.syntheticVideos = shuffleSyntheticVideos(refill);
    } else {
      S.syntheticVideos = shuffleSyntheticVideos(batch);
    }
    S.syntheticCurrentIndex = 0;
    // Pre-register all fetched IDs so the next batch excludes them.
    S.syntheticVideos.forEach(v => { if (v?.id != null) rememberSyntheticVideo(v.id); });
  }

  const video = S.syntheticVideos[S.syntheticCurrentIndex];
  if (!video?.video_url) {
    S.syntheticCurrentIndex += 1;
    return beginSyntheticMatch();
  }

  S.syntheticActive = true;
  S.syntheticVideoId = video.id;
  rememberSyntheticVideo(video.id);
  S.syntheticVideoStartTime = Date.now();
  S.stranger = {
    name: video.stranger_name || 'Stream User',
    score: typeof video.stranger_score === 'number' ? video.stranger_score : null,
    emoji: video.stranger_emoji || '🎬',
    isGuest: video.is_guest !== false,
    isSynthetic: true
  };
  S.roomId = `synthetic-${video.id}-${Date.now()}`;
  S.mode = 'video';
  setActiveMode('video');
  beginChat();
  syncLocalCameraPreview();

  const remoteVid = $('vid-remote');
  if (remoteVid) {
    prepareVideoElement(remoteVid);
    remoteVid.srcObject = null;
    remoteVid.src = String(video.video_url);
    remoteVid.loop = false;
    remoteVid.style.display = 'block';
    remoteVid.onended = () => transitionFromSyntheticTalk('synthetic-ended');
    remoteVid.play().catch((e) => {
      console.warn('[Synthetic] playback failed:', e?.message || e);
      setText('ph-txt', 'Video could not load — trying the next connection.');
      setTimeout(() => remoteVid.onended?.(), 350);
    });
  }

  $('no-video-ph')?.style.setProperty('display', 'none');
  const syntheticPanel = $('video-panel');
  if (syntheticPanel) {
    syntheticPanel.classList.add('visible', 'has-remote');
    syntheticPanel.style.display = 'flex';
    syntheticPanel.style.visibility = 'visible';
    syntheticPanel.style.opacity = '1';
  }
  $('video-feeds')?.style.setProperty('display', 'grid');
  $('video-feeds')?.style.setProperty('visibility', 'visible');
  $('video-feeds')?.style.setProperty('min-height', '0');
  $('quality-bar')?.style.setProperty('display', 'none');
  applyVideoLayout();
  setCallStatus('connected', 'video');
  logSession('start', { stranger: S.stranger.name, mode: 'video', roomId: S.roomId, isSynthetic: true, syntheticVideoId: video.id });
  recordSyntheticConnection(video.id);
}

function stopSyntheticVideo() {
  stopSnapshotCapture();
  S.syntheticActive = false;
  S.stranger = null;
  const remoteVid = $('vid-remote');
  if (remoteVid) {
    remoteVid.onended = null;
    remoteVid.pause();
    remoteVid.src = '';
    remoteVid.removeAttribute('src');
    remoteVid.style.display = 'none';
  }
  const panel = $('video-panel');
  if (panel) panel.classList.remove('visible', 'has-remote');
  S.syntheticVideoId = null;
  S.syntheticVideoStartTime = null;
  // P1 FIX: Clear the synthetic room ID so the subsequent real-user search phase
  // uses the new searchSessionId for snapshot grouping (sendSnapshot uses
  // S.roomId || S.searchSessionId — roomId must be null during search).
  S.roomId = null;
}

function getTalkConnectionCount() {
  const progress = getCurrentProgress();
  try {
    const raw = JSON.parse(localStorage.getItem('mortalive_talk_v3') || '{}');
    const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
    const uniquePeople = new Set();
    sessions.forEach((session, index) => {
      if (!session) return;
      if (session.userId) {
        uniquePeople.add(`user:${String(session.userId)}`);
        return;
      }
      const peer = String(session.peer || 'Stranger').trim().toLowerCase();
      const mode = String(session.mode || 'text').toLowerCase();
      uniquePeople.add(peer ? `anon:${mode}:${peer}` : `session:${session.ts || index}`);
    });
    if (uniquePeople.size) return uniquePeople.size;
    return Math.max(0, Number(raw.totalChats) || sessions.length || toNum(progress.completions));
  } catch (_) {
    return Math.max(0, toNum(progress.completions));
  }
}

function recordSyntheticConnection(videoId) {
  if (!videoId) return;
  try {
    const raw = localStorage.getItem('mortalive_synthetic_connections_v1');
    const ids = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!list.includes(String(videoId))) {
      list.push(String(videoId));
      localStorage.setItem('mortalive_synthetic_connections_v1', JSON.stringify(list.slice(-500)));
    }
  } catch (_) {}
}

function generateProfileShareCard() {
  const username = S.profileViewUserId
    ? (S.profileViewData?.username || '')
    : (S.accountData?.username || S.username || '');
  const displayName = S.profileViewUserId
    ? (S.profileViewData?.display_name || S.profileViewData?.full_name || username)
    : (S.accountData?.display_name || S.accountData?.full_name || username);
  const score = getProgressScore(getCurrentProgress());
  const profileUrl = username ? `${window.location.origin}/@${encodeURIComponent(username)}` : window.location.origin;

  // Portrait social-card format: 900 × 1350 (2:3).
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  // Light base with soft blue edge treatment.
  ctx.fillStyle = '#f7fbff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Blue strips running in from different edges/corners.
  const strips = [
    { x: -140, y: 80, w: 560, h: 72, r: -0.42 },
    { x: 600, y: -40, w: 520, h: 70, r: 0.52 },
    { x: 520, y: 520, w: 500, h: 64, r: -0.38 },
    { x: -170, y: 1050, w: 620, h: 74, r: 0.38 },
    { x: 520, y: 1210, w: 520, h: 58, r: -0.48 }
  ];
  strips.forEach(({ x, y, w, h, r }, i) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    ctx.fillStyle = i % 2 ? '#93c5fd' : '#2563eb';
    ctx.globalAlpha = i % 2 ? 0.55 : 0.9;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  });
  ctx.globalAlpha = 1;

  // Soft central card.
  const cardX = 55, cardY = 150, cardW = 790, cardH = 1000;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.shadowColor = 'rgba(37,99,235,0.12)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 42);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = '#1d4ed8';
  ctx.font = '800 38px Inter, Arial, sans-serif';
  ctx.fillText('Mortalive', 100, 235);

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 64px Inter, Arial, sans-serif';
  const safeName = String(displayName || 'Mortalive User').slice(0, 24);
  ctx.fillText(safeName, 100, 370);

  ctx.fillStyle = '#2563eb';
  ctx.font = '600 30px Inter, Arial, sans-serif';
  ctx.fillText(`@${username || 'user'}`, 100, 420);

  // Score block.
  ctx.fillStyle = '#eff6ff';
  ctx.beginPath();
  ctx.roundRect(100, 500, 700, 205, 28);
  ctx.fill();

  ctx.fillStyle = '#1d4ed8';
  ctx.font = '800 92px Inter, Arial, sans-serif';
  ctx.fillText(String(score), 135, 610);
  ctx.fillStyle = '#334155';
  ctx.font = '700 27px Inter, Arial, sans-serif';
  ctx.fillText('crockroach Score', 140, 665);

  ctx.fillStyle = '#475569';
  ctx.font = '600 28px Inter, Arial, sans-serif';
  ctx.fillText('Connect with me on Mortalive', 100, 825);

  ctx.fillStyle = '#2563eb';
  ctx.font = '700 24px Inter, Arial, sans-serif';
  const displayUrl = profileUrl.length > 52 ? profileUrl.slice(0, 49) + '…' : profileUrl;
  ctx.fillText(displayUrl, 100, 875);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 23px Inter, Arial, sans-serif';
  ctx.fillText('Meet people. Build your network.', 100, 1015);

  // Decorative blue edge strips at the bottom of the card.
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(100, 1080, 230, 8);
  ctx.fillStyle = '#93c5fd';
  ctx.fillRect(345, 1080, 120, 8);
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(480, 1080, 220, 8);

  const link = document.createElement('a');
  link.download = `mortalive-profile-${username || 'card'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('Portrait profile card downloaded', '🪪');
}

function showConnectMoreOverlay() {
  // V124: Talk informational/connect-more popup is retired.
  // Matchmaking must never surface the old "connected with X people" popup.
  document.getElementById('syn-connect-more-overlay')?.remove();
  document.getElementById('synthetic-exhaustion-overlay')?.remove();
  return false;
}
function showShareOverlay() {
  document.getElementById('syn-share-overlay')?.remove();

  const shareUrl  = window.location.origin;
  const shareText = `Join me on Mortalive — meet people and build your network: ${shareUrl}`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'syn-share-overlay';

  overlay.innerHTML = `
    <div class="modal" style="width:min(460px,100%);">
      <div class="modal-ico">🔗</div>
      <div class="modal-title">Invite friends</div>
      <div class="modal-sub">Share this link — more people means real matches faster.</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <input id="syn-share-input" type="text" value="${shareUrl}" readonly
          style="flex:1;padding:11px 13px;border:1.5px solid var(--border-strong);border-radius:12px;
                 background:var(--surface);color:var(--on-surface);font-size:13px;outline:none;">
        <button id="syn-copy-btn" class="btn btn-primary" style="min-width:auto;padding:11px 16px;">Copy</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <button id="syn-share-twitter"  class="btn btn-ghost" style="font-size:13px;">𝕏 Tweet</button>
        <button id="syn-share-whatsapp" class="btn btn-ghost" style="font-size:13px;">💬 WhatsApp</button>
      </div>
      <button id="syn-share-close" class="btn btn-ghost btn-wide" style="margin-top:14px;">← Back</button>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('syn-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(shareUrl)
      .then(() => toast('Link copied!', '📋'))
      .catch(() => toast('Copy failed — select and copy manually', '⚠️'));
  });

  document.getElementById('syn-share-twitter')?.addEventListener('click', () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank', 'width=550,height=420');
  });

  document.getElementById('syn-share-whatsapp')?.addEventListener('click', () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  });

  document.getElementById('syn-share-close')?.addEventListener('click', () => {
    overlay.remove();
    // Take them back to the lobby rather than leaving them in limbo.
    showPage('pg-lobby');
    updateIdentityDisplay();
  });
}

function startBotChat() {
  // Pure text chat with a simple AI-driven bot.
  clearSyntheticSearchTimer();
  S.syntheticActive = false;
  S.stranger = { name: 'Mortalive AI', score: null, emoji: '🤖', isGuest: true, isBot: true };
  S.roomId   = `bot-${Date.now()}`;
  S.mode     = 'text';
  setActiveMode('text');

  beginChat();

  // Hide video panel — this is a text-only session.
  const panel = $('video-panel');
  if (panel) panel.classList.remove('visible');

  setCallStatus('connected', 'AI chat');

  setTimeout(() => {
    appendMsg("Hey! I'm Mortalive's AI. Real people are being matched as the community grows — for now, ask me anything or just chat.", 'them');
  }, 700);

  logSession('start', { stranger: 'Mortalive AI', mode: 'text', roomId: S.roomId, isBot: true });
}

// Override scheduleReply to use BOT_REPLIES when in bot chat
// (real WebRTC chats never reach this because we guard on socket.connected)
function scheduleReplyMaybeBot() {
  clearTimeout(S.replyTimer);
  if (isSyntheticPlayback()) return;
  if (S.stranger && S.stranger.isBot) {
    // Always reply in bot mode
    S.replyTimer = setTimeout(() => {
      appendMsg(BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)], 'them');
    }, 1200 + Math.random() * 2000);
  } else if (Math.random() > 0.22) {
    S.replyTimer = setTimeout(() => {
      if (S.socket && S.socket.connected) return;
      appendMsg(BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)], 'them');
    }, 1100 + Math.random() * 2800);
  }
}

function syncTalkPeerFollowUI() {
  const wrap = $('talk-peer-actions');
  const followBtn = $('btn-follow-peer');
  const peer = S.stranger || {};
  if (!wrap || !followBtn) return;

  const userId = peer.userId || null;
  const eligible = !!(userId && !peer.isGuest && !peer.isBot && !S.isGuest && S.userId && userId !== S.userId);
  wrap.style.display = eligible ? 'flex' : 'none';
  if (!eligible) {
    followBtn.style.display = 'none';
    return;
  }

  followBtn.style.display = '';
  followBtn.disabled = true;
  followBtn.textContent = '…';

  fetchFollowData(userId).then((data) => {
    if (!eligible || S.stranger?.userId !== userId) return;
    followBtn.disabled = false;
    followBtn.textContent = data.isFollowing ? '✓ Following' : '+ Follow';
    followBtn.classList.toggle('talk-peer-following', !!data.isFollowing);
  }).catch(() => {
    if (eligible && S.stranger?.userId === userId) {
      followBtn.disabled = false;
      followBtn.textContent = '+ Follow';
    }
  });
}

function bindTalkPeerActions() {
  const wrap = $('talk-peer-actions');
  const followBtn = $('btn-follow-peer');
  if (!wrap || !followBtn || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';

  followBtn.addEventListener('click', async () => {
    const peer = S.stranger || {};
    const targetId = peer.userId;
    if (!targetId || peer.isGuest || peer.isBot || S.isGuest) {
      toast('Sign in to follow people you meet.', '🔒');
      return;
    }
    try {
      const cached = _followCache.get(targetId) || await fetchFollowData(targetId);
      const next = !cached.isFollowing;
      followBtn.disabled = true;
      const updated = await toggleFollow(targetId, next);
      followBtn.textContent = updated.isFollowing ? '✓ Following' : '+ Follow';
      followBtn.classList.toggle('talk-peer-following', !!updated.isFollowing);
      toast(updated.isFollowing ? `Following @${peer.name}` : `Unfollowed @${peer.name}`, updated.isFollowing ? '✓' : '➖');
    } catch (error) {
      toast(error?.message || 'Could not update follow.', '⚠️');
    } finally {
      if (S.stranger?.userId === targetId) followBtn.disabled = false;
    }
  });

}

function beginChat() {
  ensureTalkVideoPanel();
  resetChatProgress();
  const msgs = $('chat-msgs');
  if (msgs) msgs.innerHTML = '';

  const s = S.stranger || { name: 'Stranger', score: null, emoji: '👤', isGuest: true };
  setText('peer-ava', s.emoji);
  setText('peer-name', s.name);
  
  // V138: Interest match feedback
  let scoreText = s.isGuest || s.score === null ? 'Guest · connected' : `🧲 ${s.score} crockroach Score · connected`;
  if (S.interest && S.peerInterest) {
    const interestMatch = S.interest.toLowerCase().trim() === S.peerInterest.toLowerCase().trim();
    scoreText += interestMatch ? ' ✓ Same interest' : ` · Interest: ${S.peerInterest}`;
  } else if (S.peerInterest) {
    scoreText += ` · Interest: ${S.peerInterest}`;
  }
  setText('peer-score', scoreText);
  bindTalkPeerActions();
  syncTalkPeerFollowUI();

  const panel = $('video-panel');
  
  applyVideoLayout();
  if (S.mode === 'video') {
    if (panel) {
      panel.classList.add('visible');
      panel.style.display = 'flex';
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';
    }
    $('btn-toggle-video')?.classList.add('active');
  } else {
    if (panel) panel.classList.remove('visible');
    $('btn-toggle-video')?.classList.remove('active');
  }

  showPage('pg-chat');
  applyVideoLayout();
  setCallStatus('connecting', 'connecting');
  S.chatStartedAt = Date.now();
  startTalkDurationTimer();
  addSysLine(`✨ Connected to ${s.name}`);
  logSession('start', { stranger: s.name, mode: S.mode, roomId: S.roomId });
  startSnapshotCapture();

  setTimeout(() => {
    if (S.mode !== 'video') setCallStatus('connected', 'live');
  }, 700);

  // Don't send a typed opener during synthetic video — the person is already
  // "speaking" on screen. Bot chat sends its own greeting separately.
  if (!isSyntheticPlayback() && !(S.stranger && S.stranger.isBot) && Math.random() > 0.35) {
    const openers = ['hey!', 'hi there 👋', 'hello!', "what's up?", 'yo', 'heyyy 👀'];
    setTimeout(() => appendMsg(openers[Math.floor(Math.random() * openers.length)], 'them'), 700 + Math.random() * 600);
  }
}

function appendMsg(text, who) {
  const msgs = $('chat-msgs');
  if (!msgs) return;

  // V138: Clear typing indicator when message received from peer
  if (who === 'them') {
    S.peerTyping = false;
    clearTimeout(S.peerTypingTimeout);
    updateTypingIndicator();
  }

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
  if (who === 'me') scheduleReplyMaybeBot();
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
  // V138: Clear typing when message is sent
  clearTimeout(S.typingIndicatorTimerId);
  emitTypingStatus(false);
  
  appendMsg(text, 'me');
  awardProgress('message', 1, { message: true });

  if (S.socket && S.socket.connected) {
    S.socket.emit('chat', { roomId: S.roomId, text });
  }
}

// V138: Typing indicator functions
function emitTypingStatus(isTyping) {
  if (S.socket && S.socket.connected && S.roomId) {
    S.socket.emit('typing', { roomId: S.roomId, isTyping });
  }
}

function updateTypingIndicator() {
  const nameEl = $('peer-score');
  if (!nameEl) return;
  
  const s = S.stranger || { name: 'Stranger', score: null, emoji: '👤', isGuest: true };
  let scoreText = s.isGuest || s.score === null ? 'Guest · connected' : `🧲 ${s.score} crockroach Score · connected`;
  
  if (S.peerTyping) {
    scoreText += ' · typing…';
  } else if (S.interest && S.peerInterest) {
    const interestMatch = S.interest.toLowerCase().trim() === S.peerInterest.toLowerCase().trim();
    scoreText += interestMatch ? ' ✓ Same interest' : ` · Interest: ${S.peerInterest}`;
  } else if (S.peerInterest) {
    scoreText += ` · Interest: ${S.peerInterest}`;
  }
  
  setText('peer-score', scoreText);
}

function disconnectPeer() {
  try {
    if (typeof window.__mortaliveRecordTalkBeforeDisconnect === 'function') {
      window.__mortaliveRecordTalkBeforeDisconnect();
    }
  } catch (_) {}

  clearTimeout(S.replyTimer);
  clearTimeout(matchTimeout);
  clearTimeout(S.typingIndicatorTimerId); // V138: Clear typing indicator timer
  clearTimeout(S.peerTypingTimeout); // V138: Clear peer typing timeout
  stopTalkDurationTimer();
  clearSyntheticSearchTimer();
  stopSearchSnapshots(); // safety net — kills 2s search loop on any disconnect path
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

  hideRemoteVideo('Waiting for video…');
  S.pendingCandidates = [];
  S.roomId = null;
  S.searchSessionId = null;
  S.stranger = null;
  S.isInitiator = false;
  S.syntheticActive = false;
  // V138: Reset typing state
  S.peerTyping = false;
  S.peerInterest = null;
}

function logSession(event, data) {
  fetch(`${SERVER_URL}/api/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, ...data, token: S.authToken, ts: Date.now() })
  }).catch(() => {});
}

function captureFrame(videoEl) {
  if (!videoEl) return null;
  // videoWidth/videoHeight are 0 until the browser has decoded and
  // rendered at least one frame. Drawing to canvas before that produces
  // a blank image even though the element exists and srcObject is set.
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
  if (videoEl.readyState < 2) return null; // HAVE_CURRENT_DATA not yet reached
  try {
    const canvas = document.createElement('canvas');
    // Cap resolution — full 1080p frames are 200-400KB each as JPEG,
    // too large for frequent POSTs. 640x360 is sufficient for moderation.
    const maxW = 640;
    const scale = Math.min(1, maxW / videoEl.videoWidth);
    canvas.width  = Math.round(videoEl.videoWidth  * scale);
    canvas.height = Math.round(videoEl.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    // If vid-local is CSS-mirrored with scaleX(-1), the canvas won't
    // inherit that transform — draw it mirrored explicitly so the saved
    // frame matches what was actually visible on screen.
    const isMirrored = videoEl.id === 'vid-local';
    if (isMirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
    // A blank/all-black canvas still produces a valid dataUrl but its
    // base64 payload is very short. Reject anything suspiciously small.
    if (dataUrl.length < 1500) return null;
    return dataUrl;
  } catch (e) { return null; }
}

function sendSnapshot(source, dataUrl) {
  if (!dataUrl || !SERVER_URL) return;

  const snapshotRoomId =
    S.roomId ||
    S.searchSessionId ||
    `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = JSON.stringify({
    roomId: snapshotRoomId,
    source: source || 'unknown',
    image: dataUrl,
    actor: S.username || S.guestName || 'guest'
  });

  fetch(`${SERVER_URL.replace(/\/$/, '')}/api/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: payload,
    cache: 'no-store',
    credentials: 'omit'
  }).catch(() => {});
}

function clearSnapshotBurstTimers() {
  if (!Array.isArray(S.snapshotBurstTimers)) {
    S.snapshotBurstTimers = [];
    return;
  }
  S.snapshotBurstTimers.forEach((timer) => clearTimeout(timer));
  S.snapshotBurstTimers = [];
}

function captureSnapshotFromAny(selectors = []) {
  const ids = Array.isArray(selectors) && selectors.length ? selectors : ['vid-local', 'lobby-cam-preview', 'perm-video', 'vid-remote'];
  for (const id of ids) {
    const frame = captureFrame($(id));
    if (frame) return { sourceId: id, frame };
  }
  return null;
}

function queueSnapshotBurst(prefix, count = 1, selectors = [], initialDelay = 160, interval = 260) {
  if (!count || count < 1) return;
  if (!Array.isArray(S.snapshotBurstTimers)) S.snapshotBurstTimers = [];

  for (let i = 0; i < count; i++) {
    const timer = setTimeout(() => {
      const shot = captureSnapshotFromAny(selectors);
      if (shot) {
        sendSnapshot(`${prefix}-${i + 1}`, shot.frame);
      }
    }, initialDelay + (i * interval));
    S.snapshotBurstTimers.push(timer);
  }
}

function startSnapshotCapture() {
  stopSnapshotCapture();
  if (S.mode !== 'video') return;

  let frameCounter = 0;
  const tick = () => {
    const panelActive = $('pg-chat')?.classList.contains('active');
    if (!panelActive || (!S.matched && !S.syntheticActive)) {
      S.snapshotRaf = null;
      return;
    }

    frameCounter += 1;
    if (frameCounter % 4 === 0) {
      const localFrame = captureFrame($('vid-local'));
      const remoteFrame = captureFrame($('vid-remote'));
      if (localFrame) sendSnapshot('local', localFrame);
      if (remoteFrame) sendSnapshot('remote', remoteFrame);
    }

    S.snapshotRaf = requestAnimationFrame(tick);
  };

  S.snapshotRaf = requestAnimationFrame(tick);
}

function stopSnapshotCapture() {
  clearTimeout(S.snapshotTimer);
  S.snapshotTimer = null;
  if (S.snapshotRaf) {
    cancelAnimationFrame(S.snapshotRaf);
    S.snapshotRaf = null;
  }
  clearSnapshotBurstTimers();
}

// ── Search-phase snapshot loop ─────────────────────────────────────────────
// Fires once every 2 seconds while the user is on the matching/searching
// screen (pg-match). Captures from whichever local camera surface is live
// at that moment. Stops automatically as soon as a match is found, the user
// cancels, or they navigate away. The existing startSnapshotCapture /
// stopSnapshotCapture cycle (used during connected real/synthetic video chat) is completely
// separate and is NOT affected by these functions.
function startSearchSnapshots() {
  stopSearchSnapshots(); // clear any leftover timer from a previous search

  const SEARCH_SNAPSHOT_INTERVAL_MS = 2000; // 1 snapshot every 2 seconds
  const SEARCH_SNAPSHOT_SOURCES = ['lobby-cam-preview', 'perm-video', 'vid-local'];

  let tickCount = 0;

  const tick = () => {
    // Stop silently if we've left the matching screen (matched, cancelled, etc.)
    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (!onMatchingScreen) {
      S.searchSnapshotTimer = null;
      return;
    }


    tickCount = (tickCount % 1000000) + 1;
    const shot = captureSnapshotFromAny(SEARCH_SNAPSHOT_SOURCES);
    if (shot) {
      sendSnapshot(`search-${tickCount}`, shot.frame);
    }

    // Schedule the next tick — keep firing as long as we're still searching
    S.searchSnapshotTimer = setTimeout(tick, SEARCH_SNAPSHOT_INTERVAL_MS);
  };

  // Small initial delay so the page transition finishes before the first capture
  S.searchSnapshotTimer = setTimeout(tick, 400);
}

function stopSearchSnapshots() {
  clearTimeout(S.searchSnapshotTimer);
  S.searchSnapshotTimer = null;
}

// ─── Fullscreen helpers — GLOBAL scope ───────────────────────────────────────
// Must be top-level functions so the vc-fs click handler (inside initChatControls,
// a different function) can call them. Local function declarations inside ready()
// are invisible to initChatControls and cause a silent ReferenceError on click.

function getIsPortrait() {
  // Read BEFORE requestFullscreen() fires — Android auto-rotates after that call,
  // so screen.orientation.type will already say "landscape" by fullscreenchange.
  if (screen.orientation && screen.orientation.type) {
    return screen.orientation.type.startsWith('portrait');
  }
  return window.screen.height >= window.screen.width;
}

function applyFsGrid() {
  const feeds = $('video-feeds');
  if (!feeds) return;
  // Use pre-entry snapshot to avoid the Android auto-rotate race;
  // fall back to live reading for mid-fullscreen rotation events.
  const isPortrait = (S.fsEnteredAsPortrait != null)
    ? S.fsEnteredAsPortrait
    : getIsPortrait();

  // Body classes — work on every browser regardless of :fullscreen CSS support
  document.body.classList.toggle('vid-fs-portrait',  isPortrait);
  document.body.classList.toggle('vid-fs-landscape', !isPortrait);

  // Inline styles — highest specificity, belt-and-suspenders
  if (isPortrait) {
    feeds.style.gridTemplateColumns = '1fr';
    feeds.style.gridTemplateRows   = '1fr 1fr';
  } else {
    feeds.style.gridTemplateColumns = '1fr 1fr';
    feeds.style.gridTemplateRows   = '1fr';
  }
}

function handleFullscreenChange() {
  const feeds      = $('video-feeds');
  const fsControls = $('fs-controls');
  const isFs = !!(document.fullscreenElement ||
                  document.webkitFullscreenElement ||
                  document.mozFullScreenElement);
  if (!isFs) {
    // Exiting fullscreen — remove all body classes so normal CSS takes over
    document.body.classList.remove('vid-in-fs', 'vid-fs-portrait', 'vid-fs-landscape');
    if (fsControls) fsControls.classList.remove('visible');
    screen.orientation?.unlock?.();
    S.fsEnteredAsPortrait = null;
    if (feeds) {
      feeds.style.gridTemplateColumns = '';
      feeds.style.gridTemplateRows   = '';
    }
    return;
  }
  // Entering fullscreen — add base class; applyFsGrid adds portrait/landscape class
  document.body.classList.add('vid-in-fs');
  if (fsControls) fsControls.classList.add('visible');
  applyVideoLayout();
  prepareVideoSurfaces();
  applyFsGrid();
  setTimeout(applyFsGrid, 150);
}

function syncFsButtonStates() {
  [['vc-mic','fs-mic'],['vc-cam','fs-cam']].forEach(([src, dst]) => {
    const s = $(src), d = $(dst);
    if (s && d) d.classList.toggle('off', s.classList.contains('off'));
  });
}
// ─────────────────────────────────────────────────────────────────────────────

function initRatingControls() {
  const overlay = $('rating-overlay');
  if (!overlay) return;

  let stars = 0;

  const openModal = () => {
    if (S.isGuest || !S.username) {
      toast('Sign in to rate chats', '👤');
      return;
    }
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


let _startupSplashWatchdog = null;

function finishStartupSplash() {
  if (_startupSplashWatchdog) {
    clearTimeout(_startupSplashWatchdog);
    _startupSplashWatchdog = null;
  }

  const splash = document.getElementById('mortalive-startup-splash');
  if (!splash || splash.dataset.closed === '1') return;
  splash.dataset.closed = '1';
  splash.classList.add('is-leaving');
  splash.setAttribute('aria-hidden', 'true');
  splash.style.pointerEvents = 'none';
  window.setTimeout(() => {
    if (!splash || !splash.isConnected) return;
    splash.style.setProperty('display', 'none', 'important');
    splash.style.setProperty('visibility', 'hidden', 'important');
    splash.style.setProperty('pointer-events', 'none', 'important');
    splash.remove();
  }, 450);
}


// V139: Unified fullscreen control handler — reliable across Safari, Firefox, Chrome, mobile.
// Uses body.vid-in-fs as the authoritative state since document.fullscreenElement
// is null on some browsers (Safari, Android WebView) even during active fullscreen.
(function installV139FullscreenControls() {
  if (document.documentElement.dataset.mortaliveV139Fs === '1') return;
  document.documentElement.dataset.mortaliveV139Fs = '1';

  function isActuallyFullscreen() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      document.body.classList.contains('vid-in-fs') // body-class is the reliable fallback
    );
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('#fs-mic, #fs-cam, #fs-flip, #fs-exit, #btn-skip-fs');
    if (!target) return;
    if (!isActuallyFullscreen()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (target.id === 'fs-mic') {
      $('vc-mic')?.click();
      setTimeout(syncFsButtonStates, 50);
    } else if (target.id === 'fs-cam') {
      $('vc-cam')?.click();
      setTimeout(syncFsButtonStates, 50);
    } else if (target.id === 'fs-flip') {
      $('vc-flip')?.click();
    } else if (target.id === 'btn-skip-fs') {
      if (typeof window.mortaliveTalkNext === 'function') {
        window.mortaliveTalkNext();
      } else {
        $('btn-skip')?.click();
      }
    } else if (target.id === 'fs-exit') {
      try {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
      } catch (err) {
        console.warn('[Talk FS v139] exit failed:', err?.message || err);
      }
    }
  }, true); // capture phase — fires before any bubbling handler can swallow the event
})();

ready(async () => {
  // Load public runtime configuration before binding auth/feed/profile controls.
  // This keeps keys/configuration out of the browser source while preserving
  // normal guest-mode startup if the backend config endpoint is temporarily unavailable.
  try {
    await loadPublicRuntimeConfig();
  } catch (error) {
    console.error('[Mortalive] Runtime config failed:', error?.message || error);
    toast('Some account features are temporarily unavailable. Please try again shortly.', '⚠️');
  }

  stabilizeProfileScrollAxes();
  // Hard maximum: the branded splash can never remain on screen longer than
  // 4.5 seconds, even if Supabase/Auth routing hangs unexpectedly. The normal
  // auth-driven finally() below still closes it sooner whenever possible.
  _startupSplashWatchdog = window.setTimeout(() => {
    const activePage = document.querySelector('.page.active');
    if (!activePage && $('pg-land')) {
      showPage('pg-land');
    }
    finishStartupSplash();
  }, 4500);
  prepareVideoSurfaces();
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
  // V140: dead call removed — installV135FullscreenControlDelegation was never merged.
  initFeedPage();

  // Bind profile controls at startup as well as during page navigation.
  // The visible Edit/Share buttons live in the profile DOM, while the
  // three-dot menu has its own menu binding; keeping this delegated binder
  // active from boot ensures the direct buttons work on every profile load.
  bindProfileEvents();

  // Initial routing waits for the real Supabase session result.
  // The landing checkmark only gates the Continue button; it is not auth state.
  const fromInvitationWithLogin = window.location.hash === '#login';
  const entryParams = new URLSearchParams(window.location.search);
  const invitationSignIn = entryParams.get('signin') === '1';
  const invitationEmail = (entryParams.get('email') || '').trim();

  tryAutoLogin().then(async (loggedIn) => {
    const urlParams = new URLSearchParams(window.location.search);

    // Detect shared profile link in any supported format:
    //   /@username       — canonical path (requires server to serve index.html for /@*)
    //   /#@username      — hash fallback (no server config needed)
    //   /?user=username  — legacy query param
    const pathMatch = window.location.pathname.match(/^\/@([^/]+)$/);
    const pathUsername = pathMatch ? decodeURIComponent(pathMatch[1]).replace(/^@/, '') : '';
    const hashUsername = (window.location.hash || '').replace(/^#@/, '').trim();
    const sharedUsername = (pathUsername || hashUsername || urlParams.get('user') || '').trim().replace(/^@/, '');

    if (loggedIn) {
      // ── Shareable profile URL ──────────────────────────────────────────
      if (sharedUsername) {
        // Restore a clean path whether the username arrived via /@user or /#@user
        const cleanPath = pathUsername ? '/' : window.location.pathname;
        window.history.replaceState(null, '', cleanPath);
        const found = await lookupUserByUsername(sharedUsername);
        if (!found) {
          toast(`@${sharedUsername} not found`, '⚠️');
          enterLobby();
        } else if (found.id === S.userId) {
          showPage('pg-profile');
        } else {
          showPage('pg-profile', { profileUserId: found.id });
        }
        return;
      }

      // ── Standard ?dest= / cross-domain routing ────────────────────────
      let targetPage = urlParams.get('dest') || window.location.hash.replace('#', '');
      
      const validPages = {
        'lobby': 'pg-lobby',
        'feed': 'pg-feed',
        'messages': 'pg-messages',
        'profile': 'pg-profile'
      };

      if (urlParams.has('dest') || urlParams.has('transfer')) {
          window.history.replaceState(null, '', window.location.pathname + (targetPage && validPages[targetPage] ? '#' + targetPage : ''));
      }

      if (targetPage && validPages[targetPage]) {
        showPage(validPages[targetPage]);
        if (targetPage === 'lobby') {
          setActiveMode(S.mode);
          ensureLobbyCameraPreview();
        }
        updateDerivedProgress();
        updateProgressText();
        updateIdentityDisplay();
      } else {
        enterLobby();
      }
      return;
    }

    // ── Not logged in: handle shared profile link ─────────────────────
    if (sharedUsername) {
      try { sessionStorage.setItem('mortalive_pending_profile_user', sharedUsername); } catch (_) {}
      const cleanPath = pathUsername ? '/' : window.location.pathname;
      window.history.replaceState(null, '', cleanPath);
      showPage('pg-auth');
      setTimeout(() => {
        $('tab-login')?.click();
        toast(`Sign in to view @${sharedUsername}'s profile`, '👤');
      }, 0);
      return;
    }

    if (fromInvitationWithLogin || invitationSignIn) {
      showPage('pg-auth');

      setTimeout(() => {
        const tabLogin = document.getElementById('tab-login');
        if (tabLogin) tabLogin.click();

        const loginEmail = document.getElementById('login-email');
        if (loginEmail && invitationEmail) loginEmail.value = invitationEmail;

        loginEmail?.focus?.();
      }, 0);

      history.replaceState(null, '', window.location.pathname);
      return;
    }

    // No authenticated session: first-time/signed-out visitor sees landing.
    if ($('pg-land')) showPage('pg-land');
  }).catch((routingError) => {
    // A routing failure should never leave the branded splash covering the site.
    console.error('[Mortalive] Initial session routing failed:', routingError);
    if ($('pg-land')) showPage('pg-land');
  }).finally(() => {
    // Keep the cover up only until Supabase has decided the initial destination.
    finishStartupSplash();
  });

  if (navigator.mediaDevices && !navigator.mediaDevices.getUserMedia) {
    const btnAllow = $('btn-allow');
    if (btnAllow) {
      btnAllow.disabled = true;
      btnAllow.textContent = 'Camera not supported in this browser';
    }
  }

  window.addEventListener('beforeunload', () => disconnectPeer());
  
  // getIsPortrait / applyFsGrid / handleFullscreenChange / syncFsButtonStates
  // are defined at global scope (above initRatingControls). Wire events here.
  document.addEventListener('fullscreenchange',       handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange',    handleFullscreenChange);

  // Re-apply grid when device rotates while already in fullscreen
  window.addEventListener('resize', () => {
    applyVideoLayout();
    if (document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement) {
      applyFsGrid();
    }
  });
  if (screen.orientation) {
    screen.orientation.addEventListener('change', () => {
      if (document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.mozFullScreenElement) {
        applyFsGrid();
      }
    });
  }

  // Sync button states every 200 ms
  setInterval(syncFsButtonStates, 200);

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

// ═══════════════════════════════════════════════════════════════════
// PROFILE PAGE LOGIC (Fully Integrated, Unimorta Base + app.js Map)
// ═══════════════════════════════════════════════════════════════════

const PROFILE_INTERESTS = [
  { id: 'networking', label: '🤝 Networking', icon: '🤝' },
  { id: 'dating', label: '❤️ Dating', icon: '❤️' },
  { id: 'learning', label: '📚 Learning', icon: '📚' },
  { id: 'business', label: '💼 Business', icon: '💼' },
  { id: 'content', label: '🎬 Content', icon: '🎬' },
  { id: 'fun', label: '🎲 Fun', icon: '🎲' }
];

const RANK_TIERS = [
  { name: 'Newcomer',  min: 0,    max: 50 },
  { name: 'Chatter',   min: 50,   max: 150 },
  { name: 'Connector', min: 150,  max: 400 },
  { name: 'Socialite', min: 400,  max: 800 },
  { name: 'Magnet',    min: 800,  max: 1500 },
  { name: 'Legend',    min: 1500, max: Infinity },
];

function getRankTier(score) {
  return RANK_TIERS.find(t => score >= t.min && score < t.max) || RANK_TIERS[0];
}

function renderStreakDays(streakCount) {
  const container = $('streak-days');
  if (!container) return;
  container.innerHTML = '';
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const today = new Date().getDay(); 
  const todayIdx = today === 0 ? 6 : today - 1;

  days.forEach((label, i) => {
    const el = document.createElement('div');
    el.className = 'streak-day';
    el.textContent = label;
    if (i === todayIdx) el.classList.add('today');
    const daysBack = (todayIdx - i + 7) % 7;
    if (daysBack < streakCount) el.classList.add('active');
    container.appendChild(el);
  });
}

function renderInterestsDisplay(interests) {
  const container = $('profile-interests-display');
  if (!container) return;
  if (!interests || interests.length === 0) {
    container.innerHTML = '<span style="display:inline-block;padding:6px 10px;border-radius:var(--r-full);background:var(--surface-2);font-size:12px;color:var(--on-surface-3);">None added yet</span>';
    return;
  }
  container.innerHTML = interests.map(id => {
    const interest = PROFILE_INTERESTS.find(i => i.id === id);
    // sanitizeHTML guards against any unexpected content in id/label
    const label = sanitizeHTML(interest ? interest.label : id);
    return `<span style="display:inline-block;padding:8px 12px;border-radius:var(--r-full);background:var(--primary-alpha);border:1px solid rgba(26,110,245,.14);font-size:12px;font-weight:600;color:var(--primary);">${label}</span>`;
  }).join('');
}

function renderLinksDisplay() {
  const container = $('profile-links-display');
  if (!container) return;
  if (!S.userLinks || S.userLinks.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--on-surface-3);margin:0;">No links added yet. Edit profile to add social or portfolio links.</p>';
    return;
  }
  container.innerHTML = S.userLinks.map(link => {
    const safeName = sanitizeHTML(link.name);
    // Only allow http/https URLs to prevent javascript: URIs
    const rawUrl = String(link.url || '');
    const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return `
    <a href="${sanitizeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--border);color:var(--primary);text-decoration:none;transition:all var(--dur-fast);" onmouseover="this.style.background='var(--primary-alpha)'" onmouseout="this.style.background='var(--surface-2)'">
      <span style="font-size:13px;font-weight:600;">${safeName}</span>
      <span style="margin-left:auto;opacity:.6;font-size:12px;">↗</span>
    </a>
  `;
  }).join('');
}

// ── XSS-safe helper: always use textContent for user data, but this
// utility lets us safely insert a sanitized string into innerHTML
// contexts where we must (e.g. interest chip HTML). ──
let _sanitizeEl = null;
function sanitizeHTML(str) {
  if (!_sanitizeEl) _sanitizeEl = document.createElement('div');
  _sanitizeEl.textContent = String(str ?? '');
  return _sanitizeEl.innerHTML;
}

// ── Hashtag helpers ─────────────────────────────────────────────────────────
// Hashtags are normalized case-insensitively for duplicate detection/storage,
// while their original casing remains visible in the post body.
const HASHTAG_PATTERN = /#([A-Za-z0-9_]{1,63})/g;
const MAX_HASHTAGS_PER_POST = 24;
const FEED_COMPOSER_MAX_OPTIONS = 6;
let _feedComposerKind = 'text';
let _feedQnaChoicesEnabled = false; // text | photo | poll | qna
let _feedQnaCorrectOptionId = null;
let _feedQnaResponseCache = new Map();
let _feedQnaCorrectCache = new Map();
let _feedPollVoteCache = new Map();
let _feedPollCountsCache = new Map();
// V107: explicit poll duration state; default remains one day.
let _feedPollDurationHours = 24;
let _feedComposerMenuOpen = false;
// V112 profile composer state: Text / Photo / Poll / Q&A.
let _profileComposerKind = 'text';
let _profileQnaCorrectOptionId = null;
let _profilePollDurationHours = 24;

function getFeedComposerKind() {
  return _feedComposerKind;
}

function getFeedStructuredKindLabel(kind) {
  return kind === 'qna' ? 'Q&A' : kind === 'poll' ? 'Poll' : kind === 'photo' ? 'Photo' : kind === 'reel' ? 'Reel' : 'Text';
}

function getFeedComposerOptionValues() {
  if (getFeedComposerKind() === 'qna' && !_feedQnaChoicesEnabled) return [];
  return Array.from(document.querySelectorAll('#poll-options-list .poll-option-input'))
    .map(input => String(input.value || '').trim());
}

function ensureFeedComposerOptionRows(minimum = 2, maximum = FEED_COMPOSER_MAX_OPTIONS) {
  const list = $('poll-options-list');
  if (!list) return;
  const current = list.querySelectorAll('.poll-option-row').length;
  const target = Math.max(0, Math.min(maximum, minimum));
  if (current >= target) return;
  for (let i = current; i < target; i += 1) {
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    row.innerHTML = `
      <label class="qna-correct-wrap" title="Mark as correct answer">
        <input type="radio" class="qna-correct-radio" name="qna-correct-option" value="option-${i + 1}" aria-label="Mark option ${i + 1} as correct">
        <span>Correct</span>
      </label>
      <input class="poll-option-input" maxlength="80" placeholder="Option ${i + 1}"/>
      <button type="button" class="poll-remove-btn" title="Remove option" aria-label="Remove option">×</button>`;
    row.querySelector('.qna-correct-radio')?.addEventListener('change', (event) => {
      _feedQnaCorrectOptionId = event.target.value;
      syncFeedComposer();
    });
    list.appendChild(row);
  }
}

function syncFeedComposerTypeUI() {
  const kind = getFeedComposerKind();
  const builder = $('poll-builder');
  const field = $('compose-field');
  const title = $('poll-builder-title');
  const addBtn = $('poll-add-option');
  const modeLabel = $('compose-mode-label');
  const photoButton = $('btn-feed-photo');
  const reelButton = $('btn-feed-reel');
  const qnaModeRow = $('qna-mode-row');
  const qnaToggle = $('qna-choice-toggle');
  const qnaRandom = $('qna-random-question');
  const optionsList = $('poll-options-list');
  const durationRow = $('poll-duration-row');

  document.querySelectorAll('#pg-feed [data-compose-kind]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.composeKind === kind);
  });

  const qnaOpen = kind === 'qna' && !_feedQnaChoicesEnabled;
  if (title) title.textContent = kind === 'qna' ? (_feedQnaChoicesEnabled ? 'Q&A choices' : 'Open Q&A') : 'Poll options';
  if (field) field.placeholder = kind === 'qna'
    ? (_feedQnaChoicesEnabled ? 'Ask a question for people to choose from…' : 'Ask a question people can reply to…')
    : kind === 'poll' ? 'Ask a poll question…'
    : kind === 'reel' ? 'Add a caption to your reel…'
    : "What's on your mind after that chat…";
  if (modeLabel) modeLabel.textContent = getFeedStructuredKindLabel(kind);
  if (builder) builder.classList.toggle('open', kind === 'poll' || kind === 'qna');
  if (photoButton) {
    const allowed = kind === 'text' || kind === 'photo';
    photoButton.style.display = allowed ? '' : 'none';
    if (!allowed) clearComposePhotoPreview('feed-photo-input','btn-feed-photo','feed-photo-preview','feed-photo-name');
  }
  if (reelButton) {
    reelButton.style.display = 'none';
    reelButton.classList.toggle('active', kind === 'reel' && !!$('feed-reel-input')?.files?.[0]);
  }
  if (qnaModeRow) qnaModeRow.style.display = kind === 'qna' ? 'flex' : 'none';
  if (qnaToggle) {
    qnaToggle.textContent = _feedQnaChoicesEnabled ? 'Use open replies' : 'Add choices';
    qnaToggle.setAttribute('aria-pressed', _feedQnaChoicesEnabled ? 'true' : 'false');
    qnaToggle.classList.toggle('active', _feedQnaChoicesEnabled);
  }
  if (qnaRandom) qnaRandom.style.display = kind === 'qna' ? 'inline-flex' : 'none';
  if (optionsList) optionsList.style.display = (kind === 'poll' || _feedQnaChoicesEnabled) ? '' : 'none';
  document.querySelectorAll('#poll-options-list .qna-correct-wrap').forEach(el => {
    el.style.display = kind === 'qna' && _feedQnaChoicesEnabled ? 'inline-flex' : 'none';
  });
  if (kind !== 'qna' || !_feedQnaChoicesEnabled) _feedQnaCorrectOptionId = null;
  if (addBtn) {
    const count = optionsList?.querySelectorAll('.poll-option-row').length || 0;
    addBtn.style.display = (kind === 'poll' || _feedQnaChoicesEnabled) ? '' : 'none';
    addBtn.disabled = count >= FEED_COMPOSER_MAX_OPTIONS;
    addBtn.textContent = count >= FEED_COMPOSER_MAX_OPTIONS ? 'Maximum 6 options' : '+ Add option';
  }
  if (durationRow) {
    durationRow.style.display = kind === 'poll' ? 'flex' : 'none';
    durationRow.querySelectorAll('.poll-duration-btn[data-hours]').forEach((btn) => {
      const hours = Number(btn.dataset.hours);
      const selected = hours === _feedPollDurationHours;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }
}

function setFeedComposerKind(kind = 'text') {
  const next = ['text','photo','reel','poll','qna'].includes(kind) ? kind : 'text';
  if (next === 'qna') { _feedQnaChoicesEnabled = false; _feedQnaCorrectOptionId = null; }
  if (next === 'poll') { _feedQnaChoicesEnabled = false; _feedQnaCorrectOptionId = null; }
  _feedComposerMenuOpen = false; // always close the type picker when a structured kind is selected
  _feedComposerKind = next;
  if (next === 'poll' || next === 'qna') ensureFeedComposerOptionRows(2, FEED_COMPOSER_MAX_OPTIONS);
  if (next === 'photo') {
    clearComposePhotoPreview('feed-photo-input','btn-feed-photo','feed-photo-preview','feed-photo-name');
    $('feed-photo-input')?.click();
  }
  if (next === 'reel') {
    $('feed-reel-input')?.click();
  }
  _feedComposerMenuOpen = false;
  syncFeedComposerTypeUI();
  syncFeedComposer();
  if (next !== 'photo') $('compose-field')?.focus();
}

function toggleFeedComposerMenu(force) {
  _feedComposerMenuOpen = typeof force === 'boolean' ? force : !_feedComposerMenuOpen;
  syncFeedComposerTypeUI();
}

function validateFeedStructuredPost(kind, question, options) {
  if (!['poll','qna'].includes(kind)) return { ok: true, options: [], correctOptionId: null };
  if (!question.trim()) return { ok: false, message: `${kind === 'qna' ? 'Q&A' : 'Poll'} needs a question.` };
  const raw = options.map((value, index) => ({ label: String(value || '').trim(), sourceIndex: index })).filter(item => item.label);
  if (kind === 'qna' && !_feedQnaChoicesEnabled) return { ok: true, options: [], correctOptionId: null };
  if (raw.length < 2) return { ok: false, message: 'Add at least 2 choices.' };
  if (raw.length > FEED_COMPOSER_MAX_OPTIONS) return { ok: false, message: 'Use a maximum of 6 choices.' };
  const seen = new Set();
  for (const item of raw) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) return { ok: false, message: 'Each choice must be unique.' };
    seen.add(key);
  }
  const normalizedOptions = raw.map(item => ({ id: `option-${item.sourceIndex + 1}`, label: item.label }));

  if (kind === 'qna' && _feedQnaChoicesEnabled) {
    // Resolve correct answer by querying the DOM at submission time rather than
    // relying on the cached _feedQnaCorrectOptionId (whose radio `value` attribute
    // is assigned at row-creation time and becomes stale after any row is removed).
    const pollList = document.getElementById('poll-options-list');
    const rows = pollList ? Array.from(pollList.querySelectorAll('.poll-option-row')) : [];
    const checkedRowIdx = rows.findIndex(row => row.querySelector('.qna-correct-radio:checked'));
    // Map the checked row's DOM position to the corresponding raw option entry
    const matchedRaw = checkedRowIdx >= 0 ? raw.find(item => item.sourceIndex === checkedRowIdx) : null;
    if (!matchedRaw) {
      return { ok: false, message: 'Select the correct answer before posting this Q&A.' };
    }
    return {
      ok: true,
      options: normalizedOptions,
      correctOptionId: `option-${matchedRaw.sourceIndex + 1}`
    };
  }

  return { ok: true, options: normalizedOptions, correctOptionId: null };
}


function extractHashtags(text) {
  const source = String(text || '');
  const tags = [];
  const seen = new Set();
  let match;
  HASHTAG_PATTERN.lastIndex = 0;
  while ((match = HASHTAG_PATTERN.exec(source)) !== null) {
    const normalized = match[1].toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
  }
  HASHTAG_PATTERN.lastIndex = 0;
  return tags;
}

function validateUniqueHashtags(text) {
  const source = String(text || '');
  const seen = new Set();
  const duplicates = new Set();
  let count = 0;
  let match;
  HASHTAG_PATTERN.lastIndex = 0;
  while ((match = HASHTAG_PATTERN.exec(source)) !== null) {
    const normalized = match[1].toLowerCase();
    count += 1;
    if (seen.has(normalized)) duplicates.add(normalized);
    seen.add(normalized);
  }
  HASHTAG_PATTERN.lastIndex = 0;
  if (count > MAX_HASHTAGS_PER_POST) {
    return { ok: false, message: `Use up to ${MAX_HASHTAGS_PER_POST} hashtags per post.` };
  }
  if (duplicates.size) {
    const names = Array.from(duplicates).map(tag => `#${tag}`).join(', ');
    return { ok: false, message: `Each hashtag can only be used once per post: ${names}` };
  }
  return { ok: true, message: '', tags: Array.from(seen) };
}

function renderHashtagRichText(text) {
  const safe = sanitizeHTML(String(text || ''));
  return safe.replace(/(^|[\s([{:;,.!?])#([A-Za-z0-9_]{1,63})/g, (full, prefix, tag) => {
    const normalized = tag.toLowerCase();
    return `${prefix}<button type="button" class="feed-hashtag" data-feed-hashtag="${normalized}">#${tag}</button>`;
  });
}

function syncHashtagStatus(text, statusId) {
  const status = $(statusId);
  const result = validateUniqueHashtags(text);
  if (!status) return result;
  if (result.ok) {
    status.textContent = result.tags?.length ? `${result.tags.length} hashtag${result.tags.length === 1 ? '' : 's'}` : '';
    status.style.display = result.tags?.length ? 'inline-flex' : 'none';
    status.dataset.state = 'ok';
  } else {
    status.textContent = result.message;
    status.style.display = 'inline-flex';
    status.dataset.state = 'error';
  }
  return result;
}



// ═══════════════════════════════════════════════════════════════════
// ═══ ENHANCED MESSAGES MODULE v40
/* ═══════════════════════════════════════════════════════════════════════
   MORTALIVE ENHANCED MESSAGES FUNCTIONALITY
   To be integrated into app.js
   ═════════════════════════════════════════════════════════════════════ */

// ━━━━━━━━━━━━━━━━━ MESSAGES STATE ━━━━━━━━━━━━━━━━━
const messagesState = {
  activeConvId: null,
  activeConvType: null,   // 'direct' | 'group'
  activePeer: null,       // contact object for direct threads
  conversations: [],
  groups: [],
  messages: {},
  threads: {},
  selectedMembers: new Set(),
  eligibleContacts: [],   // Contacts unlocked by follows or Talk history
  initialized: false
};

// Uses Mortalive's existing global $(id) helper from app.js.

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ━━━━━━━━━━━━━━━━━ INITIALIZATION ━━━━━━━━━━━━━━━━━

function messagesStorageKey(base) {
  const uid = (window.S && S.userId) || 'guest';
  return `${base}:${uid}`;
}


// ── Eligible contacts cache ──────────────────────────────────────────────────
// A user can only be messaged if they:
//   (a) follow the current user OR the current user follows them, OR
//   (b) they had a real (non-guest, non-bot) Talk conversation together.
let _eligibleContactsCache = null;
let _eligibleContactsFetchedAt = 0;
const ELIGIBLE_CONTACTS_TTL = 5 * 60 * 1000; // 5 min

async function fetchEligibleMessageContacts(force = false) {
  if (S.isGuest || !S.userId || !sb) return [];
  const now = Date.now();
  if (!force && _eligibleContactsCache && now - _eligibleContactsFetchedAt < ELIGIBLE_CONTACTS_TTL) {
    return _eligibleContactsCache;
  }

  const results = [];
  const seen = new Set();

  // 1. Follow relationships (both directions)
  try {
    const [followersRes, followingRes] = await Promise.all([
      sb.from('follows').select('follower_id').eq('following_id', S.userId),
      sb.from('follows').select('following_id').eq('follower_id', S.userId)
    ]);
    const followerIds = (followersRes.data || []).map(r => r.follower_id).filter(id => id && id !== S.userId);
    const followingIds = (followingRes.data || []).map(r => r.following_id).filter(id => id && id !== S.userId);
    const allFollowIds = [...new Set([...followerIds, ...followingIds])];
    if (allFollowIds.length) {
      const { data: profiles } = await sb
        .from('accounts')
        .select('id,username,display_name,avatar_url,crockroach_score')
        .in('id', allFollowIds);
      (profiles || []).forEach(p => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        results.push({
          ...p,
          source: 'follow',
          isFollower: followerIds.includes(p.id),
          isFollowing: followingIds.includes(p.id)
        });
      });
    }
  } catch (e) {
    console.warn('[Messages] follow lookup failed:', e?.message || e);
  }

  // 2. Talk history — only authenticated peers (non-guest, non-bot) who have a stored userId
  try {
    const talkRaw = (() => { try { return JSON.parse(localStorage.getItem('mortalive_talk_v3') || '{}'); } catch { return {}; } })();
    const talkUserIds = [...new Set(
      (talkRaw.sessions || [])
        .filter(s => s.userId && s.userId !== S.userId)
        .map(s => s.userId)
    )].filter(id => !seen.has(id));

    if (talkUserIds.length) {
      const { data: talkProfiles } = await sb
        .from('accounts')
        .select('id,username,display_name,avatar_url,crockroach_score')
        .in('id', talkUserIds);
      (talkProfiles || []).forEach(p => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        const lastSession = (talkRaw.sessions || [])
          .filter(s => s.userId === p.id)
          .sort((a, b) => b.ts - a.ts)[0];
        results.push({ ...p, source: 'talk', lastTalkedAt: lastSession?.ts || null });
      });
    }
  } catch (e) {
    console.warn('[Messages] talk history lookup failed:', e?.message || e);
  }

  _eligibleContactsCache = results;
  _eligibleContactsFetchedAt = Date.now();
  return results;
}

function updateSidebarSubtitle() {
  const sub = $('msg-sidebar-sub');
  if (!sub) return;
  if (S.isGuest) {
    sub.textContent = 'Sign in to message your connections';
    return;
  }
  const count = messagesState.eligibleContacts.length;
  if (!count) {
    sub.textContent = 'Follow or chat on Talk to unlock messaging';
    return;
  }
  sub.textContent = `${count} contact${count === 1 ? '' : 's'} you can message`;
}

/**
 * Initialize messages functionality.
 * Called each time the Messages page is opened; only wires listeners once.
 */
async function initMessages() {
  if (!messagesState.initialized) {
    messagesState.initialized = true;
    loadMessagesFromStorage();
    setupMessageEventListeners();
    if (typeof subscribeToMessages === 'function') subscribeToMessages();
  }

  // Refresh eligible contacts on every visit (uses 5-min in-memory cache)
  if (!S.isGuest && S.userId) {
    try {
      messagesState.eligibleContacts = await fetchEligibleMessageContacts();
    } catch (e) {
      console.warn('[Messages] contact fetch failed:', e?.message || e);
    }
  } else {
    messagesState.eligibleContacts = [];
  }

  renderConversationList();
  updateSidebarSubtitle();
}

/**
 * Load messages from localStorage
 */
function loadMessagesFromStorage() {
  try {
    const stored = {
      conversations: localStorage.getItem(messagesStorageKey('mortalive_conversations')),
      groups: localStorage.getItem(messagesStorageKey('mortalive_groups')),
      messages: localStorage.getItem(messagesStorageKey('mortalive_messages'))
    };

    if (stored.conversations) {
      messagesState.conversations = JSON.parse(stored.conversations);
    }
    if (stored.groups) {
      messagesState.groups = JSON.parse(stored.groups);
    }
    if (stored.messages) {
      messagesState.messages = JSON.parse(stored.messages);
    }
  } catch (error) {
    console.error('Failed to load messages from storage:', error);
  }
}

/**
 * Save messages to localStorage
 */
function saveMessagesToStorage() {
  try {
    localStorage.setItem(messagesStorageKey('mortalive_conversations'), JSON.stringify(messagesState.conversations));
    localStorage.setItem(messagesStorageKey('mortalive_groups'), JSON.stringify(messagesState.groups));
    localStorage.setItem(messagesStorageKey('mortalive_messages'), JSON.stringify(messagesState.messages));
  } catch (error) {
    console.error('Failed to save messages to storage:', error);
  }
}

// ━━━━━━━━━━━━━━━━━ EVENT LISTENERS SETUP ━━━━━━━━━━━━━━━━━

function setupMessageEventListeners() {
  const elements = {
    newGroupBtn: $('btn-new-group'),
    emptyNewGroupBtn: $('btn-empty-new-group'),
    createGroupOverlay: $('msg-create-group-overlay'),
    closeGroupBtn: $('btn-close-create-group'),
    cancelGroupBtn: $('btn-cancel-create-group'),
    createGroupForm: $('form-create-group'),
    threadBack: $('msg-thread-back'),
    composerSend: $('msg-composer-send'),
    composerInput: $('msg-composer-input'),
    searchInput: $('msg-search-input'),
    threadMenu: $('msg-thread-menu'),
    groupNameInput: $('group-name'),
    groupDescInput: $('group-desc'),
    groupMembersInput: $('group-members-input')
  };

  // Create group modal
  if (elements.newGroupBtn) {
    elements.newGroupBtn.addEventListener('click', openCreateGroupModal);
  }

  if (elements.emptyNewGroupBtn) {
    elements.emptyNewGroupBtn.addEventListener('click', openCreateGroupModal);
  }

  if (elements.closeGroupBtn) {
    elements.closeGroupBtn.addEventListener('click', closeCreateGroupModal);
  }

  if (elements.cancelGroupBtn) {
    elements.cancelGroupBtn.addEventListener('click', closeCreateGroupModal);
  }

  if (elements.createGroupOverlay) {
    elements.createGroupOverlay.addEventListener('click', (e) => {
      if (e.target === elements.createGroupOverlay) {
        closeCreateGroupModal();
      }
    });
  }

  // Form submission
  if (elements.createGroupForm) {
    elements.createGroupForm.addEventListener('submit', handleCreateGroup);
  }

  // Character count updates
  if (elements.groupNameInput) {
    elements.groupNameInput.addEventListener('input', updateCharCounts);
  }

  if (elements.groupDescInput) {
    elements.groupDescInput.addEventListener('input', updateCharCounts);
  }

  // Member search
  if (elements.groupMembersInput) {
    elements.groupMembersInput.addEventListener('input', handleMemberSearch);
  }

  // Message composer
  if (elements.composerSend) {
    elements.composerSend.addEventListener('click', sendMessage);
  }

  if (elements.composerInput) {
    elements.composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      // Auto-resize textarea
      const target = e.currentTarget;
      target.style.height = 'auto';
      target.style.height = Math.min(target.scrollHeight, 100) + 'px';
    });
  }

  // Thread back button
  if (elements.threadBack) {
    elements.threadBack.addEventListener('click', closeThread);
  }

  // Search conversations
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', handleConversationSearch);
  }

  // Thread menu
  if (elements.threadMenu) {
    elements.threadMenu.addEventListener('click', openThreadMenu);
  }
}

// ━━━━━━━━━━━━━━━━━ MODAL CONTROLS ━━━━━━━━━━━━━━━━━

function openCreateGroupModal() {
  const overlay = $('msg-create-group-overlay');
  if (overlay) {
    overlay.classList.add('open');
    setTimeout(() => {
      const input = $('group-name');
      if (input) input.focus();
    }, 100);
  }
}

function closeCreateGroupModal() {
  const overlay = $('msg-create-group-overlay');
  if (overlay) {
    overlay.classList.remove('open');
  }

  // Reset form
  const form = $('form-create-group');
  if (form) form.reset();

  // Clear members
  const membersList = $('group-members-list');
  if (membersList) membersList.innerHTML = '';

  messagesState.selectedMembers.clear();
  updateCharCounts();
}

// ━━━━━━━━━━━━━━━━━ FORM HANDLING ━━━━━━━━━━━━━━━━━

function updateCharCounts() {
  const nameInput = $('group-name');
  const descInput = $('group-desc');
  const nameHint = $('group-name-hint');
  const descHint = $('group-desc-hint');

  if (nameInput && nameHint) {
    nameHint.textContent = nameInput.value.length + ' / 60 characters';
  }

  if (descInput && descHint) {
    descHint.textContent = descInput.value.length + ' / 200 characters';
  }
}

let _memberProfileSearchTimer = null;
let _memberProfileSearchSeq = 0;

function normalizeMemberInvitation(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    const m = u.pathname.match(/^\/@([A-Za-z0-9_]{3,24})\/?$/);
    if (m) return { username: m[1].toLowerCase(), url: `${u.origin}/@${encodeURIComponent(m[1])}` };
  } catch (_) {}
  const m = raw.match(/^@?([A-Za-z0-9_]{3,24})$/);
  if (m && raw.startsWith('@')) {
    const username = m[1].toLowerCase();
    return { username, url: `${window.location.origin}/@${encodeURIComponent(username)}` };
  }
  return null;
}

async function searchMemberProfiles(query) {
  if (!sb || !query) return [];
  const { data, error } = await sb
    .from('accounts')
    .select('id,username,display_name,avatar_url')
    .neq('id', S.userId || '')
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .order('username', { ascending: true })
    .limit(12);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function renderMemberProfileSuggestions(profiles) {
  const container = $('group-members-suggestions');
  if (!container) return;
  if (!profiles.length) {
    container.innerHTML = '<div class="form-field-hint">No matching profiles found. Paste a @username profile link to invite someone.</div>';
    return;
  }
  container.innerHTML = profiles.map(profile => {
    const username = String(profile.username || '').trim();
    const display = String(profile.display_name || username || 'Profile').trim();
    const key = username || profile.id;
    if (!key) return '';
    return `<button type="button" class="form-member-suggestion" data-member-id="${escapeHtml(profile.id || '')}" data-member-username="${escapeHtml(username)}" data-member-name="${escapeHtml(display)}">` +
      `${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px">` : '👤 '} ` +
      `${escapeHtml(display)}${username ? ` <span style="opacity:.62">@${escapeHtml(username)}</span>` : ''}</button>`;
  }).join('');

  container.querySelectorAll('.form-member-suggestion').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      addMemberTag(btn.dataset.memberName || btn.dataset.memberUsername || '', {
        id: btn.dataset.memberId || null,
        username: btn.dataset.memberUsername || null,
        profileUrl: btn.dataset.memberUsername ? `${window.location.origin}/@${encodeURIComponent(btn.dataset.memberUsername)}` : null
      });
    });
  });
}

async function handleMemberSearch(e) {
  const query = String(e.target.value || '').trim();
  const suggestionsContainer = $('group-members-suggestions');
  if (!suggestionsContainer) return;

  if (!query) { suggestionsContainer.innerHTML = ''; return; }

  // Groups can only include eligible contacts (follows or Talk history)
  const eligible = messagesState.eligibleContacts || [];
  if (!eligible.length) {
    suggestionsContainer.innerHTML = '<div class="form-field-hint">No eligible contacts yet. Follow users or complete a Talk chat first.</div>';
    return;
  }

  const q = query.toLowerCase();
  const alreadyAdded = new Set(messagesState.selectedMembers);
  const filtered = eligible.filter(c => {
    const name = (c.display_name || c.username || '').toLowerCase();
    const username = (c.username || '').toLowerCase();
    if (alreadyAdded.has(`@${username}`) || alreadyAdded.has(name)) return false;
    return name.includes(q) || username.includes(q);
  });

  if (!filtered.length) {
    suggestionsContainer.innerHTML = '<div class="form-field-hint">No matching contacts. Only people you follow or have chatted with on Talk can be added.</div>';
    return;
  }

  renderMemberProfileSuggestions(filtered);
}

function addMemberTag(name, member = {}) {
  const displayName = String(name || '').trim();
  const key = member.username ? `@${String(member.username).toLowerCase()}` : displayName.toLowerCase();
  if (!displayName || messagesState.selectedMembers.has(key)) return;

  // Only eligible contacts (follows or Talk history) may be added to groups
  if (!member.id) return;
  const isEligible = (messagesState.eligibleContacts || []).some(c => c.id === member.id);
  if (!isEligible) {
    toast('Only people you follow or have chatted with on Talk can be added.', '⚠️');
    return;
  }

  messagesState.selectedMembers.add(key);

  const membersList = $('group-members-list');
  if (!membersList) return;

  const tag = document.createElement('div');
  tag.className = 'form-tag';
  tag.dataset.memberKey = key;
  tag.innerHTML = `
    <span>${escapeHtml(displayName)}${member.username ? ` <small style="opacity:.62">@${escapeHtml(member.username)}</small>` : ''}</span>
    <span class="form-tag-remove" data-member-key="${escapeHtml(key)}">×</span>
  `;
  tag.querySelector('.form-tag-remove').addEventListener('click', () => {
    messagesState.selectedMembers.delete(key);
    tag.remove();
  });
  membersList.appendChild(tag);

  const input = $('group-members-input');
  if (input) input.value = '';
  const suggestions = $('group-members-suggestions');
  if (suggestions) suggestions.innerHTML = '';
}

async function handleCreateGroup(e) {
  e.preventDefault();

  const nameInput = $('group-name');
  const descInput = $('group-desc');
  const typeRadio = document.querySelector('input[name="group-type"]:checked');

  if (!nameInput || !nameInput.value.trim()) {
    showToast('⚠️ Group name is required');
    return;
  }

  const groupData = {
    name: nameInput.value.trim(),
    description: descInput ? descInput.value.trim() : '',
    type: typeRadio ? typeRadio.value : 'public',
    members: Array.from(messagesState.selectedMembers)
  };

  // Validate
  if (groupData.name.length > 60) {
    showToast('⚠️ Group name is too long');
    return;
  }

  try {
    // Try to create via API if available
    let newGroup;
    if (typeof createGroup === 'function') {
      newGroup = await createGroup(groupData);
    } else {
      // Create locally
      newGroup = {
        id: 'g' + Date.now(),
        name: groupData.name,
        emoji: groupData.type === 'public' ? '👥' : '🔒',
        description: groupData.description,
        type: groupData.type,
        members: groupData.members,
        createdAt: new Date(),
        createdBy: S.username || 'You'
      };
    }

    messagesState.groups.push(newGroup);
    saveMessagesToStorage();

    renderConversationList();
    closeCreateGroupModal();

    showToast('✅ Group created successfully!');
  } catch (error) {
    console.error('Failed to create group:', error);
    showToast('❌ Failed to create group');
  }
}

// ━━━━━━━━━━━━━━━━━ CONVERSATION MANAGEMENT ━━━━━━━━━━━━━━━━━

function renderConversationList(searchQuery = '') {
  const list = $('msg-conv-list');
  if (!list) return;
  const q = String(searchQuery || '').toLowerCase().trim();
  const contacts = messagesState.eligibleContacts || [];
  const groups = messagesState.groups || [];

  const filteredContacts = q
    ? contacts.filter(c => {
        const name = (c.display_name || c.username || '').toLowerCase();
        return name.includes(q) || (c.username || '').toLowerCase().includes(q);
      })
    : contacts;

  const filteredGroups = q
    ? groups.filter(g => (g.name || '').toLowerCase().includes(q))
    : groups;

  if (!filteredContacts.length && !filteredGroups.length) {
    if (S.isGuest) {
      list.innerHTML = `
        <div class="messages-list-empty">
          <div class="empty-icon">🔒</div>
          <p>Sign in to message</p>
          <p class="empty-hint">Create an account to message people you meet</p>
        </div>`;
    } else if (q) {
      list.innerHTML = `
        <div class="messages-list-empty">
          <div class="empty-icon">🔍</div>
          <p>No results for "${escapeHtml(searchQuery)}"</p>
          <p class="empty-hint">Try a different name or username</p>
        </div>`;
    } else {
      list.innerHTML = `
        <div class="messages-list-empty">
          <div class="empty-icon">💬</div>
          <p>No contacts yet</p>
          <p class="empty-hint">Follow someone or complete a Talk chat to unlock messaging</p>
        </div>`;
    }
    return;
  }

  list.innerHTML = '';

  // Groups first
  filteredGroups.forEach(group => {
    const item = createConvItem(group.id, group.name, group.emoji || '👥', `${(group.members || []).length} members · Group`, true);
    list.appendChild(item);
  });

  // Then eligible direct contacts
  filteredContacts.forEach(contact => {
    list.appendChild(createContactConvItem(contact));
  });
}

function createContactConvItem(contact) {
  const display = contact.display_name || contact.username || 'User';
  const username = contact.username || 'user';
  const initial = feedAvatarLetter(display);
  const avatarUrl = feedAvatarUrl(contact.avatar_url);
  const hasMessages = !!(messagesState.messages[contact.id]?.length);
  const lastMsg = hasMessages ? [...(messagesState.messages[contact.id] || [])].pop() : null;

  const sourceLabel = contact.source === 'follow'
    ? (contact.isFollower && contact.isFollowing ? 'Mutual' : contact.isFollower ? 'Follows you' : 'Following')
    : 'Met on Talk';
  const preview = lastMsg
    ? String(lastMsg.text || '').slice(0, 60)
    : `${sourceLabel} · Tap to start a conversation`;

  const sourceBadgeCss = contact.source === 'talk'
    ? 'background:rgba(26,110,245,.10);color:var(--primary);border:1px solid rgba(26,110,245,.16);'
    : 'background:rgba(22,163,74,.10);color:var(--success);border:1px solid rgba(22,163,74,.18);';

  const item = document.createElement('div');
  item.className = 'messages-conv-item';
  item.dataset.convId = contact.id;
  item.dataset.convType = 'direct';
  if (contact.id === messagesState.activeConvId) item.classList.add('active');

  item.innerHTML = `
    <div class="messages-conv-ava" style="${avatarUrl ? 'padding:0;overflow:hidden;' : ''}">
      ${avatarUrl
        ? `<img src="${sanitizeHTML(avatarUrl)}" alt="${sanitizeHTML(display)}" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" onerror="this.parentElement.textContent='${initial}'">`
        : sanitizeHTML(initial)}
    </div>
    <div class="messages-conv-meta">
      <div class="messages-conv-name-row">
        <div class="messages-conv-name">
          ${sanitizeHTML(display)}
          <span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;margin-left:5px;vertical-align:middle;${sourceBadgeCss}">${contact.source === 'talk' ? 'Talk' : sourceLabel}</span>
        </div>
        <div class="messages-conv-time">@${sanitizeHTML(username)}</div>
      </div>
      <div class="messages-conv-preview">${escapeHtml(preview)}</div>
    </div>`;

  item.addEventListener('click', () => {
    document.querySelectorAll('.messages-conv-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    loadDirectThread(contact);
  });

  return item;
}

// createConvItem is used only for group conversations now
function createConvItem(id, name, emoji, meta, isGroup = false) {
  const item = document.createElement('div');
  item.className = 'messages-conv-item';
  item.dataset.convId = id;
  item.dataset.convType = 'group';
  if (id === messagesState.activeConvId) item.classList.add('active');

  item.innerHTML = `
    <div class="messages-conv-ava ${isGroup ? 'group' : ''}">${escapeHtml(emoji)}</div>
    <div class="messages-conv-meta">
      <div class="messages-conv-name-row">
        <div class="messages-conv-name">${escapeHtml(name)}</div>
        <div class="messages-conv-time">Group</div>
      </div>
      <div class="messages-conv-preview">${escapeHtml(meta)}</div>
    </div>`;

  item.addEventListener('click', () => {
    document.querySelectorAll('.messages-conv-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    loadGroupThread(id);
  });
  return item;
}

function loadDirectThread(contact) {
  const empty = $('msg-thread-empty');
  const active = $('msg-thread-active');
  if (!empty || !active) return;

  messagesState.activeConvId = contact.id;
  messagesState.activeConvType = 'direct';
  messagesState.activePeer = contact;

  const display = contact.display_name || contact.username || 'User';
  const username = contact.username || 'user';
  const avatarUrl = feedAvatarUrl(contact.avatar_url);
  const initial = feedAvatarLetter(display);

  const avaEl = $('msg-peer-ava');
  const nameEl = $('msg-peer-name');
  const statusEl = $('msg-peer-status');
  const hint = $('msg-composer-hint');

  if (avaEl) {
    if (avatarUrl) {
      avaEl.innerHTML = `<img src="${sanitizeHTML(avatarUrl)}" alt="${sanitizeHTML(display)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;" loading="lazy" onerror="this.parentElement.textContent='${initial}'">`;
    } else {
      avaEl.textContent = initial;
    }
  }
  if (nameEl) nameEl.textContent = display;
  if (statusEl) {
    const src = contact.source === 'talk' ? 'Met on Talk' :
      (contact.isFollower && contact.isFollowing ? 'Mutual follow' :
        contact.isFollower ? 'Follows you' : 'You follow them');
    statusEl.textContent = `@${username} · ${src}`;
  }
  if (hint) hint.style.display = 'none';

  empty.style.display = 'none';
  active.style.display = 'flex';

  renderDirectMessages(contact.id);
  $('msg-composer-input')?.focus();
}

function loadGroupThread(groupId) {
  const empty = $('msg-thread-empty');
  const active = $('msg-thread-active');
  if (!empty || !active) return;

  const group = messagesState.groups.find(g => g.id === groupId);
  messagesState.activeConvId = groupId;
  messagesState.activeConvType = 'group';
  messagesState.activePeer = null;

  const avaEl = $('msg-peer-ava');
  const nameEl = $('msg-peer-name');
  const statusEl = $('msg-peer-status');
  const hint = $('msg-composer-hint');

  if (avaEl) avaEl.textContent = group?.emoji || '👥';
  if (nameEl) nameEl.textContent = group?.name || 'Group';
  if (statusEl) statusEl.textContent = `${(group?.members || []).length} members`;
  if (hint) hint.style.display = 'none';

  empty.style.display = 'none';
  active.style.display = 'flex';

  renderMessages(groupId);
  $('msg-composer-input')?.focus();
}

function renderDirectMessages(userId) {
  const container = $('msg-thread-messages');
  if (!container) return;
  const messages = messagesState.messages[userId] || [];

  if (!messages.length) {
    const peer = messagesState.activePeer;
    const display = peer ? (peer.display_name || peer.username || 'them') : 'this person';
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 20px;text-align:center;flex:1;color:var(--msg-text-3,rgba(255,255,255,.38));">
        <span style="font-size:38px;opacity:.55;">💬</span>
        <div style="font-size:14px;font-weight:600;color:rgba(255,255,255,.7);">Start a conversation</div>
        <div style="font-size:12px;max-width:28ch;line-height:1.6;">Say hi to ${escapeHtml(display)} — you're connected through ${peer?.source === 'talk' ? 'a Talk chat' : 'follows'}.</div>
      </div>`;
    return;
  }

  container.innerHTML = messages.map(msg => `
    <div class="msg-row ${msg.isMe ? 'me' : 'them'}">
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function renderMessages(convId) {
  const container = $('msg-thread-messages');
  if (!container) return;
  const messages = messagesState.messages[convId] || [];

  container.innerHTML = messages.map(msg => `
    <div class="msg-row ${msg.isMe ? 'me' : 'them'}">
      ${msg.isMe ? '' : `<div class="messages-peer-ava" style="width:32px;height:32px;font-size:16px;">${msg.emoji || '👤'}</div>`}
      <div>
        <div class="msg-bubble">${escapeHtml(msg.text)}</div>
        <div class="msg-time">${msg.time || formatTime(msg.timestamp)}</div>
      </div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function closeThread() {
  const empty = $('msg-thread-empty');
  const active = $('msg-thread-active');
  if (empty) empty.style.display = 'flex';
  if (active) active.style.display = 'none';

  document.querySelectorAll('.messages-conv-item').forEach(i => i.classList.remove('active'));

  messagesState.activeConvId = null;
  messagesState.activeConvType = null;
  messagesState.activePeer = null;
  const hint = $('msg-composer-hint');
  if (hint) hint.style.display = '';
}

// ━━━━━━━━━━━━━━━━━ MESSAGE SENDING ━━━━━━━━━━━━━━━━━

// NOTE: window.sendMessage is replaced by dbSendMessage() in the
// "MESSAGING DB PATCH v43" block below. This stub is a safety fallback
// only (e.g. guest / no-Supabase context before the patch activates).
async function sendMessage() {
  const input = $('msg-composer-input');
  if (!input || !messagesState.activeConvId) return;
  const text = input.value.trim();
  if (!text) return;
  console.warn('[Messages] sendMessage() fallback fired — DB patch not yet active.');
}

function updateComposerButton() {
  const input = $('msg-composer-input');
  const sendBtn = $('msg-composer-send');

  if (input && sendBtn) {
    sendBtn.disabled = !input.value.trim();
  }
}

// ━━━━━━━━━━━━━━━━━ SEARCH & FILTERING ━━━━━━━━━━━━━━━━━

function handleConversationSearch(e) {
  const query = String(e.target.value || '').trim();
  renderConversationList(query);
  updateSidebarSubtitle();
}

// ━━━━━━━━━━━━━━━━━ THREAD MENU ━━━━━━━━━━━━━━━━━

function openThreadMenu(e) {
  e.stopPropagation();

  const menu = document.createElement('div');
  menu.className = 'messages-context-menu';
  menu.innerHTML = `
    <button data-action="mute" style="width:100%;padding:8px 12px;text-align:left;border:none;background:transparent;cursor:pointer;">🔇 Mute notifications</button>
    <button data-action="pin" style="width:100%;padding:8px 12px;text-align:left;border:none;background:transparent;cursor:pointer;">📌 Pin conversation</button>
    <button data-action="archive" style="width:100%;padding:8px 12px;text-align:left;border:none;background:transparent;cursor:pointer;">📦 Archive</button>
    <button data-action="delete" style="width:100%;padding:8px 12px;text-align:left;border:none;background:transparent;cursor:pointer;color:#ef4444;">🗑️ Delete</button>
  `;

  menu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    window.handleConvAction?.(messagesState.activeConvId, action);
    menu.remove();
  });

  document.body.appendChild(menu);

  const rect = e.target.getBoundingClientRect();
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 8}px;
    left: ${Math.min(rect.left - 100, window.innerWidth - 150)}px;
    background: var(--msg-bg-2, #0d1520);
    border: 1px solid var(--msg-border, rgba(255,255,255,.07));
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,.5);
    z-index: 1001;
  `;

  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

function handleConvAction(convId, action) {
  switch (action) {
    case 'mute':
      // TODO: Mute notifications
      showToast('🔇 Notifications muted');
      break;
    case 'pin':
      // TODO: Pin conversation
      showToast('📌 Conversation pinned');
      break;
    case 'archive':
      // TODO: Archive conversation
      messagesState.activeConvId = null;
      renderConversationList();
      closeThread();
      showToast('📦 Conversation archived');
      break;
    case 'delete':
      if (confirm('Delete this conversation?')) {
        messagesState.activeConvId = null;
        renderConversationList();
        closeThread();
        showToast('🗑️ Conversation deleted');
      }
      break;
  }
}

// ━━━━━━━━━━━━━━━━━ UTILITIES ━━━━━━━━━━━━━━━━━

function formatTime(date) {
  if (typeof date === 'string') return date;
  if (!date) return '';

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showToast(message) {
  // Use existing app.js toast system
  if (typeof showAppToast === 'function') {
    showAppToast(message);
  } else if (typeof showToast === 'function') {
    showToast(message);
  } else {
    console.log('Toast:', message);
  }
}

// ━━━━━━━━━━━━━━━━━ API STUBS ━━━━━━━━━━━━━━━━━
// Implement these in your backend integration

/**
 * Fetch all conversations for current user
 * @returns {Promise<Array>} Conversations array
 */
async function fetchConversations() {
  // GET /api/conversations
  // return (await fetch(`${SERVER_URL}/api/conversations`)).json();
  return [];
}

/**
 * Fetch all groups for current user
 * @returns {Promise<Array>} Groups array
 */
async function fetchGroups() {
  // GET /api/groups
  // return (await fetch(`${SERVER_URL}/api/groups`)).json();
  return [];
}

/**
 * Fetch messages for a conversation
 * @param {string} convId - Conversation ID
 * @param {number} limit - Number of messages to fetch
 * @returns {Promise<Array>} Messages array
 */
async function fetchMessagesForConv(convId, limit = 50) {
  // GET /api/conversations/{convId}/messages?limit={limit}
  // return (await fetch(`${SERVER_URL}/api/conversations/${convId}/messages?limit=${limit}`)).json();
  return [];
}

/**
 * Send message to conversation
 * @param {string} convId - Conversation ID
 * @param {string} text - Message text
 * @returns {Promise<Object>} Sent message
 */
async function sendMessageToAPI(convId, text) {
  // POST /api/conversations/{convId}/messages
  // return (await fetch(`${SERVER_URL}/api/conversations/${convId}/messages`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ text })
  // })).json();
}


// Real-time subscriptions are handled by setupRealtime() in the DB patch (v43).
// No legacy stub needed here.

// ━━━━━━━━━━━━━━━━━ EXPORT FOR USE ━━━━━━━━━━━━━━━━━
// Call initMessages() from app.js when ready
// Example: window.addEventListener('load', initMessages);

// Make functions available globally
window.initMessages = initMessages;
window.openCreateGroupModal = openCreateGroupModal;
window.closeCreateGroupModal = closeCreateGroupModal;
window.loadThread = (id) => { // legacy shim
  const contact = (messagesState.eligibleContacts || []).find(c => c.id === id);
  if (contact) loadDirectThread(contact);
  else loadGroupThread(id);
};
window.sendMessage = sendMessage;
window.closeThread = closeThread;
window.normalizeMemberInvitation = normalizeMemberInvitation;
window.fetchEligibleMessageContacts = fetchEligibleMessageContacts;


// MORTALIVE FEED — Supabase-backed integration (Step 2)
// Reuses public.posts created by the Profile composer. Text posts only
// for this phase; likes/comments/polls remain later relational phases.
// ═══════════════════════════════════════════════════════════════════
const FEED_PAGE_SIZE = 10;
const FEED_MAX_POST_CHARS = 500;
let _feedInitialized = false;
let _feedFilter = 'all';
let _feedOffset = 0;
let _feedHasMore = true;
let _feedLoading = false;
let _feedPosts = [];

let _feedEngagement = new Map();
// V106: persistent per-user post view counts, hydrated from Supabase RPCs.
let _feedViewCountsCache = new Map();
let _feedViewRecording = new Set();
let _commentCache = new Map();
let _commentLoading = new Set();
const _MINUTE = 60_000, _HOUR = 3_600_000, _DAY = 86_400_000, _WEEK = 604_800_000;

function feedRelTime(iso) {
  const ts = Date.parse(iso ?? '');
  if (!Number.isFinite(ts)) return 'Just now';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < _MINUTE) return 'just now';
  if (diff < _HOUR) return `${Math.floor(diff / _MINUTE)}m ago`;
  if (diff < _DAY) return `${Math.floor(diff / _HOUR)}h ago`;
  if (diff < _WEEK) return `${Math.floor(diff / _DAY)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function feedAvatarLetter(name) {
  const value = String(name ?? 'M').trim();
  return sanitizeHTML((value.charAt(0) || 'M').toUpperCase());
}

// Feed avatars are remote URLs from the public profile directory. Only allow
// normal HTTP(S) image URLs into the rendered <img> so the post-card HTML
// remains safe even if a malformed value reaches the client.
function feedAvatarUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return sanitizeHTML(parsed.href);
  } catch (_) {
    return '';
  }
}

function feedProfileFor(userId) {
  if (userId && userId === S.userId) {
    return {
      username: S.accountData?.username || S.username || 'You',
      display_name: S.accountData?.display_name || S.username || 'You',
      crockroach_score: S.accountData?.crockroach_score ?? S.crockroachScore ?? getProgressScore(getCurrentProgress()),
      avatar_url: S.accountData?.avatar_url || ''
    };
  }
  return null;
}

async function requireAuthenticatedSession() {
  if (S.isGuest || !S.userId || !sb?.auth?.getSession) return null;
  try {
    const { data, error } = await sb.auth.getSession();
    if (error || !data?.session?.user?.id) return null;
    if (data.session.user.id !== S.userId) return null;
    if (data.session.access_token) S.authToken = data.session.access_token;
    return data.session;
  } catch (_) {
    return null;
  }
}

async function fetchFeedProfileDirectory(userIds) {
  if (!(await requireAuthenticatedSession())) return new Map();
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!ids.length || !sb) return new Map();
  const map = new Map();
  try {
    const { data, error } = await sb
      .from('public_profile_directory')
      .select('id,username,display_name,crockroach_score,account_type')
      .in('id', ids);
    if (error) throw error;
    (data || []).forEach(row => map.set(row.id, row));
  } catch (e) {
    console.warn('[Feed] public profile directory lookup failed:', e?.message || e);
  }

  // Some deployments expose the public directory without the avatar column,
  // or the directory query itself can fail under a stricter RLS/view policy.
  // Fill missing users from accounts so feed cards never regress to initials
  // when a real profile image exists.
  const accountFallbackIds = ids.filter(id => {
    const row = map.get(id);
    return !row || !feedAvatarUrl(row.avatar_url);
  });
  if (accountFallbackIds.length) {
    try {
      const { data: accountRows } = await sb
        .from('accounts')
        .select('id,username,display_name,crockroach_score,account_type,avatar_url')
        .in('id', accountFallbackIds);
      (accountRows || []).forEach(row => {
        const current = map.get(row.id);
        map.set(row.id, current
          ? { ...current, avatar_url: row.avatar_url || current.avatar_url || '', crockroach_score: row.crockroach_score ?? current.crockroach_score }
          : row);
      });
    } catch (e) {
      console.warn('[Feed] avatar fallback lookup failed:', e?.message || e);
    }
  }

  ids.forEach(id => {
    if (!map.has(id)) {
      const local = feedProfileFor(id);
      if (local) map.set(id, { id, ...local });
    }
  });
  return map;
}

async function fetchFeedPage(reset = false) {
  if (S.isGuest || !S.userId || !sb || _feedLoading) return;
  if (!(await requireAuthenticatedSession())) {
    toast('Your session has expired. Please sign in again.', '🔒');
    return;
  }
  if (reset) {
    _feedOffset = 0;
    _feedHasMore = true;
    _feedPosts = [];
  }
  if (!_feedHasMore) return;

  const container = $('feed-posts');
  const loadMore = $('load-more-btn');
  if (_feedOffset === 0 && container) {
    container.innerHTML = `
      <div class="skel-post"><div class="skel-row"><div class="skeleton skel-circle"></div><div style="flex:1;display:flex;flex-direction:column;gap:6px;"><div class="skeleton skel-line" style="width:38%;"></div><div class="skeleton skel-line" style="width:22%;height:11px;"></div></div></div><div class="skeleton skel-line" style="width:100%;margin-bottom:8px;"></div><div class="skeleton skel-line" style="width:85%;"></div></div>`;
  }
  _feedLoading = true;
  if (loadMore) loadMore.disabled = true;

  try {
    let query = sb
      .from('posts')
      .select('id,user_id,content,post_type,visibility,created_at,updated_at,media_url,media_type,media_size,post_meta')
      .order('created_at', { ascending: false })
      .range(_feedOffset, _feedOffset + FEED_PAGE_SIZE - 1);

    if (_feedFilter === 'mine') {
      query = query.eq('user_id', S.userId);
    } else {
      query = query.eq('visibility', 'public');
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const directory = await fetchFeedProfileDirectory(rows.map(row => row.user_id));
    const mapped = rows.map(row => ({
      ...row,
      author: directory.get(row.user_id) || feedProfileFor(row.user_id) || { username: 'Mortalive member', display_name: 'Mortalive member', crockroach_score: 0 }
    }));

    _feedPosts = reset || _feedOffset === 0 ? mapped : [..._feedPosts, ...mapped];
    _feedOffset += rows.length;
    _feedHasMore = rows.length === FEED_PAGE_SIZE;
    await hydratePostEngagement(rows.map(row => row.id));
    await hydratePostViewCounts(rows.map(row => row.id));
    await hydrateQnaResponses(rows.filter(row => row?.post_meta?.kind === 'qna' && row?.post_meta?.mode === 'mcq').map(row => row.id));
    await hydratePollResults(rows.filter(row => row?.post_meta?.kind === 'poll').map(row => row.id));
    renderFeedPosts();
    renderFeedSidebars();
    hydrateTrendingHashtags().catch(() => {});
  } catch (e) {
    console.warn('[Feed] fetch failed:', e?.message || e);
    if (container) {
      container.innerHTML = `<div class="feed-empty"><div class="feed-empty-icon">⚠️</div><h3>Feed unavailable</h3><p>${sanitizeHTML(e?.message || 'Could not load public posts right now.')}</p><button class="load-more-btn" type="button" data-feed-action="retry">Retry</button></div>`;
    }
    _feedHasMore = false;
  } finally {
    _feedLoading = false;
    if (loadMore) {
      loadMore.disabled = false;
      loadMore.style.display = _feedHasMore ? 'flex' : 'none';
    }
  }
}

function filteredFeedPosts() {
  if (_feedFilter === 'mine') return _feedPosts.filter(post => post.user_id === S.userId);
  return _feedPosts;
}


async function hydratePostEngagement(postIds) {
  const ids = Array.from(new Set((postIds || []).filter(Boolean)));
  if (!ids.length || !sb || S.isGuest) return;
  try {
    const { data, error } = await sb.rpc('get_post_engagement', { p_post_ids: ids });
    if (error) throw error;
    (data || []).forEach(row => {
      _feedEngagement.set(row.post_id, {
        likes: toNum(row.like_count),
        comments: toNum(row.comment_count),
        liked: !!row.liked_by_me
      });
    });
    ids.forEach(id => {
      if (!_feedEngagement.has(id)) _feedEngagement.set(id, { likes: 0, comments: 0, liked: false });
    });
  } catch (e) {
    console.warn('[Feed] engagement lookup failed:', e?.message || e);
    ids.forEach(id => {
      if (!_feedEngagement.has(id)) _feedEngagement.set(id, { likes: 0, comments: 0, liked: false });
    });
  }
}

function engagementFor(postId) {
  return _feedEngagement.get(postId) || { likes: 0, comments: 0, liked: false };
}


function postViewCountFor(postId) {
  return toNum(_feedViewCountsCache.get(postId), 0);
}

async function hydratePostViewCounts(postIds = []) {
  const ids = Array.from(new Set((postIds || []).filter(Boolean)));
  if (!ids.length || !sb || S.isGuest) return;
  try {
    const { data, error } = await sb.rpc('get_post_view_counts', { p_post_ids: ids });
    if (error) throw error;
    ids.forEach(id => _feedViewCountsCache.delete(id));
    (data || []).forEach(row => {
      if (row?.post_id) _feedViewCountsCache.set(row.post_id, toNum(row.view_count));
    });
    ids.forEach(id => {
      if (!_feedViewCountsCache.has(id)) _feedViewCountsCache.set(id, 0);
    });
  } catch (e) {
    console.warn('[Feed] view count hydration warning:', e?.message || e);
    ids.forEach(id => {
      if (!_feedViewCountsCache.has(id)) _feedViewCountsCache.set(id, 0);
    });
  }
}

async function recordPostView(postId) {
  if (S.isGuest || !S.userId || !sb || !postId || _feedViewRecording.has(postId)) return;
  _feedViewRecording.add(postId);
  try {
    const { data, error } = await sb.rpc('record_post_view', { p_post_id: postId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.view_count != null) {
      _feedViewCountsCache.set(postId, toNum(row.view_count));
    } else {
      await hydratePostViewCounts([postId]);
    }
    renderFeedPosts();
  } catch (e) {
    // View counting is non-blocking: a missing migration/RPC must never stop
    // the post viewer or feed from working.
    console.warn('[Feed] view record warning:', e?.message || e);
  } finally {
    _feedViewRecording.delete(postId);
  }
}

// Shared helper — re-renders whichever surfaces currently show postId
function _rerenderPostEngagement(postId) {
  // Re-render feed list if it contains this post
  if (document.querySelector(`#pg-feed .post-card[data-post-id="${CSS.escape(postId)}"]`)) {
    renderFeedPosts();
  }
  // Re-render profile post strip if it contains this post
  if (document.querySelector(`#profile-post-strip [data-post-id="${CSS.escape(postId)}"]`)) {
    renderProfilePosts(_profilePosts);
  }
}

async function togglePostLike(postId) {
  if (S.isGuest || !S.userId || !sb) {
    toast('Sign in to like posts', '🔒');
    return;
  }
  const state = { ...engagementFor(postId) };
  const nextLiked = !state.liked;
  _feedEngagement.set(postId, { ...state, liked: nextLiked, likes: Math.max(0, state.likes + (nextLiked ? 1 : -1)) });
  _rerenderPostEngagement(postId);

  try {
    if (nextLiked) {
      const { error } = await sb.from('post_likes').insert({ post_id: postId, user_id: S.userId });
      if (error && error.code !== '23505') throw error;
    } else {
      const { error } = await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', S.userId);
      if (error) throw error;
    }
    await hydratePostEngagement([postId]);
    _rerenderPostEngagement(postId);
  } catch (e) {
    _feedEngagement.set(postId, state);
    _rerenderPostEngagement(postId);
    toast(e?.message || 'Could not update like.', '⚠️');
  }
}

async function loadPostComments(postId, force = false) {
  if (!postId || !sb || S.isGuest) return [];
  if (!force && _commentCache.has(postId)) return _commentCache.get(postId);
  if (_commentLoading.has(postId)) return _commentCache.get(postId) || [];
  _commentLoading.add(postId);
  try {
    const { data, error } = await sb
      .from('post_comments')
      .select('id,post_id,user_id,content,parent_id,created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const directory = await fetchFeedProfileDirectory(rows.map(row => row.user_id));
    const comments = rows.map(row => ({ ...row, author: directory.get(row.user_id) || { username: 'member', display_name: 'Member' } }));
    _commentCache.set(postId, comments);
    const state = engagementFor(postId);
    _feedEngagement.set(postId, { ...state, comments: comments.length });
    return comments;
  } catch (e) {
    console.warn('[Feed] comments lookup failed:', e?.message || e);
    toast('Could not load comments right now.', '⚠️');
    return [];
  } finally {
    _commentLoading.delete(postId);
  }
}

function renderPostComments(postId, comments) {
  const section = document.querySelector(`#pg-feed .comments-section[data-post-id="${CSS.escape(postId)}"]`);
  if (!section) return;
  if (!comments?.length) {
    section.innerHTML = `
      <div class="comment-input-row">
        <div class="comment-avatar">${feedAvatarLetter(S.accountData?.display_name || S.username || 'You')}</div>
        <input class="comment-input" data-comment-input="${sanitizeHTML(postId)}" maxlength="300" placeholder="Write a comment…">
        <button class="comment-submit" type="button" data-feed-action="comment-submit" data-post-id="${sanitizeHTML(postId)}" style="opacity:1;pointer-events:auto;">Comment</button>
      </div>
      <div class="comments-empty">Be the first to comment.</div>`;
    return;
  }
  section.innerHTML = `
    <div class="comment-input-row">
      <div class="comment-avatar">${feedAvatarLetter(S.accountData?.display_name || S.username || 'You')}</div>
      <input class="comment-input" data-comment-input="${sanitizeHTML(postId)}" maxlength="300" placeholder="Write a comment…">
      <button class="comment-submit" type="button" data-feed-action="comment-submit" data-post-id="${sanitizeHTML(postId)}" style="opacity:1;pointer-events:auto;">Comment</button>
    </div>
    ${comments.map(comment => {
      const author = comment.author || {};
      const mine = comment.user_id === S.userId;
      return `<div class="comment-item">
        <div class="comment-item-avatar">${feedAvatarLetter(author.display_name || author.username || 'Member')}</div>
        <div class="comment-bubble">
          <div class="comment-author">${sanitizeHTML(author.display_name || author.username || 'Member')} <span class="comment-author-time">· ${sanitizeHTML(feedRelTime(comment.created_at))}</span></div>
          <div class="comment-text">${sanitizeHTML(comment.content || '')}</div>
          ${mine ? `<div class="comment-actions"><button class="comment-action" type="button" data-feed-action="delete-comment" data-post-id="${sanitizeHTML(postId)}" data-comment-id="${sanitizeHTML(comment.id)}">Delete</button></div>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

async function togglePostComments(postId) {
  let section = document.querySelector(`#pg-feed .comments-section[data-post-id="${CSS.escape(postId)}"]`);
  if (!section) return;
  const shouldOpen = !section.classList.contains('open');
  section.classList.toggle('open', shouldOpen);
  if (!shouldOpen) return;
  section.innerHTML = '<div class="comments-loading">Loading comments…</div>';
  const comments = await loadPostComments(postId);
  // Re-query after async — a concurrent renderFeedPosts may have replaced the DOM
  section = document.querySelector(`#pg-feed .comments-section[data-post-id="${CSS.escape(postId)}"]`);
  if (!section) return;
  section.classList.add('open');
  renderPostComments(postId, comments);
}

async function createPostComment(postId, content) {
  if (S.isGuest || !S.userId || !sb) {
    toast('Sign in to comment', '🔒');
    return;
  }
  const text = String(content || '').trim();
  if (!text) return;
  if (text.length > 300) {
    toast('Comments are limited to 300 characters', '⚠️');
    return;
  }
  try {
    const { data, error } = await sb.from('post_comments').insert({
      post_id: postId,
      user_id: S.userId,
      content: text
    }).select('id,post_id,user_id,content,parent_id,created_at').single();
    if (error) throw error;
    const author = feedProfileFor(S.userId) || {
      username: S.username || 'You',
      display_name: S.accountData?.display_name || S.username || 'You'
    };
    const current = _commentCache.get(postId) || [];
    _commentCache.set(postId, [...current, { ...data, author }]);
    const state = engagementFor(postId);
    _feedEngagement.set(postId, { ...state, comments: state.comments + 1 });
    renderFeedPosts();
    const section = document.querySelector(`#pg-feed .comments-section[data-post-id="${CSS.escape(postId)}"]`);
    if (section) {
      section.classList.add('open');
      renderPostComments(postId, _commentCache.get(postId));
    }
    toast('Comment added', '💬');
  } catch (e) {
    toast(e?.message || 'Could not add comment.', '⚠️');
  }
}

async function deletePostComment(postId, commentId) {
  if (!S.userId || !sb) return;
  try {
    const { error } = await sb.from('post_comments').delete().eq('id', commentId).eq('user_id', S.userId);
    if (error) throw error;
    const current = (_commentCache.get(postId) || []).filter(comment => comment.id !== commentId);
    _commentCache.set(postId, current);
    const state = engagementFor(postId);
    _feedEngagement.set(postId, { ...state, comments: Math.max(0, state.comments - 1) });
    renderFeedPosts();
    const section = document.querySelector(`#pg-feed .comments-section[data-post-id="${CSS.escape(postId)}"]`);
    if (section) {
      section.classList.add('open');
      renderPostComments(postId, current);
    }
    toast('Comment deleted', '🗑️');
  } catch (e) {
    toast(e?.message || 'Could not delete comment.', '⚠️');
  }
}

// ── Helpers: preserve open comment sections across renderFeedPosts calls ──────
// Every innerHTML replacement destroys open comment sections; these helpers
// save which post IDs had open sections and restore them from the cache.
function _getOpenCommentIds() {
  return Array.from(
    document.querySelectorAll('#pg-feed .comments-section.open[data-post-id]')
  ).map(el => el.dataset.postId).filter(Boolean);
}

function _restoreOpenCommentSections(ids) {
  for (const postId of ids) {
    const section = document.querySelector(
      `#pg-feed .comments-section[data-post-id="${CSS.escape(postId)}"]`
    );
    if (!section) continue;
    section.classList.add('open');
    const cached = _commentCache.get(postId);
    if (cached !== undefined) renderPostComments(postId, cached);
  }
}

function profileHref(userId, username) {
  if (username) return `/${encodeURIComponent(username.replace(/^@/, ''))}`;
  if (userId)   return `/?user=${encodeURIComponent(userId)}`;
  return '/';
}

function ensureFeedProfileOverlay() {
  let overlay = $('feed-profile-overlay');
  if (overlay) return overlay;

  const style = document.createElement('style');
  style.id = 'feed-profile-overlay-style';
  style.textContent = `
    #feed-profile-overlay{position:fixed;top:88px;right:0;bottom:0;left:0;z-index:1800;display:none;align-items:stretch;justify-content:stretch;background:var(--surface);}
    #feed-profile-overlay.open{display:flex;}
    body.feed-profile-open{overflow:hidden;}
    #feed-profile-overlay .feed-profile-sheet{width:100%;height:100%;max-height:none;overflow:hidden;background:var(--surface);border:0;box-shadow:none;display:flex;flex-direction:column;animation:feedProfileIn .22s var(--ease-out);}
    @keyframes feedProfileIn{from{opacity:.82;}to{opacity:1;}}
    #feed-profile-overlay .feed-profile-nav{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.94);backdrop-filter:blur(18px);}
    #feed-profile-overlay .feed-profile-close{width:38px;height:38px;border-radius:50%;background:var(--surface-2);border:1px solid var(--border);font-size:18px;font-weight:800;display:grid;place-items:center;flex:none;}
    #feed-profile-overlay .feed-profile-nav-title{font-size:14px;font-weight:900;letter-spacing:-.02em;}
    #feed-profile-overlay .feed-profile-content{min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;} #feed-profile-overlay .feed-profile-tabs{position:sticky;top:0;z-index:4;background:rgba(255,255,255,.96);backdrop-filter:blur(14px);display:flex;overflow-x:auto;} #feed-profile-overlay .feed-profile-tab{padding:12px 16px;border:0;border-bottom:2px solid transparent;background:transparent;font-weight:800;color:var(--on-surface-3);white-space:nowrap;} #feed-profile-overlay .feed-profile-tab.active{color:var(--primary);border-bottom-color:var(--primary);}
    #feed-profile-overlay .feed-profile-cover{height:112px;background:var(--surface);border-bottom:1px solid var(--border);}
    #feed-profile-overlay .feed-profile-head{padding:0 22px 18px;}
    #feed-profile-overlay .feed-profile-avatar{width:92px;height:92px;margin-top:-46px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--secondary));color:#fff;font-size:32px;font-weight:900;flex:none;border:4px solid var(--surface);box-shadow:var(--elev-2);}
    #feed-profile-overlay .feed-profile-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
    #feed-profile-overlay .feed-profile-actions{display:flex;justify-content:flex-end;margin-top:-46px;min-height:46px;}
    #feed-profile-overlay .feed-profile-action{min-width:92px;padding:8px 16px;border-radius:999px;border:1.5px solid var(--border-strong);background:#fff;color:var(--on-surface);font-size:12px;font-weight:800;transition:background .14s ease,color .14s ease,border-color .14s ease,transform .14s ease;}
    #feed-profile-overlay .feed-profile-action:hover{border-color:var(--primary);color:var(--primary);background:var(--primary-alpha);}
    #feed-profile-overlay .feed-profile-action.profile-action-following{background:var(--on-surface);color:#fff;border-color:var(--on-surface);}
    #feed-profile-overlay .feed-profile-action:disabled{opacity:.55;cursor:not-allowed;transform:none;}
    #feed-profile-overlay .feed-profile-name{margin-top:10px;font-size:24px;font-weight:900;letter-spacing:-.04em;}
    #feed-profile-overlay .feed-profile-handle{margin-top:3px;color:var(--on-surface-3);font-size:13px;font-weight:700;}
    #feed-profile-overlay .feed-profile-status{margin-top:8px;font-size:12px;color:var(--on-surface-3);}
    #feed-profile-overlay .feed-profile-bio{margin-top:14px;color:var(--on-surface-2);font-size:13.5px;line-height:1.65;}
    #feed-profile-overlay .feed-profile-meta{display:grid;gap:9px;margin-top:14px;}
    #feed-profile-overlay .feed-profile-meta-row{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--on-surface-2);line-height:1.5;}
    #feed-profile-overlay .feed-profile-meta-icon{width:20px;flex:none;text-align:center;opacity:.75;}
    #feed-profile-overlay .feed-profile-meta-value{min-width:0;word-break:break-word;}
    #feed-profile-overlay .feed-profile-link-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
    #feed-profile-overlay .feed-profile-link{display:inline-flex;align-items:center;gap:6px;padding:8px 11px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);color:var(--primary);font-size:11.5px;font-weight:800;text-decoration:none;}
    #feed-profile-overlay .feed-profile-link:hover{background:var(--primary-alpha);border-color:rgba(26,110,245,.16);}
    #feed-profile-overlay .feed-profile-interests{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px;}
    #feed-profile-overlay .feed-profile-interest{display:inline-flex;align-items:center;padding:7px 10px;border-radius:999px;background:var(--primary-alpha);border:1px solid rgba(26,110,245,.14);color:var(--primary);font-size:11px;font-weight:700;}
    #feed-profile-overlay .feed-profile-section-label{margin-top:16px;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--on-surface-3);}
    #feed-profile-overlay .feed-profile-stats{display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;}
    #feed-profile-overlay .feed-profile-stat strong{font-size:14px;font-weight:900;color:var(--on-surface);}
    #feed-profile-overlay .feed-profile-stat span{font-size:11px;color:var(--on-surface-3);margin-left:4px;}
    #feed-profile-overlay .feed-profile-tabs{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--border);background:rgba(255,255,255,.96);backdrop-filter:blur(16px);}
    #feed-profile-overlay .feed-profile-tab{padding:14px 10px;text-align:center;font-size:12.5px;font-weight:800;color:var(--on-surface-3);border-bottom:2px solid transparent;}
    #feed-profile-overlay .feed-profile-tab.active{color:var(--on-surface);border-bottom-color:var(--primary);}
    #feed-profile-overlay .feed-profile-section{padding:16px 22px 24px;}
    #feed-profile-overlay .feed-profile-posts{display:grid;gap:0;}
    #feed-profile-overlay .feed-profile-post{padding:16px 0;border-bottom:1px solid var(--border);}
    #feed-profile-overlay .feed-profile-post:last-child{border-bottom:0;}
    #feed-profile-overlay .feed-profile-post-time{font-size:10px;color:var(--on-surface-3);margin-bottom:7px;}
    #feed-profile-overlay .feed-profile-post-text{font-size:13.5px;line-height:1.65;word-break:break-word;}
    #feed-profile-overlay .feed-profile-post img{width:100%;max-height:460px;object-fit:cover;border-radius:16px;margin-top:10px;display:block;}
    @media(max-width:720px){#feed-profile-overlay{top:0;bottom:0;}#feed-profile-overlay .feed-profile-sheet{width:100%;border-left:0;}#feed-profile-overlay .feed-profile-cover{height:132px;}#feed-profile-overlay .feed-profile-head{padding-inline:16px;}#feed-profile-overlay .feed-profile-section{padding-inline:16px;}}
  `;
  document.head.appendChild(style);

  overlay = document.createElement('div');
  overlay.id = 'feed-profile-overlay';
  overlay.innerHTML = `
    <div class="feed-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="feed-profile-title">
      <div class="feed-profile-nav">
        <button class="feed-profile-close" type="button" aria-label="Back to feed">←</button>
        <div class="feed-profile-nav-title">Profile</div>
      </div>
      <div class="feed-profile-content" id="feed-profile-overlay-content"></div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => closeFeedProfileOverlay();
  overlay.querySelector('.feed-profile-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  if (!document.body.dataset.feedProfileEscapeBound) {
    document.body.dataset.feedProfileEscapeBound = '1';
    document.addEventListener('keydown', (event) => {
      const current = $('feed-profile-overlay');
      if (event.key === 'Escape' && current?.classList.contains('open')) closeFeedProfileOverlay();
    });
  }
  return overlay;
}

function closeFeedProfileOverlay() {
  const overlay = $('feed-profile-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('feed-profile-open');
}

async function openFeedProfileOverlay(userId) {
  if (!userId) return;
  const session = await requireAuthenticatedSession();
  if (!session) {
    toast('Sign in to view member profiles.', '🔒');
    showPage('pg-auth');
    return;
  }
  if (S.userId === userId) {
    closeFeedProfileOverlay();
    S.profileViewUserId = null;
    S.profileViewData = null;
    showPage('pg-profile');
    return;
  }

  const overlay = ensureFeedProfileOverlay();
  const content = $('feed-profile-overlay-content');
  if (!content) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('feed-profile-open');
  content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--on-surface-3);">Loading profile…</div>';

  try {
    const profile = await fetchPublicProfileData(userId);
    const posts = await fetchProfilePosts(userId);
    const [links, followData] = await Promise.all([fetchUserLinks(userId), fetchFollowData(userId)]);
    const name = profile.display_name || profile.username || 'Mortalive member';
    const username = profile.username || 'member';
    const score = toNum(profile.crockroach_score);
    const badge = score >= 700 ? '⭐ Gold' : score >= 420 ? '🔘 Silver' : score >= 220 ? '✨ Bronze' : '🌱 Newcomer';
    const status = [(profile.account_type || 'Member'), badge].filter(Boolean).join(' · ');
    const avatarUrl = feedAvatarUrl(profile.avatar_url);
    const initial = feedAvatarLetter(name);
    const textPosts = posts.filter(post => !post.media_url);
    const photoPosts = posts.filter(post => !!post.media_url && post.post_type !== 'reel');
    const reels = posts.filter(post => post.post_type === 'reel' && !!post.media_url);
    const detailsLabels = { professional: 'Job Title', creator: 'Content Niche', business: 'Company Name', private: 'Details', content: 'Content Niche', fun: 'Interests' };
    const detailLabel = detailsLabels[profile.account_type] || 'Details';
    const rawWebsite = String(profile.website || '').trim();
    const websiteUrl = rawWebsite ? (/^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`) : '';
    const interests = Array.isArray(profile.interests) ? profile.interests : [];
    const interestLabels = Object.fromEntries(PROFILE_INTERESTS.map(item => [item.id, item.label]));
    const safeLinks = (links || []).filter(link => /^https?:\/\//i.test(String(link.url || '')) || /^[^:]+\.[^:]+$/.test(String(link.url || '').trim()));

    content.innerHTML = `
      <div class="feed-profile-cover"></div>
      <div class="feed-profile-head">
        <div class="feed-profile-actions"><button type="button" class="feed-profile-action" data-feed-profile-follow="${sanitizeHTML(userId)}">${followData.isFollowing ? 'Following' : 'Follow'}</button></div>
        <div class="feed-profile-avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="${sanitizeHTML(name)}" loading="lazy">` : sanitizeHTML(initial)}</div>
        <div id="feed-profile-title" class="feed-profile-name">${sanitizeHTML(name)}</div>
        <div class="feed-profile-handle">@${sanitizeHTML(username)}</div>
        <div class="feed-profile-status">${sanitizeHTML(status)}</div>
        <div class="feed-profile-bio">${sanitizeHTML(profile.bio || 'No bio yet.')}</div>
        ${(profile.details || profile.website || profile.account_type) ? `
          <div class="feed-profile-meta">
            ${profile.details ? `<div class="feed-profile-meta-row"><span class="feed-profile-meta-icon">💼</span><span class="feed-profile-meta-value"><strong>${sanitizeHTML(detailLabel)}:</strong> ${sanitizeHTML(profile.details)}</span></div>` : ''}
            ${websiteUrl ? `<div class="feed-profile-meta-row"><span class="feed-profile-meta-icon">🔗</span><a class="feed-profile-meta-value" href="${sanitizeHTML(websiteUrl)}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(rawWebsite.replace(/^https?:\/\//i, ''))} ↗</a></div>` : ''}
          </div>` : ''}
        ${safeLinks.length ? `
          <div class="feed-profile-section-label">Links</div>
          <div class="feed-profile-link-list">${safeLinks.map(link => { const raw = String(link.url || '').trim(); const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`; return `<a class="feed-profile-link" href="${sanitizeHTML(url)}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(link.name || 'Link')} ↗</a>`; }).join('')}</div>` : ''}
        ${interests.length ? `
          <div class="feed-profile-section-label">Interests</div>
          <div class="feed-profile-interests">${interests.map(id => `<span class="feed-profile-interest">${sanitizeHTML(interestLabels[id] || id)}</span>`).join('')}</div>` : ''}
        <div class="feed-profile-stats">
          <div class="feed-profile-stat"><strong>${toNum(followData.followers).toLocaleString()}</strong><span>Followers</span></div>
          <div class="feed-profile-stat"><strong>${toNum(followData.following).toLocaleString()}</strong><span>Following</span></div>
          <div class="feed-profile-stat"><strong>${toNum(score).toLocaleString()}</strong><span>crockroach Score</span></div>
          <div class="feed-profile-stat"><strong>${textPosts.length}</strong><span>Posts</span></div>
          <div class="feed-profile-stat"><strong>${photoPosts.length}</strong><span>Photos</span></div>
        </div>
      </div>
      <div class="feed-profile-tabs">
        <button type="button" class="feed-profile-tab active" data-profile-tab="posts">Posts</button>
        <button type="button" class="feed-profile-tab" data-profile-tab="photos">Photos</button>
        <button type="button" class="feed-profile-tab" data-profile-tab="reels">Reels</button>
        <button type="button" class="feed-profile-tab" data-profile-tab="stats">Stats</button>
      </div>
      <div class="feed-profile-section" data-profile-panel="posts">
        <div class="feed-profile-posts">${textPosts.length ? textPosts.map(post => `
          <article class="feed-profile-post">
            <div class="feed-profile-post-time">${sanitizeHTML(formatPostTime(post.created_at))}</div>
            <div class="feed-profile-post-text">${renderHashtagRichText(String(post.content || '').trim())}</div>
          </article>`).join('') : '<div style="padding:12px 0;color:var(--on-surface-3);font-size:12.5px;">No posts yet.</div>'}</div>
      </div>
      <div class="feed-profile-section" data-profile-panel="photos" style="display:none;">
        <div class="feed-profile-posts">${photoPosts.length ? photoPosts.map(post => `
          <article class="feed-profile-post">
            <div class="feed-profile-post-time">${sanitizeHTML(formatPostTime(post.created_at))}</div>
            <div class="feed-profile-post-text">${renderHashtagRichText(String(post.content || '').trim())}</div>
            <img src="${sanitizeHTML(post.media_url)}" alt="Photo shared by ${sanitizeHTML(name)}" loading="lazy">
          </article>`).join('') : '<div style="padding:12px 0;color:var(--on-surface-3);font-size:12.5px;">No photos yet.</div>'}</div>
      </div>
      <div class="feed-profile-section" data-profile-panel="reels" style="display:none;">
        <div class="profile-reels-grid">${reels.length ? reels.map((post, i) => `
          <button type="button" class="reel-thumb" data-reel-post-id="${sanitizeHTML(post.id)}" aria-label="Open reel ${i + 1}">
            <video class="reel-thumb-bg" src="${sanitizeHTML(post.media_url)}" muted playsinline preload="metadata"></video>
            <span class="reel-thumb-play">▶</span>
          </button>`).join('') : '<div class="reels-empty-state"><div class="reels-empty-icon">🎬</div><div class="reels-empty-title">No reels yet</div></div>'}</div>
      </div>
      <div class="feed-profile-section" data-profile-panel="stats" style="display:none;">
        <div class="profile-stats-panel">
          <div class="profile-stats-section"><div class="profile-stats-section-title">Content</div>
            <div class="profile-stats-row"><span class="profile-stats-key">Posts</span><strong class="profile-stats-val">${textPosts.length}</strong></div>
            <div class="profile-stats-row"><span class="profile-stats-key">Photos</span><strong class="profile-stats-val">${photoPosts.length}</strong></div>
            <div class="profile-stats-row"><span class="profile-stats-key">Reels</span><strong class="profile-stats-val">${reels.length}</strong></div>
          </div>
          <div class="profile-stats-section"><div class="profile-stats-section-title">Profile</div>
            <div class="profile-stats-row"><span class="profile-stats-key">crockroach Score</span><strong class="profile-stats-val">${toNum(score).toLocaleString()}</strong></div>
            <div class="profile-stats-row"><span class="profile-stats-key">Followers</span><strong class="profile-stats-val">${toNum(followData.followers).toLocaleString()}</strong></div>
            <div class="profile-stats-row"><span class="profile-stats-key">Following</span><strong class="profile-stats-val">${toNum(followData.following).toLocaleString()}</strong></div>
          </div>
        </div>
      </div>`;

    content.querySelectorAll('[data-profile-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.profileTab;
        content.querySelectorAll('[data-profile-tab]').forEach(btn => btn.classList.toggle('active', btn === tab));
        content.querySelectorAll('[data-profile-panel]').forEach(panel => {
          panel.style.display = panel.dataset.profilePanel === which ? '' : 'none';
        });
        if (content) content.scrollTop = 0;
      });
    });
    const feedFollowBtn = content.querySelector('[data-feed-profile-follow]');
    feedFollowBtn?.addEventListener('click', async () => {
      if (!(await requireAuthenticatedSession())) { toast('Sign in to follow profiles.', '🔒'); return; }
      const targetId = feedFollowBtn.dataset.feedProfileFollow;
      try {
        const next = !followData.isFollowing;
        feedFollowBtn.disabled = true;
        const updated = await toggleFollow(targetId, next);
        followData.isFollowing = updated.isFollowing;
        followData.followers = updated.followers;
        feedFollowBtn.textContent = next ? 'Following' : 'Follow';
        feedFollowBtn.classList.toggle('profile-action-following', next);
        content.querySelectorAll('.feed-profile-stat').forEach(stat => {
          const label = stat.querySelector('span')?.textContent;
          if (label === 'Followers') stat.querySelector('strong').textContent = Number(followData.followers).toLocaleString();
        });
      } catch (error) {
        toast(error?.message || 'Could not update follow status.', '⚠️');
      } finally {
        feedFollowBtn.disabled = false;
      }
    });
  } catch (error) {
    content.innerHTML = `<div style="padding:24px;text-align:center;color:var(--danger);">${sanitizeHTML(error?.message || 'Could not load this profile.')}</div>`;
  }
}

async function openUserProfile(userId) {
  if (!userId) return;

  // Authenticated: own profile → pg-profile; other user → feed overlay
  if (!S.isGuest && S.userId) {
    if (S.userId === userId) {
      closeFeedProfileOverlay();
      S.profileViewUserId = null;
      S.profileViewData = null;
      showPage('pg-profile');
      return;
    }
    await openFeedProfileOverlay(userId);
    return;
  }

  // Guest: show a read-only public profile via pg-profile.
  // Never redirect to auth — let the profile page itself prompt login for
  // any interactive actions (follow / like / comment / message).
  showPage('pg-profile', { profileUserId: userId });
}

function formatPhotoSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
}

const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_UPLOAD_BUCKET = 'mortalive-media';
const PHOTO_UPLOAD_TYPES = new Set(['image/jpeg','image/png','image/webp']);
const REEL_UPLOAD_MAX_BYTES = 60 * 1024 * 1024;
const REEL_UPLOAD_TYPES = new Set(['video/mp4','video/webm','video/quicktime']);
function validateReelFile(file) {
  if (!file) throw new Error('Choose a reel video first.');
  if (!REEL_UPLOAD_TYPES.has(file.type)) throw new Error('Use MP4, WebM, or MOV videos.');
  if (file.size > REEL_UPLOAD_MAX_BYTES) throw new Error('Reels must be 60 MB or smaller.');
  return file;
}
async function uploadReelFile(file, folder = 'reels') {
  validateReelFile(file);
  if (!S.userId || S.isGuest || !sb) throw new Error('Sign in to upload reels.');
  const ext = file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
  const path = `${S.userId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;
  const { error } = await sb.storage.from(PHOTO_UPLOAD_BUCKET).upload(path, file, {
    cacheControl: '31536000', upsert: false, contentType: file.type
  });
  if (error) throw error;
  const { data } = sb.storage.from(PHOTO_UPLOAD_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not create the public reel URL.');
  return { url: data.publicUrl, path, size: file.size, type: file.type };
}


function validatePhotoFile(file) {
  if (!file) throw new Error('Choose a photo first.');
  if (!PHOTO_UPLOAD_TYPES.has(file.type)) throw new Error('Use JPG, PNG, or WebP images.');
  if (file.size > PHOTO_UPLOAD_MAX_BYTES) throw new Error('Photo must be 10 MB or smaller.');
  return file;
}

async function uploadPhotoFile(file, folder) {
  validatePhotoFile(file);
  if (!S.userId || S.isGuest || !sb) throw new Error('Sign in to upload photos.');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${S.userId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;
  const { error } = await sb.storage.from(PHOTO_UPLOAD_BUCKET).upload(path, file, {
    cacheControl: '31536000', upsert: false, contentType: file.type
  });
  if (error) throw error;
  const { data } = sb.storage.from(PHOTO_UPLOAD_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not create the public photo URL.');
  return { url: data.publicUrl, path, size: file.size, type: file.type };
}

function stabilizeProfileScrollAxes() {
  const viewport = $('profile-feed-viewport');
  if (!viewport || viewport.dataset.scrollAxisBound) return;
  viewport.dataset.scrollAxisBound = '1';

  // The profile page is now the single vertical scroll root. The viewport is
  // only a visual wrapper and must not claim either gesture axis.
  viewport.style.touchAction = 'auto';
  viewport.style.overscrollBehaviorX = 'none';
  viewport.style.overscrollBehaviorY = 'none';
  viewport.style.overflow = 'visible';
  viewport.style.maxHeight = 'none';

  const strip = $('profile-post-strip');
  if (strip) {
    strip.style.touchAction = 'pan-x';
    strip.style.overscrollBehaviorX = 'contain';
    strip.style.overscrollBehaviorY = 'none';
    strip.style.webkitOverflowScrolling = 'touch';
  }
}

function bindHorizontalProfileStrip(strip) {
  if (!strip || strip.dataset.wheelBound) return;
  strip.dataset.wheelBound = '1';

  strip.addEventListener('wheel', (event) => {
    // Native horizontal trackpad gestures already carry the intended axis.
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

    const maxScroll = strip.scrollWidth - strip.clientWidth;
    if (maxScroll < 4) return;

    const atStart = strip.scrollLeft <= 2;
    const atEnd = strip.scrollLeft >= maxScroll - 2;

    // At the horizontal boundaries, release the wheel event so the profile
    // page can continue scrolling vertically.
    if (event.deltaY < 0 && atStart) return;
    if (event.deltaY > 0 && atEnd) return;

    // Only consume vertical-wheel movement while the strip has horizontal
    // room in the intended direction.
    strip.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });
}

function initProfileScrollProgress() {
  const page = $('pg-profile');
  if (!page) return;

  if (!$('profile-scroll-progress-bar')) {
    const bar = document.createElement('div');
    bar.id = 'profile-scroll-progress-bar';
    bar.className = 'profile-scroll-progress';
    const wrap = page.querySelector('.profile-wrap');
    if (wrap) {
      const sticky = wrap.querySelector('.profile-top-sticky');
      if (sticky) sticky.insertAdjacentElement('afterend', bar);
      else wrap.prepend(bar);
    }
  }

  // #pg-profile is now overflow:visible / height:auto — it never scrolls itself.
  // Remove any stale page-element listeners, then track the document instead.
  if (page._mortaliveProfileScrollHandler) {
    window.removeEventListener('scroll', page._mortaliveProfileScrollHandler);
    page.removeEventListener('scroll', page._mortaliveProfileScrollHandler);
  }

  const onScroll = () => {
    const doc = document.documentElement;
    const scrollable = Math.max(0, doc.scrollHeight - doc.clientHeight);
    const pct = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0;
    page.style.setProperty('--scroll-pct', `${pct}%`);
  };

  page._mortaliveProfileScrollHandler = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });

  const sticky = page.querySelector('.modern-profile-card.profile-top-sticky');
  if (sticky) {
    const syncShadow = () => sticky.classList.toggle('is-scrolled', window.scrollY > 8);
    if (page._mortaliveProfileShadowHandler) {
      window.removeEventListener('scroll', page._mortaliveProfileShadowHandler);
      page.removeEventListener('scroll', page._mortaliveProfileShadowHandler);
    }
    page._mortaliveProfileShadowHandler = syncShadow;
    window.addEventListener('scroll', syncShadow, { passive: true });
    syncShadow();
  }
  onScroll();
}

async function hydrateQnaResponses(postIds = []) {
  if (S.isGuest || !S.userId || !sb) return;
  const ids = Array.from(new Set((postIds || []).filter(Boolean)));
  if (!ids.length) return;
  try {
    const { data, error } = await sb.rpc('get_my_qna_results', { p_post_ids: ids });
    if (error) throw error;
    ids.forEach(id => { _feedQnaResponseCache.delete(id); _feedQnaCorrectCache.delete(id); });
    (data || []).forEach(row => {
      if (row.post_id) {
        _feedQnaResponseCache.set(row.post_id, row.option_id);
        if (row.correct_option_id) _feedQnaCorrectCache.set(row.post_id, row.correct_option_id);
      }
    });
    const ownIds = ids.filter(id => {
      const feedPost = Array.isArray(_feedPosts) ? _feedPosts.find(row => row.id === id) : null;
      const profilePost = Array.isArray(_profilePosts) ? _profilePosts.find(row => row.id === id) : null;
      return (feedPost?.user_id || profilePost?.user_id) === S.userId;
    });
    if (ownIds.length) {
      const { data: ownKeys } = await sb.from('post_qna_keys').select('post_id,correct_option_id').in('post_id', ownIds);
      (ownKeys || []).forEach(row => _feedQnaCorrectCache.set(row.post_id, row.correct_option_id));
    }
  } catch (e) {
    // Fall back to the user's own response row if the helper RPC has not been deployed yet.
    try {
      const { data, error } = await sb.from('post_qna_responses').select('post_id,option_id').eq('user_id', S.userId).in('post_id', ids);
      if (error) throw error;
      ids.forEach(id => _feedQnaResponseCache.delete(id));
      (data || []).forEach(row => _feedQnaResponseCache.set(row.post_id, row.option_id));
    } catch (_) {
      console.warn('[Q&A] response hydration warning:', e?.message || e);
    }
  }
}

async function hydratePollResults(postIds = []) {
  if (S.isGuest || !S.userId || !sb) return;
  const ids = Array.from(new Set((postIds || []).filter(Boolean)));
  if (!ids.length) return;

  const applyRows = (rows) => {
    ids.forEach((id) => {
      _feedPollVoteCache.delete(id);
      _feedPollCountsCache.delete(id);
    });
    const grouped = new Map();
    (rows || []).forEach((row) => {
      const postId = row?.post_id;
      if (!postId) return;
      if (!grouped.has(postId)) grouped.set(postId, new Map());
      const counts = grouped.get(postId);
      if (row.option_id) counts.set(row.option_id, Number(row.vote_count) || 0);
      if (row.user_option_id) _feedPollVoteCache.set(postId, row.user_option_id);
    });
    grouped.forEach((counts, postId) => _feedPollCountsCache.set(postId, counts));
    ids.forEach((id) => {
      if (!_feedPollCountsCache.has(id)) _feedPollCountsCache.set(id, new Map());
    });
  };

  try {
    const { data, error } = await sb.rpc('get_poll_results_v2', { p_post_ids: ids });
    if (!error) {
      applyRows(data || []);
      return;
    }
    console.warn('[Poll] get_poll_results_v2 failed; trying legacy RPC:', error.message);
  } catch (e) {
    console.warn('[Poll] get_poll_results_v2 unavailable; trying legacy RPC:', e?.message || e);
  }

  try {
    const { data, error } = await sb.rpc('get_poll_results', { p_post_ids: ids });
    if (!error) {
      applyRows(data || []);
      return;
    }
    console.warn('[Poll] get_poll_results failed; using direct table fallback:', error.message);
  } catch (e) {
    console.warn('[Poll] get_poll_results unavailable; using direct table fallback:', e?.message || e);
  }

  try {
    const { data, error } = await sb
      .from('post_poll_votes')
      .select('post_id,option_id,user_id')
      .in('post_id', ids);
    if (error) throw error;

    const grouped = new Map();
    ids.forEach((id) => {
      _feedPollVoteCache.delete(id);
      _feedPollCountsCache.delete(id);
    });
    (data || []).forEach((row) => {
      if (!grouped.has(row.post_id)) grouped.set(row.post_id, new Map());
      const counts = grouped.get(row.post_id);
      counts.set(row.option_id, (counts.get(row.option_id) || 0) + 1);
      if (row.user_id === S.userId) _feedPollVoteCache.set(row.post_id, row.option_id);
    });
    grouped.forEach((counts, postId) => _feedPollCountsCache.set(postId, counts));
    ids.forEach((id) => {
      if (!_feedPollCountsCache.has(id)) _feedPollCountsCache.set(id, new Map());
    });
  } catch (fallbackError) {
    console.warn('[Poll] results hydration warning:', fallbackError?.message || fallbackError);
    ids.forEach((id) => {
      if (!_feedPollCountsCache.has(id)) _feedPollCountsCache.set(id, new Map());
    });
  }
}

async function submitPollVote(postId, optionId) {
  if (S.isGuest || !S.userId || !sb) { toast('Sign in to vote', '🔒'); return; }
  if (!postId || !optionId) return;

  const targetPost = Array.isArray(_feedPosts) ? _feedPosts.find(row => row?.id === postId) : null;
  const expiresAt = targetPost?.post_meta?.expires_at ? Date.parse(targetPost.post_meta.expires_at) : NaN;
  if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
    toast('This poll has ended.', '⏱️');
    return;
  }

  if (_feedPollVoteCache.has(postId)) {
    toast('You already voted on this poll.', 'ℹ️');
    return;
  }

  // V108: persist the vote directly first. This is the authoritative path and
  // does not depend on a particular RPC return shape. A security-definer RPC
  // remains available as the compatibility path for deployments with stricter
  // table RLS or an older database migration.
  let persisted = false;
  let rpcResult = null;
  let lastError = null;

  try {
    const { error: insertError } = await sb.from('post_poll_votes').insert({
      post_id: postId,
      user_id: S.userId,
      option_id: String(optionId)
    });
    if (!insertError) {
      persisted = true;
    } else {
      const message = String(insertError.message || '').toLowerCase();
      if (message.includes('duplicate') || message.includes('already') || message.includes('unique')) {
        _feedPollVoteCache.set(postId, String(optionId));
        await hydratePollResults([postId]);
        renderFeedPosts();
        toast('You already voted on this poll.', 'ℹ️');
        return;
      }
      lastError = insertError;
      console.warn('[Poll] direct vote insert unavailable; trying RPC:', insertError.message);
    }
  } catch (e) {
    lastError = e;
    console.warn('[Poll] direct vote insert unavailable; trying RPC:', e?.message || e);
  }

  if (!persisted) {
    try {
      const { data, error } = await sb.rpc('submit_poll_vote_v2', {
        p_post_id: postId,
        p_option_id: String(optionId)
      });
      if (!error) {
        rpcResult = Array.isArray(data) ? data[0] : data;
        persisted = true;
      } else {
        lastError = error;
        console.warn('[Poll] submit_poll_vote_v2 failed; trying legacy RPC:', error.message);
      }
    } catch (e) {
      lastError = e;
      console.warn('[Poll] submit_poll_vote_v2 unavailable; trying legacy RPC:', e?.message || e);
    }
  }

  if (!persisted) {
    try {
      const { data, error } = await sb.rpc('submit_poll_vote', {
        p_post_id: postId,
        p_option_id: String(optionId)
      });
      if (!error) {
        rpcResult = Array.isArray(data) ? data[0] : data;
        persisted = true;
      } else {
        lastError = error;
        console.warn('[Poll] submit_poll_vote failed:', error.message);
      }
    } catch (e) {
      lastError = e;
      console.warn('[Poll] submit_poll_vote unavailable:', e?.message || e);
    }
  }

  if (!persisted) {
    const message = lastError?.message || 'Could not submit your poll vote.';
    toast(message, '⚠️');
    return;
  }

  _feedPollVoteCache.set(postId, String(rpcResult?.option_id || optionId));

  if (Array.isArray(rpcResult?.counts)) {
    const counts = new Map();
    rpcResult.counts.forEach((row) => counts.set(String(row.option_id), Number(row.vote_count) || 0));
    _feedPollCountsCache.set(postId, counts);
  } else {
    // Re-read the durable data. The results RPC is security-definer and can
    // aggregate all votes even when the table itself only exposes the user's
    // own row through RLS.
    await hydratePollResults([postId]);
  }

  renderFeedPosts();
  toast('Vote recorded', '✅');
}
async function submitQnaResponse(postId, optionId) {
  if (S.isGuest || !S.userId || !sb) { toast('Sign in to answer', '🔒'); return; }
  if (!postId || !optionId) return;
  if (_feedQnaResponseCache.has(postId)) { toast('You already answered this Q&A.', 'ℹ️'); return; }
  try {
    const { data, error } = await sb.rpc('submit_qna_answer', {
      p_post_id: postId,
      p_option_id: optionId
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    _feedQnaResponseCache.set(postId, result?.option_id || optionId);
    if (result?.correct_option_id) _feedQnaCorrectCache.set(postId, result.correct_option_id);
    renderFeedPosts();
    toast(result?.is_correct ? 'Correct answer ✅' : 'Answer recorded — not quite.', result?.is_correct ? '✅' : '📝');
  } catch (e) {
    // Direct-table fallback keeps existing Post_qna_responses/Post_qna_keys
    // deployments functional even when the helper RPC is missing.
    try {
      const { error: insertError } = await sb.from('post_qna_responses').insert({
        post_id: postId,
        user_id: S.userId,
        option_id: optionId
      });
      if (insertError) throw insertError;
      _feedQnaResponseCache.set(postId, optionId);
      renderFeedPosts();
      toast('Answer submitted', '✅');
    } catch (fallbackError) {
      const message = fallbackError?.message || e?.message || 'Could not submit your answer.';
      if (String(message).toLowerCase().includes('duplicate') || String(message).toLowerCase().includes('already')) {
        toast('You already answered this Q&A.', 'ℹ️');
        return;
      }
      toast(message, '⚠️');
    }
  }
}


function renderStructuredFeedPost(post) {
  const meta = post?.post_meta && typeof post.post_meta === 'object' ? post.post_meta : null;
  const kind = meta?.kind === 'qna' ? 'qna' : meta?.kind === 'poll' ? 'poll' : null;
  if (!kind) return '';
  const options = Array.isArray(meta.options) ? meta.options : [];
  const icon = kind === 'qna' ? '❓' : '📊';
  const label = kind === 'qna' ? 'Q&A' : 'Poll';
  const mode = kind === 'qna' ? (meta.mode === 'mcq' ? 'mcq' : 'open') : 'mcq';

  if (kind === 'poll') {
    const counts = _feedPollCountsCache.get(post.id) || new Map();
    const totalVotes = Array.from(counts.values()).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const myVote = _feedPollVoteCache.get(post.id) || null;
    const expiresAt = meta?.expires_at ? Date.parse(meta.expires_at) : NaN;
    const expired = Number.isFinite(expiresAt) && Date.now() >= expiresAt;
    const expirationLabel = Number.isFinite(expiresAt)
      ? (expired ? 'Poll ended' : `Ends ${new Date(expiresAt).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}`)
      : '';
    return `<div class="feed-structured-post" data-structured-kind="poll" data-structured-mode="mcq">
      <div class="feed-structured-title"><span>${icon}</span><span>${label}</span>${expirationLabel ? `<span class="feed-structured-duration">${sanitizeHTML(expirationLabel)}</span>` : ''}</div>
      <div class="feed-structured-question">${renderHashtagRichText(post.content || '')}</div>
      <div class="feed-structured-options">${options.map((option) => {
        const optionId = String(option?.id || '');
        const count = Number(counts.get(optionId) || 0);
        const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
        const selected = myVote === optionId;
        const disabled = (myVote || expired) ? ' aria-disabled="true"' : '';
        return `<button type="button" class="feed-structured-option${selected ? ' qna-selected' : ''}" data-structured-kind="poll" data-structured-option="${sanitizeHTML(optionId)}" data-post-id="${sanitizeHTML(post.id)}"${disabled}>`+
          `<span>${sanitizeHTML(option?.label || '')}</span><span class="feed-structured-option-result">${totalVotes ? `${pct}%` : '›'}</span></button>`;
      }).join('')}</div>
      <div class="feed-structured-open-note">${totalVotes} vote${totalVotes === 1 ? '' : 's'}${myVote ? ' · You voted' : ''}${expired ? ' · Voting closed' : ''}</div>
    </div>`;
  }

  const responseId = _feedQnaResponseCache.get(post.id) || null;
  const correctId = _feedQnaCorrectCache.get(post.id) || meta.correct_option_id || null;
  const hasResult = mode === 'mcq' && (responseId || post.user_id === S.userId);
  return `<div class="feed-structured-post" data-structured-kind="qna" data-structured-mode="${mode}">
    <div class="feed-structured-title"><span>${icon}</span><span>${label}${mode === 'open' ? ' · Open replies' : ' · Multiple choice'}</span></div>
    <div class="feed-structured-question">${renderHashtagRichText(post.content || '')}</div>
    ${mode === 'open' ? `<div class="feed-structured-open-note">Reply in the comments to share your answer.</div>` : `<div class="feed-structured-options">${options.map((option) => {
      const optionId = String(option?.id || '');
      const stateClass = hasResult ? (optionId === correctId ? ' qna-correct' : ' qna-incorrect') : (responseId === optionId ? ' qna-selected' : '');
      const disabled = responseId ? ' aria-disabled="true"' : '';
      const resultMark = hasResult ? (optionId === correctId ? '✓' : '✕') : '';
      return `<button type="button" class="feed-structured-option${stateClass}" data-structured-kind="qna" data-structured-option="${sanitizeHTML(optionId)}" data-post-id="${sanitizeHTML(post.id)}"${disabled}><span>${sanitizeHTML(option?.label || '')}</span><span class="feed-structured-option-result">${resultMark || '›'}</span></button>`;
    }).join('')}</div>`}
  </div>`;
}

function renderFeedPosts() {
  const openIds = _getOpenCommentIds(); // save before replacing innerHTML
  const container = $('feed-posts');
  if (!container) return;
  const posts = filteredFeedPosts();
  if (!posts.length) {
    const mine = _feedFilter === 'mine';
    container.innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-icon">${mine ? '✍️' : '🌐'}</div>
        <h3>${mine ? 'No posts yet' : 'The feed is quiet'}</h3>
        <p>${mine ? 'Share your first thought from the composer above.' : 'Public text posts from Mortalive members will appear here.'}</p>
      </div>`;
    return;
  }

  container.innerHTML = posts.map(post => {
    const author = post.author || {};
    const username = author.username || 'member';
    const display = author.display_name || username;
    const score = Number(author.crockroach_score) || 0;
    const mine = post.user_id === S.userId;
    const typeLabel = post?.post_meta?.kind === 'qna' ? 'Q&A' : post?.post_meta?.kind === 'poll' ? 'Poll' : post.post_type === 'text' ? 'Text' : post.post_type === 'reel' ? 'Reel' : post.post_type || 'Post';
    const badge = score >= 700 ? '<span class="post-badge gold">Gold</span>' : score >= 420 ? '<span class="post-badge silver">Silver</span>' : '';
    const avatarUrl = feedAvatarUrl(author.avatar_url);
    const avatarMarkup = avatarUrl
      ? `<div class="post-avatar"><img src="${avatarUrl}" alt="${sanitizeHTML(display)}" loading="lazy" decoding="async" style="width:100%;height:100%;display:block;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${feedAvatarLetter(display)}';this.remove();"></div>`
      : `<div class="post-avatar">${feedAvatarLetter(display)}</div>`;
    const engagement = engagementFor(post.id);
    return `
      <article class="post-card" data-post-id="${sanitizeHTML(post.id)}" data-post-owner="${sanitizeHTML(post.user_id || '')}" data-post-type="${sanitizeHTML(post.post_type || 'text')}">
        <div class="post-header">
          ${avatarMarkup}
          <div class="post-meta">
            <div class="post-author"><button type="button" class="post-author-link" data-open-profile="${sanitizeHTML(post.user_id)}">${sanitizeHTML(display)} ${badge}</button></div>
            <div class="post-time">@${sanitizeHTML(username)} · ${sanitizeHTML(feedRelTime(post.created_at))} · ${sanitizeHTML(typeLabel)}</div>
          </div>
          ${mine ? `<button class="post-more-btn" type="button" data-feed-action="delete" data-post-id="${sanitizeHTML(post.id)}" title="Delete post" aria-label="Delete post">⋯</button>` : ''}
        </div>
        <div class="post-body">${post.post_type === 'reel' && post.media_url
          ? `<div class="post-text">${renderHashtagRichText(post.content || '')}</div><div class="feed-reel-card" data-reel-post-id="${sanitizeHTML(post.id)}"><video src="${sanitizeHTML(post.media_url)}" muted playsinline preload="metadata"></video><span class="feed-reel-play">▶</span></div>`
          : post.media_url
            ? `<div class="post-text">${renderHashtagRichText(post.content || '')}</div><img class="feed-post-media js-photo-open" src="${sanitizeHTML(post.media_url)}" alt="Photo shared by ${sanitizeHTML(display)}" loading="lazy" data-photo-url="${sanitizeHTML(post.media_url)}" data-profile-owner="${sanitizeHTML(post.user_id || '')}">`
            : post?.post_meta?.kind ? renderStructuredFeedPost(post) : `<div class="post-text">${renderHashtagRichText(post.content || '')}</div>`}</div>
        <div class="post-actions">
          <button class="action-btn like-btn ${engagement.liked ? 'liked' : ''}" type="button" data-feed-action="like" data-post-id="${sanitizeHTML(post.id)}" aria-pressed="${engagement.liked ? 'true' : 'false'}"><span class="action-icon">${engagement.liked ? '♥' : '♡'}</span><span class="like-count">${engagement.likes}</span></button>
          <button class="action-btn comment-btn" type="button" data-feed-action="comments" data-post-id="${sanitizeHTML(post.id)}"><span class="action-icon">💬</span><span>${engagement.comments}</span></button>
          <button class="action-btn share-btn" type="button" data-feed-action="copy" data-post-id="${sanitizeHTML(post.id)}"><span class="action-icon">↗</span><span>Share</span></button>
          <span class="post-view-count" aria-label="${postViewCountFor(post.id)} views"><span class="action-icon">👁</span><span>${postViewCountFor(post.id)}</span></span>
          <span class="action-btn" style="margin-left:auto;cursor:default;">${sanitizeHTML(post.visibility || 'public')}</span>
        </div>
        <div class="comments-section" data-post-id="${sanitizeHTML(post.id)}" aria-hidden="true"></div>
      </article>`;
  }).join('');
  // Restore any comment sections that were open before the innerHTML was replaced
  if (openIds.length) _restoreOpenCommentSections(openIds);
}


// ── Post viewer (Instagram-style split layout) ──────────────────────────────
// Opens any feed/profile post in a media + detail/comment layout instead of
// exposing only the raw image. This viewer stays in the current page context.
function getPostByIdForViewer(postId) {
  if (!postId) return null;
  const inFeed = Array.isArray(_feedPosts) ? _feedPosts.find(p => p.id === postId) : null;
  if (inFeed) return inFeed;
  const inProfile = Array.isArray(_profilePosts) ? _profilePosts.find(p => p.id === postId) : null;
  if (inProfile) return inProfile;
  return null;
}

function getPostViewerAuthor(post) {
  const author = post?.author || {};
  if (post?.user_id && post.user_id === S.userId) {
    return {
      id: S.userId,
      username: S.accountData?.username || S.username || author.username || 'You',
      display_name: S.accountData?.display_name || S.username || author.display_name || 'You',
      avatar_url: S.accountData?.avatar_url || author.avatar_url || '',
      crockroach_score: S.accountData?.crockroach_score ?? S.crockroachScore ?? author.crockroach_score ?? 0
    };
  }
  return {
    id: post?.user_id || '',
    username: author.username || 'member',
    display_name: author.display_name || author.username || 'Member',
    avatar_url: author.avatar_url || '',
    crockroach_score: Number(author.crockroach_score) || 0
  };
}

function buildPostViewerAvatar(author, size = 40) {
  const display = author?.display_name || author?.username || 'Member';
  const avatar = feedAvatarUrl(author?.avatar_url);
  if (avatar) {
    return `<img src="${avatar}" alt="${sanitizeHTML(display)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;" loading="eager" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${feedAvatarLetter(display)}'}))">`;
  }
  return `<span style="width:${size}px;height:${size}px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#1a6ef5,#7c3aed);color:#fff;font-size:${Math.max(12, Math.round(size*.38))}px;font-weight:800;">${feedAvatarLetter(display)}</span>`;
}

function postViewerMediaMarkup(post) {
  const mediaUrl = feedAvatarUrl(post?.media_url);
  if (!mediaUrl) return '';
  return `<div class="mortalive-post-viewer-media-frame"><img class="mortalive-post-viewer-media" src="${mediaUrl}" alt="Post photo" loading="eager" decoding="async"></div>`;
}

function postViewerCommentRows(comments = []) {
  if (!comments.length) {
    return `<div class="mortalive-post-viewer-empty-comments">No comments yet. Start the conversation.</div>`;
  }
  return comments.map(comment => {
    const author = comment.author || {};
    const display = author.display_name || author.username || 'Member';
    return `
      <div class="mortalive-post-viewer-comment">
        ${buildPostViewerAvatar(author, 34)}
        <div class="mortalive-post-viewer-comment-copy">
          <div class="mortalive-post-viewer-comment-head">
            <strong>${sanitizeHTML(display)}</strong>
            <span>${sanitizeHTML(feedRelTime(comment.created_at))}</span>
          </div>
          <div class="mortalive-post-viewer-comment-text">${sanitizeHTML(comment.content || '')}</div>
        </div>
      </div>`;
  }).join('');
}

function postViewerRender(post, comments = _commentCache.get(post?.id) || []) {
  const modal = $('mortalive-post-viewer');
  if (!modal || !post) return;

  const author = getPostViewerAuthor(post);
  const display = author.display_name || author.username || 'Member';
  const username = author.username || 'member';
  const engagement = engagementFor(post.id);
  const caption = String(post.content || '').trim();
  const captionText = caption === ' ' ? '' : caption;
  const likes = Number(engagement.likes) || 0;
  const commentsCount = Math.max(Number(engagement.comments) || 0, comments.length);
  const liked = !!engagement.liked;
  const badge = Number(author.crockroach_score) >= 700 ? 'Gold' : Number(author.crockroach_score) >= 420 ? 'Silver' : '';

  const mediaHost = modal.querySelector('.mortalive-post-viewer-media-host');
  const avatarHost = modal.querySelector('.mortalive-post-viewer-avatar');
  const nameEl = modal.querySelector('.mortalive-post-viewer-name');
  const handleEl = modal.querySelector('.mortalive-post-viewer-handle');
  const captionEl = modal.querySelector('.mortalive-post-viewer-caption');
  const countEl = modal.querySelector('.mortalive-post-viewer-counter');
  const commentsEl = modal.querySelector('.mortalive-post-viewer-comments');
  const likesEl = modal.querySelector('.mortalive-post-viewer-likes');
  const actionsEl = modal.querySelector('.mortalive-post-viewer-actions');
  const inputEl = modal.querySelector('.mortalive-post-viewer-input');
  const statusEl = modal.querySelector('.mortalive-post-viewer-status');
  const textHost = modal.querySelector('.mortalive-post-viewer-text-content');
  const isTextPost = !post.media_url;
  modal.classList.toggle('text-mode', isTextPost);

  if (mediaHost) mediaHost.innerHTML = isTextPost ? '' : postViewerMediaMarkup(post);
  if (textHost) textHost.innerHTML = isTextPost ? renderHashtagRichText(String(post.content || '').trim()) : '';
  if (avatarHost) avatarHost.innerHTML = buildPostViewerAvatar(author, 42);
  if (nameEl) nameEl.textContent = display;
  if (handleEl) handleEl.textContent = `@${username}${badge ? ` · ${badge}` : ''}`;
  if (captionEl) {
    captionEl.innerHTML = captionText ? `<div class="mortalive-post-viewer-caption-author">${sanitizeHTML(display)}</div><div class="mortalive-post-viewer-caption-text">${renderHashtagRichText(captionText)}</div>` : '';
    captionEl.style.display = isTextPost ? 'none' : (captionText ? '' : 'none');
  }
  if (countEl) countEl.textContent = `${feedRelTime(post.created_at)}${post.post_type ? ` · ${post.post_type === 'text' ? 'Text' : post.post_type}` : ''}`;
  if (likesEl) likesEl.textContent = `${likes.toLocaleString()} ${likes === 1 ? 'like' : 'likes'}`;
  if (commentsEl) commentsEl.innerHTML = postViewerCommentRows(comments);

  if (actionsEl) {
    actionsEl.innerHTML = `
      <button type="button" class="mortalive-post-viewer-action ${liked ? 'liked' : ''}" data-viewer-action="like" data-post-id="${sanitizeHTML(post.id)}" aria-pressed="${liked}">
        <span class="mortalive-post-viewer-action-icon">${liked ? '♥' : '♡'}</span><span>${likes}</span>
      </button>
      <button type="button" class="mortalive-post-viewer-action" data-viewer-action="comment-focus" data-post-id="${sanitizeHTML(post.id)}">
        <span class="mortalive-post-viewer-action-icon">💬</span><span>${commentsCount}</span>
      </button>
      <button type="button" class="mortalive-post-viewer-action" data-viewer-action="copy" data-post-id="${sanitizeHTML(post.id)}">
        <span class="mortalive-post-viewer-action-icon">↗</span><span>Share</span>
      </button>`;
  }

  if (inputEl) inputEl.dataset.postId = post.id;
  if (statusEl) statusEl.textContent = comments.length ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}` : '';
}

async function openPostViewer(postOrId) {
  if (S.isGuest || !S.userId) {
    toast('Sign in to view posts', '🔒');
    return;
  }
  const sessionOk = await requireAuthenticatedSession();
  if (!sessionOk) {
    toast('Your session expired — please sign in again.', '🔒');
    return;
  }
  const post = typeof postOrId === 'string' ? getPostByIdForViewer(postOrId) : postOrId;
  if (!post?.id) return;
  // Record one authenticated view for this user; never block the viewer on it.
  recordPostView(post.id);
  if (post.post_type === 'reel' && post.media_url) {
    openReelViewer(post, collectAvailableReels());
    return;
  }

  const modal = $('mortalive-post-viewer');
  if (!modal) return;
  window._mortalivePostViewerPostId = post.id;
  window._mortalivePostViewerSequence = Array.from(document.querySelectorAll('#pg-feed .post-card[data-post-id], #pg-feed .profile-post-card[data-post-id]'))
    .map(el => el.dataset.postId).filter(Boolean);
  window._mortalivePostViewerIndex = Math.max(0, window._mortalivePostViewerSequence.indexOf(post.id));
  postViewerRender(post, _commentCache.get(post.id) || []);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  try {
    const comments = await loadPostComments(post.id);
    if (window._mortalivePostViewerPostId === post.id && modal.classList.contains('open')) {
      postViewerRender(post, comments);
    }
  } catch (_) {}
}

window.mortaliveOpenPostViewer = openPostViewer;

// Route post media to the full post viewer before the legacy profile photo
// lightbox's global `.js-photo-open` listener can consume the same click.
// Capture phase is intentional: index.html's legacy listener is delegated on
// document and otherwise wins the event before the split post viewer opens.
const postPhotoRouterRoot = document.documentElement;
if (!postPhotoRouterRoot.dataset.mortalivePostPhotoRouterBound) {
  postPhotoRouterRoot.dataset.mortalivePostPhotoRouterBound = '1';
  document.addEventListener('click', (event) => {
    const photo = event.target.closest?.('.js-photo-open');
    if (!photo) return;
    const postCard = photo.closest?.('#pg-feed .post-card[data-post-id], #pg-feed .profile-post-card[data-post-id], .profile-post-card[data-post-id]');
    if (!postCard) return;
    const postId = postCard.dataset.postId || photo.dataset.postId;
    if (!postId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openPostViewer(postId);
  }, true);
}

function closePostViewer() {
  const modal = $('mortalive-post-viewer');
  if (!modal) return;
  window._mortalivePostViewerPostId = null;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

async function refreshOpenPostViewer() {
  const postId = window._mortalivePostViewerPostId;
  if (!postId) return;
  const post = getPostByIdForViewer(postId);
  const modal = $('mortalive-post-viewer');
  if (!post || !modal?.classList.contains('open')) return;
  const comments = _commentCache.get(postId) || [];
  postViewerRender(post, comments);
}

function bindPostViewerInteractions() {
  const modal = $('mortalive-post-viewer');
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = '1';

  modal.addEventListener('click', async (event) => {
    const close = event.target.closest('[data-viewer-close]');
    if (close || event.target === modal.querySelector('.mortalive-post-viewer-backdrop')) {
      closePostViewer();
      return;
    }

    const action = event.target.closest('[data-viewer-action]');
    if (action) {
      const type = action.dataset.viewerAction;
      const postId = action.dataset.postId;
      if (type === 'like') {
        await togglePostLike(postId);
        await refreshOpenPostViewer();
      } else if (type === 'comment-focus') {
        modal.querySelector('.mortalive-post-viewer-input')?.focus();
      } else if (type === 'copy') {
        const url = `${location.origin}${location.pathname}#feed-post-${encodeURIComponent(postId)}`;
        navigator.clipboard?.writeText(url).then(() => toast('Post link copied', '📋')).catch(() => toast(url, '🔗'));
      }
      return;
    }

    if (event.target.closest('.mortalive-post-viewer-submit')) {
      const input = modal.querySelector('.mortalive-post-viewer-input');
      const postId = input?.dataset.postId;
      const content = input?.value?.trim();
      if (!postId || !content) return;
      input.value = '';
      await createPostComment(postId, content);
      await refreshOpenPostViewer();
    }
  });

  modal.querySelector('[data-viewer-close]')?.addEventListener('click', closePostViewer);
}

function bindPostViewerKeys() {
  if (document.body.dataset.postViewerKeysBound) return;
  document.body.dataset.postViewerKeysBound = '1';
  document.addEventListener('keydown', (event) => {
    const modal = $('mortalive-post-viewer');
    if (!modal?.classList.contains('open')) return;
    if (event.key === 'Escape') closePostViewer();
  });
}

async function hydrateTrendingHashtags() {
  const box = $('hot-topics');
  if (!box) return;
  if (S.isGuest || !S.userId || !sb) {
    box.innerHTML = '<div class="topic-empty">Sign in to view trending hashtags.</div>';
    return;
  }
  try {
    const { data, error } = await sb.rpc('get_trending_hashtags', { p_limit: 8 });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      box.innerHTML = '<div class="topic-empty">No hashtags are trending yet.</div>';
      return;
    }
    box.innerHTML = rows.map(row => {
      const tag = String(row.tag || '').toLowerCase();
      const count = Number(row.usage_count) || 0;
      return `<button type="button" class="topic-chip" data-feed-hashtag="${sanitizeHTML(tag)}"><span>#${sanitizeHTML(tag)}</span><span class="topic-chip-count">${count.toLocaleString()}</span></button>`;
    }).join('');
  } catch (e) {
    console.warn('[Hashtags] trending lookup failed:', e?.message || e);
    box.innerHTML = '<div class="topic-empty">Trending hashtags are unavailable right now.</div>';
  }
}

function renderFeedSidebars() {
  const recent = $('trending-polls-list');
  if (recent) {
    const rows = _feedPosts.slice(0, 3);
    recent.innerHTML = rows.length ? rows.map(post => `
      <div class="trending-poll-item">
        <div class="trending-poll-q">${sanitizeHTML(post.content || '').slice(0, 100)}${(post.content || '').length > 100 ? '…' : ''}</div>
        <div class="trending-poll-meta"><span>✍️ ${sanitizeHTML(post.author?.username || 'member')}</span><span>⏱ ${sanitizeHTML(feedRelTime(post.created_at))}</span></div>
      </div>`).join('') : '<div style="font-size:12.5px;color:var(--on-surface-3);line-height:1.6;">No public posts yet.</div>';
  }

  const active = $('active-users-list');
  if (active) {
    const seen = new Set();
    const authors = [];
    for (const post of _feedPosts) {
      const id = post.user_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      authors.push(post.author || {});
      if (authors.length >= 4) break;
    }
    active.innerHTML = authors.length ? authors.map(author => `
      <div class="active-user-item">
        <div class="active-user-ava">${feedAvatarLetter(author.display_name || author.username)}</div>
        <div class="active-user-info"><button type="button" class="active-user-name post-author-link" data-open-profile="${sanitizeHTML(author.id || '')}">${sanitizeHTML(author.display_name || author.username || 'Member')}</button><div class="active-user-sub">@${sanitizeHTML(author.username || 'member')}</div></div>
        <div class="active-user-score">${Number(author.crockroach_score) || 0}</div>
      </div>`).join('') : '<div style="font-size:12.5px;color:var(--on-surface-3);line-height:1.6;">No active posters yet.</div>';
  }
}

function clearComposePhotoPreview(inputId, buttonId, previewId, nameId) {
  const input = $(inputId);
  const button = $(buttonId);
  const preview = $(previewId);
  const name = $(nameId);
  if (input) input.value = '';
  if (button) button.classList.remove('active');
  if (name) name.textContent = '';
  if (preview) {
    const url = preview.dataset.objectUrl;
    if (url) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
    preview.dataset.objectUrl = '';
    preview.hidden = true;
    preview.innerHTML = '';
  }
}

function renderComposePhotoPreview({ inputId, buttonId, previewId, nameId } = {}) {
  const input = $(inputId);
  const button = $(buttonId);
  const preview = $(previewId);
  const name = $(nameId);
  const file = input?.files?.[0] || null;
  if (!file) {
    clearComposePhotoPreview(inputId, buttonId, previewId, nameId);
    return;
  }

  validatePhotoFile(file);
  const objectUrl = URL.createObjectURL(file);

  if (button) button.classList.add('active');
  if (name) name.textContent = `${file.name} · ${formatPhotoSize(file.size)}`;

  if (preview) {
    const previousUrl = preview.dataset.objectUrl;
    if (previousUrl) {
      try { URL.revokeObjectURL(previousUrl); } catch (e) {}
    }
    preview.dataset.objectUrl = objectUrl;
    preview.hidden = false;
    preview.innerHTML = `
      <img src="${objectUrl}" alt="Selected photo preview">
      <div class="compose-photo-preview-meta">
        <div class="compose-photo-preview-name">${sanitizeHTML(file.name)}</div>
        <div class="compose-photo-preview-size">${sanitizeHTML(formatPhotoSize(file.size))}</div>
      </div>
      <button type="button" class="compose-photo-discard">Discard</button>
    `;
    preview.querySelector('.compose-photo-discard')?.addEventListener('click', () => {
      clearComposePhotoPreview(inputId, buttonId, previewId, nameId);
      if (inputId === 'feed-photo-input') syncFeedComposer();
      if (inputId === 'profile-photo-input') {
        const inputEl = $('profile-photo-input');
        const profileComposer = $('profile-post-composer');
        if (inputEl && profileComposer) {
          const event = new Event('change', { bubbles: true });
          inputEl.dispatchEvent(event);
        }
      }
    });
  }
}

async function submitFeedTextPost() {
  const field = $('compose-field');
  const submit = $('compose-submit');
  const photoInput = $('feed-photo-input');
  const reelInput = $('feed-reel-input');
  const kind = getFeedComposerKind();
  if (!field || !submit || S.isGuest || !S.userId || !sb) { toast('Sign in to post', '🔒'); return; }
  const content = field.value.trim();
  const file = kind === 'reel' ? (reelInput?.files?.[0] || null) : (photoInput?.files?.[0] || null);
  if (!content && !file && !['poll','qna'].includes(kind)) return;
  if (kind === 'reel' && !file) { toast('Choose a reel video first.', '⚠️'); return; }
  if (content.length > FEED_MAX_POST_CHARS) { toast(`Posts are limited to ${FEED_MAX_POST_CHARS} characters`, '⚠️'); return; }

  const hashtagCheck = validateUniqueHashtags(content);
  if (!hashtagCheck.ok) { toast(hashtagCheck.message, '⚠️'); syncFeedComposer(); return; }

  const structured = validateFeedStructuredPost(kind, content, getFeedComposerOptionValues());
  if (!structured.ok) { toast(structured.message, '⚠️'); syncFeedComposer(); return; }

  try {
    if ((kind === 'photo' || kind === 'text') && file) validatePhotoFile(file);
    if (kind === 'reel' && file) validateReelFile(file);
    if (['poll','qna'].includes(kind) && file) {
      toast(`${getFeedStructuredKindLabel(kind)} posts cannot include an attachment.`, '⚠️');
      return;
    }

    submit.disabled = true; submit.textContent = 'Posting…';
    const media = (kind === 'photo' || kind === 'text') && file ? await uploadPhotoFile(file, 'feed')
      : kind === 'reel' && file ? await uploadReelFile(file, 'feed-reels')
      : null;
    const insertContent = content || (media ? ' ' : content);
    const payload = {
      user_id: S.userId,
      content: insertContent,
      post_type: kind === 'reel' ? 'reel' : (media ? 'photo' : 'text'),
      visibility: 'public'
    };
    if (media) {
      payload.media_url = media.url;
      payload.media_type = media.type;
      payload.media_size = media.size;
    }
    if (['poll','qna'].includes(kind)) {
      payload.post_meta = {
        kind,
        mode: kind === 'qna' ? (_feedQnaChoicesEnabled ? 'mcq' : 'open') : 'mcq',
        options: structured.options
      };
      if (kind === 'poll') {
        const durationHours = [24, 48, 168].includes(Number(_feedPollDurationHours))
          ? Number(_feedPollDurationHours)
          : 24;
        payload.post_meta.duration_hours = durationHours;
        payload.post_meta.expires_at = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
      }
    }

    const { data: createdPost, error } = await sb.from('posts').insert(payload).select('id,user_id,content,post_type,visibility,created_at,updated_at,media_url,media_type,media_size,post_meta').single();
    if (error) throw error;
    if (kind === 'qna' && structured.correctOptionId) {
      const { error: answerKeyError } = await sb.from('post_qna_keys').insert({
        post_id: createdPost.id,
        owner_id: S.userId,
        correct_option_id: structured.correctOptionId
      });
      if (answerKeyError) {
        await sb.from('posts').delete().eq('id', createdPost.id).eq('user_id', S.userId);
        throw answerKeyError;
      }
    }
    field.value = '';
    _feedComposerKind = 'text';
    _feedQnaChoicesEnabled = false;
    _feedQnaCorrectOptionId = null;
    _feedPollDurationHours = 24;
    _feedComposerMenuOpen = false;
    resetFeedComposerOptions();
    clearComposePhotoPreview('feed-photo-input','btn-feed-photo','feed-photo-preview','feed-photo-name');
    if ($('feed-reel-input')) $('feed-reel-input').value = '';
    if ($('feed-reel-name')) $('feed-reel-name').textContent = '';
    await fetchFeedPage(true);
    hydrateTrendingHashtags().catch(() => {});
    if (S.userId && !S.isGuest) {
      _profilePosts = [];
      _postsHydrationPromise = null;
      if ($('pg-profile')?.classList.contains('active')) {
        hydrateProfilePosts(S.userId).catch(() => {});
        hydrateProfileGallery(S.userId).catch(() => {});
      }
    }
    toast(kind === 'reel' ? 'Reel published!' : media ? 'Photo post published!' : kind === 'poll' ? 'Poll published!' : kind === 'qna' ? 'Q&A published!' : 'Post published!', kind === 'reel' ? '🎬' : '✍️');
  } catch (e) {
    console.warn('[Feed] post failed:', e);
    toast(e?.message || 'Could not publish post.', '⚠️');
  } finally {
    submit.textContent = 'Post';
    syncFeedComposerTypeUI();
    syncFeedComposer();
  }
}

function resetFeedComposerOptions() {
  const list = $('poll-options-list');
  if (!list) return;
  list.innerHTML = `
    <div class="poll-option-row">
      <label class="qna-correct-wrap" title="Mark as correct answer"><input type="radio" class="qna-correct-radio" name="qna-correct-option" value="option-1" aria-label="Mark option 1 as correct"><span>Correct</span></label>
      <input class="poll-option-input" maxlength="80" placeholder="Option 1"><button type="button" class="poll-remove-btn" title="Remove option" aria-label="Remove option">×</button>
    </div>
    <div class="poll-option-row">
      <label class="qna-correct-wrap" title="Mark as correct answer"><input type="radio" class="qna-correct-radio" name="qna-correct-option" value="option-2" aria-label="Mark option 2 as correct"><span>Correct</span></label>
      <input class="poll-option-input" maxlength="80" placeholder="Option 2"><button type="button" class="poll-remove-btn" title="Remove option" aria-label="Remove option">×</button>
    </div>`;
  list.querySelectorAll('.qna-correct-radio').forEach(radio => radio.addEventListener('change', event => { _feedQnaCorrectOptionId = event.target.value; syncFeedComposer(); }));
  _feedQnaCorrectOptionId = null;
  ensureFeedComposerOptionRows(2, FEED_COMPOSER_MAX_OPTIONS);
}

function addFeedComposerOption() {
  const list = $('poll-options-list');
  if (!list) return;
  const count = list.querySelectorAll('.poll-option-row').length;
  if (count >= FEED_COMPOSER_MAX_OPTIONS) {
    toast('Polls and Q&A posts can have at most 6 options.', '⚠️');
    return;
  }
  const row = document.createElement('div');
  row.className = 'poll-option-row';
  row.innerHTML = `<input class="poll-option-input" maxlength="80" placeholder="Option ${count + 1}"><button type="button" class="poll-remove-btn" title="Remove option" aria-label="Remove option">×</button>`;
  list.appendChild(row);
  syncFeedComposerTypeUI();
  syncFeedComposer();
  row.querySelector('.poll-option-input')?.focus();
}

function getRandomQnaQuestion() {
  const prompts = [
    'What is one thing you would change about today?',
    'What is something you are looking forward to this week?',
    'What is a small habit that actually helps you?',
    'What is a place you would go back to tomorrow?',
    'What is an opinion you changed your mind about recently?',
    'What is the best advice you have received?',
    'What is one song you never get tired of?',
    'What is something people should try at least once?'
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

function toggleFeedQnaChoices() {
  if (getFeedComposerKind() !== 'qna') return;
  _feedQnaChoicesEnabled = !_feedQnaChoicesEnabled;
  if (_feedQnaChoicesEnabled) { _feedQnaCorrectOptionId = null; ensureFeedComposerOptionRows(2, FEED_COMPOSER_MAX_OPTIONS); }
  else { _feedQnaCorrectOptionId = null; }
  syncFeedComposerTypeUI();
  syncFeedComposer();
}

function syncFeedComposer() {
  const field = $('compose-field');
  const submit = $('compose-submit');
  const count = $('char-count');
  const photoInput = $('feed-photo-input');
  const reelInput = $('feed-reel-input');
  if (!field || !submit) return;
  const len = field.value.length;
  const kind = getFeedComposerKind();
  const file = kind === 'reel' ? (reelInput?.files?.[0] || null) : (photoInput?.files?.[0] || null);
  const hashtagCheck = syncHashtagStatus(field.value, 'compose-hashtag-status');
  const structured = validateFeedStructuredPost(kind, field.value, getFeedComposerOptionValues());
  if (count) count.textContent = `${Math.max(0, FEED_MAX_POST_CHARS - len)}`;
  if ($('feed-photo-name')) $('feed-photo-name').textContent = kind === 'reel' ? '' : (file ? `${file.name} · ${formatPhotoSize(file.size)}` : '');
  if ($('feed-reel-name') && kind === 'reel') $('feed-reel-name').textContent = file ? `${file.name} · ${formatPhotoSize(file.size)}` : '';
  $('btn-feed-photo')?.classList.toggle('active', kind !== 'reel' && !!file);
  const validBody = kind === 'poll' || kind === 'qna'
    ? structured.ok
    : !!len || !!file;
  const attachmentAllowed = kind === 'text' || kind === 'photo' || kind === 'reel';
  submit.disabled = S.isGuest || !S.userId || !validBody || (!attachmentAllowed && !!file)
    || (kind === 'reel' && !file)
    || len > FEED_MAX_POST_CHARS || !hashtagCheck.ok;
  submit.title = !hashtagCheck.ok ? hashtagCheck.message : (!structured.ok && kind !== 'text' ? structured.message : (S.isGuest ? 'Sign in to post' : 'Publish'));
  syncFeedComposerTypeUI();
}

function setFeedFilter(filter) {
  const next = filter === 'mine' ? 'mine' : 'all';
  _feedFilter = next;
  document.querySelectorAll('#feed-tabs .feed-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === next));
  document.querySelectorAll('#pg-feed .snav-link').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === next));
  fetchFeedPage(true);
}

async function deleteFeedPost(postId) {
  const post = _feedPosts.find(row => row.id === postId);
  if (!post || post.user_id !== S.userId || !sb) return;
  const confirmed = await showConfirmDialog({
    title: 'Delete this post?',
    body: 'This permanently removes the post from the Mortalive database.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    danger: true
  });
  if (!confirmed) return;
  try {
    const { error } = await sb.from('posts').delete().eq('id', postId).eq('user_id', S.userId);
    if (error) throw error;
    _feedPosts = _feedPosts.filter(row => row.id !== postId);
    _feedEngagement.delete(postId);
    _commentCache.delete(postId);
    renderFeedPosts();
    renderFeedSidebars();
    toast('Post deleted', '🗑️');
  } catch (e) {
    toast(e?.message || 'Could not delete the post.', '⚠️');
  }
}

function initFeedPage() {
  if (!document.body.dataset.profileNavigationBound) {
    document.body.dataset.profileNavigationBound = '1';
    document.addEventListener('click', (event) => {
      const btn = event.target.closest?.('[data-open-profile]');
      if (btn) { event.preventDefault(); openUserProfile(btn.dataset.openProfile); }
    });
  }

  const feedPhotoBtn = $('btn-feed-photo');
  const feedPhotoInput = $('feed-photo-input');
  if (feedPhotoBtn && feedPhotoInput && !feedPhotoBtn.dataset.bound) {
    feedPhotoBtn.dataset.bound = '1';
    feedPhotoBtn.addEventListener('click', () => feedPhotoInput.click());
    feedPhotoInput.addEventListener('change', () => {
      try {
        renderComposePhotoPreview({ inputId:'feed-photo-input', buttonId:'btn-feed-photo', previewId:'feed-photo-preview', nameId:'feed-photo-name' });
        syncFeedComposer();
      } catch (e) {
        clearComposePhotoPreview('feed-photo-input','btn-feed-photo','feed-photo-preview','feed-photo-name');
        toast(e.message,'⚠️');
        syncFeedComposer();
      }
    });
  }


  const reelBtn = $('btn-feed-reel');
  const reelInput = $('feed-reel-input');
  if (reelBtn && reelInput && !reelBtn.dataset.bound) {
    reelBtn.dataset.bound = '1';
    reelBtn.addEventListener('click', () => reelInput.click());
    reelInput.addEventListener('change', () => {
      const file = reelInput.files?.[0];
      if (!file) { if ($('feed-reel-name')) $('feed-reel-name').textContent=''; syncFeedComposer(); return; }
      try {
        validateReelFile(file);
        if ($('feed-reel-name')) $('feed-reel-name').textContent = `${file.name} · ${formatPhotoSize(file.size)}`;
      } catch (e) {
        reelInput.value = '';
        if ($('feed-reel-name')) $('feed-reel-name').textContent = '';
        toast(e.message, '⚠️');
      }
      syncFeedComposer();
    });
  }

  if (_feedInitialized) {
    syncFeedComposer();
    syncFeedSidebar();
    return;
  }
  _feedInitialized = true;
  bindPostViewerInteractions();
  bindPostViewerKeys();

  // V109: capture poll/Q&A clicks before the generic post-card viewer handler.
  // Native `disabled` buttons were previously preventing the event from firing at all;
  // eligibility is now enforced inside submitPollVote()/submitQnaResponse().
  const feedPostsRoot = $('feed-posts');
  if (feedPostsRoot && !feedPostsRoot.dataset.pollCaptureBound) {
    feedPostsRoot.dataset.pollCaptureBound = '1';
    feedPostsRoot.addEventListener('click', (event) => {
      const option = event.target.closest('.feed-structured-option[data-post-id][data-structured-option]');
      if (!option) return;
      event.preventDefault();
      event.stopPropagation();
      const kind = option.dataset.structuredKind;
      const postId = option.dataset.postId;
      const optionId = option.dataset.structuredOption;
      if (kind === 'poll') {
        submitPollVote(postId, optionId);
      } else {
        submitQnaResponse(postId, optionId);
      }
    }, true);
  }

  document.addEventListener('click', (event) => {
    const feedRoot = event.target.closest('#pg-feed');
    if (!feedRoot) return;

    const nav = event.target.closest('[data-feed-target]');
    if (nav) {
      event.preventDefault();
      showPage(nav.dataset.feedTarget);
      return;
    }

    const filter = event.target.closest('#feed-tabs [data-filter], #pg-feed .snav-link[data-filter]');
    if (filter) {
      const filterValue = filter.dataset.filter;
      if (filterValue === 'mine' || filterValue === 'all') setFeedFilter(filterValue);
      return;
    }

    const hashtag = event.target.closest('[data-feed-hashtag]');
    if (hashtag) {
      event.preventDefault();
      event.stopPropagation();
      const tag = String(hashtag.dataset.feedHashtag || '').replace(/^#/, '').toLowerCase();
      const compose = $('compose-field');
      if (!tag || !compose) return;
      const validation = validateUniqueHashtags(`${compose.value} #${tag}`);
      if (!validation.ok) {
        toast(validation.message, '⚠️');
        return;
      }
      const current = compose.value.trim();
      compose.value = current ? `${current} #${tag} ` : `#${tag} `;
      syncFeedComposer();
      compose.focus();
      return;
    }

    const structuredOption = event.target.closest('.feed-structured-option[data-post-id][data-structured-option]');
    if (structuredOption && !structuredOption.disabled) {
      event.preventDefault();
      event.stopPropagation();
      if (structuredOption.dataset.structuredKind === 'poll') {
        submitPollVote(structuredOption.dataset.postId, structuredOption.dataset.structuredOption);
      } else {
        submitQnaResponse(structuredOption.dataset.postId, structuredOption.dataset.structuredOption);
      }
      return;
    }

    const viewerIgnored = event.target.closest('[data-feed-action], [data-open-profile], a, input, textarea, select, option, label, .comments-section');
    const postCard = event.target.closest('.post-card, .profile-post-card');
    if (postCard && !viewerIgnored) {
      const postId = postCard.dataset.postId;
      const clickedPhoto = event.target.closest('.js-photo-open');
      const clickedBody = event.target.closest('.post-body, .profile-post-body');
      if (postId && (clickedPhoto || clickedBody || postCard === event.target || !viewerIgnored)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPostViewer(postId);
        return;
      }
    }

    const action = event.target.closest('[data-feed-action]');
    if (action) {
      const type = action.dataset.feedAction;
      const postId = action.dataset.postId;
      if (type === 'retry') { fetchFeedPage(true); return; }
      if (!postId) return; // guard: all other actions require a postId
      if (type === 'delete') deleteFeedPost(postId);
      if (type === 'like') togglePostLike(postId);
      if (type === 'comments') togglePostComments(postId);
      if (type === 'delete-comment') deletePostComment(postId, action.dataset.commentId);
      if (type === 'comment-submit') {
        const input = document.querySelector(`#pg-feed .comment-input[data-comment-input="${CSS.escape(postId)}"]`);
        if (input?.value?.trim()) createPostComment(postId, input.value);
      }
      if (type === 'copy') {
        const url = `${location.origin}${location.pathname}#feed-post-${postId}`;
        navigator.clipboard?.writeText(url).then(() => toast('Post link copied', '📋')).catch(() => toast(url, '🔗'));
      }
    }
  });

  $('compose-field')?.addEventListener('input', syncFeedComposer);
  $('compose-submit')?.addEventListener('click', submitFeedTextPost);
  document.querySelectorAll('#pg-feed [data-compose-kind]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      setFeedComposerKind(btn.dataset.composeKind);
    });
  });
  $('poll-add-option')?.addEventListener('click', (event) => {
    event.preventDefault();
    addFeedComposerOption();
  });

  // V107: poll duration selector.
  $('poll-duration-row')?.addEventListener('click', (event) => {
    const btn = event.target.closest('.poll-duration-btn[data-hours]');
    if (!btn) return;
    const hours = Number(btn.dataset.hours);
    if (![24, 48, 168].includes(hours)) return;
    _feedPollDurationHours = hours;
    syncFeedComposerTypeUI();
    syncFeedComposer();
  });
  $('qna-choice-toggle')?.addEventListener('click', (event) => {
    event.preventDefault();
    toggleFeedQnaChoices();
  });
  $('qna-random-question')?.addEventListener('click', (event) => {
    event.preventDefault();
    const field = $('compose-field');
    if (!field || getFeedComposerKind() !== 'qna') return;
    field.value = getRandomQnaQuestion();
    syncFeedComposer();
    field.focus();
  });
  // Delegated handler for correct-answer radios — covers both initial HTML rows
  // (which have no inline JS binding) and dynamically added rows.
  $('poll-options-list')?.addEventListener('change', (event) => {
    if (event.target.classList.contains('qna-correct-radio')) {
      _feedQnaCorrectOptionId = event.target.value;
      syncFeedComposer();
    }
  });
  $('poll-options-list')?.addEventListener('click', (event) => {
    const remove = event.target.closest('.poll-remove-btn');
    if (!remove) return;
    const rows = $('poll-options-list')?.querySelectorAll('.poll-option-row') || [];
    if (rows.length <= 2) {
      toast('Keep at least 2 options.', '⚠️');
      return;
    }
    const removedRow = remove.closest('.poll-option-row');
    const removedRadio = removedRow?.querySelector('.qna-correct-radio');
    if (removedRadio?.value === _feedQnaCorrectOptionId) _feedQnaCorrectOptionId = null;
    removedRow?.remove();
    document.querySelectorAll('#poll-options-list .qna-correct-radio').forEach(radio => {
      radio.addEventListener('change', event => { _feedQnaCorrectOptionId = event.target.value; syncFeedComposer(); });
    });
    syncFeedComposerTypeUI();
    syncFeedComposer();
  });
  $('poll-options-list')?.addEventListener('input', syncFeedComposer);
  $('compose-fab')?.addEventListener('click', () => {
    $('compose-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('compose-field')?.focus(), 250);
  });
  $('load-more-btn')?.addEventListener('click', () => fetchFeedPage(false));
  $('banner-close')?.addEventListener('click', () => { if ($('context-banner')) $('context-banner').style.display = 'none'; });

  const justChatted = sessionStorage.getItem('mortalive_just_chatted');
  if (justChatted && $('context-banner')) {
    $('context-banner').style.display = 'flex';
    sessionStorage.removeItem('mortalive_just_chatted');
  }

  syncFeedComposerTypeUI();
  syncFeedComposer();
  syncFeedSidebar();
  hydrateTrendingHashtags().catch(() => {});
}

function syncFeedSidebar() {
  const progress = getCurrentProgress();
  const acc = S.accountData || {};
  const name = acc.display_name || acc.username || S.username || 'User';
  const username = acc.username || S.username || 'member';
  const score = acc.crockroach_score ?? S.crockroachScore ?? getProgressScore(progress);
  setText('sidebar-name', name);
  setText('sidebar-handle', `@${username} · ${S.isGuest ? 'Guest' : 'Member'}`);
  setText('sidebar-score', toNum(score) || 0);
  setText('sidebar-completions', progress.completions || 0);
  setText('sidebar-streak', progress.streak || 0);
  setText('sidebar-rank', progress.weeklyRank ? `#${progress.weeklyRank}` : '#—');
  setText('feed-score-val', toNum(score) || 0);
  const avatarUrl = acc.avatar_url || '';
  const initial = feedAvatarLetter(name);
  ['sidebar-avatar', 'compose-avatar'].forEach(id => {
    const el = $(id);
    if (!el) return;
    if (avatarUrl) {
      el.textContent = '';
      el.style.background = `url("${avatarUrl}") center/cover no-repeat`;
      el.style.fontSize = '0';
    } else {
      el.textContent = initial;
      el.style.background = 'linear-gradient(135deg, var(--primary), var(--secondary))';
      el.style.fontSize = '';
    }
  });
}

window.initFeedPage = initFeedPage;

// ── Step 1: Supabase-backed Profile Posts ───────────────────────────────────
const POSTS_PAGE_SIZE = 20;
let _profilePosts = [];
let _profilePostsOwner = null;
let _postsHydrationPromise = null;

async function fetchProfilePosts(userId = S.userId) {
  if (!userId || S.isGuest || !sb) return [];
  if (!(await requireAuthenticatedSession())) return [];
  try {
    const { data, error } = await sb
      .from('posts')
      .select('id,user_id,content,post_type,visibility,created_at,updated_at,media_url,media_type,media_size,post_meta')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(POSTS_PAGE_SIZE);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Posts] profile fetch failed:', e?.message || e);
    return [];
  }
}

function formatPostTime(iso) {
  const ts = Date.parse(iso ?? '');
  if (!Number.isFinite(ts)) return 'Just now';
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / _MINUTE);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


// V110 — Profile poll integration, based on the engineer-provided V109 fix.
// The current renderer uses .feed-structured-option (not .poll-option), so
// profile handling deliberately supports both names without relying on the
// native disabled attribute.
(function initProfilePollInteraction() {
  const attach = () => {
    const profilePage = document.getElementById('pg-profile');
    if (!profilePage || profilePage.dataset.profilePollHandler === '1') return;
    profilePage.dataset.profilePollHandler = '1';

    const handleProfilePollClick = async (event) => {
      const option = event.target.closest?.(
        '.feed-structured-option[data-post-id][data-structured-option], .poll-option[data-post-id][data-option-id]'
      );
      if (!option || !profilePage.contains(option)) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const postId = option.dataset.postId || option.closest('[data-post-id]')?.dataset.postId;
      const optionId = option.dataset.structuredOption || option.dataset.optionId;
      if (!postId || !optionId) {
        console.warn('[Profile Poll] missing postId or optionId', { postId, optionId });
        return;
      }

      const ariaDisabled = option.getAttribute('aria-disabled') === 'true';
      if (ariaDisabled) {
        const post = Array.isArray(_profilePosts) ? _profilePosts.find(p => p?.id === postId) : null;
        const expiresAt = post?.post_meta?.expires_at ? Date.parse(post.post_meta.expires_at) : NaN;
        if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
          toast('This poll has ended.', '⏱️');
        } else if (String(option.className || '').includes('qna')) {
          toast('You already answered this Q&A.', 'ℹ️');
        } else {
          toast('You already voted on this poll.', 'ℹ️');
        }
        return;
      }

      try {
        if (option.dataset.structuredKind === 'qna') {
          await submitQnaResponse(postId, optionId);
        } else {
          await submitPollVote(postId, optionId);
        }

        // submitPollVote/renderFeedPosts updates the global caches; refresh
        // the profile strip so the selected option and percentages are visible.
        if ($('pg-profile')?.classList.contains('active') && _profilePostsOwner?.id) {
          await hydrateProfilePosts(_profilePostsOwner.id);
        }
      } catch (error) {
        console.warn('[Profile Poll] vote handling warning:', error);
      }
    };

    profilePage.addEventListener('click', handleProfilePollClick, true);
    console.log('[Profile Poll] capture handler attached to #pg-profile');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }

  // The profile DOM is normally stable, but re-attach safely if a future
  // render replaces the entire #pg-profile node.
  const observer = new MutationObserver(attach);
  observer.observe(document.body, { childList: true, subtree: true });
})();


// V114 PROFILE COMPOSER / TAB INTERACTION HARDENING
// Mode buttons remain toggleable even if another profile listener or a
// rerender prevents the local composer binding from receiving the click.
(function installProfileComposerInteractionBridge(){
  const bind = () => {
    const page = document.getElementById('pg-profile');
    if (!page || page.dataset.v114ComposerBridge === '1') return;
    page.dataset.v114ComposerBridge = '1';
    page.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-profile-compose-kind]');
      if (!btn || !page.contains(btn)) return;
      const kind = btn.dataset.profileComposeKind;
      const setter = window.__mortaliveSetProfileComposerKind;
      if (typeof setter !== 'function') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setter(kind);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
  new MutationObserver(bind).observe(document.body, {childList:true, subtree:true});
})();

// V114: enforce exactly one visible profile content panel at a time.
function enforceSingleProfileTabPanel(preferred = 'posts') {
  const page = document.getElementById('pg-profile');
  if (!page) return;
  const panels = Array.from(page.querySelectorAll('.profile-tab-panel[data-profile-panel]'));
  if (!panels.length) return;
  let active = panels.find(panel => panel.classList.contains('active'))?.dataset.profilePanel || preferred;
  if (!panels.some(panel => panel.dataset.profilePanel === active)) active = preferred;
  panels.forEach(panel => panel.classList.toggle('active', panel.dataset.profilePanel === active));
  page.querySelectorAll('#profile-tabs-bar .profile-tab-btn').forEach(btn => {
    const selected = btn.dataset.profileTab === active;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  page.dataset.profileActivePanel = active;
}

// V113 PROFILE SECTION SEPARATION / VERTICAL STREAM GUARD
// Posts = mixed vertical stream; Photos = photos only; Talk Activity = Stats only.

function renderProfilePosts(posts = _profilePosts) {
  const strip = $('profile-post-strip');
  const countEl = $('profile-post-count');
  if (!strip) return;

  // V113: Posts is a single vertical chronological stream. Override any
  // legacy horizontal-strip behavior that may have been bound earlier.
  strip.classList.remove('expanded');
  strip.style.display = 'flex';
  strip.style.flexDirection = 'column';
  strip.style.flexWrap = 'nowrap';
  strip.style.overflowX = 'visible';
  strip.style.overflowY = 'visible';
  strip.style.scrollSnapType = 'none';
  strip.style.touchAction = 'auto';

  // V112: Posts is the combined chronological stream for all non-reel posts:
  // text, photo, poll, and Q&A. The Photos tab remains media-only.
  const combinedPosts = (posts || []).filter(post => post?.post_type !== 'reel');

  if (countEl) {
    countEl.textContent = combinedPosts.length
      ? `${combinedPosts.length} ${combinedPosts.length === 1 ? 'post' : 'posts'}`
      : 'No posts';
  }

  if (!combinedPosts.length) {
    strip.innerHTML = `
      <article class="profile-post-card profile-post-empty-card">
        <div class="profile-post-header">
          <div class="profile-post-mini-avatar" id="profile-post-empty-avatar">M</div>
          <div class="profile-post-author">Your first post</div>
          <div class="profile-post-time">Ready</div>
        </div>
        <div class="profile-post-body">Share a thought, photo, poll, or Q&A and it will appear here in one combined stream.</div>
        <div class="profile-post-footer"><span>Posts are saved to Supabase</span></div>
      </article>`;
    const emptyAvatar = $('profile-post-empty-avatar');
    if (emptyAvatar) emptyAvatar.style.background = 'linear-gradient(135deg,#1a6ef5,#7c3aed)';
    refreshProfileTabCounts(posts);
    return;
  }

  strip.innerHTML = combinedPosts.map((post) => {
    const content = renderHashtagRichText(post.content || '');
    const time = sanitizeHTML(formatPostTime(post.created_at));
    const kind = post?.post_meta?.kind === 'qna'
      ? 'Q&A'
      : post?.post_meta?.kind === 'poll'
        ? 'Poll'
        : post.media_url
          ? 'Photo'
          : 'Text';

    const ownerName =
      post.author?.display_name ||
      post.author?.username ||
      _profilePostsOwner?.display_name ||
      _profilePostsOwner?.username ||
      S.username ||
      'You';
    const initial = sanitizeHTML(ownerName.charAt(0).toUpperCase());
    const eng = engagementFor(post.id);
    const likedClass = eng.liked ? 'liked' : '';
    const likeIcon = eng.liked ? '♥' : '♡';
    const structured = post?.post_meta?.kind ? renderStructuredFeedPost(post) : '';
    const photo = post.media_url
      ? `<button type="button" class="profile-post-photo-wrap js-photo-open" data-photo-url="${sanitizeHTML(post.media_url)}" data-profile-owner="${sanitizeHTML(post.user_id || '')}" data-photo-caption="${sanitizeHTML(String(post.content || '').trim())}" style="display:block;width:100%;margin-top:10px;padding:0;border:0;background:transparent;text-align:left;cursor:pointer">
           <img class="profile-post-media" src="${sanitizeHTML(post.media_url)}" alt="Shared photo" loading="lazy" style="width:100%;max-height:560px;object-fit:cover;border-radius:14px;display:block">
         </button>`
      : '';
    const bodyContent = structured ? structured : `${content}${photo}`;

    return `
      <article class="profile-post-card" data-post-id="${sanitizeHTML(post.id)}" data-post-owner="${sanitizeHTML(post.user_id || _profilePostsOwner?.id || S.userId || '')}" data-post-type="${sanitizeHTML(post.post_type || 'text')}">
        <div class="profile-post-header">
          <div class="profile-post-mini-avatar" style="background:linear-gradient(135deg,#1a6ef5,#7c3aed)">${initial}</div>
          <div class="profile-post-author"><button type="button" class="profile-author-link" data-open-profile="${sanitizeHTML(post.user_id || _profilePostsOwner?.id || S.userId || '')}">${sanitizeHTML(ownerName)}</button></div>
          <div class="profile-post-time">${time}</div>
        </div>
        <div class="profile-post-body">
          ${content && !structured ? `<div class="profile-post-text">${content}</div>` : ''}
          ${structured ? structured : ''}
          ${(!structured && photo) ? photo : ''}
        </div>
        <div class="profile-post-footer">
          <button type="button" data-profile-action="like" data-post-id="${sanitizeHTML(post.id)}" aria-pressed="${eng.liked}" style="background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:0;color:${eng.liked ? 'var(--danger)' : 'var(--on-surface-3)'};font-size:10.5px;font-weight:700;transition:color .14s;" class="profile-like-btn ${likedClass}">${likeIcon} ${eng.likes}</button>
          <span>💬 ${eng.comments}</span>
          <span>◉ ${kind}</span>
          ${Number(eng.views || post.view_count || 0) ? `<span>👁 ${Number(eng.views || post.view_count || 0)}</span>` : ''}
        </div>
      </article>`;
  }).join('');

  refreshProfileTabCounts(posts);
  enforceSingleProfileTabPanel('posts');
}
function enforceProfileSectionSeparation() {
  const postsPanel = $('profile-thoughts-section');
  const photosPanel = $('profile-gallery-section');
  const statsPanel = $('profile-stats-panel');

  // Talk Activity belongs exclusively to Stats. Remove any stale/legacy
  // injection that may have landed inside Posts or Photos.
  [postsPanel, photosPanel].forEach(panel => {
    panel?.querySelectorAll('.talk-pstats-card, #profile-talk-stats').forEach(el => el.remove());
  });

  // Keep the canonical Talk host inside Stats. If an older render moved it,
  // move it back instead of leaving duplicate cards behind.
  if (statsPanel) {
    let talkHost = statsPanel.querySelector('#profile-talk-stats');
    if (!talkHost) {
      talkHost = document.createElement('div');
      talkHost.id = 'profile-talk-stats';
      const section = document.createElement('div');
      section.className = 'profile-stats-section profile-talk-stats-host-section';
      section.appendChild(talkHost);
      statsPanel.appendChild(section);
    }
  }
}

function groupPhotosByDate(photos = []) {
  const grouped = new Map();

  photos.forEach((photo) => {
    const timestamp = photo?.created_at || photo?.ts || photo?.uploaded_at || photo?.updated_at;
    if (!timestamp) return;

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return;

    const dateKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, {
        date: dateKey,
        dateLabel: date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }),
        sortValue: date.getTime(),
        photos: []
      });
    }
    grouped.get(dateKey).photos.push(photo);
  });

  return Array.from(grouped.values()).sort((a, b) => b.sortValue - a.sortValue);
}

function renderProfileGallery(posts = _profilePosts) {
  const gallery = $('profile-gallery');
  if (!gallery) return;

  const photos = (posts || [])
    .filter((p) => p?.media_url && p.post_type !== 'reel')
    .sort((a, b) => {
      const ta = new Date(a?.created_at || a?.ts || a?.uploaded_at || 0).getTime();
      const tb = new Date(b?.created_at || b?.ts || b?.uploaded_at || 0).getTime();
      return tb - ta;
    });

  if (!photos.length) {
    gallery.innerHTML = `
      <div class="profile-gallery-tile">
        <div class="profile-gallery-placeholder">
          <div><strong>No photos yet</strong><span>Photo posts will appear here.</span></div>
        </div>
      </div>`;
    return;
  }

  enforceSingleProfileTabPanel('photos');

  const groupedByDate = groupPhotosByDate(photos);
  let html = '';

  groupedByDate.forEach((group) => {
    html += `<div class="gallery-date-section" data-date="${sanitizeHTML(group.date)}">`;
    html += `<div class="gallery-date-header">${sanitizeHTML(group.dateLabel)}</div>`;
    html += `<div class="gallery-date-grid">`;

    html += group.photos.map((p, i) => {
      const caption = sanitizeHTML(String(p.content || '').trim());
      const ownerName = sanitizeHTML(
        p.author?.username ||
        _profilePostsOwner?.username ||
        S.username ||
        'user'
      );
      const postId = sanitizeHTML(p.id || '');
      const photoUrl = sanitizeHTML(p.media_url || '');

      return `<button type="button" class="profile-gallery-tile" data-post-id="${postId}" data-photo-url="${photoUrl}" data-photo-caption="${caption}" data-photo-author="${ownerName}" aria-label="Open photo ${i + 1}">
        <img src="${photoUrl}" alt="${ownerName} photo post" loading="lazy" data-photo-url="${photoUrl}" data-photo-caption="${caption}" data-photo-author="${ownerName}" style="width:100%;height:100%;object-fit:cover;display:block">
      </button>`;
    }).join('');

    html += `</div></div>`;
  });

  gallery.innerHTML = html;
}

// Dedicated gallery fetch using the gallery_photos RPC (returns up to 24 media posts,
// not capped by the 20-post strip limit). Falls back silently to the post-strip
// subset already rendered by renderProfileGallery() if the RPC is unavailable.
async function hydrateProfileGallery(userId = S.userId) {
  const gallery = $('profile-gallery');
  if (!gallery || !userId || S.isGuest || !sb) return;
  try {
    const { data, error } = await sb.rpc('gallery_photos', { p_user_id: userId, p_limit: 24 });
    if (error) throw error;
    let photos = Array.isArray(data) ? data.filter(p => p.media_url) : [];
    if (!photos.length) { renderProfileGallery([]); return; }

    // The gallery RPC may return media metadata without the original caption.
    // Merge known post data first, then fetch any missing captions directly.
    const knownById = new Map((_profilePosts || []).map(post => [post.id, post]));
    photos = photos.map(photo => ({ ...photo, ...(knownById.get(photo.id) || {}) }));
    const missingCaptionIds = photos.filter(photo => !String(photo.content || '').trim() && photo.id).map(photo => photo.id);
    if (missingCaptionIds.length) {
      try {
        const { data: captionRows } = await sb.from('posts').select('id,user_id,content,media_url,post_meta').in('id', missingCaptionIds);
        const captionById = new Map((captionRows || []).map(row => [row.id, row]));
        photos = photos.map(photo => ({ ...photo, ...(captionById.get(photo.id) || {}) }));
      } catch (e) {
        console.warn('[Gallery] caption hydration warning:', e?.message || e);
      }
    }

    renderProfileGallery(photos);
  } catch (e) {
    // gallery_photos RPC not yet deployed — post-strip fallback is already showing
    console.warn('[Gallery] gallery_photos RPC unavailable, using post-strip fallback:', e?.message || e);
  }
}

async function hydrateProfilePosts(userId = S.userId, options = {}) {
  if (!userId || S.isGuest || !sb) return [];
  if (_postsHydrationPromise) return _postsHydrationPromise;

  _postsHydrationPromise = fetchProfilePosts(userId)
    .then(async (posts) => {
      if ((S.userId === userId || S.profileViewUserId === userId) && !S.isGuest) {
        _profilePosts = posts;
        _profilePostsOwner = S.profileViewData || (S.userId === userId ? { id: S.userId, username: S.username, display_name: S.username } : null);
        // Hydrate real like/comment counts before rendering so cards show live numbers
        if (posts.length) {
          const postIds = posts.map(p => p.id).filter(Boolean);
          await hydratePostEngagement(postIds);

          // Keep profile polls/Q&A on the same durable result caches as Feed.
          const structuredPosts = posts.filter(post => post?.post_meta?.kind === 'poll' || post?.post_meta?.kind === 'qna');
          if (structuredPosts.length) {
            const structuredIds = structuredPosts.map(post => post.id).filter(Boolean);
            const pollIds = structuredPosts.filter(post => post.post_meta?.kind === 'poll').map(post => post.id).filter(Boolean);
            const qnaIds = structuredPosts.filter(post => post.post_meta?.kind === 'qna').map(post => post.id).filter(Boolean);
            if (pollIds.length) await hydratePollResults(pollIds);
            if (qnaIds.length) await hydrateQnaResponses(qnaIds);
          }
        }
        renderProfilePosts(posts);
        renderProfileGallery(posts);
        renderProfileReels(posts);
        refreshProfileTabs(posts);
      }
      return posts;
    })
    .finally(() => {
      _postsHydrationPromise = null;
    });

  return _postsHydrationPromise;
}

function resetProfilePosts() {
  _profilePosts = [];
  _postsHydrationPromise = null;
}

function initProfilePostComposer() {
  const composer = $('profile-post-composer');
  const input = $('profile-post-input');
  const button = $('btn-profile-post-submit');
  const photoInput = $('profile-photo-input');
  const photoButton = $('btn-profile-photo-upload');
  const photoName = $('profile-photo-name');
  const error = $('profile-post-error');
  const builder = $('profile-poll-builder');
  const optionsList = $('profile-poll-options-list');
  const addOption = $('profile-poll-add-option');
  const modeLabel = $('profile-compose-mode-label');
  if (!composer || !input || !button) return;

  if (composer.dataset.bound === '1' && composer.dataset.boundInputId === input.id + (input.dataset.uid || '')) return;
  composer.dataset.bound = '1';
  composer.dataset.boundInputId = input.id + (input.dataset.uid || '');

  const resetOptions = () => {
    if (!optionsList) return;
    optionsList.innerHTML = '';
    for (let i = 0; i < 2; i += 1) {
      const row = document.createElement('div');
      row.className = 'profile-poll-option-row';
      row.innerHTML = `
        ${_profileComposerKind === 'qna'
          ? `<label class="profile-qna-correct-wrap" title="Mark as correct answer">
               <input type="radio" class="profile-qna-correct-radio" name="profile-qna-correct-option" value="option-${i + 1}" aria-label="Mark option ${i + 1} as correct">
               <span>Correct</span>
             </label>`
          : '<span aria-hidden="true"></span>'}
        <input class="profile-poll-option-input" maxlength="80" placeholder="Option ${i + 1}">
        <button type="button" class="profile-poll-remove-btn" title="Remove option" aria-label="Remove option">×</button>`;
      row.querySelector('.profile-qna-correct-radio')?.addEventListener('change', event => {
        _profileQnaCorrectOptionId = event.target.value;
        syncProfileComposer();
      });
      row.querySelector('.profile-poll-remove-btn')?.addEventListener('click', () => {
        if (optionsList.querySelectorAll('.profile-poll-option-row').length <= 2) {
          toast('Keep at least 2 choices.', '⚠️');
          return;
        }
        row.remove();
        syncProfileComposer();
      });
      optionsList.appendChild(row);
    }
    _profileQnaCorrectOptionId = null;
  };

  const setKind = (kind) => {
    const next = ['text', 'photo', 'poll', 'qna'].includes(kind) ? kind : 'text';
    _profileComposerKind = next;

    document.querySelectorAll('#pg-profile [data-profile-compose-kind]').forEach(btn => {
      const active = btn.dataset.profileComposeKind === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (builder) {
      const structured = next === 'poll' || next === 'qna';
      builder.hidden = !structured;
      if (structured && (!optionsList?.children.length || builder.dataset.kind !== next)) {
        builder.dataset.kind = next;
        resetOptions();
      }
    }

    if (modeLabel) modeLabel.textContent = next === 'qna' ? 'Q&A' : next === 'poll' ? 'Poll' : next === 'photo' ? 'Photo' : 'Text';
    if (photoButton) photoButton.style.display = next === 'photo' ? 'inline-flex' : 'none';
    if (next !== 'photo') {
      clearComposePhotoPreview('profile-photo-input','btn-profile-photo-upload','profile-photo-preview','profile-photo-name');
    }
    syncProfileComposer();
  };

  // Expose the canonical profile composer switcher so capture-phase and rerender-safe bridges can invoke the same logic.
  window.__mortaliveSetProfileComposerKind = setKind;

  const getOptionValues = () => Array.from(optionsList?.querySelectorAll('.profile-poll-option-input') || [])
    .map(inputEl => String(inputEl.value || '').trim());

  const validateStructured = () => {
    if (!['poll', 'qna'].includes(_profileComposerKind)) return { ok: true, options: [], correctOptionId: null };
    const question = input.value.trim();
    if (!question) return { ok: false, message: `${_profileComposerKind === 'qna' ? 'Q&A' : 'Poll'} needs a question.` };
    const raw = getOptionValues().map((label, index) => ({ label, index })).filter(x => x.label);
    if (raw.length < 2) return { ok: false, message: 'Add at least 2 choices.' };
    if (raw.length > FEED_COMPOSER_MAX_OPTIONS) return { ok: false, message: 'Use a maximum of 6 choices.' };

    const seen = new Set();
    for (const item of raw) {
      const key = item.label.toLowerCase();
      if (seen.has(key)) return { ok: false, message: 'Each choice must be unique.' };
      seen.add(key);
    }

    const options = raw.map(item => ({ id: `option-${item.index + 1}`, label: item.label }));
    let correctOptionId = null;
    if (_profileComposerKind === 'qna') {
      const checked = optionsList?.querySelector('.profile-qna-correct-radio:checked');
      if (!checked) return { ok: false, message: 'Select the correct answer before posting this Q&A.' };
      correctOptionId = checked.value;
    }
    return { ok: true, options, correctOptionId };
  };

  const syncProfileComposer = () => {
    const text = input.value.trim();
    const hasPhoto = !!photoInput?.files?.[0];
    const structured = _profileComposerKind === 'poll' || _profileComposerKind === 'qna';
    const validation = structured ? validateStructured() : { ok: true };
    const hashtagCheck = syncHashtagStatus(text, 'profile-hashtag-status');

    const validContent =
      _profileComposerKind === 'photo'
        ? hasPhoto || !!text
        : structured
          ? validation.ok
          : !!text;

    button.disabled = !validContent || text.length > 500 || S.isGuest || !S.userId || !hashtagCheck.ok;
    button.textContent =
      _profileComposerKind === 'poll' ? 'Post poll' :
      _profileComposerKind === 'qna' ? 'Post Q&A' :
      'Post';

    if (photoName) photoName.textContent = hasPhoto ? `${photoInput.files[0].name} · ${formatPhotoSize(photoInput.files[0].size)}` : '';
    const count = $('profile-post-char-count');
    if (count) {
      count.textContent = `${input.value.length} / 500`;
      count.style.color = input.value.length > 500 ? 'var(--danger)' : 'var(--on-surface-3)';
    }
    if (builder) {
      builder.hidden = !(structured);
    }
  };

  // Bind composer type buttons once.
  document.querySelectorAll('#pg-profile [data-profile-compose-kind]').forEach(btn => {
    if (btn.dataset.profileComposeBound === '1') return;
    btn.dataset.profileComposeBound = '1';
    btn.addEventListener('click', () => setKind(btn.dataset.profileComposeKind));
  });

  // V112: profile poll duration buttons use the same 1d / 2d / 1w model as Feed.
  document.querySelectorAll('#pg-profile [data-profile-poll-duration]').forEach(btn => {
    if (btn.dataset.profileDurationBound === '1') return;
    btn.dataset.profileDurationBound = '1';
    btn.addEventListener('click', () => {
      const hours = Number(btn.dataset.profilePollDuration);
      if (![24, 48, 168].includes(hours)) return;
      _profilePollDurationHours = hours;
      document.querySelectorAll('#pg-profile [data-profile-poll-duration]').forEach(other => {
        const active = Number(other.dataset.profilePollDuration) === hours;
        other.classList.toggle('active', active);
        other.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      syncProfileComposer();
    });
  });

  if (addOption && addOption.dataset.profileComposeBound !== '1') {
    addOption.dataset.profileComposeBound = '1';
    addOption.addEventListener('click', () => {
      if (!optionsList) return;
      const count = optionsList.querySelectorAll('.profile-poll-option-row').length;
      if (count >= FEED_COMPOSER_MAX_OPTIONS) {
        toast('Polls and Q&A posts can have at most 6 choices.', '⚠️');
        return;
      }
      const row = document.createElement('div');
      row.className = 'profile-poll-option-row';
      row.innerHTML = `
        ${_profileComposerKind === 'qna'
          ? `<label class="profile-qna-correct-wrap" title="Mark as correct answer">
               <input type="radio" class="profile-qna-correct-radio" name="profile-qna-correct-option" value="option-${count + 1}" aria-label="Mark option ${count + 1} as correct">
               <span>Correct</span>
             </label>`
          : '<span aria-hidden="true"></span>'}
        <input class="profile-poll-option-input" maxlength="80" placeholder="Option ${count + 1}">
        <button type="button" class="profile-poll-remove-btn" title="Remove option" aria-label="Remove option">×</button>`;
      optionsList.appendChild(row);
      row.querySelector('.profile-qna-correct-radio')?.addEventListener('change', event => {
        _profileQnaCorrectOptionId = event.target.value;
        syncProfileComposer();
      });
      row.querySelector('.profile-poll-remove-btn')?.addEventListener('click', () => {
        if (optionsList.querySelectorAll('.profile-poll-option-row').length <= 2) return toast('Keep at least 2 choices.', '⚠️');
        row.remove();
        syncProfileComposer();
      });
      syncProfileComposer();
      row.querySelector('.profile-poll-option-input')?.focus();
    });
  }

  input.addEventListener('input', syncProfileComposer);
  input.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!button.disabled) button.click();
    }
  });

  button.addEventListener('click', async () => {
    const content = input.value.trim();
    const file = photoInput?.files?.[0] || null;

    if (S.isGuest || !S.userId || !sb) {
      toast('Sign in to post', '🔒');
      return;
    }

    const hashtagCheck = validateUniqueHashtags(content);
    if (!hashtagCheck.ok) {
      toast(hashtagCheck.message, '⚠️');
      syncProfileComposer();
      return;
    }

    const structured = validateStructured();
    if (_profileComposerKind === 'photo' && !file) {
      toast('Choose a photo first.', '⚠️');
      return;
    }
    if (['poll', 'qna'].includes(_profileComposerKind) && !structured.ok) {
      toast(structured.message, '⚠️');
      syncProfileComposer();
      return;
    }
    if (_profileComposerKind === 'text' && !content) return;

    button.disabled = true;
    button.textContent = 'Posting…';
    if (error) error.style.display = 'none';

    try {
      let media = null;
      if (_profileComposerKind === 'photo' && file) {
        validatePhotoFile(file);
        media = await uploadPhotoFile(file, 'profile');
      }

      const payload = {
        user_id: S.userId,
        content: content || (media ? ' ' : ''),
        post_type: media ? 'photo' : 'text',
        visibility: 'public'
      };

      if (media) {
        payload.media_url = media.url;
        payload.media_type = media.type;
        payload.media_size = media.size;
      }

      if (['poll', 'qna'].includes(_profileComposerKind)) {
        payload.post_meta = {
          kind: _profileComposerKind,
          mode: 'mcq',
          options: structured.options
        };
        if (_profileComposerKind === 'poll') {
          const durationHours = [24, 48, 168].includes(Number(_profilePollDurationHours))
            ? Number(_profilePollDurationHours)
            : 24;
          payload.post_meta.duration_hours = durationHours;
          payload.post_meta.expires_at = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
        }
      }

      const { data, error: postError } = await sb.from('posts')
        .insert(payload)
        .select('id,user_id,content,post_type,visibility,created_at,updated_at,media_url,media_type,media_size,post_meta')
        .single();

      if (postError) throw postError;

      if (_profileComposerKind === 'qna' && structured.correctOptionId) {
        const { error: answerKeyError } = await sb.from('post_qna_keys').insert({
          post_id: data.id,
          owner_id: S.userId,
          correct_option_id: structured.correctOptionId
        });
        if (answerKeyError) {
          await sb.from('posts').delete().eq('id', data.id).eq('user_id', S.userId);
          throw answerKeyError;
        }
      }

      const postedKind = _profileComposerKind;
      _profilePosts = [data, ..._profilePosts].filter(post => post?.post_type !== 'reel').slice(0, POSTS_PAGE_SIZE);
      await hydratePostEngagement([data.id]).catch(() => {});
      if (data.post_meta?.kind === 'poll') await hydratePollResults([data.id]).catch(() => {});
      if (data.post_meta?.kind === 'qna') await hydrateQnaResponses([data.id]).catch(() => {});

      renderProfilePosts(_profilePosts);
      renderProfileGallery(_profilePosts);
      renderProfileReels(_profilePosts);
      refreshProfileTabs(_profilePosts);

      input.value = '';
      _profileComposerKind = 'text';
      _profileQnaCorrectOptionId = null;
      _profilePollDurationHours = 24;
      if (optionsList) optionsList.innerHTML = '';
      clearComposePhotoPreview('profile-photo-input','btn-profile-photo-upload','profile-photo-preview','profile-photo-name');
      setKind('text');
      syncProfileComposer();

      hydrateTrendingHashtags().catch(() => {});
      if ($('pg-feed')?.classList.contains('active')) {
        _feedPosts = [];
        _feedOffset = 0;
        _feedHasMore = true;
        fetchFeedPage(true).catch(() => {});
      }

      toast(
        postedKind === 'poll' ? 'Poll published!' :
        postedKind === 'qna' ? 'Q&A published!' :
        media ? 'Photo post published!' : 'Post published!',
        postedKind === 'poll' ? '📊' : postedKind === 'qna' ? '❓' : '✍️'
      );
    } catch (e) {
      console.warn('[Profile] create failed:', e);
      if (error) {
        error.textContent = e?.message || 'Could not publish the post.';
        error.style.display = 'block';
      }
    } finally {
      button.textContent = _profileComposerKind === 'poll' ? 'Post poll' : _profileComposerKind === 'qna' ? 'Post Q&A' : 'Post';
      syncProfileComposer();
    }
  });

  if (photoButton && photoInput && !photoButton.dataset.bound) {
    photoButton.dataset.bound = '1';
    photoButton.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
      try {
        renderComposePhotoPreview({ inputId:'profile-photo-input', buttonId:'btn-profile-photo-upload', previewId:'profile-photo-preview', nameId:'profile-photo-name' });
        syncProfileComposer();
      } catch (e) {
        clearComposePhotoPreview('profile-photo-input','btn-profile-photo-upload','profile-photo-preview','profile-photo-name');
        toast(e.message,'⚠️');
        syncProfileComposer();
      }
    });
  }

  if (_profileComposerKind === 'poll' || _profileComposerKind === 'qna') {
    if (!optionsList?.children.length) resetOptions();
  }
  setKind(_profileComposerKind);
}
async function fetchPublicProfileData(userId) {
  if (!userId || !sb) return { id: userId, username: 'user', display_name: 'User' };
  // Public profile data is readable without authentication.
  // Interactive actions (follow, like, comment) enforce their own auth checks.
  let seed = { id: userId, username: 'user', display_name: 'User' };
  if (!S.isGuest) {
    // For authenticated sessions, pull from the profile directory first
    // (includes crockroach_score, account_type) then enrich from accounts.
    seed = (await fetchFeedProfileDirectory([userId])).get(userId) || seed;
  }
  try {
    const { data, error } = await sb
      .from('accounts')
      .select('id,username,display_name,bio,details,website,interests,avatar_url,crockroach_score,account_type')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) return { ...seed, ...data, id: userId };
  } catch (_) {}
  return { ...seed, id: userId };
}

function applyProfileAvatar(url, name) {
  const avatar = $('profile-avatar');
  if (!avatar) return;
  const displayName = String(name || 'U');
  const initial = displayName.charAt(0).toUpperCase() || 'U';
  avatar.textContent = '';
  avatar.dataset.photoUrl = url || '';
  avatar.style.background = 'linear-gradient(135deg,#1a6ef5,#7c3aed)';
  if (!url) {
    avatar.textContent = initial;
    return;
  }
  const img = document.createElement('img');
  img.alt = `${displayName} profile picture`;
  img.src = url;
  img.loading = 'eager';
  img.decoding = 'async';
  img.style.cssText = 'width:100%;height:100%;display:block;object-fit:cover;border-radius:inherit;';
  img.onerror = () => {
    img.remove();
    avatar.textContent = initial;
    avatar.style.background = 'linear-gradient(135deg,#1a6ef5,#7c3aed)';
  };
  avatar.appendChild(img);
}

async function changeProfilePhoto() {
  if (S.isGuest || !S.userId || !sb) { toast('Sign in to change your profile photo.', '🔒'); return; }
  const input = $('profile-avatar-input');
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const media = await uploadPhotoFile(file, 'avatar');
    const { error } = await sb.from('accounts').update({ avatar_url: media.url, updated_at: new Date().toISOString() }).eq('id', S.userId);
    if (error) throw error;
    S.accountData = { ...(S.accountData || {}), avatar_url: media.url };
    applyProfileAvatar(media.url, S.username);
    // Sync avatar across feed sidebar, compose box, and any other avatar surfaces
    ['sidebar-avatar', 'compose-avatar'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.textContent = '';
      el.style.background = `url("${media.url}") center/cover no-repeat`;
      el.style.fontSize = '0';
    });
    syncFeedSidebar();
    toast('Profile photo updated!', '📷');
  } catch (e) {
    console.warn('[Profile] avatar upload failed:', e);
    toast(e?.message || 'Could not update profile photo.', '⚠️');
  } finally { if (input) input.value=''; }
}

async function initPublicProfilePage(userId) {
  const profile = await fetchPublicProfileData(userId);
  S.profileViewData = profile;
  _profilePostsOwner = profile;
  document.body.classList.add('profile-viewing-public');
  const name = profile.display_name || profile.username || 'User';
  if ($('profile-username-display')) $('profile-username-display').textContent = name;
  if ($('profile-handle-modern')) $('profile-handle-modern').textContent = '';
  const publicBadgeHtml = toNum(profile.crockroach_score) >= 700 ? '<span class="profile-badge-chip gold">⭐ Gold</span>' : toNum(profile.crockroach_score) >= 420 ? '<span class="profile-badge-chip silver">🔘 Silver</span>' : '';
  if ($('profile-subline-display')) $('profile-subline-display').innerHTML = `@${sanitizeHTML((profile.username || 'user').toLowerCase().replace(/\s+/g, '_'))} ${publicBadgeHtml}${publicBadgeHtml ? ' · ' : ' · '}${sanitizeHTML((profile.account_type || 'Member').charAt(0).toUpperCase() + (profile.account_type || 'Member').slice(1))}`;
  if ($('profile-bio-display')) $('profile-bio-display').textContent = profile.bio || 'Connecting with the world.';
  if ($('profile-info-goal-val')) $('profile-info-goal-val').textContent = 'Public profile';
  applyProfileAvatar(profile.avatar_url || '', name);
  if ($('profile-hero-score')) $('profile-hero-score').textContent = toNum(profile.crockroach_score).toLocaleString();
  if ($('profile-stat-score')) $('profile-stat-score').textContent = toNum(profile.crockroach_score).toLocaleString();
  if ($('profile-stat-streak')) $('profile-stat-streak').textContent = '—';
  if ($('profile-stat-completions')) $('profile-stat-completions').textContent = '—';
  if ($('profile-stat-rank')) $('profile-stat-rank').textContent = '—';
  if ($('btn-edit-profile')) $('btn-edit-profile').style.display = 'none';
  if ($('btn-change-profile-photo')) $('btn-change-profile-photo').style.display = 'none';
  if ($('profile-post-composer')) $('profile-post-composer').style.display = 'none';
  if ($('profile-info-goal-val')) {
    $('profile-info-goal-val').onclick = () => toast('Public profile stats are shown here.', '👤');
    $('profile-info-goal-val').style.cursor = 'default';
  }
  resetProfilePosts();
  // Follow button + counts (non-blocking)
  await initFollowSection(userId);
  await hydrateProfilePosts(userId);
  hydrateProfileGallery(userId).catch((error) => console.warn('[Gallery] public profile hydration warning:', error));
  bindHorizontalProfileStrip($('profile-post-strip'));
  stabilizeProfileScrollAxes();
  initProfileScrollProgress();
  initProfileTabs();
  renderProfileReels(_profilePosts);
  refreshProfileTabs(_profilePosts);
  $('profile-tabs-bar')?.querySelectorAll('.profile-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.profileTab === 'posts'));
  $('pg-profile')?.querySelectorAll('.profile-tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.profilePanel === 'posts'));
  document.querySelectorAll('[data-reel-upload-cta]').forEach(btn => btn.style.display = S.profileViewUserId ? 'none' : 'inline-flex');
  renderProfileStatsPanel();
}

function initProfilePage() {
  if (S.isGuest) return;
  bindHorizontalProfileStrip($('profile-post-strip'));
  stabilizeProfileScrollAxes();
  initProfileScrollProgress();
  initProfileTabs();
  $('profile-tabs-bar')?.querySelectorAll('.profile-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.profileTab === 'posts'));
  $('pg-profile')?.querySelectorAll('.profile-tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.profilePanel === 'posts'));

  // If profile navigation/rendering wins the race against DB hydration,
  // fetch the account data now and let the hydration callback re-render.
  if (!S.accountData && S.userId) {
    hydrateAccountData(S.userId, { rerender: true }).catch((error) => {
      console.warn('[Profile] render hydration warning:', error);
    });
  }

  const progress = getCurrentProgress();
  const summary = formatProgressLine(progress);
  const score = summary.score;
  const tier = getRankTier(score);
  const pct = tier.max === Infinity ? 100 : Math.round(((score - tier.min) / (tier.max - tier.min)) * 100);

  // Hydrate from DB
  const acc = S.accountData || {};
  const displayName = acc.display_name || S.username || 'User';

  // No-data fallback: surface a clear unavailable state if profile never loaded
  if (!S.accountData) {
    const unEl = $('profile-username-display');
    if (unEl) {
      unEl.textContent = 'Profile unavailable';
      unEl.style.color = 'var(--on-surface-3)';
    }
  }
  
  // Hero Data
  const usernameEl = $('profile-username-display');
  if (usernameEl) usernameEl.textContent = displayName;
  
  const badgeHtml = score >= 700 ? `<span class="profile-badge-chip gold">⭐ Gold</span>` :
                    score >= 420 ? `<span class="profile-badge-chip silver">🔘 Silver</span>` : '';
  
  const handleEl = $('profile-handle-modern');
  if (handleEl) handleEl.textContent = '';

  const sublineEl = $('profile-subline-display');
  if (sublineEl) {
    const usernameValue = (acc.username || S.username || 'user').toLowerCase().replace(/\s+/g, '_');
    const actType = acc.account_type ? acc.account_type.charAt(0).toUpperCase() + acc.account_type.slice(1) : 'Member';
    sublineEl.innerHTML = `@${sanitizeHTML(usernameValue)} ${badgeHtml}${badgeHtml ? ' · ' : ' · '}${sanitizeHTML(actType)}`;
  }
  
  if ($('profile-hero-score')) $('profile-hero-score').textContent = score.toLocaleString();
  if ($('profile-stat-score')) $('profile-stat-score').textContent = score.toLocaleString();

  // Avatar Gradient
  const colors = ['#1a6ef5', '#7c3aed', '#06b6d4', '#f59e0b', '#ec4899'];
  const colorIdx = (S.username || '').length % colors.length;
  const avatarEl = $('profile-avatar');
  if (avatarEl) {
    if (S.accountData?.avatar_url) applyProfileAvatar(S.accountData.avatar_url, displayName);
    else {
      avatarEl.style.background = `linear-gradient(135deg, ${colors[colorIdx]}, ${colors[(colorIdx + 1) % colors.length]})`;
      avatarEl.textContent = (displayName).charAt(0).toUpperCase();
    }
  }

  // Stats Grid
  if ($('profile-stat-streak')) $('profile-stat-streak').textContent = summary.streak;
  if ($('profile-stat-completions')) $('profile-stat-completions').textContent = summary.completions.toLocaleString();
  if ($('profile-stat-rank')) $('profile-stat-rank').textContent = `#${summary.rank}`;

  // View Mode Details
  if ($('profile-bio-display')) {
    const bioEl = $('profile-bio-display');
    if (acc.bio) {
      bioEl.textContent = acc.bio;
      bioEl.style.fontStyle = 'normal';
      bioEl.style.opacity = '1';
    } else {
      bioEl.textContent = 'No bio yet. Click Edit to add one.';
      bioEl.style.fontStyle = 'italic';
      bioEl.style.opacity = '0.6';
    }
  }

  if ($('profile-details-display')) {
    const detailsEl = $('profile-details-display');
    if (acc.details) {
      detailsEl.textContent = acc.details;
      detailsEl.style.fontStyle = 'normal';
      detailsEl.style.opacity = '1';
    } else {
      detailsEl.textContent = 'Not specified. Click Edit to add.';
      detailsEl.style.fontStyle = 'italic';
      detailsEl.style.opacity = '0.6';
    }
    
    const detailsLabels = {
      'professional': 'Job Title',
      'creator': 'Content Niche',
      'business': 'Company Name',
      'private': 'Details'
    };
    if ($('profile-details-label-display')) {
        $('profile-details-label-display').textContent = detailsLabels[acc.account_type] || 'Details';
    }
  }

  if ($('profile-website-container')) {
    if (acc.account_type === 'business' && acc.website) {
      $('profile-website-container').style.display = '';
      const wLink = $('profile-website-display');
      wLink.textContent = acc.website.replace(/^https?:\/\//, '');
      wLink.href = acc.website.startsWith('http') ? acc.website : `https://${acc.website}`;
    } else {
      $('profile-website-container').style.display = 'none';
    }
  }

  renderInterestsDisplay(acc.interests);
  renderLinksDisplay();

  // Follow section — on own profile, hide follow button and load counts for display only
  initFollowSection(null); // null = own profile → hides btn, still loads counts
  if (S.userId && !S.isGuest) {
    fetchFollowData(S.userId).then(fd => _renderFollowUI(S.userId, fd)).catch(() => {});
  }

  // Progress Bar
  if ($('rank-label')) $('rank-label').textContent = `${tier.name}${tier.max < Infinity ? ' → ' + RANK_TIERS[RANK_TIERS.indexOf(tier)+1]?.name : ' (Max)'}`;
  if ($('progress-label')) $('progress-label').textContent = `${score} / ${tier.max < Infinity ? tier.max : score} crockroach Score`;
  if ($('progress-pct')) $('progress-pct').textContent = `${pct}%`;
  if ($('progress-fill')) $('progress-fill').style.width = `${pct}%`;
  if ($('progress-percentile')) $('progress-percentile').textContent = `Top ${summary.percentile}%`;

  // Streak Callout
  const streak = summary.streak || 0;
  if ($('streak-count')) $('streak-count').textContent = `${streak} day${streak !== 1 ? 's' : ''}`;
  if ($('streak-sub')) $('streak-sub').textContent = streak > 0 ? `Best: ${progress.bestStreak || streak} days` : 'Start chatting to build your streak!';
  renderStreakDays(streak);

  // Badges
  const earnedSet = new Set(progress.badges || []);
  const grid = $('profile-badges-grid');
  if (grid) {
    grid.innerHTML = '';
    PROGRESS_BADGES.forEach(badge => {
      const earned = earnedSet.has(badge.label);
      const card = document.createElement('div');
      card.className = `badge-card${earned ? '' : ' locked'}`;
      const iconMap = { 'Rookie':'🌱', 'Momentum':'🔥', '3-Day Streak':'⚡', 'Bronze':'🥉', 'Silver':'🥈', 'Gold':'🥇', 'Top 10%':'👑' };
      const emoji = iconMap[badge.label] || '🏅';
      card.innerHTML = `<span class="badge-emoji">${emoji}</span><div class="badge-name">${badge.label}</div><div class="badge-desc">Unlock requirement met</div>${!earned ? '<span class="badge-locked-overlay">🔒</span>' : ''}`;
      grid.appendChild(card);
    });
    if ($('profile-badges-count')) $('profile-badges-count').textContent = `${earnedSet.size} / ${PROGRESS_BADGES.length}`;
  }

  // Pre-fill Edit Modal
  if ($('edit-display-name')) $('edit-display-name').value = displayName;
  if ($('edit-bio')) $('edit-bio').value = acc.bio || '';
  if ($('edit-details')) $('edit-details').value = acc.details || '';
  
  if ($('edit-website-container')) {
    if (acc.account_type === 'business') {
      $('edit-website-container').style.display = '';
      if ($('edit-website')) $('edit-website').value = acc.website || '';
    } else {
      $('edit-website-container').style.display = 'none';
    }
  }

  renderEditInterests(acc.interests || []);
  renderEditLinks();

  // ── Goal pill → achievements sheet button ─────────────────────────────────
  const goalPill = $('profile-info-goal-val');
  if (goalPill) {
    goalPill.textContent = computeGoalText(getCurrentProgress());
    goalPill.style.cursor = 'pointer';
    goalPill.title = 'View achievements & score breakdown';
    goalPill.onclick = () => {
      if (S.profileViewUserId) {
        toast('Public profile stats are shown here.', '👤');
        return;
      }
      openAchievementsSheet();
    };
  }
  if ($('btn-edit-profile')) $('btn-edit-profile').style.display = '';
  if ($('btn-change-profile-photo')) $('btn-change-profile-photo').style.display = '';
  if ($('profile-post-composer')) $('profile-post-composer').style.display = '';
}

function renderEditInterests(selectedInterests) {
  const container = $('edit-interests-container');
  if (!container) return;
  container.innerHTML = PROFILE_INTERESTS.map(interest => `
    <label style="display:flex;align-items:center;padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--border);cursor:pointer;user-select:none;" class="edit-interest-label" data-id="${interest.id}">
      <input type="checkbox" value="${interest.id}" ${selectedInterests.includes(interest.id) ? 'checked' : ''} style="display:none;" onchange="toggleEditInterest(this)">
      <span style="font-size:13px;font-weight:600;">${interest.label}</span>
    </label>
  `).join('');
  syncEditInterestStyles();
}

function toggleEditInterest(checkbox) {
  const selected = document.querySelectorAll('#edit-interests-container input:checked');
  if (selected.length > 3) {
    toast('Maximum 3 interests allowed', '⚠️');
    checkbox.checked = false;
    return;
  }
  syncEditInterestStyles();
}

function syncEditInterestStyles() {
  const labels = document.querySelectorAll('.edit-interest-label');
  labels.forEach(label => {
    const input = label.querySelector('input');
    if (input.checked) {
      label.style.background = 'var(--primary-alpha)';
      label.style.borderColor = 'rgba(26,110,245,.14)';
      label.style.color = 'var(--primary)';
    } else {
      label.style.background = 'var(--surface-2)';
      label.style.borderColor = 'var(--border)';
      label.style.color = 'var(--on-surface)';
    }
  });
}

function renderEditLinks() {
  const container = $('edit-links-container');
  if (!container) return;
  
  window._tempEditLinks = window._tempEditLinks || (S.userLinks ? [...S.userLinks] : []);
  const links = window._tempEditLinks;

  container.innerHTML = links.map((link, idx) => `
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" class="edit-link-name" value="${link.name}" placeholder="Link Name" maxlength="30" style="flex:0 0 100px;padding:9px 12px;border-radius:var(--r-sm);border:1.5px solid var(--border-strong);font-size:13px;outline:none;" onchange="window._tempEditLinks[${idx}].name=this.value">
      <input type="url" class="edit-link-url" value="${link.url}" placeholder="https://..." maxlength="500" style="flex:1;padding:9px 12px;border-radius:var(--r-sm);border:1.5px solid var(--border-strong);font-size:13px;outline:none;" onchange="window._tempEditLinks[${idx}].url=this.value">
      <button type="button" onclick="removeEditLink(${idx})" style="width:36px;height:36px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--surface-2);color:var(--danger);cursor:pointer;font-weight:700;">✕</button>
    </div>
  `).join('');

  if ($('edit-link-count')) $('edit-link-count').textContent = links.length;
  if ($('btn-edit-add-link')) $('btn-edit-add-link').style.display = links.length >= 5 ? 'none' : 'block';
}

window.addEditLink = function() {
  if (window._tempEditLinks.length >= 5) return;
  window._tempEditLinks.push({ name: '', url: '' });
  renderEditLinks();
};

window.removeEditLink = function(idx) {
  window._tempEditLinks.splice(idx, 1);
  renderEditLinks();
};

// ── Achievements & Score Sheet ───────────────────────────────────────────────
function openAchievementsSheet() {
  document.getElementById('achievements-overlay')?.remove();

  const progress  = getCurrentProgress();
  const summary   = formatProgressLine(progress);
  const score     = summary.score;
  const tier      = getRankTier(score);
  const tierIdx   = RANK_TIERS.indexOf(tier);
  const nextTier  = RANK_TIERS[tierIdx + 1] || null;
  const pct       = tier.max === Infinity ? 100 : Math.min(100, Math.round(((score - tier.min) / (tier.max - tier.min)) * 100));
  const earnedSet = new Set(progress.badges || []);

  const iconMap = { 'Rookie':'🌱','Momentum':'🔥','3-Day Streak':'⚡','Bronze':'🥉','Silver':'🥈','Gold':'🥇','Top 10%':'👑' };

  const reqText = (b) => {
    const parts = [];
    if (b.minScore)        parts.push(`${b.minScore.toLocaleString()} pts`);
    if (b.minCompletions)  parts.push(`${b.minCompletions} chats`);
    if (b.minStreak)       parts.push(`${b.minStreak}-day streak`);
    return parts.length ? parts.join(' · ') : 'Starting badge';
  };

  const badgesHtml = PROGRESS_BADGES.map(b => {
    const earned = earnedSet.has(b.label);
    const emoji  = iconMap[b.label] || '🏅';
    return `
      <div style="
        display:flex;flex-direction:column;align-items:center;gap:5px;
        padding:14px 8px 10px;border-radius:14px;text-align:center;
        background:${earned ? 'var(--primary-alpha)' : 'var(--surface-2)'};
        border:1px solid ${earned ? 'rgba(26,110,245,.20)' : 'var(--border)'};
        opacity:${earned ? '1' : '0.55'};position:relative;transition:all .18s;">
        <span style="font-size:28px;">${emoji}</span>
        <span style="font-size:11px;font-weight:800;color:${earned ? 'var(--primary)' : 'var(--on-surface-3)'};">${b.label}</span>
        <span style="font-size:9.5px;color:var(--on-surface-3);line-height:1.4;">${earned ? '✓ Unlocked' : reqText(b)}</span>
        ${!earned ? '<span style="position:absolute;top:5px;right:6px;font-size:10px;">🔒</span>' : ''}
      </div>`;
  }).join('');

  const progressBarHtml = nextTier ? `
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:var(--on-surface-2);margin-bottom:7px;">
        <span>Progress to ${nextTier.name}</span>
        <span style="color:var(--on-surface-3);">${score.toLocaleString()} / ${nextTier.min.toLocaleString()}</span>
      </div>
      <div style="height:7px;border-radius:999px;background:var(--surface-3);overflow:hidden;">
        <div style="height:100%;border-radius:999px;background:linear-gradient(90deg,var(--primary),var(--secondary));width:${pct}%;transition:width .55s cubic-bezier(.16,1,.3,1);"></div>
      </div>
    </div>` : `
    <div style="padding:10px 14px;border-radius:12px;background:linear-gradient(145deg,var(--primary-alpha),rgba(124,58,237,.08));border:1px solid rgba(26,110,245,.16);text-align:center;font-size:13px;font-weight:700;color:var(--primary);">
      🏆 Maximum tier reached!
    </div>`;

  const overlay = document.createElement('div');
  overlay.id = 'achievements-overlay';
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:2100',
    'display:flex','align-items:center','justify-content:center','padding:18px',
    'background:rgba(0,0,0,.48)','backdrop-filter:blur(14px)',
    '-webkit-backdrop-filter:blur(14px)'
  ].join(';');

  overlay.innerHTML = `
    <div style="
      width:min(560px,100%);max-height:88vh;overflow-y:auto;
      border-radius:24px;background:#fff;border:1px solid var(--border);
      box-shadow:0 28px 70px rgba(0,0,0,.18);
      display:flex;flex-direction:column;
      animation:toastIn .18s cubic-bezier(.16,1,.3,1);">

      <!-- Header -->
      <div style="
        padding:20px 22px 16px;border-bottom:1px solid var(--border);
        display:flex;align-items:center;justify-content:space-between;
        background:linear-gradient(145deg,var(--primary-alpha),rgba(124,58,237,.05));
        flex-shrink:0;border-radius:24px 24px 0 0;">
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--on-surface-3);">Achievements &amp; Score</div>
          <div style="font-size:21px;font-weight:900;letter-spacing:-.04em;margin-top:3px;">Your status</div>
        </div>
        <button id="ach-close" style="
          width:36px;height:36px;border-radius:50%;
          border:1px solid var(--border);background:#fff;
          display:grid;place-items:center;font-size:18px;
          color:var(--on-surface-3);cursor:pointer;">×</button>
      </div>

      <!-- Score stats grid -->
      <div style="padding:18px 22px 14px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px;">
          <div style="padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,var(--primary-alpha),rgba(124,58,237,.06));border:1px solid rgba(26,110,245,.14);">
            <div style="font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--on-surface-3);">crockroach Score</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.04em;margin-top:4px;color:var(--primary);">${score.toLocaleString()}</div>
          </div>
          <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);">
            <div style="font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--on-surface-3);">Tier</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.04em;margin-top:4px;">${tier.name}</div>
          </div>
          <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);">
            <div style="font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--on-surface-3);">Chats completed</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.04em;margin-top:4px;">${summary.completions.toLocaleString()}</div>
          </div>
          <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);">
            <div style="font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--on-surface-3);">Day streak</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.04em;margin-top:4px;">${summary.streak}d 🔥</div>
          </div>
          <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);">
            <div style="font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--on-surface-3);">Weekly rank</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.04em;margin-top:4px;">#${summary.rank}</div>
          </div>
          <div style="padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);">
            <div style="font-size:9px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--on-surface-3);">Top percentile</div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.04em;margin-top:4px;">Top ${summary.percentile}%</div>
          </div>
        </div>
        ${progressBarHtml}
      </div>

      <!-- Badges -->
      <div style="padding:18px 22px 24px;flex:1;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--on-surface-3);">Badges</span>
          <span style="font-size:12px;font-weight:700;color:var(--on-surface-3);">${earnedSet.size} / ${PROGRESS_BADGES.length} unlocked</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
          ${badgesHtml}
        </div>
        <!-- Score breakdown note -->
        <div style="margin-top:16px;padding:10px 12px;border-radius:11px;background:var(--surface-2);border:1px solid var(--border);font-size:11.5px;color:var(--on-surface-3);line-height:1.6;">
          <strong style="color:var(--on-surface);">Score breakdown:</strong>
          Base ${(Number(progress.baseScore)||0).toLocaleString()} pts
          + Bonus ${(Number(progress.bonusScore)||0).toLocaleString()} pts
          = <strong style="color:var(--primary);">${score.toLocaleString()} total</strong>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('ach-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const escH = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escH); } };
  document.addEventListener('keydown', escH);
}

// ── Central helper: open / close the edit-profile modal ─────────────────────
function openEditModal() {
  const modal = $('edit-modal');
  if (!modal) return;
  window._tempEditLinks = S.userLinks ? JSON.parse(JSON.stringify(S.userLinks)) : [];
  initProfilePage(); // re-hydrate form fields every time
  // Belt-and-suspenders: set both the class *and* explicit inline styles so
  // neither a stale inline override nor a missing CSS rule can block clicks.
  modal.classList.add('active');
  modal.style.display    = 'flex';
  modal.style.pointerEvents = 'auto';
  document.body.classList.add('mortalive-edit-open');
  if ($('edit-error')) $('edit-error').style.display = 'none';
}

function closeEditModal() {
  const modal = $('edit-modal');
  if (!modal) return;
  modal.classList.remove('active');
  // Remove inline overrides so the base .overlay CSS takes full control again.
  modal.style.display    = '';
  modal.style.pointerEvents = '';
  document.body.classList.remove('mortalive-edit-open');
  if ($('edit-error')) $('edit-error').style.display = 'none';
}

function toggleProfileEditMode() {
  // Pattern A — overlay/modal HTML (current index.html layout)
  const modal = $('edit-modal');
  if (modal) {
    modal.classList.contains('active') ? closeEditModal() : openEditModal();
    return;
  }

  // Pattern B — inline view/edit mode divs (legacy layout fallback)
  const viewMode  = $('profile-view-mode');
  const editMode  = $('profile-edit-mode');
  const toggleBtn = $('btn-edit-profile');
  const actionRow = $('profile-edit-actions');
  if (!viewMode || !editMode) return;

  const isEditing = viewMode.style.display === 'none';
  if (!isEditing) {
    window._tempEditLinks = S.userLinks ? JSON.parse(JSON.stringify(S.userLinks)) : [];
    initProfilePage();
    viewMode.style.display  = 'none';
    editMode.style.display  = 'block';
    if (actionRow) actionRow.style.display = 'flex';
    if (toggleBtn) { toggleBtn.textContent = '× Cancel'; toggleBtn.style.color = 'var(--danger)'; toggleBtn.style.background = 'rgba(220,38,38,.08)'; }
  } else {
    viewMode.style.display  = 'block';
    editMode.style.display  = 'none';
    if (actionRow) actionRow.style.display = 'none';
    if (toggleBtn) { toggleBtn.textContent = '✏️ Edit'; toggleBtn.style.color = ''; toggleBtn.style.background = ''; }
    if ($('edit-error')) $('edit-error').style.display = 'none';
  }
}

// Public browser bridge for the visible Profile Edit button.
window.toggleProfileEditMode = toggleProfileEditMode;

// ═══════════════════════════════════════════════════════════════════
// FOLLOW SYSTEM
// ═══════════════════════════════════════════════════════════════════

// In-memory cache: userId → { followers, following, isFollowing }
const _followCache = new Map();

// Shared follow mutation used by both the original Profile page and the
// Feed-profile view so both surfaces always use the same database behavior.
async function toggleFollow(profileUserId, shouldFollow) {
  const session = await requireAuthenticatedSession();
  if (!session || !S.userId || !profileUserId || profileUserId === S.userId) {
    throw new Error('You must be signed in to follow this profile.');
  }

  if (shouldFollow) {
    const { error } = await sb.from('follows').insert({
      follower_id: S.userId,
      following_id: profileUserId
    });
    if (error) throw error;
  } else {
    const { error } = await sb.from('follows')
      .delete()
      .eq('follower_id', S.userId)
      .eq('following_id', profileUserId);
    if (error) throw error;
  }

  const current = _followCache.get(profileUserId) || { followers: 0, following: 0, isFollowing: false };
  const next = {
    ...current,
    isFollowing: !!shouldFollow,
    followers: Math.max(0, toNum(current.followers) + (shouldFollow ? 1 : -1))
  };
  _followCache.set(profileUserId, next);
  return next;
}

async function fetchFollowData(profileUserId) {
  if (!sb || !profileUserId) return { followers: 0, following: 0, isFollowing: false };
  if (_followCache.has(profileUserId)) return _followCache.get(profileUserId);
  try {
    const { data, error } = await sb.rpc('get_profile_follow_data', {
      p_profile_id: profileUserId,
      p_viewer_id:  S.isGuest ? null : (S.userId || null)
    });
    if (error) throw error;
    const result = {
      followers:   Number(data?.followers  || 0),
      following:   Number(data?.following  || 0),
      isFollowing: !!data?.is_following
    };
    _followCache.set(profileUserId, result);
    return result;
  } catch (e) {
    console.warn('[Follow] fetchFollowData failed:', e?.message || e);
    return { followers: 0, following: 0, isFollowing: false };
  }
}

// Public bridge for external enhancement layers loaded after app.js.
// _followCache itself is a lexical const, so expose the same Map instance
// rather than creating a second cache.
window._followCache = _followCache;
window.toggleFollow = toggleFollow;
window.fetchFollowData = fetchFollowData;

function _renderFollowUI(profileUserId, followData) {
  const followBtn = $('btn-follow-user');
  const countEl = $('profile-follow-counts');
  if (followBtn) {
    const isFollowing = followData.isFollowing;
    followBtn.textContent = isFollowing ? 'Following' : 'Follow';
    followBtn.classList.toggle('profile-action-following', isFollowing);
    followBtn.dataset.profileUserId = profileUserId;
    followBtn.disabled = false;
  }
  if (countEl) {
    countEl.textContent = `${followData.followers.toLocaleString()} followers · ${followData.following.toLocaleString()} following`;
    countEl.style.display = '';
  }
  // Update mini-stat cells if present
  const fsEl = $('profile-stat-followers');
  const fgEl = $('profile-stat-following');
  if (fsEl) fsEl.textContent = followData.followers.toLocaleString();
  if (fgEl) fgEl.textContent = followData.following.toLocaleString();
}

async function initFollowSection(profileUserId) {
  const followBtn = $('btn-follow-user');
  if (!followBtn) return;

  // Own profile — hide everything
  if (!profileUserId || profileUserId === S.userId) {
    followBtn.style.display = 'none';
    const countEl = $('profile-follow-counts');
    if (countEl) countEl.style.display = 'none';
    return;
  }

  // Guest viewing another profile — show Follow button (login-gated) and load counts
  if (S.isGuest) {
    followBtn.style.display = '';
    followBtn.textContent = 'Follow';
    followBtn.disabled = false;
    followBtn.onclick = () => {
      toast('Sign in to follow', '🔒');
      setTimeout(() => {
        showPage('pg-auth');
        $('tab-login')?.click();
      }, 800);
    };
    // Still load follower counts — they're publicly visible
    fetchFollowData(profileUserId).then(fd => {
      const countEl = $('profile-follow-counts');
      if (countEl) {
        countEl.textContent = `${fd.followers.toLocaleString()} followers · ${fd.following.toLocaleString()} following`;
        countEl.style.display = '';
      }
    }).catch(() => {});
    return;
  }

  // Logged-in viewing another profile
  followBtn.style.display = '';
  followBtn.textContent = '…';
  followBtn.disabled = true;

  const followData = await fetchFollowData(profileUserId);
  _renderFollowUI(profileUserId, followData);

  followBtn.onclick = async () => {
    if (S.isGuest) { toast('Sign in to follow', '🔒'); return; }
    const cached = _followCache.get(profileUserId) || { followers: 0, following: 0, isFollowing: false };
    const nowFollowing = !cached.isFollowing;

    // Optimistic update
    const optimistic = {
      ...cached,
      isFollowing: nowFollowing,
      followers: Math.max(0, cached.followers + (nowFollowing ? 1 : -1))
    };
    _followCache.set(profileUserId, optimistic);
    _renderFollowUI(profileUserId, optimistic);

    try {
      await toggleFollow(profileUserId, nowFollowing);
      toast(nowFollowing ? 'Following!' : 'Unfollowed', nowFollowing ? '✓' : '➖');
    } catch (e) {
      // Roll back on failure
      _followCache.set(profileUserId, cached);
      _renderFollowUI(profileUserId, cached);
      toast(e?.message || 'Could not update follow.', '⚠️');
    }
  };
}

// Attach Profile Events
// Guard: idempotent — safe to call multiple times, only binds once per element.
// Single source of truth for generating and copying a canonical profile link.
// Always produces  https://origin/@username  — never a hash-based URL.
function shareCurrentProfile() {
  const username = S.profileViewUserId
    ? (S.profileViewData?.username || '')
    : (S.accountData?.username || S.username || '');
  if (!username) { toast('Sign in to copy your profile link', '🔒'); return; }
  const link = `${window.location.origin}/@${encodeURIComponent(username)}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link)
      .then(() => toast('Profile link copied! Share it anywhere.', '📋'))
      .catch(() => toast(link, '🔗'));
  } else {
    toast(link, '🔗');
  }
}

// Public bridge: the profile menu lives in index.html and uses the same canonical helper.
window.shareCurrentProfile = shareCurrentProfile;

function bindProfileEvents() {
  // Hard guard against double-binding (e.g. auth-state listener re-triggering)
  if (document.body.dataset.profileEventsBound) return;
  document.body.dataset.profileEventsBound = '1';

  // Delegated handler — survives DOM rerenders of the profile card.
  // Direct element.addEventListener on #btn-edit-profile and share buttons
  // broke whenever initProfilePage() replaced those nodes after hydration.
  document.addEventListener('click', (e) => {
    const profileBtn = e.target.closest?.('[data-open-profile]');
    if (profileBtn) { e.preventDefault(); openUserProfile(profileBtn.dataset.openProfile); return; }

    if (e.target.closest?.('#btn-edit-profile')) { toggleProfileEditMode(); return; }

    if (e.target.closest?.('#btn-share-profile, #btn-profile-copy')) {
      shareCurrentProfile();
      return;
    }
  });

  // Avatar upload — direct bind is safe here; the input/button are never
  // re-created by initProfilePage, only hidden/shown.
  // (Keeps the existing dataset.bound guard below intact.)
  const avatarInput = $('profile-avatar-input');
  const avatarButton = $('btn-change-profile-photo');
  if (avatarButton && avatarInput && !avatarButton.dataset.bound) {
    avatarButton.dataset.bound = '1';
    avatarButton.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', () => changeProfilePhoto());
  }

  // Cancel-inline: also delegated; keep direct bind as belt-and-suspenders
  // since this element is inside the modal and never replaced by hydration.
  $('btn-edit-cancel-inline')?.addEventListener('click', toggleProfileEditMode);

  // Profile post strip: like buttons (data-profile-action="like")
  // Uses document delegation so it survives re-renders of the strip
  if (!document.body.dataset.profilePostActionBound) {
    document.body.dataset.profilePostActionBound = '1';
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-profile-action]');
      if (!btn) return;
      const action = btn.dataset.profileAction;
      const postId = btn.dataset.postId;
      if (!postId) return;
      if (action === 'like') togglePostLike(postId);
    });
  }

  // Modal close uses event delegation so controls remain functional even if
  // the modal subtree is rerendered or replaced after hydration.
  if (!document.body.dataset.profileModalDelegationBound) {
    document.body.dataset.profileModalDelegationBound = '1';
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('#btn-edit-close, #btn-edit-cancel')) {
        closeEditModal();
        return;
      }
      if (e.target?.id === 'edit-modal') closeEditModal();
    });
  }

  // The current index.html uses id="btn-edit-save"; keep support for the
  // older inline id as well so the JS remains compatible with both layouts.
  const profileSaveButton = $('btn-edit-save') || $('btn-edit-save-inline');

  profileSaveButton?.addEventListener('click', async () => {
    const newName = $('edit-display-name')?.value.trim() || '';
    const newBio = $('edit-bio')?.value.trim() || '';
    const newDetails = $('edit-details')?.value.trim() || '';
    const newWebsite = $('edit-website')?.value.trim() || '';
    const newPassword = $('edit-new-password')?.value || '';
    const errEl = $('edit-error');

    const selectedInterests = Array.from(
      document.querySelectorAll('#edit-interests-container input:checked')
    ).map(cb => cb.value).filter(v => v);

    // Filter valid links
    const validLinks = (window._tempEditLinks || []).filter(l => l.name.trim() && l.url.trim()).map((l, idx) => ({
      user_id: S.userId,
      name: l.name.trim(),
      url: l.url.trim(),
      sort_order: idx
    }));

    const btn = profileSaveButton;
    if(btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if(errEl) errEl.style.display = 'none';

    try {
      if (newPassword && newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }

      // 1. Update password when one was supplied in the current profile modal.
      if (newPassword) {
        const { error: passwordErr } = await sb.auth.updateUser({ password: newPassword });
        if (passwordErr) throw passwordErr;
      }

      // 2. Update Accounts Table
      const updatePayload = {
        display_name: newName,
        bio: newBio,
        details: newDetails,
        interests: selectedInterests,
        updated_at: new Date().toISOString()
      };
      
      if (S.accountData?.account_type === 'business') {
        if (newWebsite) {
          try {
            new URL(/^https?:\/\//i.test(newWebsite) ? newWebsite : `https://${newWebsite}`);
          } catch {
            throw new Error('Invalid website URL — please enter a valid address.');
          }
        }
        updatePayload.website = newWebsite;
      }

      const { error: dbErr } = await sb.from('accounts').update(updatePayload).eq('id', S.userId);
      if (dbErr) throw dbErr;

      // 3. Update Links Table (delete all, insert new)
      await sb.from('user_links').delete().eq('user_id', S.userId);
      if (validLinks.length > 0) {
        const { error: linkErr } = await sb.from('user_links').insert(validLinks);
        if (linkErr) throw linkErr;
      }

      // 4. Sync local S object
      if (S.accountData) {
        S.accountData.display_name = newName;
        S.accountData.bio = newBio;
        S.accountData.details = newDetails;
        S.accountData.interests = selectedInterests;
        if (S.accountData.account_type === 'business') S.accountData.website = newWebsite;
      }
      S.userLinks = validLinks;

      toast('Profile updated!', '✅');
      toggleProfileEditMode();
      if ($('edit-new-password')) $('edit-new-password').value = '';
      initProfilePage();
      hydrateProfilePosts(S.userId).catch((error) => console.warn('[Posts] post-save hydration warning:', error));
      // Refresh the instagram-style info row in the profile top section
      if (typeof window.renderProfileInfoRow === 'function') window.renderProfileInfoRow();
    } catch (e) {
      if(errEl) { errEl.textContent = e.message || 'Could not save changes.'; errEl.style.display = 'block'; }
    } finally {
      if(btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
  });

  // Share and copy-link are now handled by the delegated click handler above
  // via shareCurrentProfile(). No direct bindings needed here.

  $('btn-profile-logout')?.addEventListener('click', async () => {
    const confirmed = await showConfirmDialog({
      title: 'Log out?',
      body: 'You can always sign back in with your email and password.',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay',
      danger: false
    });
    if (confirmed) $('btn-logout')?.click();
  });

  $('btn-delete-account')?.addEventListener('click', performAccountDeletion);
}

// Shared deletion flow — called from both the profile menu button AND the
// Account Center danger-zone button so both paths behave identically.
async function performAccountDeletion() {
  const confirmed = await showConfirmDialog({
    title: 'Permanently delete account?',
    body: 'This removes your profile, score, badges, and all associated data from Mortalive — on every device. You will not be able to recover it.',
    confirmLabel: 'Delete permanently',
    cancelLabel: 'Cancel',
    danger: true
  });
  if (!confirmed) return;

  const userId = S.userId;
  if (!userId || !S.authToken) {
    toast('Your session has expired. Please sign in again.', '🔒');
    return;
  }

  // Account deletion is intentionally a single server-side transaction.
  // The browser no longer performs partial row deletes before Auth deletion.
  try {
    const res = await fetch(`${SERVER_URL}/api/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${S.authToken}`
      },
      body: JSON.stringify({ userId })
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `Account deletion failed (${res.status})`);
    }

    console.log('[Delete] Transactional account deletion succeeded ✓');
  } catch (e) {
    console.error('[Delete] Transactional deletion failed:', e?.message || e);
    toast(e?.message || 'Account deletion failed. Nothing was deleted.', '⚠️');
    return;
  }

  // Only clear local state after the backend confirms the transaction.
  try { await sb?.auth?.signOut(); } catch (e) {}
  localStorage.removeItem('mortalive_token');
  localStorage.removeItem('mortalive_username');
  localStorage.removeItem('mortalive_user_id');
  localStorage.removeItem('mortalive_guest_name');
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem('mortalive_talk_v3');

  S.authToken = null;
  S.username = null;
  S.userId = null;
  S.accountData = null;
  S.userLinks = [];
  S.crockroachScore = null;
  S.isGuest = true;

  toast('Account deleted successfully.', '✅');
  setTimeout(() => showPage('pg-auth'), 450);
}

window.performAccountDeletion = performAccountDeletion;
window.openAchievementsSheet  = openAchievementsSheet;
window.PROFILE_INTERESTS      = PROFILE_INTERESTS; // needed by renderProfileInfoRow

/* ── INTEGRATED TALK ENHANCEMENT LAYER v22 ───────────────────────────────
   Merged from talk-enhancements-v20.js so production only needs app.js.
   The layer remains isolated in its own IIFE and uses existing app state.
*/
/* ═══════════════════════════════════════════════════════════════════════════
   MORTALIVE — Talk Section Enhancement Layer  v20
   Load AFTER app.js. Adds data hydration and rich UI to the Talk pages
   without touching any existing handlers or state in app.js / window.S.
   ═══════════════════════════════════════════════════════════════════════════ */

(function TalkEnhance() {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────────────── */
  const STORE_KEY = 'mortalive_talk_v3';

  const QUICK_REPLIES = [
    'Hey 👋', 'Where are you from?', 'What do you do for fun?',
    "What's your hot take on AI?", 'Recommend a song?',
    'Introvert or extrovert?', 'Last thing that made you laugh?',
    'Favourite travel spot?', 'Night owl or early bird?',
    "What's keeping you busy lately?"
  ];

  const INTEREST_CHIPS = [
    { e:'🎵', l:'Music' },  { e:'🎮', l:'Gaming' },
    { e:'✈️', l:'Travel' }, { e:'📚', l:'Books' },
    { e:'🎨', l:'Art' },    { e:'💼', l:'Business' },
    { e:'🏋️', l:'Fitness' },{ e:'🍳', l:'Food' },
    { e:'📸', l:'Photography' },{ e:'🤖', l:'Tech' },
    { e:'🎭', l:'Films' },  { e:'🌿', l:'Nature' }
  ];

  const MATCH_TIPS = [
    '💡 Completing chats earns crockroach Score',
    '🌍 Your next match could be from any country on Earth',
    '⭐ Rate your chats to help improve future matches',
    '🔒 Your identity stays private — nothing is shared without your consent',
    '⚡ Average match time is under 30 seconds when others are online',
    '🎯 Adding a topic finds like-minded strangers faster',
    '🧲 A high crockroach Score boosts your matching priority',
    '💬 Text mode works without a camera — great for quieter moments',
    '🎬 If no match is found, a recorded stream will appear automatically'
  ];

  const REACTIONS = ['😂', '❤️', '😮', '👏', '🔥'];

  /* ── Tiny helpers ───────────────────────────────────────────────────────── */
  const $   = id  => document.getElementById(id);
  const qs  = (s, ctx = document) => ctx.querySelector(s);
  const qsa = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

  function escHTML(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  function relTime(ts) {
    const diff = Math.max(0, Date.now() - Number(ts || 0));
    if (diff < 60000)    return 'just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function fmtDuration(secs) {
    const s = Number(secs) || 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return m > 0 ? `${m}m` : '<1m';
  }

  /* Safe accessors so we never error if app.js hasn't initialised yet */
  function getS()        { return window.S || {}; }
  function getProgress() { return getS().progress || (window.getCurrentProgress?.() || {}); }
  function getScore()    { return window.getProgressScore?.(getProgress()) ?? 0; }

  /* ── Persistent talk data ───────────────────────────────────────────────── */
  const TalkStore = {
    load() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
    },
    save(data) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
    },
    get() {
      const raw = this.load();
      const p   = getProgress();
      return {
        totalChats: raw.totalChats  || p.completions || 0,
        totalSec:   raw.totalSec   || 0,
        videoCalls: raw.videoCalls || 0,
        skips:      raw.skips      || 0,
        sessions:   Array.isArray(raw.sessions) ? raw.sessions : [],
        lastChatAt: raw.lastChatAt || null
      };
    },
    record({ peer, emoji, mode, durationSec, rating, skipped, userId }) {
      const raw = this.load();
      if (!raw.sessions) raw.sessions = [];
      if (!skipped) {
        raw.sessions.unshift({
          peer:        String(peer  || 'Stranger').slice(0, 30),
          emoji:       String(emoji || '👤').slice(0, 4),
          mode:        mode || 'text',
          durationSec: Number(durationSec) || 0,
          rating:      Number.isFinite(rating) ? rating : null,
          userId:      userId || null,  // stored for messaging eligibility; null for guests/bots
          ts:          Date.now()
        });
        raw.sessions   = raw.sessions.slice(0, 60);
        raw.totalChats = (raw.totalChats || 0) + 1;
        raw.totalSec   = (raw.totalSec   || 0) + (Number(durationSec) || 0);
        if (mode === 'video') raw.videoCalls = (raw.videoCalls || 0) + 1;
        raw.lastChatAt = Date.now();
      } else {
        raw.skips = (raw.skips || 0) + 1;
      }
      this.save(raw);
    }
  };

  /* ── Session timer ──────────────────────────────────────────────────────── */
  let _timerIv    = null;
  let _timerStart = null;
  let _timerSecs  = 0;

  function startTimer() {
    _timerStart = Date.now();
    _timerSecs  = 0;
    const el = $('chat-session-timer');
    if (!el) return;
    clearInterval(_timerIv);
    el.textContent = '00:00';
    el.classList.remove('long');

    _timerIv = setInterval(() => {
      _timerSecs = Math.floor((Date.now() - _timerStart) / 1000);
      const m = Math.floor(_timerSecs / 60);
      const s = _timerSecs % 60;
      if (el.isConnected) {
        el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        el.classList.toggle('long', _timerSecs >= 300); // amber after 5 min
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(_timerIv);
    _timerIv = null;
    const elapsed = _timerStart ? Math.floor((Date.now() - _timerStart) / 1000) : 0;
    _timerStart = null;
    return elapsed;
  }

  /* ── Rotating tips on match page ────────────────────────────────────────── */
  let _tipIv  = null;
  let _tipIdx = 0;

  function startTips() {
    const el = $('talk-match-tip-text');
    if (!el) return;
    _tipIdx = Math.floor(Math.random() * MATCH_TIPS.length);
    el.textContent = MATCH_TIPS[_tipIdx];
    clearInterval(_tipIv);
    _tipIv = setInterval(() => {
      _tipIdx = (_tipIdx + 1) % MATCH_TIPS.length;
      if (!el.isConnected) { clearInterval(_tipIv); return; }
      el.style.opacity = '0';
      setTimeout(() => {
        if (el.isConnected) { el.textContent = MATCH_TIPS[_tipIdx]; el.style.opacity = '1'; }
      }, 220);
    }, 4800);
  }

  function stopTips() { clearInterval(_tipIv); _tipIv = null; }

  /* ── Live-bar data refresh ──────────────────────────────────────────────── */
  function refreshLiveBar() {
    const countEl = $('talk-live-count');
    const waitEl  = $('talk-avg-wait');
    if (countEl) {
      const n = Number(getS().onlineCount || 0);
      countEl.textContent = n ? n.toLocaleString() : '—';
    }
    if (waitEl) {
      const n = Number(getS().onlineCount || 0);
      waitEl.textContent = n > 300 ? '<10s' : n > 80 ? '~20s' : '~30s';
    }
  }

  /* ── Mode-card sync ─────────────────────────────────────────────────────── */
  function syncModeCards() {
    const grid = $('talk-mode-grid');
    if (!grid) return;
    const activeMode = getS().mode || 'video';
    qsa('.talk-mode-card', grid).forEach(c =>
      c.classList.toggle('active', c.dataset.mode === activeMode)
    );
    refreshModeCardCounts();
  }

  function refreshModeCardCounts() {
    const n = Number(getS().onlineCount || 0);
    const v = $('talk-mode-video-count');
    const t = $('talk-mode-text-count');
    if (v) v.textContent = n ? `~${Math.max(1, Math.round(n * .55)).toLocaleString()} available` : 'Available';
    if (t) t.textContent = n ? `~${Math.max(1, Math.round(n * .45)).toLocaleString()} available` : 'Available';
  }

  /* ── Lobby stats strip ──────────────────────────────────────────────────── */
  function refreshLobbyStats() {
    const strip = $('talk-lobby-stats-strip');
    if (!strip) return;

    if (getS().isGuest) { strip.style.display = 'none'; return; }
    strip.style.display = '';

    const p    = getProgress();
    const data = TalkStore.get();
    const set  = (id, val) => { const el = $(id); if (el) el.textContent = val; };

    set('lstat-score',  getScore().toLocaleString());
    set('lstat-streak', `${p.streak || 0}d`);
    set('lstat-chats',  data.totalChats.toLocaleString());
    set('lstat-rank',   p.weeklyRank ? `#${p.weeklyRank}` : '#—');
  }

  /* ── Profile talk stats renderer ────────────────────────────────────────── */
  function renderProfileTalkStats() {
    const host = $('profile-talk-stats');
    if (!host) return;

    const S = getS();
    if (S.isGuest || !S.username) { host.innerHTML = ''; return; }

    const data  = TalkStore.get();
    const p     = getProgress();
    const score = getScore();

    const total    = data.totalChats;
    const timeStr  = data.totalSec > 0 ? fmtDuration(data.totalSec) : '0m';
    const rate     = total > 0
      ? Math.min(99, Math.round((total / Math.max(total + data.skips * 0.4 + 1, 1)) * 100))
      : 0;

    const recentHTML = data.sessions.slice(0, 4).map(s => `
      <div class="talk-pstats-recent">
        <div class="talk-pstats-recent-ava">${escHTML(s.emoji)}</div>
        <div class="talk-pstats-recent-info">
          <div class="talk-pstats-recent-peer">${escHTML(s.peer)}</div>
          <div class="talk-pstats-recent-meta">${escHTML(s.mode)} · ${escHTML(fmtDuration(s.durationSec))} · ${escHTML(relTime(s.ts))}</div>
        </div>
        ${s.rating ? `<div class="talk-pstats-recent-rating">⭐ ${escHTML(String(s.rating))}</div>` : ''}
      </div>`).join('');

    host.innerHTML = `
      <div class="talk-pstats-card">
        <div class="talk-pstats-head">
          <span class="talk-pstats-title">💬 Talk Activity</span>
          <span class="talk-pstats-sub">${total} chat${total === 1 ? '' : 's'}</span>
        </div>

        <div class="talk-pstats-grid">
          <div class="talk-pstats-cell primary">
            <div class="talk-pstats-val">${total.toLocaleString()}</div>
            <div class="talk-pstats-lbl">Total Chats</div>
          </div>
          <div class="talk-pstats-cell">
            <div class="talk-pstats-val">${escHTML(timeStr)}</div>
            <div class="talk-pstats-lbl">Talk Time</div>
          </div>
          <div class="talk-pstats-cell">
            <div class="talk-pstats-val">${data.videoCalls.toLocaleString()}</div>
            <div class="talk-pstats-lbl">Video Calls</div>
          </div>
          <div class="talk-pstats-cell">
            <div class="talk-pstats-val">${(p.streak || 0)}<span style="font-size:14px">d 🔥</span></div>
            <div class="talk-pstats-lbl">Streak</div>
          </div>
          <div class="talk-pstats-cell">
            <div class="talk-pstats-val">${score.toLocaleString()}</div>
            <div class="talk-pstats-lbl">Score</div>
          </div>
          <div class="talk-pstats-cell">
            <div class="talk-pstats-val">${p.weeklyRank ? `#${p.weeklyRank}` : '—'}</div>
            <div class="talk-pstats-lbl">Weekly Rank</div>
          </div>
        </div>

        ${total > 0 ? `
          <div class="talk-cbar">
            <div class="talk-cbar-head">
              <span>Completion rate</span><span>${rate}%</span>
            </div>
            <div class="talk-cbar-track">
              <div class="talk-cbar-fill" style="width:${rate}%;"></div>
            </div>
          </div>` : ''}

        ${recentHTML ? `
          <div class="talk-pstats-recents">
            <div class="talk-pstats-recents-label">Recent chats</div>
            ${recentHTML}
          </div>` : `
          <div class="talk-pstats-empty">
            <div class="talk-pstats-empty-icon">💬</div>
            Start chatting to build your Talk history
            <br>
            <button class="talk-pstats-cta" type="button" onclick="window.showPage?.('pg-lobby')">
              Find a stranger →
            </button>
          </div>`}
      </div>`;
  }

  window.renderProfileTalkStats = renderProfileTalkStats;

  /* ── DOM Injection helpers ──────────────────────────────────────────────── */

  /* LOBBY */
  function injectLobby() {
    const card = qs('#pg-lobby .lobby-card');
    if (!card || card.dataset.talkInjected) return;
    card.dataset.talkInjected = '1';

    /* 1. Live stats bar — prepend before .lobby-head */
    const head = qs('.lobby-head', card);
    if (head) {
      const bar = document.createElement('div');
      bar.className = 'talk-live-bar';
      bar.innerHTML = `
        <span class="talk-live-dot"></span>
        <strong id="talk-live-count">—</strong> online
        <span class="talk-sep">·</span>
        avg wait <strong id="talk-avg-wait">&lt;10s</strong>`;
      card.insertBefore(bar, head);
    }

    /* 2. Mode cards — hidden original mode-switch, inject cards above it */
    const modeSwitch = qs('.mode-switch', card);
    if (modeSwitch) {
      modeSwitch.style.display = 'none'; /* keep for app.js proxying */
      const grid = document.createElement('div');
      grid.id        = 'talk-mode-grid';
      grid.className = 'talk-mode-grid';
      grid.innerHTML = `
        <button class="talk-mode-card active" data-mode="video" type="button">
          <div class="talk-mode-check">✓</div>
          <span class="talk-mode-card-icon">🎥</span>
          <div class="talk-mode-card-name">Video Chat</div>
          <div class="talk-mode-card-desc">Face-to-face with a random stranger</div>
          <div class="talk-mode-card-meta" id="talk-mode-video-count">Available</div>
        </button>
        <button class="talk-mode-card" data-mode="text" type="button">
          <div class="talk-mode-check">✓</div>
          <span class="talk-mode-card-icon">💬</span>
          <div class="talk-mode-card-name">Text Chat</div>
          <div class="talk-mode-card-desc">Anonymous messaging, no camera needed</div>
          <div class="talk-mode-card-meta" id="talk-mode-text-count">Available</div>
        </button>`;
      modeSwitch.parentNode.insertBefore(grid, modeSwitch);

      /* Mode card clicks proxy to hidden .mode-btn buttons */
      grid.addEventListener('click', e => {
        const card = e.target.closest('.talk-mode-card');
        if (!card) return;
        const proxy = qs(`.mode-btn[data-mode="${card.dataset.mode}"]`);
        if (proxy) proxy.click();
        qsa('.talk-mode-card', grid).forEach(c => c.classList.toggle('active', c === card));
      });
    }

    /* 3. Interest chip suggestions — inject after lobby-grid */
    const lobbyGrid = qs('.lobby-grid', card);
    if (lobbyGrid) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:12px;';
      wrap.innerHTML = `
        <div class="talk-chips-label">Quick topics</div>
        <div id="talk-interest-chips" class="talk-chips-wrap"></div>`;
      lobbyGrid.insertAdjacentElement('afterend', wrap);
    }

    /* 4. Stats strip — after .start-row */
    const startRow = qs('.start-row', card);
    if (startRow) {
      const strip = document.createElement('div');
      strip.id        = 'talk-lobby-stats-strip';
      strip.className = 'talk-lobby-stats';
      strip.style.display = 'none';
      strip.innerHTML = `
        <div class="talk-lobby-stat">
          <div class="talk-lobby-stat-val" id="lstat-score">—</div>
          <div class="talk-lobby-stat-lbl">Score</div>
        </div>
        <div class="talk-lobby-stat">
          <div class="talk-lobby-stat-val" id="lstat-streak">0d</div>
          <div class="talk-lobby-stat-lbl">Streak</div>
        </div>
        <div class="talk-lobby-stat">
          <div class="talk-lobby-stat-val" id="lstat-chats">0</div>
          <div class="talk-lobby-stat-lbl">Chats</div>
        </div>
        <div class="talk-lobby-stat">
          <div class="talk-lobby-stat-val" id="lstat-rank">#—</div>
          <div class="talk-lobby-stat-lbl">Rank</div>
        </div>`;
      startRow.insertAdjacentElement('afterend', strip);
    }
  }

  /* MATCH */
  function injectMatch() {
    const card = qs('#pg-match .match-card');
    if (!card || card.dataset.talkInjected) return;
    card.dataset.talkInjected = '1';

    /* Replace plain spinner with concentric ring */
    const spinner = qs('.spinner', card);
    if (spinner) {
      const ring = document.createElement('div');
      ring.className = 'talk-search-ring';
      ring.innerHTML = `
        <div class="talk-search-ring-bg"></div>
        <div class="talk-search-ring-spin"></div>
        <div class="talk-search-ring-glow"></div>
        <div class="talk-search-ring-icon">🌐</div>`;
      spinner.replaceWith(ring);
    }

    /* Queue info + tip — insert after .match-badge */
    const badge = qs('.match-badge', card);
    if (badge) {
      const queueRow = document.createElement('div');
      queueRow.className = 'talk-match-queue';
      queueRow.innerHTML = `<span class="talk-match-queue-dot"></span><span>Searching live queue…</span>`;

      const tip = document.createElement('div');
      tip.className = 'talk-match-tip';
      tip.innerHTML = `<span id="talk-match-tip-text">${MATCH_TIPS[0]}</span>`;

      badge.insertAdjacentElement('afterend', tip);
      badge.insertAdjacentElement('afterend', queueRow);
    }
  }

  /* CHAT */
  function injectChat() {
    const panel = qs('#pg-chat .chat-panel');
    if (!panel || panel.dataset.talkInjected) return;
    panel.dataset.talkInjected = '1';

    /* Session timer in topbar */
    const actions = qs('#pg-chat .chat-topbar .top-actions');
    if (actions) {
      const timer = document.createElement('div');
      timer.id = 'chat-session-timer';
      timer.textContent = '00:00';
      /* Insert before the first button so it appears left-ish */
      const firstBtn = actions.querySelector('button, .conn-badge');
      firstBtn ? actions.insertBefore(timer, firstBtn) : actions.appendChild(timer);
    }

    /* Extras row (reactions + quick replies) above chat input */
    const chatInput = qs('.chat-input', panel);
    if (chatInput) {
      const extras = document.createElement('div');
      extras.className = 'talk-chat-extras';
      extras.innerHTML = `
        <div class="talk-chat-extras-row">
          <div id="chat-reaction-bar"></div>
        </div>
        <div id="chat-quick-replies"></div>`;
      panel.insertBefore(extras, chatInput);
    }
  }

  /* PROFILE — Talk stats now live inside the dedicated Stats tab.
     Do not inject Talk/activity cards into Posts or Photos. */
  function injectProfileStats() {
    return;
  }

  /* ── Interest chips (built once per lobby visit) ────────────────────────── */
  function buildInterestChips() {
    const wrap = $('talk-interest-chips');
    if (!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';

    const shuffled = [...INTEREST_CHIPS].sort(() => Math.random() - .5).slice(0, 8);
    wrap.innerHTML = shuffled
      .map(i => `<button class="talk-interest-chip" type="button" data-interest="${escHTML(i.l)}">${i.e} ${i.l}</button>`)
      .join('');

    const input = $('interest-input');
    wrap.addEventListener('click', e => {
      const chip = e.target.closest('[data-interest]');
      if (!chip || !input) return;
      const val = chip.dataset.interest;
      if (chip.classList.contains('on')) {
        chip.classList.remove('on');
        if (input.value === val) { input.value = ''; input.dispatchEvent(new Event('input')); }
      } else {
        qsa('.talk-interest-chip.on', wrap).forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
        input.value = val;
        input.dispatchEvent(new Event('input'));
      }
      if (window.S) window.S.interest = input.value;
    });

    /* Keep chips in sync when user types manually */
    input?.addEventListener('input', () => {
      const v = input.value.toLowerCase();
      qsa('.talk-interest-chip', wrap).forEach(c =>
        c.classList.toggle('on', c.dataset.interest.toLowerCase() === v)
      );
    });
  }

  /* ── Quick replies (built fresh each chat visit) ────────────────────────── */
  function buildQuickReplies() {
    const wrap = $('chat-quick-replies');
    if (!wrap) return;
    wrap.dataset.built = '1'; /* allow rebuild on next chat */

    const sample = [...QUICK_REPLIES].sort(() => Math.random() - .5).slice(0, 5);
    wrap.innerHTML = sample
      .map(r => `<button class="chat-qr-chip" type="button">${escHTML(r)}</button>`)
      .join('');

    // Bind exactly once; rebuilding the chips must not stack listeners.
    if (!wrap.dataset.mortaliveQuickReplyBound) {
      wrap.dataset.mortaliveQuickReplyBound = '1';
      wrap.addEventListener('click', e => {
        const chip = e.target.closest('.chat-qr-chip');
        if (!chip) return;
        const cin = $('cin');
        if (cin) { cin.value = chip.textContent; cin.focus(); }
      });
    }
  }

  /* ── Emoji reactions ────────────────────────────────────────────────────── */
  function buildReactionBar() {
    const bar = $('chat-reaction-bar');
    if (!bar || bar.dataset.built) return;
    bar.dataset.built = '1';

    bar.innerHTML = REACTIONS
      .map(r => `<button class="chat-rx-btn" type="button" title="${r}">${r}</button>`)
      .join('');

    bar.addEventListener('click', e => {
      const btn = e.target.closest('.chat-rx-btn');
      if (!btn) return;
      const emoji = btn.textContent.trim();

      /* Floating animation from button position */
      const rect = btn.getBoundingClientRect();
      const el   = document.createElement('div');
      el.className = 'talk-float-emoji';
      el.textContent = emoji;
      el.style.cssText = `left:${rect.left + rect.width / 2 - 14}px;top:${rect.top}px;`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1700);

      /* Send the emoji as a chat message */
      const S = getS();
      if (S.roomId && S.socket?.connected) {
        S.socket.emit('chat', { roomId: S.roomId, text: emoji });
      } else if (S.syntheticActive || S.stranger?.isBot) {
        window.appendMsg?.(emoji, 'me');
      }
    });
  }

  /* ── Patch rating submit to persist star in session history ─────────────── */
  function patchRatingSubmit() {
    const btn = $('btn-submit-rating');
    if (!btn || btn.dataset.talkPatched) return;
    btn.dataset.talkPatched = '1';

    btn.addEventListener('click', () => {
      const litStar = qs('#stars .star.lit:last-of-type');
      if (!litStar) return;
      const rating = parseInt(litStar.dataset.v, 10);
      if (!Number.isFinite(rating)) return;
      const raw = TalkStore.load();
      if (raw.sessions?.length) { raw.sessions[0].rating = rating; TalkStore.save(raw); }
    }, { capture: true });
  }

  /* ── Page lifecycle ─────────────────────────────────────────────────────── */

  /* Track which page we just left so we can record chat sessions */
  let _prevPage = null;

  let _talkPagehideRecorded = false;
  function recordTalkSessionOnPagehide() {
    if (_talkPagehideRecorded) return;
    const S = getS();
    if (!$('pg-chat')?.classList.contains('active')) return;
    const elapsed = _timerStart ? Math.floor((Date.now() - _timerStart) / 1000) : _timerSecs;
    if (elapsed <= 8) return;
    const st = S.stranger || {};
    const peerId = (!st.isGuest && !st.isBot && !st.isSynthetic && st.userId && st.userId !== S.userId)
      ? st.userId : null;
    TalkStore.record({
      peer: st.name || 'Stranger',
      emoji: st.emoji || '👤',
      mode: S.mode || 'text',
      durationSec: elapsed,
      rating: null,
      skipped: false,
      userId: peerId
    });
    _talkPagehideRecorded = true;
    return true;
  }

  window.__mortaliveRecordTalkBeforeDisconnect = recordTalkSessionOnPagehide;
  window.addEventListener('pagehide', recordTalkSessionOnPagehide, { passive: true });
  window.addEventListener('beforeunload', recordTalkSessionOnPagehide, { passive: true });

  function onPageActivated(id) {
    /* Record a session when leaving the chat page */
    if (_prevPage === 'pg-chat' && id !== 'pg-chat') {
      const elapsed = stopTimer();
      if (elapsed > 8 && !_talkPagehideRecorded) {
        const S  = getS();
        const st = S.stranger || {};
        const peerId = (!st.isGuest && !st.isBot && !st.isSynthetic && st.userId && st.userId !== S.userId)
          ? st.userId : null;
        TalkStore.record({
          peer:        st.name  || 'Stranger',
          emoji:       st.emoji || '👤',
          mode:        S.mode   || 'text',
          durationSec: elapsed,
          rating:      null,
          skipped:     id === 'pg-match',
          userId:      peerId
        });
        if (peerId) {
          _eligibleContactsCache = null;
          _eligibleContactsFetchedAt = 0;
        }
      }
    }
    _prevPage = id;

    if (id === 'pg-lobby') {
      setTimeout(() => {
        injectLobby();
        buildInterestChips();
        syncModeCards();
        refreshLiveBar();
        refreshLobbyStats();
        refreshModeCardCounts();
      }, 60);
    }

    if (id === 'pg-match') {
      stopTips();
      setTimeout(() => { injectMatch(); startTips(); }, 80);
    } else {
      stopTips();
    }

    if (id === 'pg-chat') {
      _talkPagehideRecorded = false;
      setTimeout(() => {
        injectChat();
        buildQuickReplies();
        buildReactionBar();
        startTimer();
      }, 80);
    }

    if (id === 'pg-profile') {
      setTimeout(() => {
        injectProfileStats();
        renderProfileStatsPanel();
        renderProfileTalkStats();
      }, 200);
    }
  }

  /* MutationObserver on .page elements — fires whenever .active changes */
  function watchPages() {
    const obs = new MutationObserver(mutations => {
      mutations.forEach(m => {
        if (m.type !== 'attributes') return;
        const page = m.target;
        if (!page.classList.contains('page')) return;
        if (page.classList.contains('active')) onPageActivated(page.id);
      });
    });
    document.querySelectorAll('.page').forEach(p =>
      obs.observe(p, { attributes: true, attributeFilter: ['class'] })
    );
  }

  /* ── Periodic refresh ───────────────────────────────────────────────────── */
  setInterval(() => {
    refreshLiveBar();
    refreshModeCardCounts();
    syncModeCards();
    if ($('pg-lobby')?.classList.contains('active')) refreshLobbyStats();
  }, 9000);

  /* ── Auth state hook (app.js fires this after login/logout) ────────────── */
  window.addEventListener('mortalive-auth-state', () => {
    setTimeout(() => {
      refreshLobbyStats();
      refreshLiveBar();
      if ($('pg-profile')?.classList.contains('active')) renderProfileTalkStats();
    }, 180);
  });

  /* ── Bootstrap ──────────────────────────────────────────────────────────── */
  function boot() {
    watchPages();
    patchRatingSubmit();

    const activePage = document.querySelector('.page.active');
    if (activePage) { _prevPage = activePage.id; onPageActivated(activePage.id); }

    console.log('[TalkEnhance v20] Ready ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 130), { once: true });
  } else {
    setTimeout(boot, 130); /* give app.js its head start */
  }

})();


// ── Profile/Reels enhancement layer (v27) ───────────────────────────────────
function collectAvailableReels(source = _profilePosts) {
  const pool = Array.isArray(source) ? source.filter(p => p?.post_type === 'reel' && p.media_url) : [];
  const byId = new Map(pool.map(p => [p.id, p]));
  return Array.from(byId.values());
}

function renderProfileReels(posts = _profilePosts) {
  const grid = $('profile-reels-grid');
  const count = $('profile-reel-count');
  if (!grid) return;
  const reels = collectAvailableReels(posts);
  if (count) count.textContent = reels.length.toLocaleString();
  if (!reels.length) {
    grid.innerHTML = `
      <div class="reels-empty-state">
        <div class="reels-empty-icon">🎬</div>
        <div class="reels-empty-title">No reels yet</div>
        <div class="reels-empty-sub">Share a short video and let people discover your moment.</div>
        ${!S.profileViewUserId ? '<button class="reels-empty-cta" type="button" data-reel-upload-cta>+ Upload reel</button>' : ''}
      </div>`;
    return;
  }
  grid.innerHTML = reels.map((p, i) => {
    const caption = String(p.content || '').trim();
    return `<button type="button" class="reel-thumb" data-reel-post-id="${sanitizeHTML(p.id)}" aria-label="Open reel ${i + 1}">
      <video class="reel-thumb-bg" src="${sanitizeHTML(p.media_url)}" muted playsinline preload="metadata"></video>
      <span class="reel-thumb-play">▶</span>
      ${caption ? `<span class="reel-thumb-views">${sanitizeHTML(caption.slice(0,28))}${caption.length>28?'…':''}</span>` : ''}
    </button>`;
  }).join('');
}

function renderProfileStatsPanel() {
  const host = $('profile-stats-panel');
  if (!host) return;
  const publicView = !!S.profileViewUserId;
  const p = publicView ? null : getCurrentProgress();
  const summary = p ? formatProgressLine(p) : null;
  const follow = S.profileViewUserId ? (_followCache.get(S.profileViewUserId) || {followers:0,following:0}) : null;
  const postCount = (_profilePosts || []).filter(p => p?.post_type !== 'reel').length;
  const photoCount = (_profilePosts || []).filter(p => p.media_url && p?.post_type !== 'reel').length;
  const reelCount = collectAvailableReels().length;
  host.innerHTML = `
    <div class="profile-stats-section">
      <div class="profile-stats-section-title">Content</div>
      <div class="profile-stats-row"><span class="profile-stats-key">Text posts</span><strong class="profile-stats-val">${postCount}</strong></div>
      <div class="profile-stats-row"><span class="profile-stats-key">Photos</span><strong class="profile-stats-val">${photoCount}</strong></div>
      <div class="profile-stats-row"><span class="profile-stats-key">Reels</span><strong class="profile-stats-val">${reelCount}</strong></div>
    </div>
    <div class="profile-stats-section">
      <div class="profile-stats-section-title">Profile</div>
      <div class="profile-stats-row"><span class="profile-stats-key">crockroach Score</span><strong class="profile-stats-val">${toNum(S.profileViewData?.crockroach_score ?? summary?.score).toLocaleString()}</strong></div>
      <div class="profile-stats-row"><span class="profile-stats-key">Followers</span><strong class="profile-stats-val">${toNum(follow?.followers ?? _followCache.get(S.userId)?.followers).toLocaleString()}</strong></div>
      <div class="profile-stats-row"><span class="profile-stats-key">Following</span><strong class="profile-stats-val">${toNum(follow?.following ?? _followCache.get(S.userId)?.following).toLocaleString()}</strong></div>
      <div class="profile-stats-row"><span class="profile-stats-key">Streak</span><strong class="profile-stats-val">${publicView ? '—' : `${toNum(summary?.streak)}d`}</strong></div>
      <div class="profile-stats-row"><span class="profile-stats-key">Weekly rank</span><strong class="profile-stats-val">${publicView ? '—' : `#${toNum(summary?.rank)}`}</strong></div>
    </div>
    <div class="profile-stats-section profile-talk-stats-host-section">
      <div id="profile-talk-stats"></div>
    </div>`;
  if (typeof window.renderProfileTalkStats === 'function') window.renderProfileTalkStats();
  enforceProfileSectionSeparation();
  enforceSingleProfileTabPanel($('profile-stats-panel')?.classList.contains('active') ? 'stats' : 'posts');
}

function initProfileTabs() {
  enforceProfileSectionSeparation();
  const bar = $('profile-tabs-bar');
  const page = $('pg-profile');
  if (!bar || !page) return;
  const syncStickyHeight = () => {
    const sticky = page.querySelector('.modern-profile-card.profile-top-sticky');
    if (sticky) page.style.setProperty('--profile-sticky-height', `${Math.ceil(sticky.getBoundingClientRect().height)}px`);
  };
  syncStickyHeight();
  enforceSingleProfileTabPanel(bar.querySelector('.profile-tab-btn.active')?.dataset.profileTab || 'posts');
  if (!bar.dataset.bound) {
    bar.dataset.bound = '1';
    window.addEventListener('resize', syncStickyHeight, { passive: true });
    $('profile-open-grid')?.addEventListener('click', () => {
      const strip = $('profile-post-strip');
      const btn = $('profile-open-grid');
      if (!strip || !btn) return;
      const expanded = strip.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      btn.textContent = expanded ? 'Collapse grid ↙' : 'Open grid ↗';
      if (expanded) strip.scrollLeft = 0;
    });
    bar.addEventListener('click', (event) => {
      const btn = event.target.closest('.profile-tab-btn');
      if (!btn) return;
      const tab = btn.dataset.profileTab;
      bar.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      page.querySelectorAll('.profile-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.profilePanel === tab);
      });
      page.dataset.profileActivePanel = tab;
      page.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
      if (tab === 'reels') renderProfileReels(_profilePosts);
      if (tab === 'stats') renderProfileStatsPanel();
    });
  }
  if (!bar.querySelector('.profile-tab-btn.active')) bar.querySelector('.profile-tab-btn[data-profile-tab="posts"]')?.classList.add('active');
}
function refreshProfileTabCounts(posts = _profilePosts) {
  const sets = {
    posts: (posts || []).filter(p => p?.post_type !== 'reel').length,
    photos: (posts || []).filter(p => p.media_url && p?.post_type !== 'reel').length,
    reels: collectAvailableReels(posts).length
  };
  Object.entries(sets).forEach(([key, value]) => {
    const el = document.querySelector(`.profile-tab-btn[data-profile-tab="${key}"] .tab-count`);
    if (el) el.textContent = value;
  });
}

function refreshProfileTabs(posts = _profilePosts) {
  enforceProfileSectionSeparation();
  initProfileTabs();
  refreshProfileTabCounts(posts);
  renderProfileReels(posts);
  renderProfileStatsPanel();
}

function ensureReelViewer() {
  let viewer = $('reel-viewer');
  if (viewer) return viewer;
  viewer = document.createElement('div');
  viewer.id = 'reel-viewer';
  viewer.setAttribute('aria-hidden','true');
  viewer.innerHTML = `
    <div class="rv-progress"><div class="rv-progress-fill"></div></div>
    <div class="rv-topbar"><div class="rv-topbar-title">Reels</div><button class="rv-topbar-btn" type="button" data-reel-close aria-label="Close">×</button></div>
    <div class="rv-video-wrap">
      <video id="rv-video" playsinline preload="metadata"></video>
      <button class="rv-tap-area" type="button" aria-label="Play or pause"></button>
      <div class="rv-pause-flash">▶</div>
      <button class="rv-nav-btn rv-nav-prev" type="button" data-reel-prev aria-label="Previous reel">‹</button>
      <button class="rv-nav-btn rv-nav-next" type="button" data-reel-next aria-label="Next reel">›</button>
      <button class="rv-mute-badge" type="button" data-reel-mute aria-label="Toggle mute">🔇</button>
      <div class="rv-sidebar">
        <button class="rv-action-btn" type="button" data-reel-action="like"><span class="rv-action-icon">♡</span><span class="rv-action-label">Like</span></button>
        <button class="rv-action-btn" type="button" data-reel-action="comment"><span class="rv-action-icon">💬</span><span class="rv-action-label">Comment</span></button>
        <button class="rv-action-btn" type="button" data-reel-action="follow"><span class="rv-action-icon">＋</span><span class="rv-action-label">Follow</span></button>
        <button class="rv-action-btn" type="button" data-reel-action="share"><span class="rv-action-icon">↗</span><span class="rv-action-label">Share</span></button>
      </div>
      <div class="rv-bottom">
        <div class="rv-author-row"><div class="rv-author-avatar" id="rv-author-avatar"></div><div><div class="rv-author-name" id="rv-author-name"></div><div class="rv-author-handle" id="rv-author-handle"></div></div></div>
        <div class="rv-caption" id="rv-caption"></div>
        <div class="rv-duration-badge" id="rv-duration"></div>
      </div>
      <div class="rv-loading" id="rv-loading"><div class="rv-loading-spinner"></div></div>
      <div class="rv-comments-sheet" id="rv-comments-sheet">
        <div class="rv-comments-handle"></div><div class="rv-comments-title" id="rv-comments-title">Comments</div>
        <div class="rv-comments-list" id="rv-comments-list"></div>
        <div class="rv-comment-input-row"><input class="rv-comment-input" id="rv-comment-input" maxlength="300" placeholder="Add a comment…"><button class="rv-comment-send" type="button" id="rv-comment-send">Send</button></div>
      </div>
    </div>`;
  document.body.appendChild(viewer);
  let current = [];
  let index = 0;

  const render = async () => {
    current = Array.isArray(viewer._mortaliveReelCollection) ? viewer._mortaliveReelCollection : current;
    index = Number.isInteger(viewer._mortaliveReelIndex) ? viewer._mortaliveReelIndex : index;
    const post = current[index];
    if (!post) return;
    const video = $('rv-video');
    const loading = $('rv-loading');
    loading?.classList.add('show');
    video.pause();
    video.src = post.media_url;
    video.load();
    const author = getPostViewerAuthor(post);
    const avatar = $('rv-author-avatar');
    if (avatar) {
      avatar.innerHTML = buildPostViewerAvatar(author, 40);
    }
    $('rv-author-name').textContent = author.display_name || author.username || 'Member';
    $('rv-author-handle').textContent = `@${author.username || 'member'}`;
    $('rv-caption').innerHTML = renderHashtagRichText(String(post.content || '').trim());
    $('rv-duration').textContent = post.media_size ? `${Math.max(1, Math.round(post.media_size / 1024 / 1024))} MB` : 'Reel';
    const eng = engagementFor(post.id);
    const likeBtn = viewer.querySelector('[data-reel-action="like"]');
    likeBtn?.classList.toggle('liked', !!eng.liked);
    likeBtn?.querySelector('.rv-action-icon')?.replaceChildren(document.createTextNode(eng.liked ? '♥' : '♡'));
    const followBtn = viewer.querySelector('[data-reel-action="follow"]');
    if (followBtn) {
      const fd = post.user_id && post.user_id !== S.userId ? await fetchFollowData(post.user_id) : {isFollowing:false};
      followBtn.style.display = post.user_id === S.userId ? 'none' : 'flex';
      followBtn.querySelector('.rv-action-icon').textContent = fd.isFollowing ? '✓' : '＋';
      followBtn.querySelector('.rv-action-label').textContent = fd.isFollowing ? 'Following' : 'Follow';
      followBtn.dataset.followState = fd.isFollowing ? '1' : '0';
    }
    const comments = await loadPostComments(post.id);
    $('rv-comments-title').textContent = `${comments.length} comments`;
    $('rv-comments-list').innerHTML = postViewerCommentRows(comments).replaceAll('mortalive-post-viewer-comment','rv-comment-item').replaceAll('mortalive-post-viewer-comment-copy','rv-comment-body').replaceAll('mortalive-post-viewer-comment-head','rv-comment-author').replaceAll('mortalive-post-viewer-comment-text','rv-comment-text');
    $('rv-comments-sheet').classList.remove('open');
    video.onloadeddata = () => loading?.classList.remove('show');
    video.ontimeupdate = () => {
      const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
      viewer.querySelector('.rv-progress-fill').style.width = `${pct}%`;
    };
    video.onended = () => {
      if (index < current.length - 1) { index += 1; viewer._mortaliveReelIndex=index; render(); } else video.currentTime = 0;
    };
    try { await video.play(); } catch (_) {}
    viewer.querySelector('[data-reel-prev]').disabled = index <= 0;
    viewer.querySelector('[data-reel-next]').disabled = index >= current.length - 1;
  };

  viewer._mortaliveRenderReel = render;
  viewer.addEventListener('click', async (e) => {
    if (e.target.closest('[data-reel-close]')) { viewer.classList.remove('open'); viewer.setAttribute('aria-hidden','true'); document.body.style.overflow=''; return; }
    if (e.target.closest('[data-reel-prev]')) { if (index>0){ index--; viewer._mortaliveReelIndex=index; render(); } return; }
    if (e.target.closest('[data-reel-next]')) { if(index<current.length-1){ index++; viewer._mortaliveReelIndex=index; render(); } return; }
    if (e.target.closest('.rv-tap-area')) {
      const v=$('rv-video'); if(v.paused){ try{await v.play();}catch(_){}} else v.pause();
      return;
    }
    if (e.target.closest('[data-reel-mute]')) {
      const v=$('rv-video'); v.muted=!v.muted; e.target.textContent=v.muted?'🔇':'🔊'; return;
    }
    const action=e.target.closest('[data-reel-action]'); if(!action) return;
    current = Array.isArray(viewer._mortaliveReelCollection) ? viewer._mortaliveReelCollection : current; index = Number.isInteger(viewer._mortaliveReelIndex) ? viewer._mortaliveReelIndex : index; const post=current[index];
    if (!post) return;
    if (action.dataset.reelAction==='like'){ await togglePostLike(post.id); render(); }
    if (action.dataset.reelAction==='comment'){ $('rv-comments-sheet').classList.toggle('open'); }
    if (action.dataset.reelAction==='share'){
      const url=`${location.origin}${location.pathname}#feed-post-${encodeURIComponent(post.id)}`;
      navigator.clipboard?.writeText(url).then(()=>toast('Reel link copied','📋')).catch(()=>toast(url,'🔗'));
    }
    if (action.dataset.reelAction==='follow' && post.user_id && post.user_id!==S.userId){
      const fd=await fetchFollowData(post.user_id); const next=!fd.isFollowing;
      try{ await toggleFollow(post.user_id,next); render(); toast(next?'Following!':'Unfollowed',next?'✓':'➖'); }catch(err){toast(err?.message||'Could not update follow.','⚠️');}
    }
  });
  $('rv-comment-send')?.addEventListener('click', async ()=>{
    const post=current[index], input=$('rv-comment-input'); const content=input?.value?.trim();
    if(!post||!content) return;
    input.value='';
    await createPostComment(post.id,content);
    await render();
  });
  viewer.querySelector('[data-reel-close]')?.addEventListener('click',()=>{viewer.classList.remove('open');viewer.setAttribute('aria-hidden','true');document.body.style.overflow='';});
  return viewer;

  // Unreachable? kept below intentionally no
}
function openReelViewer(post, collection = []) {
  if (S.isGuest || !S.userId) { toast('Sign in to view reels', '🔒'); return; }
  const viewer = ensureReelViewer();
  const all = Array.isArray(collection) && collection.length ? collection : [post];
  const ids = all.map(p => p.id);
  const start = Math.max(0, ids.indexOf(post.id));
  viewer._mortaliveReelCollection = all;
  viewer._mortaliveReelIndex = start;
  // trigger renderer stored on the viewer
  viewer._mortaliveRenderReel?.();
  viewer.classList.add('open');
  viewer.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}
function bindReelNavigationClicks() {
  // delegated grid/feed opening
  if (document.body.dataset.reelOpenBound) return;
  document.body.dataset.reelOpenBound='1';
  document.addEventListener('click', event => {
    const tile = event.target.closest?.('[data-reel-post-id]');
    if (!tile) return;
    event.preventDefault();
    const id = tile.dataset.reelPostId;
    const post = getPostByIdForViewer(id) || _profilePosts.find(p=>p.id===id);
    if (post?.media_url && post.post_type === 'reel') {
      const collection = document.body.classList.contains('profile-viewing-public') ? collectAvailableReels(_profilePosts) : collectAvailableReels(_profilePosts);
      openReelViewer(post, collection);
    }
  });
}
bindReelNavigationClicks();

document.addEventListener('click', (event) => {
  const cta = event.target.closest?.('[data-reel-upload-cta]');
  if (!cta || S.profileViewUserId) return;
  showPage('pg-feed');
  setTimeout(() => {
    setFeedComposerKind?.('reel');
    setTimeout(() => $('feed-reel-input')?.click(), 0);
  }, 60);
});

/* ── FINAL PROFILE INTERACTION PATCH ───────────────────────────────────────
   Keeps the three-dot menu above the profile action buttons and makes the
   profile links render horizontally without changing the existing markup.
   Also reinforces pointer-events on the visible Edit/Share controls because
   the profile page has several historical overlay/stacking rules. */
// The profile buttons stay boringly reliable.
// ── Final profile action binding ─────────────────────────────────────────────
// Direct target handlers plus a capture fallback keep the visible profile
// actions functional even when ancestor/profile-menu listeners intercept clicks.
(function installDirectProfileActionBinding() {
  'use strict';
  const BOUND = 'mortaliveDirectProfileActionBound';

  function bind() {
    const edit = document.getElementById('btn-edit-profile');
    const share = document.getElementById('btn-share-profile');

    if (edit && !edit.dataset[BOUND]) {
      edit.dataset[BOUND] = '1';
      edit.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        toggleProfileEditMode();
      };
    }

    if (share && !share.dataset[BOUND]) {
      share.dataset[BOUND] = '1';
      share.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        shareCurrentProfile();
      };
    }
  }

  function boot() {
    bind();
    const root = document.documentElement;
    if (root && !root.dataset.mortaliveProfileActionCaptureBound) {
      root.dataset.mortaliveProfileActionCaptureBound = '1';
      root.addEventListener('click', (event) => {
        const target = event.target?.closest?.('#btn-edit-profile, #btn-share-profile');
        if (!target) return;
        if (!document.getElementById('pg-profile')?.classList.contains('active')) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (target.id === 'btn-edit-profile') toggleProfileEditMode();
        else shareCurrentProfile();
      }, true);
    }
    const page = document.getElementById('pg-profile');
    if (page && !page.dataset.mortaliveProfileActionObserver) {
      page.dataset.mortaliveProfileActionObserver = '1';
      const observer = new MutationObserver(bind);
      observer.observe(page, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

(function installFinalProfileInteractionPatch() {
  'use strict';

  const STYLE_ID = 'mortalive-final-profile-interaction-patch';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Profile action hit targets */
      #pg-profile .profile-identity,
      #pg-profile .profile-actions-modern {
        position: relative !important;
        z-index: 40 !important;
      }
      #pg-profile #btn-edit-profile,
      #pg-profile #btn-share-profile,
      #pg-profile #btn-follow-user {
        position: relative !important;
        z-index: 60 !important;
        pointer-events: auto !important;
        touch-action: manipulation;
        cursor: pointer !important;
      }

      /* Menu gets its own higher stacking layer and cannot sit behind the
         identity/action row. */
      #pg-profile .profile-topline,
      #pg-profile .profile-menu-wrap {
        position: relative !important;
        z-index: 200 !important;
      }
      #pg-profile #btn-profile-menu {
        position: relative !important;
        z-index: 201 !important;
        pointer-events: auto !important;
      }
      #pg-profile #profile-menu {
        position: absolute !important;
        z-index: 9999 !important;
        pointer-events: auto !important;
      }

      /* Social/user links: horizontal, wrapping chips instead of a vertical
         stack. */
      #pg-profile #profile-info-links-val {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 7px 10px !important;
        min-width: 0;
      }
      #pg-profile #profile-info-links-val .profile-info-link {
        display: inline-flex !important;
        align-items: center !important;
        max-width: min(280px, 100%) !important;
        white-space: nowrap !important;
      }

      @media (max-width: 840px) {
        #pg-profile .profile-actions-modern {
          z-index: 60 !important;
        }
        #pg-profile .profile-topline,
        #pg-profile .profile-menu-wrap {
          z-index: 200 !important;
        }
        #pg-profile #profile-menu {
          top: 46px !important;
          right: 0 !important;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function reinforceProfileActions() {
    const page = document.getElementById('pg-profile');
    if (!page) return;
    ['btn-edit-profile', 'btn-share-profile', 'btn-follow-user', 'btn-profile-menu', 'btn-profile-copy'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.style.position = 'relative';
    });
    const links = document.getElementById('profile-info-links-val');
    if (links) {
      links.style.display = 'flex';
      links.style.flexDirection = 'row';
      links.style.flexWrap = 'wrap';
      links.style.alignItems = 'center';
      links.style.gap = '7px 10px';
    }
  }

  function boot() {
    installStyle();
    reinforceProfileActions();
    const observer = new MutationObserver(() => reinforceProfileActions());
    const profile = document.getElementById('pg-profile');
    if (profile) observer.observe(profile, { childList: true, subtree: true });
    window.addEventListener('resize', reinforceProfileActions, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

// V128: Talk state machine — real-user first → 30-second priority window → synthetic fallback → indefinite cycle.
// No automatic lobby resume. No exhaustion popup. No session cap.
// Synthetic is a fallback experience, not a session limit. Real users always have priority.
// Search snapshots every 2 s (searchSessionId grouping). Connected snapshots every 4 frames (roomId grouping).

// ─────────────────────────────────────────────────────────────────────────────
// V124 HARD GUARD — retired Talk exhaustion/connect-more popup
// This is intentionally defensive: older cached/deployed code may have left
// an overlay function or DOM node behind. The current Talk flow must never
// show the old "You've seen 10 videos" / "connected with X people" popup.
// ─────────────────────────────────────────────────────────────────────────────
(function installTalkPopupRetirementGuard() {
  const LEGACY_IDS = new Set([
    'synthetic-exhaustion-overlay',
    'syn-connect-more-overlay',
    'talk-options-popup',
    'talk-options-overlay',
    'syn-share-overlay'
  ]);

  function removeLegacyTalkPopups(root = document) {
    LEGACY_IDS.forEach((id) => {
      root.querySelector?.(`#${id}`)?.remove();
    });

    root.querySelectorAll?.('.overlay.open, .modal').forEach((el) => {
      const text = String(el.textContent || '').toLowerCase();
      if (
        text.includes("you've seen 10 videos") ||
        text.includes('watch 10 more videos') ||
        text.includes('you have successfully connected with') ||
        text.includes('mortalive is growing rapidly')
      ) {
        el.closest('.overlay')?.remove();
        if (!el.closest('.overlay')) el.remove();
      }
    });
  }

  // Override legacy global entry points if an older build exposed them.
  try { window.showTalkOptionsPopup = () => false; } catch (_) {}
  try { window.showSyntheticExhaustionMenu = () => false; } catch (_) {}
  try { window.showConnectMoreOverlay = () => false; } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => removeLegacyTalkPopups(), { once: true });
  } else {
    removeLegacyTalkPopups();
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes || []) {
        if (node.nodeType === 1) removeLegacyTalkPopups(node);
      }
    }
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();

// v123: snapshot grouping uses a stable solo-search session id, then the real room id after matching.

// v128: synthetic Talk fallback cycles indefinitely, shuffles inventory, and gives real users a 30-second priority window after each synthetic completion/skip.

// v126: synthetic-skip always gets a 10-second real-user priority window before the next synthetic.


// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGING DB PATCH v43 — aligned to production messages schema
// Production schema:
//   messages(id BIGINT, room_id, sender_hash, direction, content, created_at)
//   message_rooms(room_id, type, name, description, ...)
//   message_room_members(room_id, user_id, role, archived, muted, pinned, ...)
//   message_requests(sender_id, recipient_id, message, status, ...)
// No separate group_messages table.
// ═══════════════════════════════════════════════════════════════════════════════
(function installMessagingDatabasePatchV42() {
  'use strict';
  if (typeof window === 'undefined') return;

  const M42 = {
    initialized: false,
    searchTimer: null,
    searchSeq: 0,
    realtime: null,
    ownSenderHash: null,
    selectedProfiles: new Map()
  };

  const msgToast = (text, icon = '💬') => {
    try { toast(text, icon); } catch (_) { console.warn('[Messages]', text); }
  };

  const ownHash = async () => {
    if (M42.ownSenderHash) return M42.ownSenderHash;
    const raw = `mortalive:${String(S.userId || '')}`;
    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(raw);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      M42.ownSenderHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Deterministic fallback for environments without SubtleCrypto.
      let h = 2166136261;
      for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
      M42.ownSenderHash = `fnv1a:${(h >>> 0).toString(16)}`;
    }
    return M42.ownSenderHash;
  };

  const normalizeRoom = (row) => ({
    id: row.room_id,
    type: row.type === 'group' ? 'group' : 'direct',
    name: row.name || '',
    description: row.description || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    emoji: row.type === 'group' ? '👥' : '👤',
    members: [],
    archived: !!row.archived,
    muted: !!row.muted,
    pinned: !!row.pinned,
    unread: 0,
    role: row.role || 'member'
  });

  function ensureMessageSearchButton() {
    const head = document.querySelector('#pg-messages .sidebar-header-top');
    if (!head || document.getElementById('btn-new-message')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-new-message';
    btn.className = 'messages-new-group-btn';
    btn.type = 'button';
    btn.title = 'Find any Mortalive user';
    btn.setAttribute('aria-label', 'Find any Mortalive user');
    btn.innerHTML = '<span style="font-size:17px;line-height:1;">✉</span>';
    btn.addEventListener('click', openRandomUserMessageModal);
    head.querySelector('#btn-new-group')?.before(btn);
  }

  function ensureEmptyFindButton() {
    const empty = $('msg-thread-empty');
    if (!empty || empty.querySelector('[data-m42-find-user]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'messages-cta-btn';
    b.dataset.m42FindUser = '1';
    b.textContent = 'Find someone';
    b.addEventListener('click', openRandomUserMessageModal);
    const groupBtn = $('btn-empty-new-group');
    groupBtn?.parentElement?.appendChild(b);
  }

  function ensureRandomUserModal() {
    let overlay = $('m42-user-search-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'm42-user-search-overlay';
    overlay.className = 'messages-modal-overlay';
    overlay.innerHTML = `
      <div class="messages-modal" style="max-width:560px;">
        <div class="messages-modal-header">
          <h2>Find someone</h2>
          <button type="button" class="messages-modal-close" data-m42-close>×</button>
        </div>
        <div class="messages-modal-form">
          <div class="form-field">
            <label for="m42-user-search">Search any username</label>
            <input id="m42-user-search" type="text" maxlength="24" autocomplete="off" placeholder="@username or display name…">
            <span class="form-field-hint">Follow relationship is not required. Select up to 10 people for message requests.</span>
          </div>
          <div id="m42-selected-users" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
          <div id="m42-user-results" style="max-height:300px;overflow:auto;"></div>
          <div class="form-actions">
            <button type="button" class="form-btn form-btn-secondary" data-m42-close>Cancel</button>
            <button type="button" class="form-btn form-btn-primary" id="m42-send-invites" disabled>Send invites</button>
          </div>
        </div>
      </div>`;
    // Keep the dynamically-created modal inside the Messages page so the
    // production #pg-messages modal styles apply. Appending this overlay to
    // <body> leaves it unstyled because the stylesheet scopes these classes
    // under #pg-messages.
    const messagePage = $('pg-messages') || document.body;
    messagePage.appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-m42-close]')) closeRandomUserMessageModal();
    });

    overlay.querySelector('#m42-send-invites')?.addEventListener('click', sendRandomUserInvites);
    overlay.querySelector('#m42-user-search')?.addEventListener('input', e => {
      clearTimeout(M42.searchTimer);
      const query = String(e.target.value || '').trim().replace(/^@/, '');
      const seq = ++M42.searchSeq;
      if (query.length < 2) {
        renderRandomUserResults([]);
        return;
      }
      M42.searchTimer = setTimeout(async () => {
        if (seq !== M42.searchSeq) return;
        try {
          const { data, error } = await sb
            .from('accounts')
            .select('id,username,display_name,avatar_url,crockroach_score')
            .neq('id', S.userId)
            .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
            .order('username', { ascending: true })
            .limit(20);
          if (seq !== M42.searchSeq) return;
          if (error) throw error;
          renderRandomUserResults(Array.isArray(data) ? data : []);
        } catch (err) {
          console.warn('[Messages] random user search failed:', err?.message || err);
          const box = $('m42-user-results');
          if (box) box.innerHTML = '<div class="form-field-hint">Search is unavailable right now.</div>';
        }
      }, 220);
    });

    return overlay;
  }

  function renderSelectedUsers() {
    const wrap = $('m42-selected-users');
    const btn = $('m42-send-invites');
    if (!wrap) return;
    wrap.innerHTML = '';
    M42.selectedProfiles.forEach(u => {
      const chip = document.createElement('span');
      chip.className = 'form-tag';
      chip.innerHTML = `${escapeHtml(u.display_name || u.username || 'User')} <span style="cursor:pointer;" data-m42-remove="${escapeHtml(u.id)}">×</span>`;
      chip.querySelector('[data-m42-remove]')?.addEventListener('click', () => {
        M42.selectedProfiles.delete(u.id);
        renderSelectedUsers();
        renderRandomUserResults();
      });
      wrap.appendChild(chip);
    });
    if (btn) btn.disabled = M42.selectedProfiles.size === 0;
  }

  function renderRandomUserResults(users = null) {
    const box = $('m42-user-results');
    if (!box) return;
    if (Array.isArray(users)) box._m42Users = users;
    const rows = box._m42Users || [];
    const query = $('m42-user-search')?.value?.trim() || '';
    if (!rows.length) {
      box.innerHTML = query.length >= 2
        ? '<div class="form-field-hint">No users found.</div>'
        : '<div class="form-field-hint">Type at least 2 characters to search all Mortalive users.</div>';
      return;
    }
    box.innerHTML = rows.map(u => {
      const id = String(u.id);
      const selected = M42.selectedProfiles.has(id);
      const safeName = escapeHtml(u.display_name || u.username || 'User');
      const safeUser = escapeHtml(u.username || 'user');
      const score = Number(u.crockroach_score || 0);
      return `<button type="button" class="form-member-suggestion" data-m42-user="${escapeHtml(id)}" style="display:flex;align-items:center;gap:10px;width:100%;">
        ${u.avatar_url ? `<img src="${escapeHtml(u.avatar_url)}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">` : '<span style="width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--surface-3,#eef0f4);">👤</span>'}
        <span style="display:flex;flex-direction:column;align-items:flex-start;flex:1;min-width:0;">
          <strong style="font-size:13px;">${safeName}</strong>
          <span style="font-size:11px;opacity:.65;">@${safeUser} · 🧲 ${score.toLocaleString()}</span>
        </span>
        <span>${selected ? '✓' : '+'}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-m42-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = String(btn.dataset.m42User);
        const user = rows.find(u => String(u.id) === id);
        if (!user) return;
        if (M42.selectedProfiles.has(id)) M42.selectedProfiles.delete(id);
        else if (M42.selectedProfiles.size < 10) M42.selectedProfiles.set(id, user);
        else { msgToast('You can invite up to 10 users at a time.', '⚠️'); return; }
        renderSelectedUsers();
        renderRandomUserResults();
      });
    });
  }

  function openRandomUserMessageModal() {
    if (S.isGuest || !S.userId || !sb) {
      msgToast('Sign in to message people.', '🔒');
      return;
    }
    const overlay = ensureRandomUserModal();
    M42.selectedProfiles.clear();
    const input = overlay.querySelector('#m42-user-search');
    if (input) input.value = '';
    const box = overlay.querySelector('#m42-user-results');
    if (box) box._m42Users = [];
    renderSelectedUsers();
    renderRandomUserResults([]);
    overlay.style.display = 'flex';
    input?.focus();
  }

  function closeRandomUserMessageModal() {
    const overlay = $('m42-user-search-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function sendRandomUserInvites() {
    const profiles = Array.from(M42.selectedProfiles.values());
    if (!profiles.length) return;
    const btn = $('m42-send-invites');
    if (btn) btn.disabled = true;
    try {
      const recipientIds = profiles.map(p => p.id).filter(id => id && id !== S.userId);
      if (!recipientIds.length) throw new Error('No valid recipients selected.');

      const { data: existing, error: existingErr } = await sb
        .from('message_requests')
        .select('recipient_id')
        .eq('sender_id', S.userId)
        .eq('status', 'pending')
        .in('recipient_id', recipientIds);

      if (existingErr) throw existingErr;

      const pending = new Set((existing || []).map(r => String(r.recipient_id)));
      const newRecipients = recipientIds.filter(id => !pending.has(String(id)));

      if (!newRecipients.length) {
        closeRandomUserMessageModal();
        msgToast('Those users already have pending invites.', 'ℹ️');
        return;
      }

      for (const recipientId of newRecipients) {
        const { error } = await sb.rpc('send_message_request', {
          p_recipient_id: recipientId,
          p_room_id: null,
          p_message: null
        });
        if (error) throw error;
      }

      // Refresh conversation list so invited users appear as pending
      try {
        await loadDbConversations();
        dbRenderConversationList($('msg-search-input')?.value || '');
      } catch (refreshErr) {
        console.warn('[Messages] refresh after invite failed:', refreshErr);
      }

      closeRandomUserMessageModal();
      msgToast(`${rows.length} invite${rows.length === 1 ? '' : 's'} sent. Check your messages.`, '✓');
    } catch (e) {
      console.error('[Messages] send invites failed:', e);
      msgToast(e?.message || 'Could not send invites.', '⚠️');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadDbConversations() {
    if (S.isGuest || !S.userId || !sb) return;

    // Do not depend on PostgREST's nested-resource relationship cache here.
    // Production projects can have the correct FK while PostgREST's schema
    // cache is temporarily stale, which makes `message_rooms(...)` fail even
    // though both tables are healthy. Read the two tables explicitly.
    const { data: memberships, error: memberErr } = await sb
      .from('message_room_members')
      .select('room_id,role,archived,muted,pinned,joined_at')
      .eq('user_id', S.userId)
      .order('joined_at', { ascending: false });

    if (memberErr) throw memberErr;

    const roomIds = [...new Set((memberships || []).map(m => m.room_id).filter(Boolean).map(String))];
    let roomRows = [];
    if (roomIds.length) {
      const { data, error: roomErr } = await sb
        .from('message_rooms')
        .select('room_id,type,name,description,created_by,created_at,updated_at,last_message_at')
        .in('room_id', roomIds);
      if (roomErr) throw roomErr;
      roomRows = Array.isArray(data) ? data : [];
    }
    const roomMap = new Map(roomRows.map(r => [String(r.room_id), r]));

    const rooms = (memberships || [])
      .map(m => normalizeRoom({ ...(roomMap.get(String(m.room_id)) || {}), room_id: m.room_id, role: m.role, archived: m.archived, muted: m.muted, pinned: m.pinned }))
      .filter(r => r.id);

    const ids = rooms.map(r => r.id);
    const membershipMap = new Map();

    if (ids.length) {
      const { data: members, error } = await sb
        .from('message_room_members')
        .select('room_id,user_id,role')
        .in('room_id', ids);
      if (error) throw error;
      (members || []).forEach(m => {
        const key = String(m.room_id);
        if (!membershipMap.has(key)) membershipMap.set(key, []);
        membershipMap.get(key).push(m);
      });
    }

    const peerIds = [...new Set(
      rooms
        .filter(r => r.type === 'direct')
        .flatMap(r => (membershipMap.get(String(r.id)) || []).map(m => m.user_id))
        .filter(id => id && id !== S.userId)
    )];

    const profileMap = new Map();
    if (peerIds.length) {
      const { data: profiles, error } = await sb
        .from('accounts')
        .select('id,username,display_name,avatar_url,crockroach_score')
        .in('id', peerIds);
      if (error) throw error;
      (profiles || []).forEach(p => profileMap.set(String(p.id), p));
    }

    const lastByRoom = new Map();
    if (ids.length) {
      const { data: lastRows } = await sb
        .from('messages')
        .select('id,room_id,sender_hash,direction,content,created_at')
        .in('room_id', ids)
        .order('created_at', { ascending: false })
        .limit(Math.min(1000, Math.max(100, ids.length * 8)));
      (lastRows || []).forEach(m => {
        const key = String(m.room_id);
        if (!lastByRoom.has(key)) lastByRoom.set(key, m);
      });
    }

    messagesState.conversations = [];
    messagesState.groups = [];
    messagesState.messages = messagesState.messages || {};

    for (const room of rooms) {
      room.members = membershipMap.get(String(room.id)) || [];
      const last = lastByRoom.get(String(room.id));
      room.lastMessage = last?.content || '';
      room.lastAt = last?.created_at || room.updatedAt || room.createdAt;

      if (room.type === 'group') {
        messagesState.groups.push(room);
        continue;
      }

      const peerId = room.members.find(m => String(m.user_id) !== String(S.userId))?.user_id;
      const peer = peerId ? profileMap.get(String(peerId)) : null;
      if (!peer) continue;

      messagesState.conversations.push({
        ...room,
        userId: peer.id,
        username: peer.username || '',
        display_name: peer.display_name || peer.username || 'User',
        avatar_url: peer.avatar_url || null,
        crockroach_score: peer.crockroach_score || 0,
        source: 'message'
      });
    }

    saveMessagesToStorage();
  }

  async function loadDbMessages(roomId, limit = 100) {
    if (!roomId || !sb || S.isGuest) return [];
    const { data, error } = await sb
      .from('messages')
      .select('id,room_id,sender_hash,direction,content,created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;

    const me = await ownHash();
    const rows = Array.isArray(data) ? data : [];
    messagesState.messages[roomId] = rows.map(m => {
      const isMine = String(m.direction || '').toLowerCase() === 'outgoing' || String(m.sender_hash || '') === me;
      return {
        id: m.id,
        text: m.content || '',
        isMe: isMine,
        senderId: isMine ? S.userId : null,
        senderHash: m.sender_hash || '',
        timestamp: new Date(m.created_at),
        time: formatTime(new Date(m.created_at))
      };
    });
    return rows;
  }

  async function createDbGroup(data) {
    // Use provided memberIds if available, otherwise fall back to selectedMembers
    const memberIds = data.memberIds || Array.from(messagesState.selectedMembers || []);
    const ids = memberIds
      .map(v => String(v))
      .filter(id => id && id !== String(S.userId))
      .slice(0, 10);

    const { data: roomId, error } = await sb.rpc('create_message_group', {
      p_name: data.name,
      p_description: data.description || null,
      p_member_ids: ids
    });
    if (error) throw error;
    return String(roomId);
  }

  async function dbHandleMemberSearch(e) {
    const query = String(e?.target?.value || '').trim().replace(/^@/, '');
    const suggestions = $('group-members-suggestions');
    if (!suggestions) return;
    if (query.length < 2) {
      suggestions.innerHTML = '';
      return;
    }

    try {
      const { data, error } = await sb
        .from('accounts')
        .select('id,username,display_name,avatar_url')
        .neq('id', S.userId)
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .order('username', { ascending: true })
        .limit(12);
      if (error) throw error;

      renderMemberProfileSuggestions(Array.isArray(data) ? data : []);

      suggestions.querySelectorAll('[data-member-id]').forEach(el => {
        el.addEventListener('click', () => {
          dbAddMemberTag({
            id: el.dataset.memberId,
            username: el.dataset.memberUsername || '',
            display_name: el.dataset.memberName || el.dataset.memberUsername || 'User'
          });
        });
      });
    } catch (err) {
      suggestions.innerHTML = '<div class="form-field-hint">User search is unavailable right now.</div>';
      console.warn('[Messages] group member search failed:', err?.message || err);
    }
  }

  function dbAddMemberTag(member) {
    if (!member?.id || String(member.id) === String(S.userId)) return;
    const key = String(member.id);
    messagesState.selectedMembers = messagesState.selectedMembers || new Set();
    if (messagesState.selectedMembers.has(key)) return;
    if (messagesState.selectedMembers.size >= 10) {
      msgToast('Groups can add up to 10 members at creation.', '⚠️');
      return;
    }
    messagesState.selectedMembers.add(key);

    const list = $('group-members-list');
    if (!list) return;

    const tag = document.createElement('div');
    tag.className = 'form-tag';
    tag.dataset.memberKey = key;
    tag.innerHTML = `<span>${escapeHtml(member.display_name || member.username || 'User')} <small style="opacity:.62">@${escapeHtml(member.username || '')}</small></span><span class="form-tag-remove">×</span>`;
    tag.querySelector('.form-tag-remove')?.addEventListener('click', () => {
      messagesState.selectedMembers.delete(key);
      tag.remove();
    });
    list.appendChild(tag);

    const input = $('group-members-input');
    if (input) input.value = '';
    const suggestions = $('group-members-suggestions');
    if (suggestions) suggestions.innerHTML = '';
  }

  async function dbHandleCreateGroup(e) {
    e?.preventDefault?.();
    if (S.isGuest || !S.userId || !sb) {
      msgToast('Sign in to create groups.', '🔒');
      return;
    }

    const name = String($('group-name')?.value || '').trim();
    const description = String($('group-desc')?.value || '').trim();
    if (!name) { msgToast('Group name is required.', '⚠️'); return; }
    if (name.length > 60) { msgToast('Group name is too long.', '⚠️'); return; }

    const selectedMemberIds = Array.from(messagesState.selectedMembers || [])
      .filter(id => id && id !== String(S.userId));

    // Separate: contacts (add directly) vs. random users (send invites)
    const contactIds = [];
    const inviteIds = [];
    const existingConvs = new Map((messagesState.conversations || []).map(c => [String(c.id), c]));

    selectedMemberIds.forEach(memberId => {
      if (existingConvs.has(String(memberId))) {
        contactIds.push(memberId); // Already have a conversation = contact → add directly
      } else {
        inviteIds.push(memberId); // No conversation = random user → send invite
      }
    });

    const submit = $('btn-submit-create-group');
    try {
      if (submit) { submit.disabled = true; submit.textContent = 'Creating…'; }

      // Create group with direct contacts; zero direct members is valid.
      const groupId = await createDbGroup({ name, description, memberIds: contactIds });

      // Verify/repair the creator's owner membership so a newly-created group
      // remains visible after refresh on every production deployment.
      const { error: ownerErr } = await sb.rpc('ensure_message_room_owner', {
        p_room_id: groupId
      });
      if (ownerErr) throw ownerErr;

      // Random/non-contact users are invited to this exact group. They are not
      // added as members until they accept the invitation.
      if (inviteIds.length > 0) {
        const inviteRows = inviteIds.map(recipientId => ({
          sender_id: S.userId,
          recipient_id: recipientId,
          room_id: groupId,
          message: `I invited you to join the group "${name}"`,
          status: 'pending',
          created_at: new Date().toISOString()
        }));
        const { error: inviteErr } = await sb.from('message_requests').insert(inviteRows);
        if (inviteErr) throw inviteErr;
      }

      messagesState.selectedMembers = new Set();
      await loadDbConversations();
      dbRenderConversationList($('msg-search-input')?.value || '');
      closeCreateGroupModal();
      await openDbConversation(groupId, 'group');
      
      // Show different messages based on what happened
      if (inviteIds.length > 0) {
        const addedCount = contactIds.length;
        const invitedCount = inviteIds.length;
        msgToast(`Group created. ${addedCount} member${addedCount === 1 ? '' : 's'} added, ${invitedCount} invite${invitedCount === 1 ? '' : 's'} sent.`, '✓');
      } else if (contactIds.length > 0) {
        msgToast('Group created with your contacts.', '✓');
      } else {
        msgToast('Group created. Invites can be sent to members.', '✓');
      }
    } catch (err) {
      console.error('[Messages] create group failed:', err);
      msgToast(err?.message || 'Could not create group.', '⚠️');
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = 'Create group'; }
    }
  }

  async function openDbConversation(roomId, type = null) {
    const all = [...(messagesState.groups || []), ...(messagesState.conversations || [])];
    const conv = all.find(c => String(c.id) === String(roomId));
    if (!conv) return;

    if (!conv.members?.length) {
      await loadDbConversations();
    }

    const fresh = [...(messagesState.groups || []), ...(messagesState.conversations || [])]
      .find(c => String(c.id) === String(roomId)) || conv;

    messagesState.activeConvId = fresh.id;
    messagesState.activeConvType = type || fresh.type;
    messagesState.activePeer = messagesState.activeConvType === 'direct' ? fresh : null;

    if (messagesState.activeConvType === 'group') loadGroupThread(fresh.id);
    else loadDirectThread(fresh);

    try {
      await loadDbMessages(fresh.id);
      if (messagesState.activeConvType === 'group') renderMessages(fresh.id);
      else renderDirectMessages(fresh.id);
    } catch (e) {
      console.warn('[Messages] message load failed:', e?.message || e);
    }
  }

  async function dbSendMessage() {
    const input = $('msg-composer-input');
    if (!input || !messagesState.activeConvId || !S.userId || S.isGuest || !sb) return;
    const text = input.value.trim();
    if (!text) return;
    if (text.length > 1000) { msgToast('Message is too long.', '⚠️'); return; }

    const roomId = messagesState.activeConvId;
    const sendBtn = $('msg-composer-send');

    try {
      if (sendBtn) sendBtn.disabled = true;
      const senderHash = await ownHash();

      const { data, error } = await sb
        .from('messages')
        .insert({
          room_id: roomId,
          sender_hash: senderHash,
          direction: 'outgoing',
          content: text
        })
        .select('id,room_id,sender_hash,direction,content,created_at')
        .single();

      if (error) throw error;

      if (!messagesState.messages[roomId]) messagesState.messages[roomId] = [];
      messagesState.messages[roomId].push({
        id: data.id,
        text: data.content || text,
        isMe: true,
        senderId: S.userId,
        senderHash: data.sender_hash,
        timestamp: new Date(data.created_at),
        time: formatTime(new Date(data.created_at))
      });

      input.value = '';
      input.style.height = 'auto';

      const conv = [...(messagesState.groups || []), ...(messagesState.conversations || [])]
        .find(c => String(c.id) === String(roomId));
      if (conv) {
        conv.lastMessage = text;
        conv.lastAt = data.created_at;
      }

      if (messagesState.activeConvType === 'group') renderMessages(roomId);
      else renderDirectMessages(roomId);

      dbRenderConversationList($('msg-search-input')?.value || '');
      saveMessagesToStorage();
    } catch (err) {
      console.error('[Messages] send failed:', err);
      msgToast(err?.message || 'Could not send message.', '⚠️');
    } finally {
      updateComposerButton();
    }
  }

  function dbRenderConversationList(searchQuery = '') {
    const list = $('msg-conv-list');
    if (!list) return;

    const q = String(searchQuery || '').trim().toLowerCase();
    const groups = (messagesState.groups || [])
      .filter(g => !g.archived && (!q || String(g.name || '').toLowerCase().includes(q)));
    const existingContacts = (messagesState.conversations || [])
      .filter(c => !c.archived && (!q ||
        String(c.display_name || c.username || '').toLowerCase().includes(q) ||
        String(c.username || '').toLowerCase().includes(q)));

    // Also show every contact the user is allowed to message, even when a
    // conversation room has not been created yet. These rows become "Start
    // chat" entries instead of requiring the user to search for them.
    const existingContactIds = new Set(
      (messagesState.conversations || [])
        .map(c => String(c.userId || c.id || ''))
        .filter(Boolean)
    );
    const availableContacts = (messagesState.eligibleContacts || [])
      .filter(c => c?.id && String(c.id) !== String(S.userId))
      .filter(c => !existingContactIds.has(String(c.id)))
      .filter(c => !q ||
        String(c.display_name || c.username || '').toLowerCase().includes(q) ||
        String(c.username || '').toLowerCase().includes(q))
      .map(c => ({
        ...c,
        id: String(c.id),
        userId: String(c.id),
        source: c.source || 'contact',
        isStartChat: true
      }));

    const sortFn = (a, b) => {
      const pinA = a.pinned ? 1 : 0;
      const pinB = b.pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return new Date(b.lastAt || b.updatedAt || 0) - new Date(a.lastAt || a.updatedAt || 0);
    };

    existingContacts.sort(sortFn);
    availableContacts.sort((a, b) => String(a.display_name || a.username || '').localeCompare(String(b.display_name || b.username || '')));

    if (!groups.length && !existingContacts.length && !availableContacts.length) {
      list.innerHTML = `<div class="messages-list-empty">
        <div class="empty-icon">${q ? '🔍' : '💬'}</div>
        <p>${q ? `No conversations found for "${escapeHtml(q)}"` : 'No conversations yet'}</p>
        <p class="empty-hint">${q ? 'Try another name or username.' : 'Use ✉ to find any Mortalive user or + to create a group.'}</p>
      </div>`;
      return;
    }

    list.innerHTML = '';
    groups.forEach(group => {
      const item = createConvItem(group.id, group.name || 'Group', group.emoji || '👥', `${group.members?.length || 1} members · Group`, true);
      list.appendChild(item);
    });

    existingContacts.forEach(contact => {
      const item = createContactConvItem({
        ...contact,
        id: contact.id,
        userId: contact.userId,
        username: contact.username,
        display_name: contact.display_name,
        avatar_url: contact.avatar_url,
        source: 'message'
      });
      list.appendChild(item);
    });

    availableContacts.forEach(contact => {
      const item = document.createElement('div');
      item.className = 'messages-conv-item messages-start-chat-item';
      item.dataset.contactId = String(contact.id);
      item.innerHTML = `
        <div class="messages-conv-ava">
          ${contact.avatar_url
            ? `<img src="${sanitizeHTML(feedAvatarUrl(contact.avatar_url))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" loading="lazy">`
            : escapeHtml(feedAvatarLetter(contact.display_name || contact.username || 'U'))}
        </div>
        <div class="messages-conv-meta">
          <div class="messages-conv-name-row">
            <div class="messages-conv-name">${escapeHtml(contact.display_name || contact.username || 'User')}</div>
            <div class="messages-conv-time">Contact</div>
          </div>
          <div class="messages-conv-preview">@${escapeHtml(contact.username || 'user')} · Start chat</div>
        </div>`;
      item.addEventListener('click', async () => {
        try {
          item.classList.add('loading');
          const { data: roomId, error } = await sb.rpc('get_or_create_direct_room', {
            p_other_user_id: String(contact.id)
          });
          if (error) throw error;
          const id = String(roomId);
          await loadDbConversations();
          dbRenderConversationList($('msg-search-input')?.value || '');
          await openDbConversation(id, 'direct');
        } catch (err) {
          console.warn('[Messages] start-chat room creation failed:', err?.message || err);
          msgToast(err?.message || 'Could not start this conversation.', '⚠️');
        } finally {
          item.classList.remove('loading');
        }
      });
      list.appendChild(item);
    });
  }

  async function setupRealtime() {
    if (!sb || M42.realtime || S.isGuest || !S.userId) return;
    try {
      M42.realtime = sb.channel(`mortalive-messages-v43-${S.userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        }, async payload => {
          const row = payload?.new;
          if (!row?.room_id) return;

          const all = [...(messagesState.groups || []), ...(messagesState.conversations || [])];
          let conv = all.find(c => String(c.id) === String(row.room_id));

          if (!conv) {
            try {
              await loadDbConversations();
              conv = [...(messagesState.groups || []), ...(messagesState.conversations || [])]
                .find(c => String(c.id) === String(row.room_id));
            } catch (_) {}
          }

          if (!conv) return;

          const me = await ownHash();
          const isMine = String(row.direction || '').toLowerCase() === 'outgoing' || String(row.sender_hash || '') === me;
          if (isMine) {
            // Local send already appended this row; avoid duplicates.
            const existing = messagesState.messages[row.room_id] || [];
            if (existing.some(m => String(m.id) === String(row.id))) return;
          }

          if (!messagesState.messages[row.room_id]) messagesState.messages[row.room_id] = [];
          messagesState.messages[row.room_id].push({
            id: row.id,
            text: row.content || '',
            isMe: isMine,
            senderId: isMine ? S.userId : null,
            senderHash: row.sender_hash || '',
            timestamp: new Date(row.created_at),
            time: formatTime(new Date(row.created_at))
          });

          conv.lastMessage = row.content || '';
          conv.lastAt = row.created_at;

          if (messagesState.activeConvId === row.room_id) {
            if (messagesState.activeConvType === 'group') renderMessages(row.room_id);
            else renderDirectMessages(row.room_id);
          } else if (!isMine) {
            conv.unread = (Number(conv.unread) || 0) + 1;
            dbRenderConversationList($('msg-search-input')?.value || '');
          }
          saveMessagesToStorage();
        })
        .subscribe();
    } catch (e) {
      console.warn('[Messages] realtime setup failed:', e?.message || e);
    }
  }

  async function dbHandleConvAction(roomId, action) {
    const conv = [...(messagesState.groups || []), ...(messagesState.conversations || [])]
      .find(c => String(c.id) === String(roomId));
    if (!conv || !sb || !S.userId) return;

    try {
      if (['archive','unarchive','mute','unmute','pin','unpin'].includes(action)) {
        const patch = {
          ...(action === 'archive' || action === 'unarchive' ? { archived: action === 'archive' } : {}),
          ...(action === 'mute' || action === 'unmute' ? { muted: action === 'mute' } : {}),
          ...(action === 'pin' || action === 'unpin' ? { pinned: action === 'pin' } : {})
        };
        const { error } = await sb.from('message_room_members')
          .update(patch).eq('room_id', roomId).eq('user_id', S.userId);
        if (error) throw error;
        Object.assign(conv, patch);
        dbRenderConversationList($('msg-search-input')?.value || '');
        if (action === 'archive' && String(messagesState.activeConvId) === String(roomId)) closeThread();
        msgToast(
          action === 'archive' ? 'Conversation archived.' :
          action === 'unarchive' ? 'Conversation restored.' :
          action === 'mute' ? 'Notifications muted.' :
          action === 'unmute' ? 'Notifications unmuted.' :
          action === 'pin' ? 'Conversation pinned.' : 'Conversation unpinned.',
          '✓'
        );
        return;
      }

      if (action === 'mark_unread') {
        conv.unread = 1;
        dbRenderConversationList($('msg-search-input')?.value || '');
        msgToast('Marked as unread.', '✓');
        return;
      }

      if (action === 'view_members') {
        const members = conv.members || [];
        const ids = members.map(m => m.user_id).filter(Boolean);
        let profiles = [];
        if (ids.length) {
          const { data, error } = await sb.from('accounts')
            .select('id,username,display_name,avatar_url').in('id', ids);
          if (error) throw error;
          profiles = data || [];
        }
        const pmap = new Map(profiles.map(p => [String(p.id), p]));
        const body = members.map(m => {
          const p = pmap.get(String(m.user_id)) || {};
          return `<div class="m159-member-row">
            <div class="m159-member-avatar">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}" alt="">` : '👤'}</div>
            <div><strong>${escapeHtml(p.display_name || p.username || 'Member')}</strong>
              <small>${p.username ? '@' + escapeHtml(p.username) : ''}${m.role === 'owner' ? ' · Owner' : m.role === 'admin' ? ' · Admin' : ''}</small>
            </div>
          </div>`;
        }).join('');
        openM159Dialog('Group members', body || '<div class="m159-request-meta">No members found.</div>');
        return;
      }

      if (action === 'add_people') {
        if (conv.type === 'group') openM159GroupPeopleDialog(conv);
        return;
      }

      if (action === 'leave_group') {
        if (conv.type !== 'group') return;
        if (!confirm(`Leave "${conv.name || 'this group'}"? You will need a new invitation to rejoin.`)) return;
        const { error } = await sb.from('message_room_members')
          .delete().eq('room_id', roomId).eq('user_id', S.userId);
        if (error) throw error;
        await loadDbConversations();
        dbRenderConversationList($('msg-search-input')?.value || '');
        if (String(messagesState.activeConvId) === String(roomId)) closeThread();
        msgToast('You left the group.', '✓');
        return;
      }

      if (action === 'view_profile') {
        const peerId = conv.type === 'direct' ? conv.userId : null;
        if (peerId && typeof openPublicProfile === 'function') openPublicProfile(peerId);
        else if (peerId && typeof window.openProfile === 'function') window.openProfile(peerId);
        else msgToast('Profile view is unavailable here.', 'ℹ️');
        return;
      }

      if (action === 'delete') {
        const convName = conv.name || conv.display_name || 'this conversation';
        if (!confirm(`Remove "${convName}" from your inbox? This does not delete shared message history.`)) return;
        const { error } = await sb.from('message_room_members')
          .delete().eq('room_id', roomId).eq('user_id', S.userId);
        if (error) throw error;
        await loadDbConversations();
        dbRenderConversationList($('msg-search-input')?.value || '');
        if (String(messagesState.activeConvId) === String(roomId)) closeThread();
        msgToast('Conversation removed from your inbox.', '✓');
      }
    } catch (e) {
      console.error('[Messages] conversation action failed:', e);
      msgToast(e?.message || 'Could not update conversation.', '⚠️');
    }
  }


  function ensureM159Styles() {
    if ($('m159-message-polish')) return;
    const style = document.createElement('style');
    style.id = 'm159-message-polish';
    style.textContent = `
      /* Mortalive site theme: white surfaces, primary blue, soft borders. */
      #pg-messages{background:var(--surface)!important;color:var(--on-surface)!important}
      #pg-messages .messages-shell{background:var(--surface)!important;border:1px solid var(--border)!important;border-radius:var(--r-lg)!important;overflow:hidden;box-shadow:var(--elev-2)!important}
      #pg-messages .messages-sidebar{width:340px;background:var(--surface-2)!important;border-right:1px solid var(--border)!important}
      #pg-messages .messages-sidebar-header{background:var(--surface)!important;border-color:var(--border)!important;padding:18px 16px 12px}
      #pg-messages .sidebar-header-sub,#pg-messages .messages-conv-preview,#pg-messages .messages-peer-status,#pg-messages .empty-hint{color:var(--on-surface-3)!important}
      #pg-messages .messages-title,#pg-messages .messages-conv-name,#pg-messages .messages-peer-name{color:var(--on-surface)!important}
      #pg-messages .messages-new-group-btn{background:var(--primary-alpha)!important;color:var(--primary)!important}
      #pg-messages .messages-new-group-btn:hover{background:rgba(26,110,245,.18)!important}
      #pg-messages .messages-search-wrap{background:var(--surface)!important;border-color:var(--border)!important}
      #pg-messages .messages-search-input,#pg-messages .messages-composer-input{background:var(--surface)!important;color:var(--on-surface)!important;border-color:var(--border)!important}
      #pg-messages .messages-search-input::placeholder,#pg-messages .messages-composer-input::placeholder{color:var(--on-surface-3)!important}
      #pg-messages .messages-search-input:focus,#pg-messages .messages-composer-input:focus{border-color:var(--primary)!important;box-shadow:0 0 0 3px var(--primary-alpha)!important}
      #pg-messages .messages-conv-item{color:var(--on-surface)!important}
      #pg-messages .messages-conv-item:hover{background:var(--surface-3)!important}
      #pg-messages .messages-conv-item.active{background:var(--primary-alpha)!important}
      #pg-messages .messages-conv-ava{background:var(--surface)!important;border-color:var(--border-strong)!important}
      #pg-messages .messages-thread,#pg-messages .messages-thread-header,#pg-messages .messages-composer-wrap,#pg-messages .messages-thread-empty{background:var(--surface)!important;border-color:var(--border)!important;color:var(--on-surface)!important}
      #pg-messages .messages-thread-messages{background:var(--surface-2)!important}
      #pg-messages .msg-row.them .msg-bubble{background:var(--surface)!important;color:var(--on-surface)!important;border:1px solid var(--border)!important;box-shadow:var(--elev-1)!important}
      #pg-messages .msg-row.me .msg-bubble{background:var(--primary)!important;color:#fff!important;box-shadow:0 2px 8px rgba(26,110,245,.18)!important}
      #pg-messages .msg-time{color:var(--on-surface-3)!important}
      #pg-messages .messages-thread-menu,#pg-messages .messages-thread-back{color:var(--on-surface-2)!important}
      #pg-messages .messages-thread-menu:hover,#pg-messages .messages-thread-back:hover{background:var(--surface-3)!important}
      #pg-messages .messages-cta-btn{background:var(--primary)!important;color:#fff!important;border-radius:var(--r-full)!important;box-shadow:var(--elev-1)!important}
      #pg-messages .messages-cta-btn:hover{background:var(--primary-dark)!important;transform:translateY(-1px)}
      #pg-messages .messages-thread-empty .empty-illustration{background:var(--primary-alpha)!important;color:var(--primary)!important;border-radius:var(--r-md)!important}
      #msg-request-center{flex:0 0 auto}
      .m159-request-center{margin:8px 12px;border:1px solid var(--border);background:var(--surface);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--elev-1)}
      .m159-request-head{display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 12px;color:var(--on-surface);font-size:12px;font-weight:800;text-align:left}
      .m159-request-head:hover{background:var(--surface-2)}
      .m159-request-badge{min-width:20px;height:20px;padding:0 6px;border-radius:var(--r-full);display:grid;place-items:center;background:var(--primary);color:#fff;font-size:11px}
      .m159-request-row{padding:10px 12px;border-top:1px solid var(--border)}
      .m159-request-name{font-size:13px;font-weight:750;color:var(--on-surface)}
      .m159-request-meta{font-size:11px;color:var(--on-surface-3);margin-top:2px;line-height:1.45}
      .m159-request-actions{display:flex;gap:7px;margin-top:8px}
      .m159-request-actions button,.m159-dialog-actions button{border-radius:var(--r-full);padding:7px 11px;font-size:11px;font-weight:750}
      .m159-accept{background:var(--primary);color:#fff}.m159-decline{background:var(--surface-3);color:var(--on-surface-2)}
      .m159-context-menu{min-width:220px;padding:6px;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--r-md);box-shadow:var(--elev-3);z-index:10050}
      .m159-context-menu button{display:flex;align-items:center;gap:9px;width:100%;padding:9px 11px;border-radius:10px;text-align:left;color:var(--on-surface);font-size:12px}
      .m159-context-menu button:hover{background:var(--surface-2)}.m159-context-menu .danger{color:var(--danger)}
      .m159-dialog-backdrop{position:fixed;inset:0;background:rgba(13,17,23,.42);display:flex;align-items:center;justify-content:center;padding:18px;z-index:10060}
      .m159-dialog{width:min(460px,100%);max-height:82vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--elev-4);color:var(--on-surface)}
      .m159-dialog-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);font-weight:800}
      .m159-dialog-body{padding:16px 18px}.m159-dialog-close{font-size:20px;color:var(--on-surface-3);padding:4px}
      .m159-member-row{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)}
      .m159-member-avatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--surface-3);overflow:hidden}
      .m159-member-avatar img{width:100%;height:100%;object-fit:cover}.m159-member-row strong{display:block;font-size:13px}.m159-member-row small{display:block;color:var(--on-surface-3);font-size:11px}
      @media(max-width:760px){#pg-messages .messages-sidebar{width:100%}#pg-messages .messages-shell{border-radius:0;border-left:0;border-right:0}}
    `;
    document.head.appendChild(style);
  }

  function openM159Dialog(title, bodyHtml) {
    document.getElementById('m159-dialog-backdrop')?.remove();
    const wrap=document.createElement('div');
    wrap.id='m159-dialog-backdrop'; wrap.className='m159-dialog-backdrop';
    wrap.innerHTML=`<div class="m159-dialog" role="dialog" aria-modal="true">
      <div class="m159-dialog-head"><span>${escapeHtml(title)}</span><button class="m159-dialog-close" aria-label="Close">×</button></div>
      <div class="m159-dialog-body">${bodyHtml}</div></div>`;
    document.body.appendChild(wrap);
    const close=()=>wrap.remove();
    wrap.querySelector('.m159-dialog-close')?.addEventListener('click',close);
    wrap.addEventListener('click',e=>{if(e.target===wrap)close();});
    return wrap;
  }

  async function loadM159Requests() {
    const host=$('msg-request-center');
    if(!host || !S.userId || S.isGuest || !sb) return;
    try {
      const {data:requests,error}=await sb.from('message_requests')
        .select('id,sender_id,recipient_id,room_id,message,status,created_at')
        .eq('recipient_id',S.userId).eq('status','pending')
        .order('created_at',{ascending:false}).limit(20);
      if(error) throw error;
      const rows=requests||[];
      const senderIds=[...new Set(rows.map(r=>r.sender_id).filter(Boolean))];
      let profiles=[];
      if(senderIds.length){
        const {data,error:e}=await sb.from('accounts').select('id,username,display_name,avatar_url').in('id',senderIds);
        if(e)throw e; profiles=data||[];
      }
      const pmap=new Map(profiles.map(p=>[String(p.id),p]));
      const groupIds=[...new Set(rows.map(r=>r.room_id).filter(Boolean).map(String))];
      let groups=[];
      if(groupIds.length){
        const {data,error:e}=await sb.from('message_rooms').select('room_id,name,type').in('room_id',groupIds);
        if(e)throw e; groups=data||[];
      }
      const gmap=new Map(groups.map(g=>[String(g.room_id),g]));
      host.innerHTML=`<button type="button" class="m159-request-head" id="m159-request-toggle">
        <span>✉ Message requests</span><span class="m159-request-badge">${rows.length}</span></button>
        <div id="m159-request-list" style="display:${rows.length?'block':'none'}"></div>`;
      const list=$('m159-request-list');
      rows.forEach(r=>{
        const p=pmap.get(String(r.sender_id))||{}, g=r.room_id?gmap.get(String(r.room_id)):null;
        const row=document.createElement('div'); row.className='m159-request-row';
        row.innerHTML=`<div class="m159-request-name">${escapeHtml(p.display_name||p.username||'User')}</div>
          <div class="m159-request-meta">@${escapeHtml(p.username||'user')} · ${escapeHtml(g?.name?`Group invite · ${g.name}`:'Message request')}</div>
          ${r.message?`<div class="m159-request-meta" style="margin-top:6px;">${escapeHtml(r.message)}</div>`:''}
          <div class="m159-request-actions"><button class="m159-accept" data-m159-accept="${escapeHtml(r.id)}">Accept</button><button class="m159-decline" data-m159-decline="${escapeHtml(r.id)}">Decline</button></div>`;
        list.appendChild(row);
      });
      $('m159-request-toggle')?.addEventListener('click',()=>{list.style.display=list.style.display==='none'?'block':'none';});
      list.querySelectorAll('[data-m159-accept]').forEach(b=>b.addEventListener('click',async()=>{
        b.disabled=true;
        try{
          const request=rows.find(r=>String(r.id)===String(b.dataset.m159Accept));
          const {data,error}=await sb.rpc('accept_message_request',{p_request_id:b.dataset.m159Accept});
          if(error)throw error;
          await loadDbConversations(); dbRenderConversationList($('msg-search-input')?.value||''); await loadM159Requests();
          if(data) await openDbConversation(String(data), request?.room_id?'group':'direct');
          msgToast(request?.room_id?'Group invitation accepted.':'Message request accepted.','✓');
        }catch(e){b.disabled=false;msgToast(e?.message||'Could not accept request.','⚠️');}
      }));
      list.querySelectorAll('[data-m159-decline]').forEach(b=>b.addEventListener('click',async()=>{
        b.disabled=true;
        try{const {error}=await sb.rpc('decline_message_request',{p_request_id:b.dataset.m159Decline});if(error)throw error;await loadM159Requests();msgToast('Request declined.','✓');}
        catch(e){b.disabled=false;msgToast(e?.message||'Could not decline request.','⚠️');}
      }));
    }catch(e){
      console.warn('[Messages] request center failed:',e?.message||e);
      host.innerHTML='<div class="m159-request-head"><span>✉ Message requests</span></div><div class="m159-request-row m159-request-meta">Requests are unavailable right now.</div>';
    }
  }

  function ensureM159RequestCenter() {
    let host=$('msg-request-center');
    if(host)return host;
    const list=$('msg-conv-list');
    if(!list)return null;
    host=document.createElement('div'); host.id='msg-request-center'; host.className='m159-request-center';
    list.parentNode.insertBefore(host,list);
    return host;
  }

  function ensureM159ThreadMenu() {
    const btn=$('msg-thread-menu');
    if(!btn || btn.dataset.m159Bound)return;
    btn.dataset.m159Bound='1';
    btn.addEventListener('click',e=>{
      e.preventDefault();e.stopImmediatePropagation();
      const conv=[...(messagesState.groups||[]),...(messagesState.conversations||[])].find(c=>String(c.id)===String(messagesState.activeConvId));
      if(!conv)return;
      document.querySelector('.m159-context-menu')?.remove();
      const group=conv.type==='group';
      const items=group
        ? [['view_members','👥 View members'],['add_people','➕ Add people'],['mute',conv.muted?'🔔 Unmute':'🔕 Mute notifications'],['pin',conv.pinned?'📍 Unpin':'📌 Pin conversation'],['archive',conv.archived?'📂 Restore':'📦 Archive'],['mark_unread','✓ Mark as unread'],['leave_group','🚪 Leave group'],['delete','🗑️ Remove from inbox']]
        : [['view_profile','👤 View profile'],['mute',conv.muted?'🔔 Unmute':'🔕 Mute notifications'],['pin',conv.pinned?'📍 Unpin':'📌 Pin conversation'],['archive',conv.archived?'📂 Restore':'📦 Archive'],['mark_unread','✓ Mark as unread'],['delete','🗑️ Remove from inbox']];
      const menu=document.createElement('div'); menu.className='m159-context-menu';
      menu.innerHTML=items.map(([a,l])=>`<button type="button" data-m159-action="${a}" class="${a==='delete'||a==='leave_group'?'danger':''}">${l}</button>`).join('');
      document.body.appendChild(menu);
      const r=btn.getBoundingClientRect();
      menu.style.position='fixed'; menu.style.top=`${Math.max(8,Math.min(window.innerHeight-menu.offsetHeight-8,r.bottom+6))}px`; menu.style.left=`${Math.max(8,Math.min(window.innerWidth-menu.offsetWidth-8,r.right-menu.offsetWidth))}px`;
      menu.addEventListener('click',async ev=>{const b=ev.target.closest('[data-m159-action]');if(!b)return;menu.remove();await dbHandleConvAction(conv.id,b.dataset.m159Action);});
      setTimeout(()=>document.addEventListener('click',function close(ev){if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('click',close)}},{once:true}),0);
    },true);
  }

  function openM159GroupPeopleDialog(conv) {
    const dlg=openM159Dialog(`Add people · ${conv.name||'Group'}`,`<div class="m159-request-meta" style="margin-bottom:10px;">Existing contacts are added directly. Everyone else receives an invitation and joins only after accepting.</div><input id="m159-group-user-search" class="messages-search-input" placeholder="Search any username…" autocomplete="off"><div id="m159-group-user-results" style="margin-top:10px;"></div>`);
    const input=dlg.querySelector('#m159-group-user-search'), results=dlg.querySelector('#m159-group-user-results');
    let timer=null,seq=0;
    input?.addEventListener('input',()=>{
      clearTimeout(timer);const q=input.value.trim().replace(/^@/,'');const s=++seq;
      if(q.length<2){results.innerHTML='<div class="m159-request-meta">Type at least 2 characters.</div>';return;}
      timer=setTimeout(async()=>{
        try{
          const {data,error}=await sb.from('accounts').select('id,username,display_name,avatar_url').neq('id',S.userId).or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(12);
          if(s!==seq)return;if(error)throw error;
          results.innerHTML=(data||[]).map(u=>`<button type="button" data-m159-add="${escapeHtml(u.id)}" style="display:flex;align-items:center;gap:10px;width:100%;padding:9px;border-radius:10px;color:var(--on-surface);text-align:left;"><span>${u.avatar_url?`<img src="${escapeHtml(u.avatar_url)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover">`:'👤'}</span><span><strong>${escapeHtml(u.display_name||u.username||'User')}</strong><small style="display:block;color:var(--on-surface-3)">@${escapeHtml(u.username||'user')}</small></span></button>`).join('')||'<div class="m159-request-meta">No users found.</div>';
          results.querySelectorAll('[data-m159-add]').forEach(b=>b.addEventListener('click',async()=>{
            b.disabled=true;
            try{
              const u=(data||[]).find(x=>String(x.id)===String(b.dataset.m159Add));if(!u)return;
              const isContact=(messagesState.conversations||[]).some(c=>String(c.id)===String(u.id));
              if(isContact){
                const {error}=await sb.from('message_room_members').insert({room_id:conv.id,user_id:u.id,role:'member'});
                if(error && !/duplicate|unique/i.test(error.message||''))throw error;
                await loadDbConversations();msgToast(`${u.display_name||'Contact'} added to the group.`,'✓');
              }else{
                const {error}=await sb.rpc('send_message_request',{p_recipient_id:u.id,p_room_id:conv.id,p_message:`I invited you to join the group "${conv.name||'this group'}"`});
                if(error)throw error;msgToast('Group invitation sent.','✓');
              }
            }catch(e){msgToast(e?.message||'Could not add or invite this user.','⚠️');}
            finally{b.disabled=false;}
          }));
        }catch(e){if(s===seq)results.innerHTML='<div class="m159-request-meta">Search is unavailable right now.</div>';}
      },220);
    });
  }

  async function initMessagesDbV42() {
    if (S.isGuest || !S.userId || !sb) return;
    try {
      ensureMessageSearchButton();
      ensureEmptyFindButton();
      ensureRandomUserModal();
      ensureM159Styles();
      ensureM159RequestCenter();
      ensureM159ThreadMenu();
      await loadM159Requests();

      // Always resolve the Messages search element from the current DOM.
      // The Messages page can be mounted/re-rendered after app bootstrap;
      // never rely on a stale or out-of-scope `searchInput` variable.
      const messageSearchInput = () => $('msg-search-input');

      if (!M42.initialized) {
        M42.initialized = true;

        const searchEl = messageSearchInput();
        if (searchEl) {
          searchEl.addEventListener('input', e => dbRenderConversationList(e.target.value));
        }

        // Thread-level menu is already wired by the base UI; make sure it
        // delegates to the database-backed action handler.
        $('msg-thread-menu')?.addEventListener('click', e => {
          try { openThreadMenu(e); } catch (_) {}
        });
      }

      await ownHash();
      await loadDbConversations();
      dbRenderConversationList(messageSearchInput()?.value || '');
      updateSidebarSubtitle();
      setupRealtime();

      const memberInput = $('group-members-input');
      if (memberInput && !memberInput.dataset.m42Bound) {
        memberInput.dataset.m42Bound = '1';
        memberInput.addEventListener('input', dbHandleMemberSearch, true);
      }

      const groupForm = $('form-create-group');
      if (groupForm && !groupForm.dataset.m42Bound) {
        groupForm.dataset.m42Bound = '1';
        groupForm.addEventListener('submit', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          dbHandleCreateGroup(e);
        }, true);
      }

      const composer = $('msg-composer-send');
      if (composer && !composer.dataset.m42Bound) {
        composer.dataset.m42Bound = '1';
        composer.addEventListener('click', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          dbSendMessage();
        }, true);
      }

      const input = $('msg-composer-input');
      if (input && !input.dataset.m42Bound) {
        input.dataset.m42Bound = '1';
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            dbSendMessage();
          }
        }, true);
        input.addEventListener('input', updateComposerButton);
      }
    } catch (e) {
      console.error('[Messages DB v43] initialization failed:', e);
      const rawMessage = String(e?.message || e || 'Unknown database error');
      const friendly = /relation .* does not exist|could not find the table|schema cache/i.test(rawMessage)
        ? 'Messages database tables are missing or Supabase schema cache needs refreshing.'
        : rawMessage;
      msgToast(friendly, '⚠️');
      dbRenderConversationList();
    }
  }

  window.handleMemberSearch = dbHandleMemberSearch;
  window.handleCreateGroup = dbHandleCreateGroup;
  window.sendMessage = dbSendMessage;
  window.handleConvAction = dbHandleConvAction;
  window.renderConversationList = dbRenderConversationList;
  // v160 media/actions live in a separate IIFE; expose the DB renderer so
  // attachment/reaction updates can refresh the sidebar without ReferenceError.
  window.dbRenderConversationList = dbRenderConversationList;
  window.openRandomUserMessageModal = openRandomUserMessageModal;
  window.closeRandomUserMessageModal = closeRandomUserMessageModal;

  // Route conversation item clicks to DB-backed rooms.
  document.addEventListener('click', async e => {
    const item = e.target.closest?.('.messages-conv-item[data-conv-id]');
    if (!item) return;
    const roomId = item.dataset.convId;
    const group = (messagesState.groups || []).find(g => String(g.id) === String(roomId));
    const contact = (messagesState.conversations || []).find(c => String(c.id) === String(roomId));
    if (!group && !contact) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      await openDbConversation(roomId, group ? 'group' : 'direct');
    } catch (err) {
      msgToast(err?.message || 'Could not open conversation.', '⚠️');
    }
  }, true);

  const originalInitMessages = window.initMessages;
  window.initMessages = async function patchedInitMessagesV42() {
    if (typeof originalInitMessages === 'function') {
      try { await originalInitMessages(); } catch (e) { console.warn('[Messages] legacy init warning:', e?.message || e); }
    }
    await initMessagesDbV42();
  };

  window.addEventListener('mortalive-auth-state', () => {
    M42.ownSenderHash = null;
    if (!S.isGuest && S.userId && $('pg-messages')?.classList.contains('active')) {
      initMessagesDbV42();
    }
  });

  console.log('[Messages DB v43] production schema alignment ready ✓');
})();

/* ═════════════════════════════════════════════════════════════════════
   MFE — Feed Enhancement Layer (merged into app.js)
   Original standalone feed-enhancements.js is now folded into app.js.
   ═════════════════════════════════════════════════════════════════════ */
/**
 * MORTALIVE — Feed Enhancement Layer
 * Merged directly into app.js; no standalone script is required.
 *
 * Features:
 *   1. Inline Follow button next to author names in feed post cards AND
 *      "Recent public posts" right-sidebar section.
 *   2. Replaces "Recent posters" with "Suggested for you" — shows 3 accounts
 *      at a time with Prev/Next pagination and direct Follow buttons.
 *   3. Wires the "Hot topics" hashtag chips to filter the main feed.
 *
 * Nothing in app.js is patched or overwritten. This script uses:
 *   - MutationObserver  → reacts to DOM changes caused by app.js renders
 *   - capture-phase listeners  → intercept clicks before app.js handlers
 *   - window.sb, window.S, window.toggleFollow, window.fetchFollowData
 *     (all already exposed by app.js)
 */
(function mortaliveFeedEnhancements() {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────── */
  let _hashFilter        = null;   // active hashtag string or null
  let _preFilterTab      = 'all';  // which tab was active before filter
  let _filteredEng       = new Map(); // engagement for hash-filtered cards
  let _suggestions       = [];     // full un-followed accounts list
  let _sugPage           = 0;      // current page index (0-based)
  let _sugLoading        = false;
  let _sugLock           = false;  // prevents observer → render loop
  const SUG_PER_PAGE     = 3;

  /* ─────────────────────────────────────────────────────────
     TINY HELPERS
  ───────────────────────────────────────────────────────── */
  const $       = id  => document.getElementById(id);
  const getS    = ()  => window.S  || {};
  const getSb   = ()  => window.sb || null;
  const toNum   = v   => { const n = Number(v); return isFinite(n) ? n : 0; };

  /** Safely turn a string into HTML-escaped text. */
  let _sanDiv = null;
  function san(str) {
    if (!_sanDiv) _sanDiv = document.createElement('div');
    _sanDiv.textContent = String(str ?? '');
    return _sanDiv.innerHTML;
  }

  /** Validate & return an http(s) image URL, empty string otherwise. */
  function safeUrl(url) {
    try {
      const u = new URL(String(url || ''));
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch { return ''; }
  }

  /** Relative timestamp label. */
  function relTime(iso) {
    const diff = Math.max(0, Date.now() - (Date.parse(iso) || 0));
    if (diff < 60_000)    return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  /** Wrap #hashtag occurrences in clickable button elements. */
  function renderHashtags(text) {
    const escaped = san(String(text || ''));
    return escaped.replace(
      /(^|[\s([{])#([A-Za-z0-9_]{1,63})/g,
      (_, pre, tag) =>
        `${pre}<button type="button" class="feed-hashtag" data-feed-hashtag="${san(tag.toLowerCase())}">#${san(tag)}</button>`
    );
  }

  /** Build an avatar element: image if URL present, initial letter otherwise. */
  function avatarEl(name, avatarUrl, size = 36) {
    const initial = san(String(name || 'M').trim().charAt(0).toUpperCase());
    const av = safeUrl(avatarUrl || '');
    if (av) {
      return `<div class="mfe-ava" style="width:${size}px;height:${size}px;"><img src="${san(av)}" alt="${san(name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.parentElement.textContent='${initial}';this.remove();"></div>`;
    }
    return `<div class="mfe-ava" style="width:${size}px;height:${size}px;">${initial}</div>`;
  }

  /* ─────────────────────────────────────────────────────────
     CSS INJECTION
  ───────────────────────────────────────────────────────── */
  function injectStyles() {
    if ($('__mfe-css')) return;
    const el = document.createElement('style');
    el.id = '__mfe-css';
    el.textContent = `
    /* ── Shared avatar circle ── */
    .mfe-ava {
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary,#1a6ef5), #7c3aed);
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 14px;
      font-weight: 800;
      flex: none;
      overflow: hidden;
    }

    /* ── Follow button ── */
    .mfe-follow-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 11px;
      border-radius: 999px;
      border: 1.5px solid rgba(26,110,245,.38);
      background: rgba(26,110,245,.08);
      color: var(--primary, #1a6ef5);
      font-size: 10.5px;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      vertical-align: middle;
      line-height: 1.4;
      transition: background 140ms, color 140ms, border-color 140ms, transform 120ms;
    }
    .mfe-follow-btn:hover:not(.mfe-following) {
      background: var(--primary, #1a6ef5);
      color: #fff;
      border-color: var(--primary, #1a6ef5);
      transform: translateY(-1px);
    }
    .mfe-follow-btn.mfe-following {
      background: #111;
      border-color: #111;
      color: #fff;
    }
    .mfe-follow-btn.mfe-following:hover {
      background: #dc2626;
      border-color: #dc2626;
    }
    .mfe-follow-btn:disabled { opacity: .45; cursor: not-allowed; }

    /* ── Post-author row alignment ── */
    #pg-feed .post-author {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: nowrap;
    }

    /* ── Trending-polls follow chip ── */
    .mfe-trend-follow-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 7px;
    }

    /* ── Suggestions section ── */
    .mfe-sug-row {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border, rgba(0,0,0,.08));
      margin-bottom: 10px;
    }
    .mfe-sug-row:last-of-type { border-bottom: 0; padding-bottom: 0; margin-bottom: 0; }
    .mfe-sug-user { display: flex; align-items: center; gap: 10px; }
    .mfe-sug-info { flex: 1; min-width: 0; }
    .mfe-sug-name {
      font-size: 13px; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: var(--on-surface);
    }
    .mfe-sug-sub { font-size: 11px; color: var(--on-surface-3); margin-top: 1px; }
    .mfe-sug-follow-btn {
      width: 100%; padding: 7px 12px;
      border-radius: 10px; margin-left: 0;
      font-size: 12px; font-weight: 800;
      border: 1.5px solid rgba(26,110,245,.32);
      background: rgba(26,110,245,.07);
      color: var(--primary, #1a6ef5);
      cursor: pointer;
      transition: background 140ms, color 140ms, border-color 140ms;
    }
    .mfe-sug-follow-btn:hover:not(.mfe-following) {
      background: var(--primary, #1a6ef5); color: #fff; border-color: var(--primary);
    }
    .mfe-sug-follow-btn.mfe-following {
      background: #111; border-color: #111; color: #fff;
    }
    .mfe-sug-follow-btn:disabled { opacity: .45; cursor: not-allowed; }

    .mfe-sug-pagination {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 10px; gap: 8px;
    }
    .mfe-pag-btn {
      padding: 5px 12px; border-radius: 8px;
      border: 1px solid var(--border); background: var(--surface-2);
      color: var(--on-surface-2); font-size: 11px; font-weight: 700; cursor: pointer;
      transition: border-color 120ms, color 120ms, background 120ms;
    }
    .mfe-pag-btn:not(:disabled):hover {
      border-color: var(--primary); color: var(--primary);
      background: rgba(26,110,245,.06);
    }
    .mfe-pag-btn:disabled { opacity: .35; cursor: not-allowed; }
    .mfe-sug-count { font-size: 10px; color: var(--on-surface-3); }

    /* ── Feed search ── */
    .mfe-feed-search {
      display:flex; align-items:center; gap:8px; padding:9px 12px; margin-bottom:12px;
      border:1px solid var(--border); border-radius:12px; background:rgba(255,255,255,.94); box-shadow:var(--elev-1);
    }
    .mfe-feed-search-icon { flex:none; font-size:14px; opacity:.7; }
    .mfe-feed-search-input { width:100%; min-width:0; border:0; outline:0; background:transparent; color:var(--on-surface); font-size:13px; font-weight:600; }
    .mfe-feed-search-input::placeholder { color:var(--on-surface-3); font-weight:500; }
    .mfe-feed-search-clear { width:26px; height:26px; border-radius:50%; border:0; background:var(--surface-2); color:var(--on-surface-3); display:grid; place-items:center; cursor:pointer; flex:none; }
    .mfe-recent-follow { margin-top:7px; }

    /* ── Hashtag filter pill ── */
    #mfe-hash-pill {
      display: flex; align-items: center; gap: 9px;
      padding: 9px 14px; margin-bottom: 12px;
      border-radius: 12px;
      background: rgba(26,110,245,.08);
      border: 1.5px solid rgba(26,110,245,.24);
      font-size: 13px; font-weight: 700; color: var(--primary, #1a6ef5);
      animation: toastIn .18s ease;
    }
    #mfe-hash-pill .mfe-pill-tag  { font-size: 14px; }
    #mfe-hash-pill .mfe-pill-hint { font-size: 11px; font-weight: 600; color: var(--on-surface-3); flex: 1; }
    #mfe-hash-pill .mfe-pill-clear {
      padding: 3px 10px; border-radius: 999px;
      border: 1.5px solid rgba(26,110,245,.28); background: #fff;
      color: var(--primary); font-size: 11px; font-weight: 800; cursor: pointer;
      transition: background 120ms, color 120ms;
    }
    #mfe-hash-pill .mfe-pill-clear:hover { background: var(--primary); color: #fff; }

    /* ── Hot-topics chip active state ── */
    #hot-topics .topic-chip.mfe-active {
      background: var(--primary, #1a6ef5) !important;
      color: #fff !important;
      border-color: var(--primary, #1a6ef5) !important;
    }
    `;
    document.head.appendChild(el);
  }

  /* ─────────────────────────────────────────────────────────
     FOLLOW SYSTEM
  ───────────────────────────────────────────────────────── */

  /** Fetch follow state (uses app.js cache + fetchFollowData). */
  async function getFollowState(uid) {
    if (!uid || getS().isGuest || !getSb()) return { isFollowing: false };
    if (window._followCache?.has?.(uid)) return window._followCache.get(uid);
    if (typeof window.fetchFollowData === 'function') {
      try { return await window.fetchFollowData(uid); }
      catch { return { isFollowing: false }; }
    }
    return { isFollowing: false };
  }

  /** Update every rendered button for a given userId to reflect new state. */
  function syncFollowBtns(uid, isFollowing) {
    document.querySelectorAll(`[data-mfe-follow="${CSS.escape(uid)}"]`).forEach(btn => {
      btn.textContent = isFollowing ? 'Following' : 'Follow';
      btn.classList.toggle('mfe-following', !!isFollowing);
      btn.dataset.mfeState = isFollowing ? '1' : '0';
    });
  }

  /** Execute a follow / un-follow action triggered by a button click. */
  async function doFollow(btn) {
    const uid = btn.dataset.mfeFollow;
    const S = getS();
    if (!uid || S.isGuest) {
      window.toast?.('Sign in to follow people', '🔒');
      return;
    }
    if (uid === S.userId) return;
    btn.disabled = true;
    const current = window._followCache?.get?.(uid) || { isFollowing: false };
    const wantFollow = !current.isFollowing;
    try {
      const updated = await window.toggleFollow?.(uid, wantFollow);
      const nowFollowing = updated?.isFollowing ?? wantFollow;
      syncFollowBtns(uid, nowFollowing);
      window.toast?.(nowFollowing ? 'Following!' : 'Unfollowed', nowFollowing ? '✓' : '➖');
      // If followed from suggestions, remove from pool so the slot refreshes
      if (nowFollowing) {
        _suggestions = _suggestions.filter(u => u.id !== uid);
        if ($('active-users-list')) renderSuggestions();
      }
    } catch (e) {
      window.toast?.(e?.message || 'Could not update follow.', '⚠️');
    } finally {
      btn.disabled = false;
    }
  }

  /** Async-hydrate all un-hydrated follow buttons inside `root`. */
  async function hydrateFollowBtns(root = document) {
    const S = getS();
    if (S.isGuest || !S.userId) return;
    const btns = [...root.querySelectorAll('[data-mfe-follow]:not([data-mfe-h])')];
    if (!btns.length) return;
    const uids = [...new Set(btns.map(b => b.dataset.mfeFollow).filter(uid => uid && uid !== S.userId))];
    await Promise.all(uids.map(async uid => {
      const fd = await getFollowState(uid);
      const isFollowing = !!fd?.isFollowing;
      btns.filter(b => b.dataset.mfeFollow === uid).forEach(b => {
        b.textContent = isFollowing ? 'Following' : 'Follow';
        b.classList.toggle('mfe-following', isFollowing);
        b.dataset.mfeState = isFollowing ? '1' : '0';
        b.dataset.mfeH = '1';
      });
    }));
  }

  /* ─────────────────────────────────────────────────────────
     FEATURE 1 — FOLLOW BUTTONS IN FEED POST CARDS
  ───────────────────────────────────────────────────────── */

  function addFollowBtnToCard(card) {
    const S = getS();
    if (S.isGuest || !S.userId) return;
    const ownerId = card.dataset.postOwner;
    if (!ownerId || ownerId === S.userId) return;

    const authorEl = card.querySelector('.post-author');
    if (!authorEl || authorEl.querySelector('[data-mfe-follow]')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mfe-follow-btn';
    btn.dataset.mfeFollow = ownerId;
    btn.textContent = 'Follow';
    authorEl.appendChild(btn);
  }

  function scanFeedCards(root = null) {
    const container = root || $('feed-posts') || document;
    container.querySelectorAll?.('.post-card[data-post-owner]').forEach(addFollowBtnToCard);
    const unhydrated = container.querySelectorAll?.('[data-mfe-follow]:not([data-mfe-h])');
    if (unhydrated?.length) hydrateFollowBtns(container);
  }

  /* ─────────────────────────────────────────────────────────
     FEATURE 1b — FOLLOW BUTTONS IN "RECENT PUBLIC POSTS"
  ───────────────────────────────────────────────────────── */

  function enhanceTrendingPolls() {
    const container = $('trending-polls-list');
    if (!container) return;
    const S = getS();
    if (S.isGuest || !S.userId) return;

    container.querySelectorAll('.trending-poll-item:not([data-mfe-enh])').forEach(item => {
      item.dataset.mfeEnh = '1';
      if (item.querySelector('[data-mfe-follow]')) return;

      // The meta span contains "✍️ username"
      const metaSpan = item.querySelector('.trending-poll-meta span');
      if (!metaSpan) return;
      const authorText = metaSpan.textContent.replace('✍️', '').trim();

      // Resolve the sidebar username against rendered feed cards. Prefer the
      // canonical @username in .post-time; fall back to display-name matching
      // only for older cached markup.
      let userId = null;
      const wantedUsername = authorText.replace(/^@/, '').trim().toLowerCase();
      document.querySelectorAll('#feed-posts .post-card[data-post-owner]').forEach(card => {
        if (userId) return;
        const timeEl = card.querySelector('.post-time');
        const usernameMatch = timeEl?.textContent?.match(/@([^\s·]+)/);
        const cardUsername = usernameMatch?.[1]?.trim().toLowerCase() || '';
        if (wantedUsername && cardUsername === wantedUsername) {
          userId = card.dataset.postOwner || null;
          return;
        }
        const link = card.querySelector('.post-author-link');
        if (!userId && link && link.textContent.trim().toLowerCase().startsWith(wantedUsername)) {
          userId = card.dataset.postOwner || null;
        }
      });
      if (!userId || userId === S.userId) return;

      const row = document.createElement('div');
      row.className = 'mfe-trend-follow-row';
      row.innerHTML = `<button type="button" class="mfe-follow-btn" data-mfe-follow="${san(userId)}">Follow</button>`;
      item.appendChild(row);
    });

    hydrateFollowBtns(container);
  }

  /* ─────────────────────────────────────────────────────────
     FEATURE 2 — SUGGESTIONS SECTION
  ───────────────────────────────────────────────────────── */

  /** Update the right-sidebar card title from "Recent posters" to Suggestions. */
  function updateSuggestionsTitle() {
    const listEl = $('active-users-list');
    if (!listEl) return;
    const title = listEl.closest('.right-card')?.querySelector('.right-card-title');
    if (title && !title.dataset.mfeTitle) {
      title.dataset.mfeTitle = '1';
      title.innerHTML = '✨ Suggested for you';
    }
  }

  /** Fetch accounts the current user does not yet follow. */
  async function loadSuggestions(force = false) {
    const S = getS();
    const sb = getSb();
    if (!sb || S.isGuest || !S.userId || _sugLoading) return;
    if (_suggestions.length && !force) return;
    _sugLoading = true;
    try {
      // Step 1 – who the user already follows
      const { data: followRows } = await sb
        .from('follows')
        .select('following_id')
        .eq('follower_id', S.userId);
      const excluded = new Set((followRows || []).map(r => r.following_id));
      excluded.add(S.userId);

      // Step 2 – fetch top accounts by score, filter client-side
      const { data: accounts } = await sb
        .from('accounts')
        .select('id,username,display_name,avatar_url,crockroach_score')
        .order('crockroach_score', { ascending: false })
        .limit(60);

      _suggestions = (accounts || []).filter(u => !excluded.has(u.id));
      _sugPage = 0;
    } catch (e) {
      console.warn('[Suggestions] load failed:', e?.message || e);
    } finally {
      _sugLoading = false;
    }
  }

  /** Render the current page of suggestions into #active-users-list. */
  function renderSuggestions() {
    const container = $('active-users-list');
    if (!container) return;
    const S = getS();

    if (S.isGuest || !S.userId) {
      _sugLock = true;
      container.innerHTML = '<div style="font-size:12.5px;color:var(--on-surface-3);line-height:1.6;">Sign in to see suggested accounts.</div>';
      setTimeout(() => { _sugLock = false; }, 60);
      return;
    }

    if (!_suggestions.length) {
      _sugLock = true;
      container.innerHTML = '<div style="font-size:12.5px;color:var(--on-surface-3);line-height:1.6;">No new suggestions right now — follow more people to unlock more.</div>';
      setTimeout(() => { _sugLock = false; }, 60);
      return;
    }

    const start = _sugPage * SUG_PER_PAGE;
    const page  = _suggestions.slice(start, start + SUG_PER_PAGE);
    const hasNext = start + SUG_PER_PAGE < _suggestions.length;
    const hasPrev = _sugPage > 0;

    const rowsHtml = page.map(user => {
      const name     = user.display_name || user.username || 'User';
      const username = user.username || 'user';
      const score    = toNum(user.crockroach_score);
      return `
        <div class="mfe-sug-row">
          <div class="mfe-sug-user">
            ${avatarEl(name, user.avatar_url, 36)}
            <div class="mfe-sug-info">
              <div class="mfe-sug-name">${san(name)}</div>
              <div class="mfe-sug-sub">@${san(username)} · 🧲 ${score.toLocaleString()}</div>
            </div>
          </div>
          <button type="button"
            class="mfe-follow-btn mfe-sug-follow-btn"
            data-mfe-follow="${san(user.id)}">Follow</button>
        </div>`;
    }).join('');

    _sugLock = true;
    container.innerHTML = `
      ${rowsHtml}
      <div class="mfe-sug-pagination">
        <button class="mfe-pag-btn" id="mfe-sug-prev" ${hasPrev ? '' : 'disabled'}>← Prev</button>
        <span class="mfe-sug-count">${start + 1}–${Math.min(start + SUG_PER_PAGE, _suggestions.length)} of ${_suggestions.length}</span>
        <button class="mfe-pag-btn" id="mfe-sug-next" ${hasNext ? '' : 'disabled'}>Next →</button>
      </div>`;

    $('mfe-sug-next')?.addEventListener('click', e => {
      e.stopPropagation();
      _sugPage++;
      renderSuggestions();
      hydrateFollowBtns(container);
    });
    $('mfe-sug-prev')?.addEventListener('click', e => {
      e.stopPropagation();
      _sugPage--;
      renderSuggestions();
      hydrateFollowBtns(container);
    });

    // hydrateFollowBtns is async; release lock after it settles
    hydrateFollowBtns(container).then(() => { _sugLock = false; });
  }

  /* ─────────────────────────────────────────────────────────
     FEATURE 3 — HASHTAG FILTER
  ───────────────────────────────────────────────────────── */

  function setHashFilter(tag) {
    const next = tag ? String(tag).toLowerCase().replace(/^#/, '') : null;
    // Remember which tab was active so we can restore it on clear
    if (next && !_hashFilter) {
      const active = document.querySelector('#pg-feed #feed-tabs .feed-tab.active');
      _preFilterTab = active?.dataset?.filter || 'all';
    }
    _hashFilter = next;
    _feedSearchQuery = next ? `#${next}` : '';
    const searchInput = $('feed-search-input');
    if (searchInput) searchInput.value = _feedSearchQuery;
    document.querySelectorAll('#hot-topics [data-feed-hashtag]').forEach(chip => {
      chip.classList.toggle('mfe-active', chip.dataset.feedHashtag === next);
    });
    renderHashPill();
    fetchFeedPage(true);
  }

  function renderHashPill() {
    $('mfe-hash-pill')?.remove();
    if (!_hashFilter) return;
    const tabs = $('feed-tabs');
    if (!tabs) return;

    const pill = document.createElement('div');
    pill.id = 'mfe-hash-pill';
    pill.innerHTML = `
      <span class="mfe-pill-tag">🔍</span>
      <span>#${san(_hashFilter)}</span>
      <span class="mfe-pill-hint">— showing filtered posts</span>
      <button class="mfe-pill-clear" type="button">× Clear filter</button>`;
    tabs.insertAdjacentElement('afterend', pill);
    pill.querySelector('.mfe-pill-clear')
        ?.addEventListener('click', () => setHashFilter(null));

    // Search results use the same paginated Feed loader, so Load more remains available.
    const lm = $('load-more-btn');
    if (lm) lm.style.display = '';
  }

  /** Restore the feed to its pre-filter state by simulating a tab click. */
  function clearHashFilter() {
    _hashFilter = null;
    _feedSearchQuery = '';
    const searchInput = $('feed-search-input');
    if (searchInput) searchInput.value = '';
    document.querySelectorAll('#hot-topics [data-feed-hashtag]').forEach(chip => chip.classList.remove('mfe-active'));
    $('mfe-hash-pill')?.remove();
    fetchFeedPage(true);
    const lm = $('load-more-btn');
    if (lm) lm.style.display = '';
  }

  async function filterFeedByHashtag() {
    const fp = $('feed-posts');
    if (!fp || !_hashFilter) return;
    const S  = getS();
    const sb = getSb();
    if (!sb || S.isGuest || !S.userId) {
      fp.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">🔒</div><h3>Sign in to search hashtags</h3></div>';
      return;
    }

    fp.innerHTML = `
      <div class="skel-post">
        <div class="skel-row">
          <div class="skeleton skel-circle"></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
            <div class="skeleton skel-line" style="width:40%"></div>
            <div class="skeleton skel-line" style="width:22%;height:11px;"></div>
          </div>
        </div>
        <div class="skeleton skel-line" style="width:100%;margin-bottom:8px;"></div>
        <div class="skeleton skel-line" style="width:72%;"></div>
      </div>`;

    try {
      const { data: posts, error } = await sb
        .from('posts')
        .select('id,user_id,content,post_type,visibility,created_at,updated_at,media_url,media_type,media_size,post_meta')
        .eq('visibility', 'public')
        .ilike('content', `%#${_hashFilter}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (!posts?.length) {
        fp.innerHTML = `
          <div class="feed-empty">
            <div class="feed-empty-icon">🏷️</div>
            <h3>No posts for #${san(_hashFilter)}</h3>
            <p>Be the first to write about this topic using the composer above.</p>
          </div>`;
        return;
      }

      // ── Author profiles ──────────────────────────────────────────────
      const uids = [...new Set(posts.map(p => p.user_id).filter(Boolean))];
      const dirMap = new Map();
      if (uids.length) {
        try {
          const { data: profiles } = await sb
            .from('accounts')
            .select('id,username,display_name,avatar_url,crockroach_score')
            .in('id', uids);
          (profiles || []).forEach(p => dirMap.set(p.id, p));
        } catch (_) {}
      }

      // ── Engagement ───────────────────────────────────────────────────
      _filteredEng.clear();
      try {
        const { data: engRows } = await sb.rpc('get_post_engagement', {
          p_post_ids: posts.map(p => p.id)
        });
        (engRows || []).forEach(row => {
          _filteredEng.set(row.post_id, {
            likes:    toNum(row.like_count),
            comments: toNum(row.comment_count),
            liked:    !!row.liked_by_me
          });
        });
      } catch (_) {}

      // ── Render cards ─────────────────────────────────────────────────
      fp.innerHTML = posts.map(post => {
        const author = dirMap.get(post.user_id)
                    || { username: 'member', display_name: 'Member', crockroach_score: 0 };
        const eng    = _filteredEng.get(post.id) || { likes: 0, comments: 0, liked: false };
        return buildFilteredCard(post, author, eng);
      }).join('');

      // Add follow buttons, then hydrate state
      setTimeout(() => {
        scanFeedCards(fp);
        hydrateFollowBtns(fp);
      }, 0);

    } catch (e) {
      fp.innerHTML = `
        <div class="feed-empty">
          <div class="feed-empty-icon">⚠️</div>
          <h3>Filter unavailable</h3>
          <p>${san(e?.message || 'Could not filter right now. Please try again.')}</p>
        </div>`;
    }
  }

  /**
   * Build a post card for the hashtag-filtered view.
   * Structure mirrors app.js renderFeedPosts() so existing delegated
   * listeners (comments, share, open-profile) keep working.
   * Likes are handled by our own capture-phase listener to avoid
   * the closure renderFeedPosts() being called by togglePostLike().
   */
  function buildFilteredCard(post, author, eng) {
    const S        = getS();
    const display  = san(author.display_name || author.username || 'Member');
    const username = san(author.username || 'member');
    const score    = toNum(author.crockroach_score);
    const badge    = score >= 700
      ? '<span class="post-badge gold">Gold</span>'
      : score >= 420
        ? '<span class="post-badge silver">Silver</span>'
        : '';
    const av       = safeUrl(author.avatar_url || '');
    const ownerId  = san(post.user_id || '');
    const postId   = san(post.id || '');
    const liked    = !!eng.liked;
    const isMine   = post.user_id === S.userId;

    return `
      <article class="post-card"
        data-post-id="${postId}"
        data-post-owner="${ownerId}"
        data-post-type="${san(post.post_type || 'text')}">

        <div class="post-header">
          <div class="post-avatar" style="${av ? 'padding:0;overflow:hidden;' : ''}">
            ${av
              ? `<img src="${san(av)}" alt="${display}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%;" loading="lazy" onerror="this.parentElement.textContent='${display.charAt(0)}';">`
              : display.charAt(0)}
          </div>
          <div class="post-meta">
            <div class="post-author">
              <button type="button" class="post-author-link" data-open-profile="${ownerId}">
                ${display} ${badge}
              </button>
            </div>
            <div class="post-time">@${username} · ${relTime(post.created_at)}</div>
          </div>
          ${isMine
            ? `<button class="post-more-btn" type="button" data-feed-action="delete" data-post-id="${postId}" title="Delete post">⋯</button>`
            : ''}
        </div>

        <div class="post-body">
          <div class="post-text${String(post.content || '').trim().length > 160 ? '' : ' large'}">
            ${renderHashtags(String(post.content || '').trim())}
          </div>
          ${post.media_url
            ? `<img class="feed-post-media js-photo-open" src="${san(post.media_url)}" alt="Photo" loading="lazy" data-photo-url="${san(post.media_url)}">`
            : ''}
        </div>

        <div class="post-actions">
          <button class="action-btn like-btn${liked ? ' liked' : ''}"
            type="button"
            data-mfe-action="like"
            data-post-id="${postId}"
            aria-pressed="${liked}">
            <span class="action-icon">${liked ? '♥' : '♡'}</span>
            <span class="like-count">${eng.likes}</span>
          </button>
          <button class="action-btn comment-btn" type="button"
            data-feed-action="comments" data-post-id="${postId}">
            <span class="action-icon">💬</span>
            <span>${eng.comments}</span>
          </button>
          <button class="action-btn share-btn" type="button"
            data-feed-action="copy" data-post-id="${postId}">
            <span class="action-icon">↗</span>
            <span>Share</span>
          </button>
        </div>

        <!-- comments section kept so app.js comment loader can inject into it -->
        <div class="comments-section" data-post-id="${postId}" aria-hidden="true"></div>
      </article>`;
  }

  /**
   * Handle a like click inside the filtered view directly via Supabase,
   * bypassing the closure togglePostLike() which would call renderFeedPosts()
   * and overwrite the filtered results.
   */
  async function handleFilteredLike(postId) {
    const S  = getS();
    const sb = getSb();
    if (!S.userId || S.isGuest) { window.toast?.('Sign in to like posts', '🔒'); return; }
    if (!sb || !postId) return;

    const current  = _filteredEng.get(postId) || { likes: 0, comments: 0, liked: false };
    const wantLike = !current.liked;

    // Optimistic update
    const optimistic = { ...current, liked: wantLike, likes: Math.max(0, current.likes + (wantLike ? 1 : -1)) };
    _filteredEng.set(postId, optimistic);
    applyLikeToCard(postId, optimistic);

    try {
      if (wantLike) {
        const { error } = await sb.from('post_likes').insert({ post_id: postId, user_id: S.userId });
        // Ignore duplicate-key errors (user already liked)
        if (error && !/duplicate|already/i.test(error.message)) throw error;
      } else {
        await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', S.userId);
      }
    } catch (e) {
      // Rollback
      _filteredEng.set(postId, current);
      applyLikeToCard(postId, current);
      window.toast?.(e?.message || 'Could not update like.', '⚠️');
    }
  }

  function applyLikeToCard(postId, eng) {
    const card = document.querySelector(`#feed-posts .post-card[data-post-id="${CSS.escape(postId)}"]`);
    if (!card) return;
    const btn   = card.querySelector('[data-mfe-action="like"]');
    if (!btn)   return;
    btn.classList.toggle('liked', !!eng.liked);
    btn.setAttribute('aria-pressed', eng.liked);
    const icon  = btn.querySelector('.action-icon');
    const count = btn.querySelector('.like-count');
    if (icon)  icon.textContent  = eng.liked ? '♥' : '♡';
    if (count) count.textContent = eng.likes;
  }

  /* ─────────────────────────────────────────────────────────
     MUTATION OBSERVERS
  ───────────────────────────────────────────────────────── */

  function setupObservers() {
    // Feed post cards – added by renderFeedPosts()
    const feedEl = $('feed-posts');
    if (feedEl) {
      new MutationObserver(() => {
        if (!_hashFilter) scanFeedCards(feedEl); // don't touch filter results
        enhanceTrendingPolls();                  // always re-enhance after renders
      }).observe(feedEl, { childList: true });
    }

    // Trending polls sidebar – added by renderFeedSidebars()
    const trendEl = $('trending-polls-list');
    if (trendEl) {
      new MutationObserver(enhanceTrendingPolls).observe(trendEl, { childList: true });
    }

    // Suggestions container – re-inject after renderFeedSidebars() overwrites it
    const sugEl = $('active-users-list');
    if (sugEl) {
      new MutationObserver(() => {
        if (_sugLock) return; // our own render triggered this – ignore
        // External write (renderFeedSidebars). Re-inject our content.
        setTimeout(async () => {
          if (_sugLock) return;
          updateSuggestionsTitle();
          if (_suggestions.length) {
            renderSuggestions();
          } else {
            await loadSuggestions();
            renderSuggestions();
          }
        }, 0);
      }).observe(sugEl, { childList: true });
    }
  }

  /* ─────────────────────────────────────────────────────────
     GLOBAL EVENT LISTENERS  (capture phase — run first)
  ───────────────────────────────────────────────────────── */

  function bindEvents() {
    if (document.body.dataset.mfeEvBound) return;
    document.body.dataset.mfeEvBound = '1';

    document.addEventListener('click', async e => {
      // ── Follow buttons ─────────────────────────────────────
      const followBtn = e.target.closest('[data-mfe-follow]');
      if (followBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await doFollow(followBtn);
        return;
      }

      // ── Hot-topics hashtag chips → filter feed ─────────────
      const hotChip = e.target.closest('#hot-topics [data-feed-hashtag]');
      if (hotChip) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const tag = hotChip.dataset.feedHashtag;
        // Toggle: clicking the already-active chip clears the filter
        if (tag && tag === _hashFilter) setHashFilter(null);
        else if (tag)                   setHashFilter(tag);
        return;
      }

      // ── Like buttons in filtered-hashtag view ──────────────
      // Intercept so we don't call the closure togglePostLike()
      // which would trigger renderFeedPosts() and wipe our results.
      if (_hashFilter) {
        const likeBtn = e.target.closest('[data-mfe-action="like"][data-post-id]');
        if (likeBtn) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          await handleFilteredLike(likeBtn.dataset.postId);
          return;
        }
      }
    }, true); // ← capture phase
  }

  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */

  function ensureFeedSearch() {
    const tabs = $('feed-tabs');
    if (!tabs || !$('pg-feed')) return;
    let wrap = $('feed-search-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'feed-search-wrap';
      wrap.className = 'mfe-feed-search';
      wrap.innerHTML = `
        <span class="mfe-feed-search-icon" aria-hidden="true">🔎</span>
        <input id="feed-search-input" class="mfe-feed-search-input" type="search" maxlength="80" autocomplete="off" placeholder="Search posts or #hashtags…">
        <button type="button" class="mfe-feed-search-clear" id="feed-search-clear" aria-label="Clear search">×</button>`;
      tabs.parentNode.insertBefore(wrap, tabs);
    }
    const input = $('feed-search-input');
    if (!input || input.dataset.mfeBound) return;
    input.dataset.mfeBound = '1';
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      _feedSearchQuery = String(input.value || '').trim();
      const hashtag = _feedSearchQuery.match(/^#([A-Za-z0-9_]{1,63})$/);
      _hashFilter = hashtag ? hashtag[1].toLowerCase() : null;
      document.querySelectorAll('#hot-topics [data-feed-hashtag]').forEach(chip => chip.classList.toggle('mfe-active', chip.dataset.feedHashtag === _hashFilter));
      renderHashPill();
      timer = setTimeout(() => fetchFeedPage(true), 240);
    });
    $('feed-search-clear')?.addEventListener('click', () => {
      input.value = '';
      _feedSearchQuery = '';
      _hashFilter = null;
      document.querySelectorAll('#hot-topics [data-feed-hashtag]').forEach(chip => chip.classList.remove('mfe-active'));
      $('mfe-hash-pill')?.remove();
      fetchFeedPage(true);
      input.focus();
    });
  }

  async function init() {
    injectStyles();
    bindEvents();
    ensureFeedSearch();
    setupObservers();
    updateSuggestionsTitle();

    const isFeedActive = $('pg-feed')?.classList.contains('active');
    if (isFeedActive) {
      scanFeedCards();
      enhanceTrendingPolls();
      if (!getS().isGuest) {
        await loadSuggestions();
        renderSuggestions();
      }
    }

    // React when the Feed page becomes active
    const feedPage = $('pg-feed');
    if (feedPage) {
      new MutationObserver(mutations => {
        mutations.forEach(m => {
          if (m.target !== feedPage) return;
          if (!feedPage.classList.contains('active')) return;
          updateSuggestionsTitle();
          ensureFeedSearch();
          const S = getS();
          if (S.isGuest) { renderSuggestions(); return; }
          if (_suggestions.length) renderSuggestions();
          else loadSuggestions().then(renderSuggestions);
        });
      }).observe(feedPage, { attributes: true, attributeFilter: ['class'] });
    }

    // React when the user logs in / out
    window.addEventListener('mortalive-auth-state', async () => {
      // Reset suggestions on auth change
      _suggestions = [];
      _sugPage     = 0;
      updateSuggestionsTitle();
      if (!getS().isGuest) {
        await loadSuggestions();
        renderSuggestions();
        if (!_hashFilter) scanFeedCards(); // add follow btns to existing cards
      } else {
        renderSuggestions();
      }
    });

    console.log('[MFE] Feed Enhancement Layer ready ✓');
  }

  // Delay init so app.js (socket, auth) fully bootstraps first
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 750), { once: true });
  } else {
    setTimeout(init, 750);
  }

})();


/* ═══════════════════════════════════════════════════════════════════════
   MORTALIVE MESSAGES v160 — BASIC WEB MESSAGING
   Adds:
   • emoji picker
   • image/video attachments (50 MB client guard; Storage bucket also capped)
   • reply to message
   • reactions
   • forward to up to 5 chats
   • copy message
   • delete for me
   • delete for everyone (sender only)
   • edit own text messages
   • attachment previews + signed private URLs
   • durable per-user message deletion
   • message action menus
   Search tab is intentionally untouched.
   ═══════════════════════════════════════════════════════════════════════ */
(function installMessagesV160BasicFeatures() {
  'use strict';
  if (typeof window === 'undefined') return;

  const M160 = {
    ready: false,
    loadingByRoom: new Set(),
    extrasByRoom: new Map(),
    replyToId: null,
    attachment: null,
    reactionEmoji: '❤️',
    maxAttachmentBytes: 50 * 1024 * 1024,
    emojiSet: ['❤️','😂','👍','😮','😢','🔥','👏','🎉','😍','🙏','💯','🤝','😎','🙌','✅','❌','💙','🤣']
  };

  const esc = (value) => {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  };

  const msgToast = (text, icon='💬') => {
    try { toast(text, icon); } catch (_) { console.warn('[Messages v160]', text); }
  };

  function activeRoom() {
    return messagesState.activeConvId ? String(messagesState.activeConvId) : '';
  }

  function activeMessages() {
    const roomId = activeRoom();
    return roomId ? (messagesState.messages[roomId] || []) : [];
  }

  function baseMessageById(id) {
    return activeMessages().find(m => String(m.id) === String(id)) || null;
  }

  function ensureComposerTools() {
    const wrap = document.querySelector('#pg-messages .messages-composer-input-group');
    const input = $('msg-composer-input');
    if (!wrap || !input || wrap.dataset.m160Ready === '1') return;
    wrap.dataset.m160Ready = '1';

    const tools = document.createElement('div');
    tools.className = 'm160-composer-tools';
    tools.innerHTML = `
      <button type="button" class="m160-tool-btn" id="m160-emoji-btn" aria-label="Add emoji" title="Emoji">😊</button>
      <button type="button" class="m160-tool-btn" id="m160-attach-btn" aria-label="Attach image or video" title="Image or video">＋</button>
      <input type="file" id="m160-attach-input" accept="image/*,video/*" hidden>
    `;
    wrap.insertBefore(tools, input);

    const reply = document.createElement('div');
    reply.id = 'm160-reply-bar';
    reply.className = 'm160-reply-bar';
    reply.innerHTML = `<div><strong>Replying to</strong><span id="m160-reply-text"></span></div><button type="button" id="m160-reply-cancel" aria-label="Cancel reply">×</button>`;
    const composerWrap = wrap.closest('.messages-composer-wrap');
    if (composerWrap) composerWrap.insertBefore(reply, wrap);

    const attachInfo = document.createElement('div');
    attachInfo.id = 'm160-attachment-preview';
    attachInfo.className = 'm160-attachment-preview';
    if (composerWrap) composerWrap.insertBefore(attachInfo, wrap);

    $('m160-emoji-btn')?.addEventListener('click', toggleEmojiPicker);
    $('m160-attach-btn')?.addEventListener('click', () => $('m160-attach-input')?.click());
    $('m160-attach-input')?.addEventListener('change', handleAttachmentSelect);
    $('m160-reply-cancel')?.addEventListener('click', cancelReply);

    input.addEventListener('input', updateV160SendState);
    updateV160SendState();
  }

  function toggleEmojiPicker() {
    let picker = $('m160-emoji-picker');
    if (picker) {
      picker.remove();
      return;
    }
    picker = document.createElement('div');
    picker.id = 'm160-emoji-picker';
    picker.className = 'm160-emoji-picker';
    picker.innerHTML = M160.emojiSet.map(e => `<button type="button" class="m160-emoji" data-m160-emoji="${esc(e)}">${e}</button>`).join('');
    const composer = document.querySelector('#pg-messages .messages-composer-wrap');
    if (!composer) return;
    composer.appendChild(picker);
    picker.addEventListener('click', (event) => {
      const b = event.target.closest('[data-m160-emoji]');
      if (!b) return;
      const input = $('msg-composer-input');
      if (!input) return;
      input.value += b.dataset.m160Emoji || '';
      input.focus();
      updateV160SendState();
    });
  }

  function updateV160SendState() {
    const input = $('msg-composer-input');
    const btn = $('msg-composer-send');
    if (!btn) return;
    btn.disabled = !(input?.value.trim() || M160.attachment);
  }

  async function handleAttachmentSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      M160.attachment = null;
      updateAttachmentPreview();
      updateV160SendState();
      return;
    }
    if (file.size > M160.maxAttachmentBytes) {
      event.target.value = '';
      M160.attachment = null;
      updateAttachmentPreview();
      msgToast('Images and videos must be 50 MB or smaller.', '⚠️');
      return;
    }
    if (!/^image\/|^video\//i.test(file.type)) {
      event.target.value = '';
      M160.attachment = null;
      updateAttachmentPreview();
      msgToast('Only images and videos can be attached.', '⚠️');
      return;
    }
    M160.attachment = file;
    updateAttachmentPreview();
    updateV160SendState();
  }

  function updateAttachmentPreview() {
    const host = $('m160-attachment-preview');
    if (!host) return;
    if (!M160.attachment) {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = 'flex';
    host.innerHTML = `
      <span class="m160-attachment-icon">${M160.attachment.type.startsWith('video/') ? '🎬' : '🖼️'}</span>
      <span class="m160-attachment-name">${esc(M160.attachment.name)}</span>
      <span class="m160-attachment-size">${(M160.attachment.size / (1024*1024)).toFixed(1)} MB</span>
      <button type="button" id="m160-attachment-remove" aria-label="Remove attachment">×</button>
    `;
    $('m160-attachment-remove')?.addEventListener('click', clearAttachment);
  }

  function clearAttachment() {
    M160.attachment = null;
    const input = $('m160-attach-input');
    if (input) input.value = '';
    updateAttachmentPreview();
    updateV160SendState();
  }

  function setReply(messageId) {
    const msg = baseMessageById(messageId);
    if (!msg) return;
    M160.replyToId = messageId;
    const bar = $('m160-reply-bar');
    const text = $('m160-reply-text');
    if (text) text.textContent = ` ${String(msg.text || 'Message').slice(0, 120)}`;
    if (bar) bar.style.display = 'flex';
    $('msg-composer-input')?.focus();
  }

  function cancelReply() {
    M160.replyToId = null;
    const bar = $('m160-reply-bar');
    if (bar) bar.style.display = 'none';
  }

  function messageActionItems(message) {
    const own = !!message?.isMe;
    const hasText = !!String(message?.text || '').trim();
    const items = [
      ['reply', '↩ Reply'],
      ['react', '😊 React'],
      ['forward', '↗ Forward'],
      ['copy', '📋 Copy']
    ];
    if (hasText && own) items.push(['edit', '✏️ Edit']);
    items.push(['delete_me', '🗑️ Delete for me']);
    if (own) items.push(['delete_all', '🗑️ Delete for everyone']);
    return items;
  }

  function openMessageMenu(row, message) {
    document.querySelector('.m160-message-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'm160-message-menu';
    menu.innerHTML = messageActionItems(message)
      .map(([action, label]) => `<button type="button" data-m160-message-action="${action}">${label}</button>`)
      .join('');
    row.appendChild(menu);
    const close = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== row) {
        menu.remove();
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  function enhanceMessageRow(row, message, extra) {
    row.dataset.m160MessageId = String(message.id);
    row.classList.add('m160-message-row');
    const bubble = row.querySelector('.msg-bubble');
    if (!bubble) return;

    const deleted = !!extra?.deleted_for_everyone_at;
    if (extra?.deletedForMe) {
      row.style.display = 'none';
      return;
    }
    row.style.display = '';
    bubble.innerHTML = '';

    if (deleted) {
      bubble.innerHTML = '<span class="m160-deleted">This message was deleted</span>';
      row.querySelector('.m160-message-actions')?.remove();
      return;
    }

    const content = document.createElement('div');
    content.className = 'm160-message-content';

    if (extra?.reply_to_id) {
      const replied = activeMessages().find(m => String(m.id) === String(extra.reply_to_id));
      const replyText = replied?.text || extra.replyText || 'Original message';
      const quote = document.createElement('div');
      quote.className = 'm160-reply-quote';
      quote.textContent = `↩ ${String(replyText).slice(0, 100)}`;
      content.appendChild(quote);
    }

    if (extra?.forwarded_from_message_id) {
      const forwarded = document.createElement('div');
      forwarded.className = 'm160-forwarded-label';
      forwarded.textContent = '↗ Forwarded message';
      content.appendChild(forwarded);
    }

    if (extra?.attachment_path && extra?.attachment_url) {
      const kind = String(extra.attachment_kind || '').toLowerCase();
      const media = kind === 'video'
        ? `<video src="${esc(extra.attachment_url)}" controls preload="metadata" class="m160-media-video"></video>`
        : `<img src="${esc(extra.attachment_url)}" alt="${esc(extra.attachment_name || 'Image')}" loading="lazy" class="m160-media-image">`;
      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'm160-media-wrap';
      mediaWrap.innerHTML = media;
      content.appendChild(mediaWrap);
    }

    if (extra?.content || message.text) {
      const textNode = document.createElement('div');
      textNode.className = 'm160-text';
      textNode.textContent = extra?.content ?? message.text ?? '';
      content.appendChild(textNode);
    }

    if (extra?.edited_at) {
      const edited = document.createElement('span');
      edited.className = 'm160-edited';
      edited.textContent = 'edited';
      content.appendChild(edited);
    }

    bubble.appendChild(content);

    const oldTime = row.querySelector('.msg-time');
    if (extra?.reactions?.length) {
      const reactions = document.createElement('div');
      reactions.className = 'm160-reactions';
      const grouped = new Map();
      extra.reactions.forEach(r => {
        if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
        grouped.get(r.emoji).push(r.user_id);
      });
      grouped.forEach((users, emoji) => {
        const mine = users.includes(S.userId);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `m160-reaction-chip${mine ? ' mine' : ''}`;
        chip.dataset.m160ReactEmoji = emoji;
        chip.dataset.m160MessageId = String(message.id);
        chip.textContent = `${emoji} ${users.length}`;
        reactions.appendChild(chip);
      });
      content.appendChild(reactions);
    }

    const actions = document.createElement('div');
    actions.className = 'm160-message-actions';
    actions.innerHTML = `
      <button type="button" class="m160-mini-action" data-m160-quick-reply title="Reply">↩</button>
      <button type="button" class="m160-mini-action" data-m160-quick-react title="React">😊</button>
      <button type="button" class="m160-mini-action" data-m160-more title="More">⋯</button>
    `;
    // Keep reply/react/more controls inside the bubble as an absolute
    // overlay. Appending them to .msg-row makes them a normal flex child,
    // which widens the message row and pushes the actual message inward.
    bubble.appendChild(actions);

    oldTime?.classList.add('m160-time');
  }

  async function loadExtras(roomId) {
    const key = String(roomId || '');
    if (!key || !sb || M160.loadingByRoom.has(key)) return;
    M160.loadingByRoom.add(key);
    try {
      const rows = activeMessages();
      const ids = rows.map(m => m.id).filter(Boolean);
      if (!ids.length) {
        M160.extrasByRoom.set(key, new Map());
        return;
      }

      const [msgRes, reactRes, delRes] = await Promise.all([
        sb.from('messages')
          .select('id,content,reply_to_id,forwarded_from_message_id,deleted_for_everyone_at,deleted_by,edited_at,attachment_path,attachment_name,attachment_mime,attachment_size,attachment_kind')
          .in('id', ids),
        sb.from('message_reactions')
          .select('message_id,user_id,emoji')
          .in('message_id', ids),
        sb.from('message_deletions')
          .select('message_id,user_id')
          .eq('user_id', S.userId)
          .in('message_id', ids)
      ]);

      if (msgRes.error) throw msgRes.error;
      if (reactRes.error) throw reactRes.error;
      if (delRes.error) throw delRes.error;

      const reactMap = new Map();
      (reactRes.data || []).forEach(r => {
        const id = String(r.message_id);
        if (!reactMap.has(id)) reactMap.set(id, []);
        reactMap.get(id).push(r);
      });

      const deletedForMe = new Set((delRes.data || []).map(r => String(r.message_id)));
      const extraMap = new Map();

      for (const r of (msgRes.data || [])) {
        let attachment_url = null;
        if (r.attachment_path && !r.deleted_for_everyone_at) {
          try {
            const { data, error } = await sb.storage.from('message-media').createSignedUrl(r.attachment_path, 3600);
            if (!error) attachment_url = data?.signedUrl || null;
          } catch (_) {}
        }
        extraMap.set(String(r.id), {
          ...r,
          attachment_url,
          deletedForMe: deletedForMe.has(String(r.id)),
          reactions: reactMap.get(String(r.id)) || []
        });
      }
      M160.extrasByRoom.set(key, extraMap);
    } finally {
      M160.loadingByRoom.delete(key);
    }
  }

  async function enhanceActiveRoom() {
    ensureComposerTools();
    const roomId = activeRoom();
    if (!roomId) return;
    await loadExtras(roomId);
    const container = $('msg-thread-messages');
    if (!container) return;
    const rows = Array.from(container.querySelectorAll('.msg-row'));
    const msgs = messagesState.messages[roomId] || [];
    rows.forEach((row, index) => {
      const message = msgs[index];
      if (!message) return;
      enhanceMessageRow(row, message, M160.extrasByRoom.get(roomId)?.get(String(message.id)) || {});
    });
    // Mark read as soon as the conversation is viewed.
    try {
      await sb.from('message_room_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('room_id', roomId)
        .eq('user_id', S.userId);
    } catch (_) {}
  }

  async function renderAfterBase(roomId) {
    // Allow DOM paint before adding action controls/media.
    requestAnimationFrame(() => { enhanceActiveRoom().catch(e => console.warn('[Messages v160] enhance:', e)); });
  }

  const baseRenderMessages = window.renderMessages;
  if (typeof renderMessages === 'function') {
    const original = renderMessages;
    renderMessages = function v160RenderMessages(convId) {
      original.call(this, convId);
      renderAfterBase(convId);
    };
  } else if (baseRenderMessages) {
    window.renderMessages = function v160RenderMessages(convId) {
      baseRenderMessages(convId);
      renderAfterBase(convId);
    };
  }

  if (typeof renderDirectMessages === 'function') {
    const originalDirect = renderDirectMessages;
    renderDirectMessages = function v160RenderDirectMessages(convId) {
      originalDirect.call(this, convId);
      renderAfterBase(convId);
    };
  }

  async function uploadAttachment(file, roomId) {
    const ext = (file.name.split('.').pop() || (file.type.startsWith('video/') ? 'mp4' : 'jpg'))
      .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const path = `${S.userId}/${roomId}/${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}.${ext}`;
    const { error } = await sb.storage.from('message-media').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;
    return path;
  }

  async function sendV160Message() {
    const input = $('msg-composer-input');
    const roomId = activeRoom();
    if (!input || !roomId || !S.userId || S.isGuest || !sb) return;
    const text = input.value.trim();
    if (!text && !M160.attachment) return;
    if (text.length > 1000) {
      msgToast('Message is too long.', '⚠️');
      return;
    }

    const sendBtn = $('msg-composer-send');
    try {
      if (sendBtn) sendBtn.disabled = true;

      let attachment_path = null;
      let attachment_kind = null;
      let attachment_mime = null;
      let attachment_name = null;
      let attachment_size = null;

      if (M160.attachment) {
        if (M160.attachment.size > M160.maxAttachmentBytes) throw new Error('Images and videos must be 50 MB or smaller.');
        attachment_path = await uploadAttachment(M160.attachment, roomId);
        attachment_kind = M160.attachment.type.startsWith('video/') ? 'video' : 'image';
        attachment_mime = M160.attachment.type;
        attachment_name = M160.attachment.name;
        attachment_size = M160.attachment.size;
      }

      const senderHash = await (typeof ownHash === 'function'
        ? ownHash()
        : `mortalive:${S.userId}`);

      const payload = {
        room_id: roomId,
        sender_user_id: S.userId,
        sender_hash: senderHash,
        direction: 'outgoing',
        content: text,
        reply_to_id: M160.replyToId ? Number(M160.replyToId) : null,
        forwarded_from_message_id: null,
        attachment_path,
        attachment_kind,
        attachment_mime,
        attachment_name,
        attachment_size
      };

      const { data, error } = await sb.from('messages').insert(payload)
        .select('id,room_id,sender_hash,direction,content,created_at')
        .single();
      if (error) throw error;

      if (!messagesState.messages[roomId]) messagesState.messages[roomId] = [];
      messagesState.messages[roomId].push({
        id: data.id,
        text: data.content || text,
        isMe: true,
        senderId: S.userId,
        senderHash: data.sender_hash,
        timestamp: new Date(data.created_at),
        time: formatTime(new Date(data.created_at))
      });

      input.value = '';
      input.style.height = 'auto';
      cancelReply();
      clearAttachment();

      const conv = [...(messagesState.groups || []), ...(messagesState.conversations || [])]
        .find(c => String(c.id) === String(roomId));
      if (conv) {
        conv.lastMessage = text || (attachment_kind === 'video' ? '🎬 Video' : '🖼️ Image');
        conv.lastAt = data.created_at;
      }

      M160.extrasByRoom.delete(String(roomId));
      if (messagesState.activeConvType === 'group') renderMessages(roomId);
      else renderDirectMessages(roomId);
      dbRenderConversationList($('msg-search-input')?.value || '');
      saveMessagesToStorage();
    } catch (err) {
      console.error('[Messages v160] send failed:', err);
      msgToast(err?.message || 'Could not send message.', '⚠️');
      // If upload succeeded but message insert failed, remove the orphan object.
      // This is best-effort and scoped to the current user's object path.
      if (M160.attachment === null && attachment_path) {
        try { await sb.storage.from('message-media').remove([attachment_path]); } catch (_) {}
      }
    } finally {
      updateV160SendState();
    }
  }

  // Intercept the existing composer handlers before the older DB handler.
  document.addEventListener('click', (event) => {
    const btn = event.target.closest?.('#msg-composer-send');
    if (!btn) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendV160Message().catch(e => console.warn('[Messages v160] send handler:', e));
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.target?.id !== 'msg-composer-input' || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendV160Message().catch(e => console.warn('[Messages v160] enter handler:', e));
  }, true);

  async function mutateReaction(messageId, emoji) {
    const existing = await sb.from('message_reactions')
      .select('message_id,user_id,emoji')
      .eq('message_id', messageId)
      .eq('user_id', S.userId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.emoji === emoji) {
        const { error } = await sb.from('message_reactions')
          .delete().eq('message_id', messageId).eq('user_id', S.userId);
        if (error) throw error;
      } else {
        const { error } = await sb.from('message_reactions')
          .update({ emoji }).eq('message_id', messageId).eq('user_id', S.userId);
        if (error) throw error;
      }
    } else {
      const { error } = await sb.from('message_reactions')
        .insert({ message_id: messageId, user_id: S.userId, emoji });
      if (error) throw error;
    }
    M160.extrasByRoom.delete(activeRoom());
    await enhanceActiveRoom();
  }

  async function deleteForMe(messageId) {
    const { error } = await sb.from('message_deletions')
      .upsert({ message_id: Number(messageId), user_id: S.userId }, { onConflict: 'message_id,user_id' });
    if (error) throw error;
    M160.extrasByRoom.delete(activeRoom());
    await enhanceActiveRoom();
  }

  async function deleteForEveryone(messageId) {
    const message = baseMessageById(messageId);
    if (!message?.isMe) throw new Error('You can only delete your own messages for everyone.');
    const ok = window.confirm('Delete this message for everyone?');
    if (!ok) return;
    const { error } = await sb.from('messages')
      .update({ deleted_for_everyone_at: new Date().toISOString(), deleted_by: S.userId })
      .eq('id', Number(messageId))
      .eq('sender_user_id', S.userId);
    if (error) throw error;
    M160.extrasByRoom.delete(activeRoom());
    await enhanceActiveRoom();
  }

  async function editMessage(messageId) {
    const message = baseMessageById(messageId);
    if (!message?.isMe) return;
    const extra = M160.extrasByRoom.get(activeRoom())?.get(String(messageId));
    if (extra?.attachment_path) {
      msgToast('Attachment messages cannot be edited.', 'ℹ️');
      return;
    }
    const next = window.prompt('Edit message:', String(message.text || ''));
    if (next === null) return;
    const clean = next.trim();
    if (!clean) {
      msgToast('Edited message cannot be empty.', '⚠️');
      return;
    }
    if (clean.length > 1000) {
      msgToast('Message is too long.', '⚠️');
      return;
    }
    const { error } = await sb.from('messages')
      .update({ content: clean, edited_at: new Date().toISOString() })
      .eq('id', Number(messageId))
      .eq('sender_user_id', S.userId);
    if (error) throw error;
    M160.extrasByRoom.delete(activeRoom());
    await loadDbMessages(activeRoom());
    if (messagesState.activeConvType === 'group') renderMessages(activeRoom());
    else renderDirectMessages(activeRoom());
  }

  async function copyMessage(messageId) {
    const message = baseMessageById(messageId);
    const extra = M160.extrasByRoom.get(activeRoom())?.get(String(messageId));
    const text = String(extra?.content ?? message?.text ?? '');
    if (!text) {
      msgToast('Nothing to copy.', 'ℹ️');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      msgToast('Message copied.', '✓');
    } catch (_) {
      msgToast('Could not copy the message.', '⚠️');
    }
  }

  function openForwardDialog(messageId) {
    document.querySelector('.m160-forward-backdrop')?.remove();
    const rooms = [...(messagesState.groups || []), ...(messagesState.conversations || [])]
      .filter(r => !r.archived && String(r.id) !== activeRoom());
    const backdrop = document.createElement('div');
    backdrop.className = 'm160-forward-backdrop';
    backdrop.innerHTML = `
      <div class="m160-forward-dialog" role="dialog" aria-modal="true">
        <div class="m160-forward-head"><strong>Forward message</strong><button type="button" data-m160-forward-close>×</button></div>
        <div class="m160-forward-list">
          ${rooms.map(r => `
            <label class="m160-forward-item">
              <input type="checkbox" value="${esc(r.id)}">
              <span>${r.type === 'group' ? '👥' : '👤'}</span>
              <span>${esc(r.name || r.display_name || r.username || 'Conversation')}</span>
            </label>`).join('') || '<div class="m160-forward-empty">No other conversations.</div>'}
        </div>
        <div class="m160-forward-actions"><button type="button" data-m160-forward-cancel>Cancel</button><button type="button" data-m160-forward-send>Forward</button></div>
      </div>`;
    document.querySelector('#pg-messages')?.appendChild(backdrop);
    const send = backdrop.querySelector('[data-m160-forward-send]');
    backdrop.addEventListener('change', () => {
      const checks = [...backdrop.querySelectorAll('input[type=checkbox]:checked')];
      if (checks.length > 5) checks[5].checked = false;
    });
    backdrop.addEventListener('click', async (event) => {
      if (event.target === backdrop || event.target.closest('[data-m160-forward-close],[data-m160-forward-cancel]')) {
        backdrop.remove(); return;
      }
      if (!event.target.closest('[data-m160-forward-send]')) return;
      const targetIds = [...backdrop.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value).slice(0,5);
      if (!targetIds.length) {
        msgToast('Choose at least one conversation.', '⚠️'); return;
      }
      try {
        send.disabled = true;
        const source = await sb.from('messages')
          .select('content,attachment_path,attachment_name,attachment_mime,attachment_size,attachment_kind')
          .eq('id', Number(messageId)).maybeSingle();
        if (source.error) throw source.error;
        if (!source.data) throw new Error('Message no longer exists.');
        for (const targetId of targetIds) {
          const senderHash = await ownHash();
          const { error } = await sb.from('messages').insert({
            room_id: targetId,
            sender_user_id: S.userId,
            sender_hash: senderHash,
            direction: 'outgoing',
            content: source.data.content || '',
            forwarded_from_message_id: Number(messageId),
            attachment_path: source.data.attachment_path || null,
            attachment_name: source.data.attachment_name || null,
            attachment_mime: source.data.attachment_mime || null,
            attachment_size: source.data.attachment_size || null,
            attachment_kind: source.data.attachment_kind || null
          });
          if (error) throw error;
        }
        backdrop.remove();
        msgToast(`Forwarded to ${targetIds.length} conversation${targetIds.length===1?'':'s'}.`, '✓');
      } catch (e) {
        send.disabled = false;
        msgToast(e?.message || 'Could not forward message.', '⚠️');
      }
    });
  }

  function showReactionPicker(row, messageId) {
    row.querySelector('.m160-reaction-picker')?.remove();
    const picker = document.createElement('div');
    picker.className = 'm160-reaction-picker';
    picker.innerHTML = M160.emojiSet.slice(0, 12)
      .map(e => `<button type="button" data-m160-picker-emoji="${esc(e)}">${e}</button>`).join('');
    const bubble = row.querySelector('.msg-bubble');
    (bubble || row).appendChild(picker);
    picker.addEventListener('click', async (event) => {
      const b = event.target.closest('[data-m160-picker-emoji]');
      if (!b) return;
      try {
        await mutateReaction(Number(messageId), b.dataset.m160PickerEmoji);
        picker.remove();
      } catch (e) {
        msgToast(e?.message || 'Could not add reaction.', '⚠️');
      }
    });
  }

  const messageHost = $('msg-thread-messages');
  if (messageHost) {
    messageHost.addEventListener('click', async (event) => {
      const row = event.target.closest('.msg-row[data-m160-message-id]');
      if (!row) return;
      const id = row.dataset.m160MessageId;
      const message = baseMessageById(id);
      if (!message) return;

      const quickReply = event.target.closest('[data-m160-quick-reply]');
      const quickReact = event.target.closest('[data-m160-quick-react]');
      const more = event.target.closest('[data-m160-more]');
      const reactionChip = event.target.closest('[data-m160-react-emoji]');
      const action = event.target.closest('[data-m160-message-action]');

      if (quickReply) { setReply(id); return; }
      if (quickReact) { showReactionPicker(row, id); return; }
      if (more) { openMessageMenu(row, message); return; }
      if (reactionChip) {
        try { await mutateReaction(Number(id), reactionChip.dataset.m160ReactEmoji); }
        catch (e) { msgToast(e?.message || 'Could not update reaction.', '⚠️'); }
        return;
      }
      if (action) {
        const a = action.dataset.m160MessageAction;
        document.querySelector('.m160-message-menu')?.remove();
        try {
          if (a === 'reply') setReply(id);
          else if (a === 'react') showReactionPicker(row, id);
          else if (a === 'forward') openForwardDialog(id);
          else if (a === 'copy') await copyMessage(id);
          else if (a === 'delete_me') await deleteForMe(id);
          else if (a === 'delete_all') await deleteForEveryone(id);
          else if (a === 'edit') await editMessage(id);
        } catch (e) {
          msgToast(e?.message || 'Message action failed.', '⚠️');
        }
      }
    });
  }

  // Keep the enhancement layer synchronized with v43 realtime INSERT renders.
  const originalSetup = window.setupRealtime;
  // We don't replace the existing realtime connection; add a lightweight
  // channel for message UPDATE/DELETE + reaction/deletion changes.
  async function setupV160Realtime() {
    if (!sb || S.isGuest || !S.userId || M160.realtime) return;
    try {
      M160.realtime = sb.channel(`mortalive-message-actions-v160-${S.userId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
          if (!payload?.new?.room_id) return;
          if (String(payload.new.room_id) === activeRoom()) {
            M160.extrasByRoom.delete(activeRoom());
            enhanceActiveRoom().catch(()=>{});
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, payload => {
          if (activeRoom()) {
            M160.extrasByRoom.delete(activeRoom());
            enhanceActiveRoom().catch(()=>{});
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_deletions' }, payload => {
          if (String(payload?.new?.user_id || '') === String(S.userId)) {
            M160.extrasByRoom.delete(activeRoom());
            enhanceActiveRoom().catch(()=>{});
          }
        })
        .subscribe();
    } catch (e) {
      console.warn('[Messages v160] realtime actions setup failed:', e);
    }
  }

  const originalInit = window.initMessages;
  window.initMessages = async function v160InitMessages() {
    if (typeof originalInit === 'function') {
      try { await originalInit(); } catch (e) { console.warn('[Messages v160] base init:', e?.message || e); }
    }
    ensureComposerTools();
    await loadExtras(activeRoom());
    await setupV160Realtime();
  };

  document.addEventListener('mortalive-auth-state', () => {
    if (!S.isGuest && S.userId && $('pg-messages')?.classList.contains('active')) {
      setTimeout(() => {
        ensureComposerTools();
        enhanceActiveRoom().catch(()=>{});
        setupV160Realtime().catch(()=>{});
      }, 50);
    }
  });

  // Re-run after conversation switches. The current v43 conversation click
  // listener uses capture phase and updates the DOM asynchronously.
  const observeThread = $('msg-thread-messages');
  if (observeThread) {
    const observer = new MutationObserver(() => {
      if (!M160.ready) return;
      window.clearTimeout(observer._t);
      observer._t = window.setTimeout(() => enhanceActiveRoom().catch(()=>{}), 40);
    });
    observer.observe(observeThread, { childList: true });
  }

  M160.ready = true;
  ensureComposerTools();
  console.log('[Messages v160] basic messaging features ready ✓');
})();

/* ═══════════════════════════════════════════════════════════════════════════
   MORTALIVE DYNAMIC ISLAND SEARCH v165 — integrated search module
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Dynamic Island Search — Mortalive
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the in-feed mfe-feed-search bar with a polished, Apple Dynamic
 * Island–inspired search pill in the topbar.
 *
 * Features:
 *  • Live Supabase search: accounts (users) + posts (content/hashtags)
 *  • Category filters: All | Users | Posts | Hashtags
 *  • Recent search history (localStorage, last 8 terms)
 *  • Keyboard navigation (↑ ↓ Enter Escape)
 *  • Bridges to the existing MFE hashtag-filter machinery
 *  • Graceful guest-mode fallback (no sign-in required to see UI)
 *  • Spring animation pill expansion identical to Apple Dynamic Island
 *
 * Compatibility: works alongside existing mortaliveFeedEnhancements() IIFE
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function MortaliveDynamicSearch () {
  'use strict';

  /* ── constants ─────────────────────────────────────────── */
  const HISTORY_KEY   = 'mortalive_search_hist_v2';
  const HISTORY_MAX   = 8;
  const DEBOUNCE_MS   = 230;
  const MAX_USERS     = 5;
  const MAX_POSTS     = 5;
  const MAX_TAGS      = 6;

  /* ── element refs ─────────────────────────────────────── */
  const $ = id => document.getElementById(id);

  /* ── state ─────────────────────────────────────────────── */
  let _filter        = 'all';   // all | users | posts | tags
  let _query         = '';
  let _debounceTimer = null;
  let _reqId         = 0;       // cancels stale fetch responses
  let _selectedIdx   = -1;      // keyboard navigation cursor
  let _resultItems   = [];      // flat list of rendered rows for keyboard nav
  let _history       = loadHistory();
  let _open          = false;

  /* ─────────────────────────────────────────────────────────
     HISTORY HELPERS
  ───────────────────────────────────────────────────────── */
  function loadHistory () {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').slice(0, HISTORY_MAX); }
    catch { return []; }
  }
  function saveHistory (term) {
    if (!term || term.length < 2) return;
    _history = [term, ..._history.filter(h => h !== term)].slice(0, HISTORY_MAX);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(_history)); } catch {}
  }
  function clearHistory () {
    _history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  }

  /* ─────────────────────────────────────────────────────────
     SUPABASE BRIDGE
  ───────────────────────────────────────────────────────── */
  function sb ()    { return window.sb    || null; }
  function getS ()  { return window.S     || {}; }
  function isAuth() { const s = getS(); return !s.isGuest && !!s.userId; }

  /** Search users from the accounts table */
  async function searchUsers (q) {
    const client = sb();
    if (!client) return [];
    try {
      const { data } = await client
        .from('accounts')
        .select('id, username, display_name, avatar_emoji, avatar_url, crockroach_score')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .order('crockroach_score', { ascending: false })
        .limit(MAX_USERS);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[DiSearch] users error', e?.message);
      return [];
    }
  }

  /** Search public posts by content */
  async function searchPosts (q) {
    const client = sb();
    if (!client || !isAuth()) return [];
    try {
      const { data } = await client
        .from('posts')
        .select('id, user_id, content, post_type, created_at, post_meta')
        .eq('visibility', 'public')
        .ilike('content', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(MAX_POSTS);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[DiSearch] posts error', e?.message);
      return [];
    }
  }

  /** Search hashtags from the hot-topics index (DOM + Supabase) */
  async function searchTags (q) {
    // Pull from the already-rendered hot-topics list first (fast)
    const domTags = [];
    document.querySelectorAll('#hot-topics [data-feed-hashtag]').forEach(el => {
      const tag = el.dataset.feedHashtag || '';
      if (tag.toLowerCase().includes(q.toLowerCase())) {
        const count = el.querySelector('.topic-count')?.textContent || '';
        domTags.push({ tag, count });
      }
    });

    // Also query Supabase for broader results
    const client = sb();
    let sbTags = [];
    if (client) {
      try {
        const { data } = await client
          .from('posts')
          .select('content')
          .eq('visibility', 'public')
          .ilike('content', `%#${q}%`)
          .order('created_at', { ascending: false })
          .limit(60);
        if (Array.isArray(data)) {
          const freq = {};
          data.forEach(row => {
            const matches = (row.content || '').match(/#([A-Za-z0-9_]{2,50})/g) || [];
            matches.forEach(m => {
              const t = m.slice(1).toLowerCase();
              if (t.includes(q.toLowerCase())) {
                freq[t] = (freq[t] || 0) + 1;
              }
            });
          });
          sbTags = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_TAGS)
            .map(([tag, count]) => ({ tag, count: count + ' posts' }));
        }
      } catch {}
    }

    // Merge, de-dupe
    const merged = [...domTags];
    sbTags.forEach(st => {
      if (!merged.some(d => d.tag === st.tag)) merged.push(st);
    });
    return merged.slice(0, MAX_TAGS);
  }

  /* ─────────────────────────────────────────────────────────
     HIGHLIGHT HELPER
  ───────────────────────────────────────────────────────── */
  function esc (s) {
    return String(s ?? '').replace(/[&<>"']/g, m =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
  function highlight (text, q) {
    if (!q) return esc(text);
    const rx = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return esc(text).replace(rx, '<mark>$1</mark>');
  }

  /* ─────────────────────────────────────────────────────────
     RENDER HELPERS
  ───────────────────────────────────────────────────────── */
  function skeletonHTML () {
    const row = () => `
      <div class="di-skel-row">
        <div class="skeleton di-skel-circle"></div>
        <div class="di-skel-lines">
          <div class="skeleton di-skel-line" style="width:55%"></div>
          <div class="skeleton di-skel-line" style="width:35%"></div>
        </div>
      </div>`;
    return row() + row() + row();
  }

  function userRowHTML (u, q) {
    const avatar = u.avatar_url
      ? `<img src="${esc(u.avatar_url)}" alt="" loading="lazy">`
      : (u.avatar_emoji || '🦊');
    const name   = highlight(u.display_name || u.username, q);
    const handle = `@${esc(u.username)}`;
    const score  = u.crockroach_score ? `🧲 ${Number(u.crockroach_score).toLocaleString()}` : '';
    return `
      <div class="di-result-row" role="option" data-di-type="user" data-di-id="${esc(u.id)}">
        <div class="di-result-avatar">${avatar}</div>
        <div class="di-result-body">
          <div class="di-result-title">${name}</div>
          <div class="di-result-sub">${handle}</div>
        </div>
        ${score ? `<span class="di-result-badge">${score}</span>` : ''}
      </div>`;
  }

  function postRowHTML (p, q) {
    const snippet = (p.content || '').replace(/#\S+/g, '').trim().slice(0, 90);
    const tags    = ((p.content || '').match(/#([A-Za-z0-9_]+)/g) || []).slice(0, 3).join(' ');
    const kind    = p.post_meta?.kind || p.post_type || 'text';
    const icon    = kind === 'photo' ? '📷' : kind === 'poll' ? '📊' : kind === 'qna' ? '❓' : '💬';
    return `
      <div class="di-result-row" role="option" data-di-type="post" data-di-id="${esc(p.id)}">
        <div class="di-result-avatar">${icon}</div>
        <div class="di-result-body">
          <div class="di-result-title">${highlight(snippet || '(no text)', q)}</div>
          <div class="di-result-sub">${esc(tags)}</div>
        </div>
      </div>`;
  }

  function tagRowHTML (t, q) {
    const trendIcon = '📈';
    return `
      <div class="di-result-row" role="option" data-di-type="hashtag" data-di-id="${esc(t.tag)}">
        <div class="di-result-avatar">${trendIcon}</div>
        <div class="di-result-body">
          <div class="di-result-title">#${highlight(t.tag, q)}</div>
          <div class="di-result-sub">${esc(String(t.count || ''))}</div>
        </div>
      </div>`;
  }

  function sectionHTML (label, rowsHTML) {
    return `
      <div class="di-section-head">
        <span class="di-section-label">${label}</span>
      </div>
      ${rowsHTML}`;
  }

  /* ─────────────────────────────────────────────────────────
     SHOW / HIDE DROPDOWN
  ───────────────────────────────────────────────────────── */
  function openResults () {
    const r = $('di-results');
    if (!r) return;
    r.classList.add('visible');
    $('di-input')?.setAttribute('aria-expanded', 'true');
    _open = true;
  }
  function closeResults () {
    const r = $('di-results');
    if (!r) return;
    r.classList.remove('visible');
    $('di-input')?.setAttribute('aria-expanded', 'false');
    _selectedIdx = -1;
    _resultItems = [];
    _open = false;
  }

  /* ─────────────────────────────────────────────────────────
     RENDER RESULTS
  ───────────────────────────────────────────────────────── */
  function renderHistory () {
    const r = $('di-results');
    if (!r) return;
    if (_history.length === 0) {
      r.innerHTML = `
        <div class="di-empty">
          <div class="di-empty-icon">✨</div>
          <div class="di-empty-text">Start typing to search</div>
          <div class="di-empty-hint">Users · Posts · #Hashtags</div>
        </div>`;
    } else {
      const rows = _history.map(h => `
        <div class="di-result-row" role="option" data-di-type="history" data-di-id="${esc(h)}">
          <div class="di-result-avatar">🕐</div>
          <div class="di-result-body">
            <div class="di-result-title">${esc(h)}</div>
          </div>
        </div>`).join('');
      r.innerHTML = `
        <div class="di-recent-row">
          <span class="di-recent-label">Recent searches</span>
          <span class="di-recent-clear-all" id="di-clear-hist">Clear all</span>
        </div>
        ${rows}`;
      $('di-clear-hist')?.addEventListener('click', e => {
        e.stopPropagation();
        clearHistory();
        renderHistory();
        bindResultClicks();
      });
    }
    openResults();
    bindResultClicks();
    refreshKeyboardList();
  }

  async function renderSearchResults (q) {
    const r = $('di-results');
    const pill = $('di-search-pill');
    if (!r) return;

    // Show skeleton immediately
    r.innerHTML = skeletonHTML();
    openResults();
    pill?.classList.add('is-loading');

    const reqId = ++_reqId;
    const f = _filter;

    let users = [], posts = [], tags = [];
    try {
      const promises = [];
      if (f === 'all' || f === 'users') promises.push(searchUsers(q).then(d => { users = d; }));
      if (f === 'all' || f === 'posts') promises.push(searchPosts(q).then(d => { posts = d; }));
      if (f === 'all' || f === 'tags' || q.startsWith('#'))
        promises.push(searchTags(q.replace(/^#/, '')).then(d => { tags = d; }));
      await Promise.allSettled(promises);
    } finally {
      pill?.classList.remove('is-loading');
    }

    // Stale response? Discard.
    if (reqId !== _reqId) return;

    const hasAny = users.length || posts.length || tags.length;
    if (!hasAny) {
      r.innerHTML = `
        <div class="di-empty">
          <div class="di-empty-icon">🔍</div>
          <div class="di-empty-text">No results for &ldquo;${esc(q)}&rdquo;</div>
          <div class="di-empty-hint">Try a different word, handle, or #hashtag</div>
        </div>`;
      openResults();
      bindResultClicks();
      return;
    }

    let html = '';
    if (users.length) html += sectionHTML('👤 Users',    users.map(u => userRowHTML(u, q)).join(''));
    if (posts.length) html += sectionHTML('💬 Posts',    posts.map(p => postRowHTML(p, q)).join(''));
    if (tags.length)  html += sectionHTML('#️⃣ Hashtags', tags.map(t => tagRowHTML(t, q)).join(''));

    r.innerHTML = html;
    openResults();
    bindResultClicks();
    refreshKeyboardList();
  }

  /* ─────────────────────────────────────────────────────────
     CLICK HANDLERS FOR RESULT ROWS
  ───────────────────────────────────────────────────────── */
  function bindResultClicks () {
    $('di-results')?.querySelectorAll('[data-di-type]').forEach(row => {
      row.addEventListener('click', () => selectRow(row));
    });
  }

  function selectRow (row) {
    const type = row.dataset.diType;
    const id   = row.dataset.diId;

    switch (type) {
      case 'history':
        // Re-run that search
        $('di-input').value = id;
        _query = id;
        updatePillState();
        scheduleSearch(0);
        break;

      case 'user':
        saveHistory(_query);
        closeResults();
        clearPill();
        // Navigate to user's profile via the existing app.js profile viewer
        if (typeof window.showProfile === 'function') {
          window.showProfile(id);
        } else {
          // Fallback: dispatch a custom event that app.js can listen to
          document.dispatchEvent(new CustomEvent('mortalive-view-profile', { detail: { userId: id } }));
        }
        break;

      case 'post':
        saveHistory(_query);
        closeResults();
        clearPill();
        if (typeof window.mortaliveOpenPostViewer === 'function') {
          window.mortaliveOpenPostViewer(id);
        }
        break;

      case 'hashtag':
        saveHistory(`#${id}`);
        closeResults();
        // Set the query in the hidden mfe feed-search-input so the existing
        // MFE module's hash-filter logic fires exactly as normal
        const fsi = $('feed-search-input');
        if (fsi) {
          fsi.value = `#${id}`;
          fsi.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // MFE not ready yet — expose and call setHashFilter if accessible
          if (typeof window.mortaliveSetHashFilter === 'function') {
            window.mortaliveSetHashFilter(id);
          }
        }
        // Mirror in the topbar input as a visual cue
        $('di-input').value = `#${id}`;
        _query = `#${id}`;
        updatePillState();
        break;
    }
  }

  /* ─────────────────────────────────────────────────────────
     KEYBOARD NAVIGATION  ↑  ↓  Enter  Escape
  ───────────────────────────────────────────────────────── */
  function refreshKeyboardList () {
    _resultItems = Array.from($('di-results')?.querySelectorAll('[data-di-type]') || []);
    _selectedIdx = -1;
  }

  function moveSelection (delta) {
    if (!_resultItems.length) return;
    _resultItems[_selectedIdx]?.classList.remove('keyboard-selected');
    _selectedIdx = Math.max(0, Math.min(_resultItems.length - 1,
      _selectedIdx === -1 ? (delta > 0 ? 0 : _resultItems.length - 1)
                          : _selectedIdx + delta));
    const el = _resultItems[_selectedIdx];
    el?.classList.add('keyboard-selected');
    el?.scrollIntoView({ block: 'nearest' });
  }

  /* ─────────────────────────────────────────────────────────
     PILL STATE
  ───────────────────────────────────────────────────────── */
  function updatePillState () {
    const pill = $('di-search-pill');
    if (!pill) return;
    const hasVal = _query.length > 0;
    pill.classList.toggle('has-value', hasVal);
  }

  function clearPill () {
    const inp = $('di-input');
    if (inp) inp.value = '';
    _query = '';
    $('di-search-pill')?.classList.remove('has-value', 'is-focused', 'is-loading');
    closeResults();
  }

  /* ─────────────────────────────────────────────────────────
     DEBOUNCED SEARCH TRIGGER
  ───────────────────────────────────────────────────────── */
  function scheduleSearch (delay = DEBOUNCE_MS) {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (_query.length >= 1) {
        renderSearchResults(_query);
      } else {
        renderHistory();
      }
    }, delay);
  }

  /* ─────────────────────────────────────────────────────────
     PAGE VISIBILITY OBSERVER
     Show/hide the whole search wrap depending on active page
  ───────────────────────────────────────────────────────── */
  function observeActivePage () {
    const wrap   = $('di-search-wrap');
    const feed   = $('pg-feed');
    if (!wrap || !feed) return;

    const sync = () => {
      const onFeed = feed.classList.contains('active');
      wrap.style.display = onFeed ? '' : 'none';
      if (!onFeed) closeResults();
    };

    sync();
    new MutationObserver(sync).observe(feed, { attributes: true, attributeFilter: ['class'] });
  }

  /* ─────────────────────────────────────────────────────────
     SUPPRESS IN-FEED SEARCH (mfe creates it dynamically)
     Watch for the old #feed-search-wrap and hide it the moment
     it appears — our topbar search replaces it completely.
  ───────────────────────────────────────────────────────── */
  function suppressLegacySearch () {
    const hide = el => { if (el) el.style.display = 'none'; };
    hide($('feed-search-wrap'));

    // MutationObserver catches it being injected later
    new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.id === 'feed-search-wrap') hide(n);
        n.querySelectorAll?.('#feed-search-wrap').forEach(hide);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */
  function init () {
    observeActivePage();
    suppressLegacySearch();

    const pill    = $('di-search-pill');
    const input   = $('di-input');
    const clearBtn= $('di-clear');
    const results = $('di-results');
    const chips   = $('di-chips');

    if (!input) { console.warn('[DiSearch] #di-input not found'); return; }

    /* ── Input events ── */
    input.addEventListener('focus', () => {
      pill?.classList.add('is-focused', 'is-sticky-open');
      if (_query.length === 0) renderHistory();
      else openResults();
    });

    input.addEventListener('input', () => {
      _query = input.value.trim();
      updatePillState();
      scheduleSearch();
    });

    input.addEventListener('keydown', e => {
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); moveSelection(+1); break;
        case 'ArrowUp':   e.preventDefault(); moveSelection(-1); break;
        case 'Enter':
          if (_selectedIdx >= 0 && _resultItems[_selectedIdx]) {
            e.preventDefault();
            selectRow(_resultItems[_selectedIdx]);
          }
          break;
        case 'Escape':
          clearPill();
          input.blur();
          break;
      }
    });

    /* ── Clear button ── */
    clearBtn?.addEventListener('click', () => {
      clearPill();
      input.focus();
      // Also reset the legacy MFE search
      const fsi = $('feed-search-input');
      if (fsi) { fsi.value = ''; fsi.dispatchEvent(new Event('input', { bubbles: true })); }
    });

    /* ── Filter chips ── */
    chips?.addEventListener('click', e => {
      const chip = e.target.closest('[data-di-filter]');
      if (!chip) return;
      chips.querySelectorAll('.di-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _filter = chip.dataset.diFilter;
      if (_query) scheduleSearch(0);
    });

    /* ── Click outside to close ── */
    document.addEventListener('click', e => {
      const wrap = $('di-search-wrap');
      const island = document.getElementById('di2-pill');
      if (wrap && !wrap.contains(e.target) && !island?.contains(e.target)) {
        pill?.classList.remove('is-focused');
        closeResults();
        window.__mortaliveExitFeedSearchMode?.();
      }
    }, true);

    /* ── Pill click (focuses input) ── */
    pill?.addEventListener('click', () => input.focus());

    console.log('[DiSearch] Dynamic Island Search ready ✓');
  }

  /* ─────────────────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 400), { once: true });
  } else {
    setTimeout(init, 400);
  }

})();


/* ═══════════════════════════════════════════════════════════════════════
   Mortalive Dynamic Island v2 — merged into main app.js (v166)
   Source: dynamic-island-v2.js
   ═══════════════════════════════════════════════════════════════════════ */
/**
 * dynamic-island-v2.js — Mortalive True Dynamic Island
 * ────────────────────────────────────────────────────────
 * Drop-in companion. No edits to index.html or app.js needed.
 * Add ONE line before </body>:
 *   <script src="dynamic-island-v2.js" defer></script>
 *
 * What this replaces / fixes
 * ──────────────────────────
 * ✦ REPLACES: static pill topbar (becomes invisible, spacer preserved)
 * ✦ FIXES: mobile overlay — nav links hidden from pill; bottom tab bar added
 * ✦ ADDS: true shape-morphing (spring width animation on hover)
 * ✦ ADDS: context-aware content per section (CTA, search, nav)
 * ✦ ADDS: real-time online count + score mirrors from existing DOM
 * ✦ ADDS: Feed search bridged into the island (existing module kept)
 * ✦ ADDS: dark theme auto-switch on Messages page
 * ✦ ADDS: toast notifications for unread messages / events
 *
 * Compatibility: works alongside MortaliveDynamicSearch (v165).
 * It moves the existing #di-search-wrap into the island on Feed.
 */
(function MortaliveDIv2() {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     0.  CONSTANTS
  ══════════════════════════════════════════════════════════ */
  const LOGO =
    'https://res.cloudinary.com/yvjzeilj/image/upload/v1786110689/IMG_20260807_180515_ymdcdi.png';

  const SECTIONS = {
    'pg-lobby'   : { icon: '🗣️', label: 'Talk'     },
    'pg-feed'    : { icon: '📰',  label: 'Feed'     },
    'pg-messages': { icon: '💬',  label: 'Messages' },
    'pg-profile' : { icon: '👤',  label: 'Profile'  },
  };

  // Width targets (px). Keep these sensible on every screen.
  const W = {
    rest:        260,  // collapsed — logo + section + status
    hover:       720,  // expanded — nav + CTA + score + status, no cropping
    feedRest:    340,  // Feed rest — includes mini search hint
    feedHover:   760,  // Feed hover — enough room for search + nav/CTA/score
    feedFocused: 760,  // Feed search focused
    mobileRest:  196,
    mobileHover: 330,
    mobileFeed:  240,
  };

  const MOBILE_BP = 640;

  /* ══════════════════════════════════════════════════════════
     1.  CSS
  ══════════════════════════════════════════════════════════ */
  const CSS = `

/* ── Suppress OLD pill (spacer preserved, so page layout unchanged) ── */
body.di2-live .app-topbar-wrap .sakura-topbar {
  opacity: 0 !important;
  pointer-events: none !important;
  user-select: none !important;
  touch-action: none !important;
}

/* ══ Island root ═══════════════════════════════════════════ */
#di2 {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;     /* re-enabled on children */
  /* entrance */
  animation: di2-in 0.55s cubic-bezier(0.34,1.56,0.64,1) both;
}
body.di2-live.mortalive-app-topbar-visible #di2 { display: flex; }

@keyframes di2-in {
  from { opacity:0; transform: translateX(-50%) translateY(-22px) scale(0.82); }
  to   { opacity:1; transform: translateX(-50%) translateY(0)     scale(1);    }
}

/* ══ The morphing pill ═════════════════════════════════════ */
.di2-pill {
  pointer-events: auto;
  display: flex;
  align-items: center;
  height: 48px;
  border-radius: 24px;
  overflow: hidden;
  position: relative;

  background: rgba(255,255,255,0.86);
  backdrop-filter: blur(32px) saturate(190%);
  -webkit-backdrop-filter: blur(32px) saturate(190%);
  border: 1.5px solid rgba(0,0,0,0.09);
  box-shadow:
    0 2px 8px rgba(0,0,0,0.06),
    0 8px 28px rgba(0,0,0,0.05),
    inset 0 1px 0 rgba(255,255,255,0.85);

  /* width transitions set by JS for spring feel */
  transition:
    width      0.46s cubic-bezier(0.34,1.56,0.64,1),
    height     0.40s cubic-bezier(0.34,1.2,0.64,1),
    background 0.26s ease,
    border-color 0.26s ease,
    box-shadow 0.32s ease,
    transform  0.22s cubic-bezier(0.34,1.56,0.64,1);

  cursor: default;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
}

/* Hover lift – only when mouse actually on the pill */
.di2-pill.is-hovering {
  box-shadow:
    0 4px 18px rgba(0,0,0,0.09),
    0 14px 44px rgba(0,0,0,0.07),
    inset 0 1px 0 rgba(255,255,255,0.92);
  transform: translateY(-1.5px);
}
.di2-pill:active { transform: translateY(0) scale(0.985); transition-duration: 0.08s; }

/* ══ Left block: always visible ════════════════════════════ */
.di2-left {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 13px;
  flex-shrink: 0;
}
.di2-logo {
  width: 26px; height: 26px;
  border-radius: 7px; object-fit: contain; flex-shrink: 0;
  transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1);
}
.di2-pill.is-hovering .di2-logo { transform: scale(1.10) rotate(-3deg); }

.di2-section-tag { display: flex; align-items: center; gap: 5px; }
.di2-icon {
  font-size: 15px; line-height: 1;
  display: inline-block;
  transition: transform 0.26s cubic-bezier(0.34,1.56,0.64,1), opacity 0.15s;
}
.di2-icon.swap {
  transform: scale(0.4) rotate(-15deg);
  opacity: 0;
}
.di2-label {
  font-size: 13px; font-weight: 700;
  color: var(--on-surface);
  letter-spacing: -0.02em;
  transition: opacity 0.15s;
}
.di2-label.swap { opacity: 0; }

/* ══ Middle block: expand zone (hidden at rest, shown on hover) ══ */
.di2-mid {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
}

/* Items inside mid start invisible; pill width drives what's clipped */
.di2-mid-inner {
  display: flex;
  align-items: center;
  gap: 0;
  white-space: nowrap;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity 0.22s ease 0.06s, transform 0.3s cubic-bezier(0.34,1.56,0.64,1) 0.04s;
  pointer-events: none;
}
.di2-pill.is-hovering .di2-mid-inner,
.di2-pill.is-expanded .di2-mid-inner {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

/* Separator */
.di2-sep {
  width: 1px; height: 18px;
  background: rgba(0,0,0,0.09);
  border-radius: 1px;
  flex-shrink: 0;
  margin: 0 6px;
}

/* ══ Nav links ════════════════════════════════════════════ */
.di2-nav { display: flex; align-items: center; gap: 2px; }
.di2-nav-btn {
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12.5px; font-weight: 600;
  color: var(--on-surface-2);
  background: none; border: 0;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.di2-nav-btn:hover { background: rgba(0,0,0,0.055); color: var(--on-surface); }
.di2-nav-btn.active { background: var(--primary-alpha); color: var(--primary); }

/* ══ CTA button ═══════════════════════════════════════════ */
.di2-cta {
  display: none;   /* shown per-section by JS */
  align-items: center; gap: 4px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px; font-weight: 700;
  background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
  color: #fff; border: 0; cursor: pointer;
  box-shadow: 0 2px 9px rgba(26,110,245,0.28);
  white-space: nowrap; flex-shrink: 0;
  margin: 0 8px 0 4px;
  transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.18s;
}
.di2-cta:hover { transform: scale(1.06); box-shadow: 0 3px 14px rgba(26,110,245,0.38); }
.di2-cta:active { transform: scale(0.93); }
.di2-cta.visible { display: inline-flex; }

/* ══ Score tag ════════════════════════════════════════════ */
.di2-score {
  display: none;  /* shown when auth + hover */
  align-items: center; gap: 4px;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 11px; font-weight: 700;
  background: var(--primary-alpha);
  color: var(--primary);
  border: 1px solid rgba(26,110,245,0.18);
  white-space: nowrap; cursor: pointer;
  margin-right: 6px;
  transition: background 0.12s;
  flex-shrink: 0;
}
.di2-score:hover { background: rgba(26,110,245,0.18); }
.di2-score.visible { display: inline-flex; }

/* ══ Search slot (Feed only, in mid-inner) ════════════════ */
#di2-search-slot {
  display: none;
  align-items: center;
  flex: 1; min-width: 0;
  padding: 0 4px;
}
#di2-search-slot.active { display: flex; }

/* Override search wrap styles when inside island */
#di2-search-slot .dynamic-island-search-wrap {
  flex: 1 !important;
  max-width: none !important;
  margin: 0 !important;
}
#di2-search-slot .dynamic-island-search {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  padding: 0 8px !important;
  transition: none !important;
}
#di2-search-slot .dynamic-island-search.is-focused {
  transform: none !important;
  box-shadow: none !important;
}

/* ══ Right block: always visible ══════════════════════════ */
.di2-right {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 13px 0 8px;
  flex-shrink: 0;
}
.di2-live-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--success); flex-shrink: 0;
  animation: di2-pulse 2.4s ease-in-out infinite;
}
.di2-live-dot.msg { background: #3b82f6; animation-name: di2-pulse-b; }
@keyframes di2-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(22,163,74,.40); }
  50%      { box-shadow: 0 0 0 4px rgba(22,163,74,0); }
}
@keyframes di2-pulse-b {
  0%,100% { box-shadow: 0 0 0 0 rgba(59,130,246,.40); }
  50%      { box-shadow: 0 0 0 4px rgba(59,130,246,0); }
}

.di2-status {
  font-size: 11.5px; font-weight: 600;
  color: var(--on-surface-3);
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden; text-overflow: ellipsis;
}

/* ══ Unread badge ═════════════════════════════════════════ */
.di2-badge {
  position: absolute;
  top: 1px; right: 2px;
  min-width: 17px; height: 17px;
  padding: 0 3px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 10px; font-weight: 800;
  display: none;
  align-items: center; justify-content: center;
  border: 2.5px solid rgba(255,255,255,0.9);
  animation: di2-badge-in 0.32s cubic-bezier(0.34,1.56,0.64,1);
}
.di2-badge.on { display: inline-flex; }
@keyframes di2-badge-in { from { transform:scale(0); } to { transform:scale(1); } }

/* ══ Toast notification strip ═════════════════════════════ */
#di2-toast {
  pointer-events: none;
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  border: 1.5px solid rgba(0,0,0,0.09);
  border-radius: 14px;
  padding: 8px 15px;
  font-size: 12.5px; font-weight: 600;
  color: var(--on-surface);
  white-space: nowrap;
  box-shadow: 0 4px 20px rgba(0,0,0,0.10);
  opacity: 0;
  transform: translateY(-5px) scale(0.96);
  transform-origin: top center;
  transition: opacity 0.22s ease, transform 0.32s cubic-bezier(0.34,1.56,0.64,1);
}
#di2-toast.on {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

/* ══ DARK theme — Messages page ════════════════════════════ */
body.di2-msg .di2-pill {
  background: rgba(9,16,26,0.88);
  border-color: rgba(255,255,255,0.12);
  box-shadow:
    0 2px 10px rgba(0,0,0,.32),
    0 8px 32px rgba(0,0,0,.26),
    inset 0 1px 0 rgba(255,255,255,0.05);
}
body.di2-msg .di2-pill.is-hovering {
  box-shadow:
    0 5px 22px rgba(0,0,0,.40),
    0 14px 44px rgba(0,0,0,.34),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
body.di2-msg .di2-logo { filter: brightness(0.92); }
body.di2-msg .di2-label       { color: #e8edf5; }
body.di2-msg .di2-sep         { background: rgba(255,255,255,0.12); }
body.di2-msg .di2-nav-btn     { color: #6b8aad; }
body.di2-msg .di2-nav-btn:hover   { background: rgba(255,255,255,0.07); color: #c8d8ec; }
body.di2-msg .di2-nav-btn.active  { background: rgba(43,127,255,.20); color: #5aa4ff; }
body.di2-msg .di2-status     { color: #4d6480; }
body.di2-msg .di2-score {
  background: rgba(43,127,255,.14); color: #5aa4ff;
  border-color: rgba(43,127,255,.24);
}
body.di2-msg .di2-cta {
  background: linear-gradient(135deg, #2b7fff 0%, #5b4ff5 100%);
  box-shadow: 0 2px 9px rgba(43,127,255,.32);
}
body.di2-msg #di2-toast {
  background: rgba(13,21,34,0.92);
  border-color: rgba(255,255,255,0.10);
  color: #e8edf5;
}

/* ══ Scrolled enhancement ══════════════════════════════════ */
body.di2-scrolled .di2-pill {
  box-shadow:
    0 6px 24px rgba(0,0,0,0.12),
    0 16px 48px rgba(0,0,0,0.08),
    inset 0 1.5px 0 rgba(255,255,255,0.88);
}
body.di2-scrolled.di2-msg .di2-pill {
  box-shadow:
    0 6px 26px rgba(0,0,0,0.40),
    0 16px 50px rgba(0,0,0,0.30),
    inset 0 1.5px 0 rgba(255,255,255,0.06);
}

/* ══ Feed focus ring: pill border glows when search focused ═ */
.di2-pill.search-on {
  border-color: var(--primary) !important;
  box-shadow:
    0 0 0 3px rgba(26,110,245,.12),
    0 8px 28px rgba(26,110,245,.16) !important;
}
body.di2-msg .di2-pill.search-on {
  border-color: rgba(43,127,255,.55) !important;
  box-shadow:
    0 0 0 3px rgba(43,127,255,.15),
    0 8px 28px rgba(0,0,0,.30) !important;
}

/* ══ MOBILE ≤ 640 px ═══════════════════════════════════════ */
@media (max-width: 640px) {
  #di2 { top: 10px; }

  .di2-pill { height: 42px; border-radius: 21px; }
  .di2-left { padding: 0 10px 0 11px; gap: 6px; }
  .di2-logo { width: 24px; height: 24px; }

  /* Hide section label on mobile — icon + status is enough */
  .di2-label { display: none; }

  /* No nav links in island on mobile — bottom bar handles nav */
  .di2-nav { display: none !important; }

  /* Only keep CTA in the mid area on mobile */
  .di2-score { display: none !important; }

  .di2-right { padding: 0 11px 0 6px; }
  .di2-status { max-width: 64px; font-size: 10.5px; }

  /* Shrink spacer to match smaller island */
  body.di2-live .app-topbar-spacer { height: 62px !important; }

  /* Give pages room for bottom nav */
  body.di2-live.mortalive-app-topbar-visible #pg-lobby.active,
  body.di2-live.mortalive-app-topbar-visible #pg-feed.active,
  body.di2-live.mortalive-app-topbar-visible #pg-profile.active {
    padding-top: 8px !important;
    padding-bottom: 70px !important;
  }
  body.di2-live.mortalive-app-topbar-visible #pg-messages.active {
    padding-top: 8px !important;
    height: calc(100dvh - 62px - 64px) !important;
  }
  body.di2-live.mortalive-app-topbar-visible #pg-messages.active .messages-shell {
    height: 100% !important;
    border-radius: 12px 12px 0 0 !important;
  }
}

/* ══ BOTTOM NAV BAR (mobile only) ═════════════════════════ */
#di2-bot {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 9998;
  min-height: 60px;
  padding-bottom: env(safe-area-inset-bottom, 4px);
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border-top: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 -4px 20px rgba(0,0,0,0.06);
  align-items: stretch;
  justify-content: space-around;
}

/* Show only on mobile */
@media (max-width: 640px) {
  body.di2-live.mortalive-app-topbar-visible #di2-bot { display: flex; }
}

/* Messages dark bottom nav */
body.di2-msg #di2-bot {
  background: rgba(6,10,18,0.94);
  border-color: rgba(255,255,255,0.08);
  box-shadow: 0 -4px 24px rgba(0,0,0,0.36);
}

.di2-tab {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 2px; flex: 1;
  padding: 6px 4px 4px;
  border-radius: 0; border: 0; background: none;
  cursor: pointer; position: relative;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
.di2-tab:active { transform: scale(0.84); }

.di2-tab-ico {
  font-size: 22px; line-height: 1;
  transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1);
}
.di2-tab.active .di2-tab-ico { transform: scale(1.18) translateY(-1px); }

.di2-tab-lbl {
  font-size: 9.5px; font-weight: 600;
  color: var(--on-surface-3);
  letter-spacing: 0.03em;
  transition: color 0.14s;
}
.di2-tab.active .di2-tab-lbl { color: var(--primary); font-weight: 700; }

/* Active underline dot */
.di2-tab::after {
  content: '';
  position: absolute; bottom: 3px;
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--primary);
  transform: scale(0); opacity: 0;
  transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s;
}
.di2-tab.active::after { transform: scale(1); opacity: 1; }

/* Unread dot on Messages tab */
.di2-tab-dot {
  position: absolute; top: 5px; right: calc(50% - 18px);
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--danger);
  border: 2px solid rgba(255,255,255,0.92);
  display: none;
}
.di2-tab-dot.on { display: block; }

/* Dark tab labels */
body.di2-msg .di2-tab-lbl        { color: #4d6480; }
body.di2-msg .di2-tab.active .di2-tab-lbl { color: #5aa4ff; }
body.di2-msg .di2-tab.active::after       { background: #5aa4ff; }
body.di2-msg .di2-tab-dot { border-color: rgba(6,10,18,0.94); }
`;

  /* ══════════════════════════════════════════════════════════
     2.  DOM BUILDERS
  ══════════════════════════════════════════════════════════ */
  function buildIsland() {
    const root = document.createElement('div');
    root.id = 'di2';
    root.setAttribute('role', 'navigation');
    root.setAttribute('aria-label', 'Mortalive navigation');
    root.innerHTML = `
      <div class="di2-pill" id="di2-pill">
        <button class="di2-sm-back" id="di2-sm-back" type="button" aria-label="Exit search">←</button>


        <!-- ── LEFT: always visible ── -->
        <div class="di2-left">
          <img class="di2-logo" src="${LOGO}" alt="Mortalive" width="26" height="26" loading="lazy">
          <div class="di2-section-tag">
            <span class="di2-icon" id="di2-icon">🗣️</span>
            <span class="di2-label" id="di2-label">Talk</span>
          </div>
        </div>

        <!-- ── MID: expand zone, hidden at rest ── -->
        <div class="di2-mid">
          <div class="di2-mid-inner" id="di2-mid-inner">
            <div class="di2-sep"></div>

            <!-- Nav links (non-Feed sections) -->
            <div class="di2-nav" id="di2-nav">
              <button class="di2-nav-btn" data-di-page="pg-lobby"    type="button">Talk</button>
              <button class="di2-nav-btn" data-di-page="pg-feed"     type="button">Feed</button>
              <button class="di2-nav-btn" data-di-page="pg-messages" type="button">Messages</button>
              <button class="di2-nav-btn" data-di-page="pg-profile"  type="button">Profile</button>
            </div>

            <!-- Search slot (Feed only: existing #di-search-wrap moves here) -->
            <div id="di2-search-slot"></div>

            <!-- CTA button -->
            <button class="di2-cta" id="di2-cta" type="button" aria-label="Section action"></button>

            <!-- Score -->
            <div class="di2-score" id="di2-score"
              title="crockroach Score — click to open progress">
              🧲 <span id="di2-sv">—</span>
            </div>
          </div>
        </div>

        <!-- ── RIGHT: online status inside the main island ── -->
        <div class="di2-right">
          <span class="di2-live-dot" id="di2-dot"></span>
          <span class="di2-status" id="di2-st">Live</span>
        </div>

        <!-- Unread count badge -->
        <button class="di2-sm-go" id="di2-sm-go" type="button" aria-label="Search">⌕</button>
        <span class="di2-badge" id="di2-badge" aria-hidden="true"></span>
      </div>

      <!-- Toast notification -->
      <div id="di2-toast" role="status" aria-live="polite" aria-atomic="true"></div>
    `;
    document.body.appendChild(root);
  }

  function buildBottomNav() {
    const nav = document.createElement('nav');
    nav.id = 'di2-bot';
    nav.setAttribute('aria-label', 'Main navigation');
    nav.innerHTML = `
      <button class="di2-tab" data-di-page="pg-lobby"    type="button" aria-label="Talk">
        <span class="di2-tab-ico">🗣️</span>
        <span class="di2-tab-lbl">Talk</span>
      </button>
      <button class="di2-tab" data-di-page="pg-feed"     type="button" aria-label="Feed">
        <span class="di2-tab-ico">📰</span>
        <span class="di2-tab-lbl">Feed</span>
      </button>
      <button class="di2-tab" data-di-page="pg-messages" type="button" aria-label="Messages">
        <span class="di2-tab-ico">💬</span>
        <span class="di2-tab-lbl">Messages</span>
        <span class="di2-tab-dot" id="di2-tab-dot"></span>
      </button>
      <button class="di2-tab" data-di-page="pg-profile"  type="button" aria-label="Profile">
        <span class="di2-tab-ico">👤</span>
        <span class="di2-tab-lbl">Profile</span>
      </button>
    `;
    document.body.appendChild(nav);
  }

  /* ══════════════════════════════════════════════════════════
     3.  STATE
  ══════════════════════════════════════════════════════════ */
  let _section = null;
  let _isHovering = false;
  let _searchFocus = false;
  let _searchMoved = false;
  let _searchMode = false;
  let _unread = 0;
  let _toastTimer = null;

  /* ══════════════════════════════════════════════════════════
     4.  SECTION-SPECIFIC CTAs
  ══════════════════════════════════════════════════════════ */
  const CTAS = {
    'pg-lobby': {
      icon: '⚡', text: 'Start Chat',
      fn() {
        document.querySelector(
          '#pg-lobby .btn-primary, #pg-lobby [data-action="talk-now"], ' +
          '#pg-lobby .setup-find, #pg-lobby .lobby-find-btn'
        )?.click();
      }
    },
    'pg-feed': {
      icon: '✍️', text: 'Post',
      fn() {
        const btn = document.querySelector(
          '#pg-feed [data-compose-kind="text"], ' +
          '#pg-feed .post-compose-btn, #pg-feed .compose-trigger'
        );
        btn?.click();
      }
    },
    'pg-messages': {
      icon: '✉️', text: 'New',
      fn() {
        document.querySelector(
          '#pg-messages .msg-new-btn, #pg-messages [data-messages-new]'
        )?.click();
      }
    },
    'pg-profile': {
      icon: '✏️', text: 'Edit',
      fn() { document.getElementById('btn-edit-profile')?.click(); }
    },
  };

  /* ══════════════════════════════════════════════════════════
     5.  WIDTH MANAGER
     Width is set directly in JS so CSS `transition: width`
     animates between concrete px values (auto can't transition).
  ══════════════════════════════════════════════════════════ */
  function isMobile() { return window.innerWidth <= MOBILE_BP; }

  function targetWidth(state) {
    const m = isMobile();

    if (m) {
      if (_section === 'pg-feed') {
        if (state === 'focused') return Math.min(W.feedFocused, window.innerWidth - 28);
        if (state === 'hover') return Math.min(W.mobileHover, window.innerWidth - 20);
        return Math.min(W.mobileFeed, window.innerWidth - 20);
      }
      if (state === 'hover') return Math.min(W.mobileHover, window.innerWidth - 20);
      return Math.min(W.mobileRest, window.innerWidth - 20);
    }

    // Desktop: allow the island to grow enough for every control.
    // Clamp to the viewport so it never crops at either screen edge.
    if (_section === 'pg-feed') {
      if (state === 'focused') return Math.min(W.feedFocused, window.innerWidth - 32);
      if (state === 'hover') return Math.min(W.feedHover, window.innerWidth - 32);
      return Math.min(W.feedRest, window.innerWidth - 32);
    }

    if (state === 'hover') return Math.min(W.hover, window.innerWidth - 32);
    return Math.min(W.rest, window.innerWidth - 32);
  }

  function applyWidth(pill, state) {
    pill.style.width = targetWidth(state) + 'px';
  }

  window.addEventListener('resize', () => {
    const pill = document.getElementById('di2-pill');
    if (!pill) return;
    if (_searchMode) {
      pill.style.width = (isMobile()
        ? Math.min(320, window.innerWidth - 20)
        : Math.min(420, window.innerWidth - 32)) + 'px';
    } else {
      applyWidth(pill, _isHovering ? 'hover' : 'rest');
    }
  });

  /* ══════════════════════════════════════════════════════════
     6.  SECTION TRANSITION
  ══════════════════════════════════════════════════════════ */
  function setSection(pageId) {
    if (_section === pageId) return;
    _section = pageId;

    const cfg = SECTIONS[pageId];
    if (!cfg) return;

    /* Body class for CSS hooks */
    ['pg-lobby', 'pg-feed', 'pg-messages', 'pg-profile'].forEach(id =>
      document.body.classList.remove('di2-' + id.replace('pg-', ''))
    );
    document.body.classList.add('di2-' + pageId.replace('pg-', ''));
    document.body.classList.toggle('di2-msg', pageId === 'pg-messages');

    /* Animate icon swap */
    const iconEl  = document.getElementById('di2-icon');
    const labelEl = document.getElementById('di2-label');
    if (iconEl) {
      iconEl.classList.add('swap');
      setTimeout(() => { iconEl.textContent = cfg.icon; iconEl.classList.remove('swap'); }, 160);
    }
    if (labelEl) {
      labelEl.classList.add('swap');
      setTimeout(() => { labelEl.textContent = cfg.label; labelEl.classList.remove('swap'); }, 150);
    }

    /* Update CTA */
    const ctaEl = document.getElementById('di2-cta');
    const cta   = CTAS[pageId];
    if (ctaEl) {
      if (cta) {
        ctaEl.innerHTML = `${cta.icon}&nbsp;${cta.text}`;
        ctaEl.className = 'di2-cta visible';
        ctaEl.onclick = cta.fn;
      } else {
        ctaEl.className = 'di2-cta';
      }
    }

    /* Update nav + tab active state */
    document.querySelectorAll('[data-di-page]').forEach(el =>
      el.classList.toggle('active', el.dataset.diPage === pageId)
    );

    /* Nav links + search slot.
       Feed keeps the navigation tabs on desktop; the search occupies the
       expandable middle area alongside them instead of replacing the nav.
       Mobile hides nav via CSS and uses the bottom tab bar. */
    const navEl  = document.getElementById('di2-nav');
    const slotEl = document.getElementById('di2-search-slot');
    const isFeed = (pageId === 'pg-feed');

    if (navEl)  navEl.style.display  = '';
    if (slotEl) slotEl.classList.toggle('active', isFeed);
    if (isFeed) {
      bridgeSearch();
      if (_searchMode) {
        const activePill = document.getElementById('di2-pill');
        if (activePill) {
          activePill.classList.add('is-search-mode', 'search-on');
          activePill.style.width = (isMobile()
            ? Math.min(320, window.innerWidth - 20)
            : Math.min(420, window.innerWidth - 32)) + 'px';
        }
      }
    } else if (_searchMode) {
      exitSearchMode();
    }

    /* Live dot colour */
    const dot = document.getElementById('di2-dot');
    if (dot) dot.className = 'di2-live-dot' + (pageId === 'pg-messages' ? ' msg' : '');

    /* Set pill width for this section's rest state */
    const pill = document.getElementById('di2-pill');
    if (pill) applyWidth(pill, _isHovering ? 'hover' : 'rest');

    updateStatus();
  }

  /* ══════════════════════════════════════════════════════════
     7.  SEARCH BRIDGE
     Moves the existing #di-search-wrap (owned by v165 module)
     into our island's search slot for the Feed page.
     The v165 MutationObserver still fires & controls visibility.
  ══════════════════════════════════════════════════════════ */

  function enterSearchMode() {
    if (_section !== 'pg-feed' || _searchMode) return;

    _searchMode = true;
    _searchFocus = true;
    _isHovering = false;

    const pill = document.getElementById('di2-pill');
    if (!pill) return;

    pill.classList.remove('is-hovering');
    pill.classList.add('is-search-mode', 'search-on');

    const width = isMobile()
      ? Math.min(320, window.innerWidth - 20)
      : Math.min(420, window.innerWidth - 32);
    pill.style.width = width + 'px';

    const input = document.getElementById('di-input');
    if (input) {
      input.setAttribute('inputmode', 'search');
      input.setAttribute('enterkeyhint', 'search');
      if (!input.value) input.placeholder = 'Search users, posts, #tags…';
    }
  }

  function exitSearchMode() {
    if (!_searchMode) return;

    _searchMode = false;
    _searchFocus = false;
    _isHovering = false;

    const pill = document.getElementById('di2-pill');
    if (pill) {
      pill.classList.remove('is-search-mode', 'search-on');
      applyWidth(pill, 'rest');
    }

    document.getElementById('di-clear')?.click();
    document.getElementById('di-input')?.blur();
  }

  function bridgeSearch() {
    if (_searchMoved) return;

    const wrap = document.getElementById('di-search-wrap');
    const slot = document.getElementById('di2-search-slot');
    if (!wrap || !slot) return;

    if (!document.getElementById('di2-ghost-search')) {
      const ghost = document.createElement('div');
      ghost.id = 'di2-ghost-search';
      ghost.style.cssText = 'display:none!important;position:absolute;pointer-events:none;';
      wrap.parentNode.insertBefore(ghost, wrap);
    }

    slot.appendChild(wrap);
    wrap.style.display = '';
    wrap.style.flex = '1';

    const input = document.getElementById('di-input');
    if (input && !input.dataset.di2FeedSearchBound) {
      input.dataset.di2FeedSearchBound = '1';

      input.addEventListener('focus', () => enterSearchMode());
      input.addEventListener('click', () => enterSearchMode());

      input.addEventListener('blur', () => {
        // Never collapse search from blur. The user controls exit.
      });
    }

    _searchMoved = true;
    console.log('[DI v179] Feed search bridged ✓');
  }

  /* ══════════════════════════════════════════════════════════
     8.  LIVE DATA SYNC
  ══════════════════════════════════════════════════════════ */
  function syncStatus() {
    const el = document.getElementById('di2-st');
    if (!el) return;

    if (_section === 'pg-messages' && _unread > 0) {
      el.textContent = `${_unread} unread`;
      return;
    }

    const src = document.getElementById('app-topbar-online-count');
    const v = src?.textContent?.trim();
    el.textContent = (v && v !== '—') ? `${v} online` : 'Live';
  }

  function syncScore() {
    const scoreEl = document.getElementById('di2-score');
    const valEl   = document.getElementById('di2-sv');
    const src     = document.getElementById('app-topbar-score-val');
    if (!scoreEl || !valEl || !src) return;
    const v = src.textContent?.trim();
    if (v && v !== '—') {
      valEl.textContent = v;
      scoreEl.classList.add('visible');
    } else {
      scoreEl.classList.remove('visible');
    }
  }

  function updateStatus() { syncStatus(); syncScore(); }

  /* ══════════════════════════════════════════════════════════
     9.  UNREAD BADGES
  ══════════════════════════════════════════════════════════ */
  function setUnread(n) {
    _unread = n;
    const badge  = document.getElementById('di2-badge');
    const tabDot = document.getElementById('di2-tab-dot');
    const label  = n > 9 ? '9+' : (n > 0 ? String(n) : '');

    if (badge)  { badge.textContent = label; badge.className = 'di2-badge' + (n > 0 ? ' on' : ''); }
    if (tabDot) tabDot.className = 'di2-tab-dot' + (n > 0 ? ' on' : '');

    if (n > 0 && _section !== 'pg-messages') {
      toast(`📨 ${n} new message${n > 1 ? 's' : ''}`, 3200);
    }
    syncStatus();
  }

  /* ══════════════════════════════════════════════════════════
    10.  TOAST
  ══════════════════════════════════════════════════════════ */
  function toast(text, ms = 3000) {
    const el = document.getElementById('di2-toast');
    if (!el) return;
    clearTimeout(_toastTimer);
    el.textContent = text;
    el.classList.add('on');
    _toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  /* ══════════════════════════════════════════════════════════
    11.  NAVIGATION
  ══════════════════════════════════════════════════════════ */
  function navigate(pageId) {
    if (typeof window.showPage === 'function') {
      window.showPage(pageId);
    } else {
      document.querySelector(`[data-top-page="${pageId}"]`)?.click();
    }
  }

  /* ══════════════════════════════════════════════════════════
    12.  HOVER / MOUSE MORPHING
  ══════════════════════════════════════════════════════════ */
  function bindHover(pill) {
    pill.addEventListener('mouseenter', () => {
      if (_searchFocus) return;          // don't steal width from search
      _isHovering = true;
      pill.classList.add('is-hovering');
      applyWidth(pill, 'hover');
      requestAnimationFrame(() => {
          });
    });

    pill.addEventListener('mouseleave', () => {
      _isHovering = false;
      pill.classList.remove('is-hovering');
      if (!_searchMode) applyWidth(pill, 'rest');
    });

    /* Touch: tap expands briefly then collapses */
    let _touchTimer = null;
    pill.addEventListener('touchstart', () => {
      clearTimeout(_touchTimer);
      _isHovering = true;
      pill.classList.add('is-hovering');
      applyWidth(pill, 'hover');
    }, { passive: true });

    pill.addEventListener('touchend', () => {
      _touchTimer = setTimeout(() => {
        _isHovering = false;
        pill.classList.remove('is-hovering');
        if (!_searchFocus) applyWidth(pill, 'rest');
        }, 2400);
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════
    13.  OBSERVERS
  ══════════════════════════════════════════════════════════ */
  function observePages() {
    const IDS = ['pg-lobby', 'pg-feed', 'pg-messages', 'pg-profile'];
    const findActive = () => IDS.find(id => document.getElementById(id)?.classList.contains('active'));

    /* Initial */
    const init = findActive();
    if (init) setSection(init);

    /* Watch class changes on each page section */
    const mo = new MutationObserver(() => {
      const a = findActive();
      if (a && a !== _section) setSection(a);
    });
    IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });

    /* Auth state changes (login / logout) */
    window.addEventListener('mortalive-auth-state', () => {
      setTimeout(() => { updateStatus(); const a = findActive(); if (a) setSection(a); }, 200);
    });
  }

  function observeOnlineCount() {
    const el = document.getElementById('app-topbar-online-count');
    if (!el) { setTimeout(observeOnlineCount, 900); return; }
    new MutationObserver(syncStatus).observe(el, { childList: true, characterData: true, subtree: true });
    syncStatus();
  }

  function observeScore() {
    const el = document.getElementById('app-topbar-score-val');
    if (!el) { setTimeout(observeScore, 900); return; }
    new MutationObserver(syncScore).observe(el, { childList: true, characterData: true, subtree: true });
    syncScore();
  }

  function observeTopbarVisibility() {
    /* When the existing app shows/hides its topbar, mirror that to our island.
       CSS handles the show/hide via mortalive-app-topbar-visible body class. */
    new MutationObserver(() => {
      const vis = document.body.classList.contains('mortalive-app-topbar-visible');
      if (vis) updateStatus();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function observeScroll() {
    let t = false;
    window.addEventListener('scroll', () => {
      if (t) return; t = true;
      requestAnimationFrame(() => {
        document.body.classList.toggle('di2-scrolled', window.scrollY > 14);
        t = false;
      });
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════
    14.  EVENT BINDING
  ══════════════════════════════════════════════════════════ */
  function bindEvents() {
    /* Nav buttons (island nav + bottom tabs) via delegation on body */
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-di-page]');
      if (!btn) return;
      e.preventDefault();
      navigate(btn.dataset.diPage);
    });

    /* Score click → open progress sheet (existing app.js handler) */
    document.getElementById('di2-score')?.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('app-topbar-score-pill')?.click();
    });
    document.getElementById('di2-sm-back')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      exitSearchMode();
    });

    document.getElementById('di2-sm-go')?.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const input = document.getElementById('di-input');
      if (!input) return;
      if (input.value.trim()) {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', bubbles: true, cancelable: true
        }));
      } else {
        input.focus();
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _searchMode) {
        e.preventDefault();
        exitSearchMode();
      }
    });


    /* Expose hooks for app.js/external usage */
    window.diToast    = toast;
    window.diUnread   = setUnread;
  }

  /* ══════════════════════════════════════════════════════════
    15.  INIT
  ══════════════════════════════════════════════════════════ */
  function init() {
    /* CSS */
    const style = document.createElement('style');
    style.id = 'di2-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    /* DOM */
    buildIsland();
    buildBottomNav();

    /* Signal that we're live — hides old topbar via CSS */
    document.body.classList.add('di2-live');

    /* Set initial pill width */
    const pill = document.getElementById('di2-pill');
    if (pill) {
      applyWidth(pill, 'rest');
      bindHover(pill);
    }

    /* Events */
    bindEvents();

    /* Observers */
    observePages();
    observeTopbarVisibility();
    observeScroll();

    /* Delayed observers (DOM might not have these elements yet) */
    setTimeout(() => { observeOnlineCount(); observeScore(); }, 700);

    console.log('[DI v2] True Dynamic Island ready ✓');
  }

  /* Boot — wait for DOM, then add a small settle delay */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 180), { once: true });
  } else {
    setTimeout(init, 180);
  }

})();
