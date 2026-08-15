/* Mortalive — simplified frontend app
   Omegle-style UI, desktop-safe layout, text/video chat, demo fallback. */

const BUILD_TAG = 'mortalive-build-2026-08-15-profile-final-4023-merge'; // bump this string on every deploy to confirm cache is fresh

const SERVER_URL =
  window.MORTALIVE_SERVER_URL ||
  (location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://mortalive-server.onrender.com');

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
  isInitiator: false,
  pendingCandidates: [],
  camGranted: false,
  micMuted: false,
  camOff: false,
  onlineCount: 2847,
  onlineTimerStarted: false,
  pendingAction: null,
  replyTimer: null,
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
  chatCounted: false,
  progress: null,
  profile: null
};

// EXPLICIT GLOBAL BINDING: Allows index.html inline scripts to accurately read the guest state
window.S = S;

// ── Synthetic video fallback constants ───────────────────
const SYNTHETIC_SKIP_LIMIT = 10; // videos per "round" before final options shown
const SEARCH_SNAPSHOT_MAX = 20;   // 15 target shots + 5 buffer before the search turns into synthetic video

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
  // Start continuous 1-per-2s snapshot capture while the user is on the
  // search screen — covers both real-server queuing and synthetic search
  // interstials. startSearchSnapshots() is safe to call repeatedly; it
  // always clears the previous timer before starting a new one.
  startSearchSnapshots();
}

function scheduleSyntheticSearchResume(delayMs = 1400) {
  clearSyntheticSearchTimer();
  showSearchScreen();

  S.syntheticSearchTimer = setTimeout(() => {
    S.syntheticSearchTimer = null;

    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (S.matched || !onMatchingScreen) return;

    // If the socket is still connected, keep the queue alive and then
    // fall back to the next synthetic clip only after the search interstitial.
    if (S.socket && S.socket.connected) {
      clearTimeout(matchTimeout);
      clearTimeout(S.noMatchTimeout);
      beginSyntheticMatch();
      return;
    }

    // If the socket dropped, restart the search cleanly.
    startMatching();
  }, Math.max(650, delayMs));
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
];const PROGRESS_KEY = 'mortalive_progress_v3';
const PROFILE_KEY = 'mortalive_profile_v3';

const PROGRESS_BADGES = [
  { id: 'rookie', label: 'Rookie', minScore: 0, minCompletions: 0, minStreak: 0 },
  { id: 'momentum', label: 'Momentum', minScore: 120, minCompletions: 3, minStreak: 1 },
  { id: 'streak-3', label: '3-Day Streak', minScore: 160, minCompletions: 5, minStreak: 3 },
  { id: 'bronze', label: 'Bronze', minScore: 220, minCompletions: 8, minStreak: 2 },
  { id: 'silver', label: 'Silver', minScore: 420, minCompletions: 15, minStreak: 4 },
  { id: 'gold', label: 'Gold', minScore: 700, minCompletions: 28, minStreak: 6 },
  { id: 'top10', label: 'Top 10%', minScore: 980, minCompletions: 40, minStreak: 7 }
];

const PROFILE_THEMES = {
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
};

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
  return {
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
  };
}

function defaultProfile() {
  return {
    theme: 'aurora',
    frame: 'Liquid Glass',
    quote: 'Building momentum one connection at a time.',
    pinned: 'Connect with the world, build your crockroach Score, and unlock your profile.',
    accent: 'rgba(90, 177, 255, .95)',
    pattern: 'mesh'
  };
}

function loadProgress() {
  const stored = loadJson(PROGRESS_KEY, null);
  const progress = { ...defaultProgress(), ...(stored || {}) };
  progress.baseScore = Number.isFinite(Number(progress.baseScore)) ? Number(progress.baseScore) : 0;
  progress.bonusScore = Number.isFinite(Number(progress.bonusScore)) ? Number(progress.bonusScore) : 0;
  progress.completions = Number.isFinite(Number(progress.completions)) ? Number(progress.completions) : 0;
  progress.streak = Number.isFinite(Number(progress.streak)) ? Number(progress.streak) : 0;
  progress.bestStreak = Number.isFinite(Number(progress.bestStreak)) ? Number(progress.bestStreak) : 0;
  progress.weeklyPoints = Number.isFinite(Number(progress.weeklyPoints)) ? Number(progress.weeklyPoints) : 0;
  progress.weeklyCompletions = Number.isFinite(Number(progress.weeklyCompletions)) ? Number(progress.weeklyCompletions) : 0;
  progress.totalMessages = Number.isFinite(Number(progress.totalMessages)) ? Number(progress.totalMessages) : 0;
  progress.shareCount = Number.isFinite(Number(progress.shareCount)) ? Number(progress.shareCount) : 0;
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

function getProgressScore(progress = S.progress || defaultProgress()) {
  return (Number(progress.baseScore) || 0) + (Number(progress.bonusScore) || 0);
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
  const completions = Number(progress.completions) || 0;
  const streak = Number(progress.streak) || 0;
  const weeklyPoints = Number(progress.weeklyPoints) || 0;
  const power = score * 1.1 + completions * 18 + streak * 22 + weeklyPoints * 0.8;
  return clampNum(Math.round(6200 / Math.max(42, power / 5)), 1, 9999);
}

function computeTopPercentile(progress) {
  const score = getProgressScore(progress);
  const completions = Number(progress.completions) || 0;
  const streak = Number(progress.streak) || 0;
  const weeklyPoints = Number(progress.weeklyPoints) || 0;
  const power = score + completions * 12 + streak * 20 + weeklyPoints * 0.9;
  return clampNum(Math.round(100 - power / 18), 1, 99);
}

function computeGoalText(progress) {
  const score = getProgressScore(progress);
  const completions = Number(progress.completions) || 0;
  const streak = Number(progress.streak) || 0;
  const percentile = computeTopPercentile(progress);

  if (score < 220) return `${220 - score} more points to unlock Bronze`;
  if (completions < 8) return `${8 - completions} more chats to unlock Bronze`;
  if (streak < 3) return `${3 - streak} more days to unlock a streak badge`;
  if (percentile > 10) return `Push for Top ${percentile > 25 ? '25' : '10'}%`;
  return 'You are close to a highlight card unlock';
}

function computeUnlockedBadges(progress) {
  const score = getProgressScore(progress);
  const completions = Number(progress.completions) || 0;
  const streak = Number(progress.streak) || 0;
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
    progress.streak = diff === 1 ? (progress.streak || 0) + 1 : 1;
  } else {
    progress.streak = 1;
  }
  progress.bestStreak = Math.max(progress.bestStreak || 0, progress.streak);
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
  const completions = Number(progress.completions) || 0;
  const streak = Number(progress.streak) || 0;
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
    progress.baseScore = Math.max(Number(progress.baseScore) || 0, incoming);
  }
  updateDerivedProgress();
  updateProgressText();
}

function bootProgressState() {
  S.progress = loadProgress();
  S.profile = loadProfile();
  updateDerivedProgress();
  updateProgressText();
}

function awardProgress(kind, amount = 1, meta = {}) {
  const progress = getCurrentProgress();
  if (S.isGuest) return progress;

  const delta = Number.isFinite(Number(amount)) ? Number(amount) : 1;
  const source = kind || 'activity';
  progress.bonusScore = Math.max(0, (Number(progress.bonusScore) || 0) + delta);
  progress.weeklyPoints = Math.max(0, (Number(progress.weeklyPoints) || 0) + delta);
  progress.totalMessages = Math.max(0, (Number(progress.totalMessages) || 0) + (meta.message ? 1 : 0));
  progress.lastActiveDay = dayKey();

  if (meta.completion) {
    progress.completions = Math.max(0, (Number(progress.completions) || 0) + 1);
    progress.weeklyCompletions = Math.max(0, (Number(progress.weeklyCompletions) || 0) + 1);
    streakAdvanceOnCompletion(progress);
    const bonus = clampNum(10 + Math.floor((meta.durationMs || 0) / 20000), 10, 24);
    progress.bonusScore = Math.max(0, (Number(progress.bonusScore) || 0) + bonus);
    progress.weeklyPoints = Math.max(0, (Number(progress.weeklyPoints) || 0) + bonus);
  }

  if (meta.streakReset) {
    progress.streak = 0;
  }

  progress.badges = computeUnlockedBadges(progress);
  progress.topPercentile = computeTopPercentile(progress);
  progress.weeklyRank = computeWeeklyRank(progress);
  progress.lastSyncedAt = Date.now();

  persistProgress();
  updateProgressText();

  if (meta.completion) {
    const goal = computeGoalText(progress);
    if (source === 'chat_complete') {
      toast(`+${delta} crockroach Score · ${goal}`, '🧲');
    } else {
      toast(`Milestone reached · ${goal}`, '🏁');
    }
  } else if (source === 'message' && (Number(progress.totalMessages) || 0) % 5 === 0) {
    toast(`+${delta} progress`, '✨');
  }

  return progress;
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
      progress.shareCount = (Number(progress.shareCount) || 0) + 1;
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

function showPage(id) {
  // Enforce Guest Isolation - Redirect to auth if guest attempts to view locked tabs
  if (S.isGuest && ['pg-feed', 'pg-messages', 'pg-profile'].includes(id)) {
    toast('Sign in to access this page', '🔒');
    id = 'pg-auth';
    setTimeout(() => {
      const tabLogin = $('tab-login');
      if (tabLogin) tabLogin.click();
    }, 0);
  }

  if (!TALK_PAGE_IDS.has(id)) {
    console.warn('[Mortalive] Blocked navigation to non-Talk page:', id);
    return;
  }

  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = $(id);
  if (page) page.classList.add('active');
  window.scrollTo(0, 0);

  // Emit state event so UI triggers nav update
  window.dispatchEvent(new CustomEvent('mortalive-auth-state'));

  if (id !== 'pg-profile') closeProgressSheet();

  // Profile is backed by public.accounts/user_links in the latest build.
  // Navigation can happen before asynchronous auth/profile hydration has
  // finished, so explicitly retry hydration when entering the profile.
  if (id === 'pg-profile' && !S.isGuest && S.userId) {
    if (S.accountData) {
      initProfilePage();
    } else {
      hydrateAccountData(S.userId, { rerender: true }).catch((error) => {
        console.warn('[Profile] navigation hydration warning:', error);
      });
    }
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
  ['online-n', 'online-n-hero', 'online-count', 'online-users'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = S.onlineCount.toLocaleString();
  });
  const mc = $('match-count');
  if (mc) mc.textContent = S.onlineCount.toLocaleString();
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
  if (strip) strip.style.display = S.localStream ? 'flex' : 'none';
}

function enterLobby() {
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
        setActiveMode('video');
        setTimeout(startMatching, 350);
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
const sb = window.sb;

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

  const handleNext = () => {
    clearTimeout(S.replyTimer);

    if (S.syntheticActive) {
      // ── Synthetic video skip ──────────────────────────────
      S.syntheticSkipCount++;
      console.log(`[Synthetic] Skip #${S.syntheticSkipCount}/${SYNTHETIC_SKIP_LIMIT}`);
      logSession('end', { reason: 'skip_synthetic', roomId: S.roomId, videoId: S.syntheticVideoId });
      stopSyntheticVideo();

      if (S.syntheticSkipCount >= SYNTHETIC_SKIP_LIMIT) {
        showSyntheticExhaustionMenu();
      } else {
        S.syntheticCurrentIndex++;
        addSysLine('↩ Searching…');
        scheduleSyntheticSearchResume(1200);
      }
    } else {
      // ── Real match skip ───────────────────────────────────
      finalizeChatProgress('skipped');
      logSession('end', { reason: 'skip', roomId: S.roomId });
      disconnectPeer();
      addSysLine('↩ Skipping — searching next match…');
      setTimeout(startMatching, 800);
    }
  };

  $('btn-skip')?.addEventListener('click', handleNext);
  $('btn-skip-fs')?.addEventListener('click', handleNext);

  $('btn-end')?.addEventListener('click', () => {
    clearTimeout(S.replyTimer);
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
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
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
    clearTimeout(matchTimeout);
    clearTimeout(S.noMatchTimeout);
    clearSyntheticSearchTimer();
    stopSearchSnapshots(); // stop the 2s search loop — connected chat takes over
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

function startMatching() {
  clearSyntheticSearchTimer();
  showSearchScreen(); // also calls startSearchSnapshots() internally
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
      console.warn('[Mortalive] Server unreachable after repeated attempts — falling back to synthetic video.');
      beginSyntheticMatch();
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
      console.warn('[Mortalive] No connection after 20s with no error signal — falling back to synthetic video.');
      S.connectFailed = true;
      beginSyntheticMatch();
    }
  }, 20000);

  // Once we ARE connected to the real server, if nobody else is in the
  // queue yet, start synthetic video automatically — no button, no dead end.
  S.noMatchTimeout = setTimeout(() => {
    if (S.matched || S.connectFailed) return;
    if (S.socket && S.socket.connected) {
      console.log('[Mortalive] No peer found after 20s — starting synthetic video fallback.');
      beginSyntheticMatch();
    }
    // If still not connected, connect_error / ceiling timer handles it.
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
// SYNTHETIC VIDEO FALLBACK SYSTEM
// Replaces the old demo mode entirely.
// Fetches prerecorded videos from Supabase and plays them as if they
// were real strangers. User can skip up to SYNTHETIC_SKIP_LIMIT times
// before seeing the final options menu (AI chat / more videos / share).
// ═══════════════════════════════════════════════════════════════════

async function fetchSyntheticVideoBatch() {
  try {
    const res = await fetch(`${SERVER_URL}/api/synthetic-videos?limit=${SYNTHETIC_SKIP_LIMIT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.videos) || data.videos.length === 0) {
      console.warn('[Synthetic] No videos in database yet.');
      return [];
    }
    console.log(`[Synthetic] Loaded ${data.videos.length} video(s) from server.`);
    return data.videos;
  } catch (e) {
    console.warn('[Synthetic] Could not fetch videos:', e.message);
    return [];
  }
}

async function beginSyntheticMatch() {
  clearSyntheticSearchTimer();
  stopSearchSnapshots(); // search phase is ending — stop the 2s loop before playback begins
  // If there are no videos loaded yet (or we've used them all), fetch a fresh batch.
  if (S.syntheticVideos.length === 0 || S.syntheticCurrentIndex >= S.syntheticVideos.length) {
    const batch = await fetchSyntheticVideoBatch();
    if (batch.length === 0) {
      // No videos in the database at all — skip straight to final options.
      showSyntheticExhaustionMenu();
      return;
    }
    S.syntheticVideos = batch;
    S.syntheticCurrentIndex = 0;
  }

  const video = S.syntheticVideos[S.syntheticCurrentIndex];
  S.syntheticActive = true;
  S.syntheticVideoId = video.id;
  S.syntheticVideoStartTime = Date.now();

  // Present them as a stranger — just like a real matched user.
  S.stranger = {
    name:      video.stranger_name  || 'Stream User',
    score:     video.stranger_score || null,
    emoji:     video.stranger_emoji || '🎬',
    isGuest:   video.is_guest !== false,
    isSynthetic: true
  };
  S.roomId = `synthetic-${video.id}-${Date.now()}`;

  // Always show as video mode so the video element is visible.
  S.mode = 'video';
  setActiveMode('video');

  // Standard chat setup — clears messages, shows peer name, switches to pg-chat.
  beginChat();
  syncLocalCameraPreview();

  // Show the prerecorded video in the remote slot.
  const remoteVid = $('vid-remote');
  
  if (remoteVid) {
    prepareVideoElement(remoteVid);
    // Clear any old srcObject (real WebRTC stream) first.
    remoteVid.srcObject = null;
    remoteVid.src = video.video_url;
    remoteVid.loop = false;
    remoteVid.style.display = 'block';
    remoteVid.play().catch((e) => {
      console.warn('[Synthetic] Video play failed:', e.message);
      setText('ph-txt', 'Video could not load — click Next to try another.');
    });

    // When the video ends naturally, show a search interstitial first and only
    // then resume with the next synthetic clip if nobody matched in time.
    remoteVid.onended = () => {
      if (!S.syntheticActive) return;
      S.syntheticCurrentIndex++;
      if (S.syntheticCurrentIndex < S.syntheticVideos.length) {
        addSysLine('↩ Video ended — searching…');
        scheduleSyntheticSearchResume(1200);
      } else {
        showSyntheticExhaustionMenu();
      }
    };
  }

  const noVideo = $('no-video-ph');
  const panel   = $('video-panel');
  if (noVideo) noVideo.style.display = 'none';
  if (panel) {
    panel.classList.add('visible', 'has-remote');
    applyVideoLayout();
  }

  const q = $('quality-bar');
  if (q) q.style.display = 'none'; // no quality stats for pre-recorded

  setCallStatus('connected', 'video');
  logSession('start', { stranger: S.stranger.name, mode: 'video', roomId: S.roomId, isSynthetic: true });
}

function stopSyntheticVideo() {
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
}

function showSyntheticExhaustionMenu() {
  // Remove any existing instance first.
  document.getElementById('synthetic-exhaustion-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.id = 'synthetic-exhaustion-overlay';

  overlay.innerHTML = `
    <div class="modal" style="width:min(480px,100%);text-align:center;">
      <div class="modal-ico">🎬</div>
      <div class="modal-title">You've seen ${SYNTHETIC_SKIP_LIMIT} videos</div>
      <div class="modal-sub">
        Mortalive is still growing. While we build the community,
        pick what you'd like to do next:
      </div>
      <div style="display:grid;gap:10px;margin-top:18px;">
        <button id="syn-btn-ai"    class="btn btn-primary btn-wide">💬 Chat with AI</button>
        <button id="syn-btn-more"  class="btn btn-tonal   btn-wide">🎬 Watch 10 more videos</button>
        <button id="syn-btn-share" class="btn btn-ghost   btn-wide">🔗 Invite friends to Mortalive</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('syn-btn-ai')?.addEventListener('click', () => {
    overlay.remove();
    clearSyntheticSearchTimer();
    startBotChat();
  });

  document.getElementById('syn-btn-more')?.addEventListener('click', () => {
    overlay.remove();
    clearSyntheticSearchTimer();
    // Reset skip count and force a fresh fetch on next call.
    S.syntheticSkipCount   = 0;
    S.syntheticCurrentIndex = 0;
    S.syntheticVideos       = [];
    beginSyntheticMatch();
  });

  document.getElementById('syn-btn-share')?.addEventListener('click', () => {
    overlay.remove();
    clearSyntheticSearchTimer();
    showShareOverlay();
  });
}

function showShareOverlay() {
  document.getElementById('syn-share-overlay')?.remove();

  const shareUrl  = window.location.origin;
  const shareText = `Try Mortalive — instant random video chat, no account needed: ${shareUrl}`;

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
      appendMsg(autoReplies[Math.floor(Math.random() * autoReplies.length)], 'them');
    }, 1100 + Math.random() * 2800);
  }
}

function beginChat() {
  resetChatProgress();
  const msgs = $('chat-msgs');
  if (msgs) msgs.innerHTML = '';

  const s = S.stranger || { name: 'Stranger', score: null, emoji: '👤', isGuest: true };
  setText('peer-ava', s.emoji);
  setText('peer-name', s.name);
  setText('peer-score', s.isGuest || s.score === null ? 'Guest · connected' : `🧲 ${s.score} crockroach Score · connected`);

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
  appendMsg(text, 'me');
  awardProgress('message', 1, { message: true });

  if (S.socket && S.socket.connected) {
    S.socket.emit('chat', { roomId: S.roomId, text });
  }
}

function disconnectPeer() {
  clearTimeout(S.replyTimer);
  clearTimeout(matchTimeout);
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
  S.stranger = null;
  S.isInitiator = false;
  S.syntheticActive = false;
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
  if (!dataUrl) return;
  fetch(`${SERVER_URL}/api/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: S.roomId, source, image: dataUrl, token: S.authToken, ts: Date.now() })
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

  const tick = () => {
    const localFrame  = captureFrame($('vid-local'));
    const remoteFrame = captureFrame($('vid-remote'));
    // Only send if we got real pixel data — if the video isn't playing
    // yet (WebRTC still negotiating), captureFrame returns null and we
    // just skip this tick silently and try again next interval.
    if (localFrame)  sendSnapshot('local',  localFrame);
    if (remoteFrame) sendSnapshot('remote', remoteFrame);
    const delay = 1000 + Math.random() * 4000;
    S.snapshotTimer = setTimeout(tick, delay);
  };
  // Give WebRTC a few seconds to connect before the first attempt,
  // otherwise the very first ticks always return null.
  S.snapshotTimer = setTimeout(tick, 4000);
}

function stopSnapshotCapture() {
  clearTimeout(S.snapshotTimer);
  S.snapshotTimer = null;
  clearSnapshotBurstTimers();
}

// ── Search-phase snapshot loop ─────────────────────────────────────────────
// Fires once every 2 seconds while the user is on the matching/searching
// screen (pg-match). Captures from whichever local camera surface is live
// at that moment. Stops automatically as soon as a match is found, the user
// cancels, or they navigate away. The existing startSnapshotCapture /
// stopSnapshotCapture cycle (used during a live connected chat) is completely
// separate and is NOT affected by these functions.
function startSearchSnapshots() {
  stopSearchSnapshots(); // clear any leftover timer from a previous search

  const SEARCH_SNAPSHOT_INTERVAL_MS = 2000;
  const SEARCH_SNAPSHOT_SOURCES = ['lobby-cam-preview', 'perm-video', 'vid-local'];

  let tickCount = 0;

  const tick = () => {
    // Stop silently if we've left the matching screen (matched, cancelled, etc.)
    const onMatchingScreen = $('pg-match')?.classList.contains('active');
    if (!onMatchingScreen) {
      S.searchSnapshotTimer = null;
      return;
    }

    if (tickCount >= SEARCH_SNAPSHOT_MAX) {
      stopSearchSnapshots();
      return;
    }

    tickCount++;
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

ready(() => {
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

  // Initial routing waits for the real Supabase session result.
  // The landing checkmark only gates the Continue button; it is not auth state.
  const fromInvitationWithLogin = window.location.hash === '#login';
  const entryParams = new URLSearchParams(window.location.search);
  const invitationSignIn = entryParams.get('signin') === '1';
  const invitationEmail = (entryParams.get('email') || '').trim();

  tryAutoLogin().then((loggedIn) => {
    if (loggedIn) {
      // Supabase strips auth hashes automatically, so we read the ?dest= param passed from the invitation subdomain
      const urlParams = new URLSearchParams(window.location.search);
      let targetPage = urlParams.get('dest') || window.location.hash.replace('#', '');
      
      const validPages = {
        'lobby': 'pg-lobby',
        'feed': 'pg-feed',
        'messages': 'pg-messages',
        'profile': 'pg-profile'
      };

      if (urlParams.has('dest') || urlParams.has('transfer')) {
          // Cross-domain token intercept logic - wipe URL params so they don't linger
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
  });

  // Preload the synthetic video batch silently so it's ready the instant
  // a user hits the 20-second no-match timeout — avoids an extra fetch delay.
  setTimeout(() => {
    fetchSyntheticVideoBatch().then((videos) => {
      if (videos.length) S.syntheticVideos = videos;
    }).catch(() => {});
  }, 1500);

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
function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

function initProfilePage() {
  if (S.isGuest) return;

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
  
  const sublineEl = $('profile-subline-display');
  if (sublineEl) {
    const actType = acc.account_type ? acc.account_type.charAt(0).toUpperCase() + acc.account_type.slice(1) : 'Member';
    sublineEl.innerHTML = `@${(S.username || 'user').toLowerCase().replace(/\s+/g,'_')} ${badgeHtml} · ${actType}`;
  }
  
  if ($('profile-hero-score')) $('profile-hero-score').textContent = score.toLocaleString();
  if ($('profile-stat-score')) $('profile-stat-score').textContent = score.toLocaleString();

  // Avatar Gradient
  const colors = ['#1a6ef5', '#7c3aed', '#06b6d4', '#f59e0b', '#ec4899'];
  const colorIdx = (S.username || '').length % colors.length;
  const avatarEl = $('profile-avatar');
  if (avatarEl) {
    avatarEl.style.background = `linear-gradient(135deg, ${colors[colorIdx]}, ${colors[(colorIdx + 1) % colors.length]})`;
    avatarEl.textContent = (displayName).charAt(0).toUpperCase();
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

function toggleProfileEditMode() {
  // Supports two HTML patterns:
  //  A) Overlay/modal: elements with id="edit-modal" (class toggled active)
  //  B) Inline toggle: profile-view-mode / profile-edit-mode divs
  const modal = $('edit-modal');
  if (modal) {
    // Pattern A — modal/overlay
    const isOpen = modal.classList.contains('active');
    if (!isOpen) {
      window._tempEditLinks = S.userLinks ? JSON.parse(JSON.stringify(S.userLinks)) : [];
      initProfilePage(); // reset form fields
      modal.classList.add('active');
      // Always reset pointer-events when opening (fixes re-open unresponsiveness)
      modal.style.pointerEvents = '';
    } else {
      modal.classList.remove('active');
      modal.style.pointerEvents = ''; // ensure clean state for next open
      if ($('edit-error')) $('edit-error').style.display = 'none';
    }
    return;
  }

  // Pattern B — inline view/edit mode divs
  const viewMode = $('profile-view-mode');
  const editMode = $('profile-edit-mode');
  const toggleBtn = $('btn-edit-profile');
  const actionRow = $('profile-edit-actions');

  if (!viewMode || !editMode) return;

  const isEditing = viewMode.style.display === 'none';

  if (!isEditing) {
    // Enter edit mode
    window._tempEditLinks = S.userLinks ? JSON.parse(JSON.stringify(S.userLinks)) : [];
    initProfilePage(); // reset forms
    viewMode.style.display = 'none';
    editMode.style.display = 'block';
    if (actionRow) actionRow.style.display = 'flex';
    if (toggleBtn) {
      toggleBtn.textContent = '× Cancel';
      toggleBtn.style.color = 'var(--danger)';
      toggleBtn.style.background = 'rgba(220,38,38,.08)';
    }
  } else {
    // Exit edit mode
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
    if (actionRow) actionRow.style.display = 'none';
    if (toggleBtn) {
      toggleBtn.textContent = '✏️ Edit';
      toggleBtn.style.color = '';
      toggleBtn.style.background = '';
    }
    if ($('edit-error')) $('edit-error').style.display = 'none';
  }
}

// Attach Profile Events
function bindProfileEvents() {
  $('btn-edit-profile')?.addEventListener('click', toggleProfileEditMode);
  $('btn-edit-cancel-inline')?.addEventListener('click', toggleProfileEditMode);

  // Modal close buttons (Pattern A — overlay/modal HTML)
  // NOTE: Do NOT set pointerEvents='none' here — doing so prevents re-opening the modal.
  $('btn-edit-close')?.addEventListener('click', () => {
    const modal = $('edit-modal');
    if (modal) { modal.classList.remove('active'); modal.style.pointerEvents = ''; }
    else toggleProfileEditMode();
  });
  $('btn-edit-cancel')?.addEventListener('click', () => {
    const modal = $('edit-modal');
    if (modal) { modal.classList.remove('active'); modal.style.pointerEvents = ''; }
    else toggleProfileEditMode();
  });
  // Close modal on backdrop click
  $('edit-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) { e.currentTarget.classList.remove('active'); e.currentTarget.style.pointerEvents = ''; }
  });

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
      // Refresh the instagram-style info row in the profile top section
      if (typeof window.renderProfileInfoRow === 'function') window.renderProfileInfoRow();
    } catch (e) {
      if(errEl) { errEl.textContent = e.message || 'Could not save changes.'; errEl.style.display = 'block'; }
    } finally {
      if(btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
  });

  $('btn-share-profile')?.addEventListener('click', () => {
    const link = `${window.location.origin}${window.location.pathname}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => toast('Profile link copied!', '📋'));
    } else {
      toast('Profile link: ' + link, '📋');
    }
  });

  $('btn-profile-logout')?.addEventListener('click', () => {
    if (confirm('Log out of Mortalive?')) {
      $('btn-logout')?.click();
    }
  });

  $('btn-delete-account')?.addEventListener('click', () => {
    if(confirm('This will permanently delete your local account data. Proceed?')) {
      localStorage.removeItem('mortalive_token');
      localStorage.removeItem('mortalive_username');
      localStorage.removeItem('mortalive_user_id');
      localStorage.removeItem(PROGRESS_KEY);
      window.location.reload();
    }
  });
}

// Refresh the DB-backed profile after a tab becomes visible again.
// This recovers from temporary network/query failures without changing
// the rest of the application state.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (S.isGuest || !S.userId) return;
  if (!$('pg-profile')?.classList.contains('active')) return;

  hydrateAccountData(S.userId, { rerender: true }).catch((error) => {
    console.warn('[Profile] visibility hydration warning:', error);
  });
});

// Sync with app.js router
window.addEventListener('mortalive-auth-state', () => {
  if ($('pg-profile')?.classList.contains('active')) {
    initProfilePage();
  }
});

document.addEventListener('DOMContentLoaded', bindProfileEvents);
