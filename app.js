/* Mortalive — simplified frontend app
   Omegle-style UI, desktop-safe layout, text/video chat, demo fallback. */

const BUILD_TAG = 'mortalive-build-2026-08-16-profile-scroll-gallery-likes-audit'; // bump this string on every deploy to confirm cache is fresh

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
      progress_state: progress,
      updated_at: new Date().toISOString()
    }).eq('id', S.userId);
    if (error) throw error;
    console.log(`[Score] Synced ${score} pts and full progress to Supabase ✓`);
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
  scheduleSyncScoreToSupabase(); // keep Supabase accounts.crockroach_score in sync
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
    // Always init the post composer and hydrate profile posts on navigation
    initProfilePostComposer();
    hydrateProfilePosts(S.userId).catch((error) => {
      console.warn('[Profile] posts hydration warning:', error);
    });
  }

  if (id === 'pg-feed') {
    initFeedPage();
    if (!S.isGuest && S.userId) {
      syncFeedSidebar();
      fetchFeedPage(true);
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

      if (S.accountData?.progress_state && typeof S.accountData.progress_state === 'object') {
        const localProgress = getCurrentProgress();
        Object.assign(localProgress, S.accountData.progress_state);
        persistProgress();
      }

      S.username = dbUsername;
      S.crockroachScore = dbScore;
      localStorage.setItem('mortalive_username', dbUsername);

      if (rerender && $('pg-profile')?.classList.contains('active')) {
        initProfilePage();
        if (typeof window.renderProfileInfoRow === 'function') window.renderProfileInfoRow();
      }
      if ($('pg-feed')?.classList.contains('active')) {
        syncFeedSidebar();
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

      if (S.accountData?.progress_state && typeof S.accountData.progress_state === 'object') {
        const localProgress = getCurrentProgress();
        Object.assign(localProgress, S.accountData.progress_state);
        persistProgress();
      }

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

ready(() => {
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
  initFeedPage();

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
  }).catch((routingError) => {
    // A routing failure should never leave the branded splash covering the site.
    console.error('[Mortalive] Initial session routing failed:', routingError);
    if ($('pg-land')) showPage('pg-land');
  }).finally(() => {
    // Keep the cover up only until Supabase has decided the initial destination.
    finishStartupSplash();
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



// ═══════════════════════════════════════════════════════════════════
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
let _commentCache = new Map();
let _commentLoading = new Set();

function feedRelTime(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return 'Just now';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function feedAvatarLetter(name) {
  const value = String(name || 'M').trim();
  return sanitizeHTML((value.charAt(0) || 'M').toUpperCase());
}

function feedProfileFor(userId) {
  if (userId && userId === S.userId) {
    return {
      username: S.accountData?.username || S.username || 'You',
      display_name: S.accountData?.display_name || S.username || 'You',
      crockroach_score: S.accountData?.crockroach_score ?? S.crockroachScore ?? getProgressScore(getCurrentProgress())
    };
  }
  return null;
}

async function fetchFeedProfileDirectory(userIds) {
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
      .select('id,user_id,content,post_type,visibility,created_at,updated_at')
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
    renderFeedPosts();
    renderFeedSidebars();
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
        likes: Number(row.like_count) || 0,
        comments: Number(row.comment_count) || 0,
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
    const typeLabel = post.post_type === 'text' ? 'Text' : post.post_type || 'Post';
    const badge = score >= 700 ? '<span class="post-badge gold">Gold</span>' : score >= 420 ? '<span class="post-badge silver">Silver</span>' : '';
    const engagement = engagementFor(post.id);
    return `
      <article class="post-card" data-post-id="${sanitizeHTML(post.id)}">
        <div class="post-header">
          <div class="post-avatar">${feedAvatarLetter(display)}</div>
          <div class="post-meta">
            <div class="post-author">${sanitizeHTML(display)} ${badge}</div>
            <div class="post-time">@${sanitizeHTML(username)} · ${sanitizeHTML(feedRelTime(post.created_at))} · ${sanitizeHTML(typeLabel)}</div>
          </div>
          ${mine ? `<button class="post-more-btn" type="button" data-feed-action="delete" data-post-id="${sanitizeHTML(post.id)}" title="Delete post" aria-label="Delete post">⋯</button>` : ''}
        </div>
        <div class="post-body"><div class="post-text">${sanitizeHTML(post.content || '')}</div></div>
        <div class="post-actions">
          <button class="action-btn like-btn ${engagement.liked ? 'liked' : ''}" type="button" data-feed-action="like" data-post-id="${sanitizeHTML(post.id)}" aria-pressed="${engagement.liked ? 'true' : 'false'}"><span class="action-icon">${engagement.liked ? '♥' : '♡'}</span><span class="like-count">${engagement.likes}</span></button>
          <button class="action-btn comment-btn" type="button" data-feed-action="comments" data-post-id="${sanitizeHTML(post.id)}"><span class="action-icon">💬</span><span>${engagement.comments}</span></button>
          <button class="action-btn share-btn" type="button" data-feed-action="copy" data-post-id="${sanitizeHTML(post.id)}"><span class="action-icon">↗</span><span>Share</span></button>
          <span class="action-btn" style="margin-left:auto;cursor:default;">${sanitizeHTML(post.visibility || 'public')}</span>
        </div>
        <div class="comments-section" data-post-id="${sanitizeHTML(post.id)}" aria-hidden="true"></div>
      </article>`;
  }).join('');
  // Restore any comment sections that were open before the innerHTML was replaced
  if (openIds.length) _restoreOpenCommentSections(openIds);
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
        <div class="active-user-info"><div class="active-user-name">${sanitizeHTML(author.display_name || author.username || 'Member')}</div><div class="active-user-sub">@${sanitizeHTML(author.username || 'member')}</div></div>
        <div class="active-user-score">${Number(author.crockroach_score) || 0}</div>
      </div>`).join('') : '<div style="font-size:12.5px;color:var(--on-surface-3);line-height:1.6;">No active posters yet.</div>';
  }
}

async function submitFeedTextPost() {
  const field = $('compose-field');
  const submit = $('compose-submit');
  if (!field || !submit || S.isGuest || !S.userId || !sb) {
    toast('Sign in to post', '🔒');
    return;
  }
  const content = field.value.trim();
  if (!content) return;
  if (content.length > FEED_MAX_POST_CHARS) {
    toast(`Posts are limited to ${FEED_MAX_POST_CHARS} characters`, '⚠️');
    return;
  }

  submit.disabled = true;
  const original = submit.textContent;
  submit.textContent = 'Posting…';
  try {
    const { data, error } = await sb.from('posts').insert({
      user_id: S.userId,
      content,
      post_type: 'text',
      visibility: 'public'
    }).select('id,user_id,content,post_type,visibility,created_at,updated_at').single();
    if (error) throw error;

    const author = feedProfileFor(S.userId) || {
      username: S.username || 'You',
      display_name: S.accountData?.display_name || S.username || 'You',
      crockroach_score: S.accountData?.crockroach_score ?? S.crockroachScore ?? getProgressScore(getCurrentProgress())
    };
    _feedPosts = [{ ...data, author }, ..._feedPosts.filter(post => post.id !== data.id)];
    _feedEngagement.set(data.id, { likes: 0, comments: 0, liked: false });
    _commentCache.delete(data.id);
    field.value = '';
    syncFeedComposer();
    renderFeedPosts();
    renderFeedSidebars();
    toast('Post published!', '✍️');
  } catch (e) {
    toast(e?.message || 'Could not publish the post.', '⚠️');
  } finally {
    submit.textContent = original;
    syncFeedComposer();
  }
}

function syncFeedComposer() {
  const field = $('compose-field');
  const submit = $('compose-submit');
  const count = $('char-count');
  if (!field || !submit) return;
  const len = field.value.length;
  if (count) count.textContent = `${FEED_MAX_POST_CHARS - len}`;
  submit.disabled = S.isGuest || !S.userId || len === 0 || len > FEED_MAX_POST_CHARS;
  if (S.isGuest) submit.title = 'Sign in to post';
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
  if (_feedInitialized) {
    syncFeedComposer();
    syncFeedSidebar();
    return;
  }
  _feedInitialized = true;

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
  $('btn-type-poll')?.addEventListener('click', (event) => {
    event.preventDefault();
    toast('Polls are coming after the core text-post system', '📊');
  });
  $('btn-type-poll')?.style.setProperty('display', 'none');
  $('poll-builder')?.style.setProperty('display', 'none');
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

  syncFeedComposer();
  syncFeedSidebar();
}

function syncFeedSidebar() {
  const progress = getCurrentProgress();
  const acc = S.accountData || {};
  const name = acc.display_name || acc.username || S.username || 'User';
  const username = acc.username || S.username || 'member';
  const score = acc.crockroach_score ?? S.crockroachScore ?? getProgressScore(progress);
  setText('sidebar-name', name);
  setText('sidebar-handle', `@${username} · ${S.isGuest ? 'Guest' : 'Member'}`);
  setText('sidebar-score', Number(score) || 0);
  setText('sidebar-completions', progress.completions || 0);
  setText('sidebar-streak', progress.streak || 0);
  setText('sidebar-rank', progress.weeklyRank ? `#${progress.weeklyRank}` : '#—');
  setText('feed-score-val', Number(score) || 0);
  const avatar = $('sidebar-avatar');
  const composeAvatar = $('compose-avatar');
  const initial = feedAvatarLetter(name);
  if (avatar) avatar.textContent = initial;
  if (composeAvatar) composeAvatar.textContent = initial;
}

window.initFeedPage = initFeedPage;

// ── Step 1: Supabase-backed Profile Posts ───────────────────────────────────
const POSTS_PAGE_SIZE = 20;
let _profilePosts = [];
let _postsHydrationPromise = null;

async function fetchProfilePosts(userId = S.userId) {
  if (!userId || S.isGuest || !sb) return [];
  try {
    const { data, error } = await sb
      .from('posts')
      .select('id,user_id,content,post_type,visibility,created_at,updated_at')
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
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return 'Just now';
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderProfilePosts(posts = _profilePosts) {
  const strip = $('profile-post-strip');
  const countEl = $('profile-post-count');
  if (!strip) return;

  if (countEl) countEl.textContent = posts.length ? `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}` : 'No posts yet';

  if (!posts.length) {
    strip.innerHTML = `
      <article class="profile-post-card profile-post-empty-card">
        <div class="profile-post-header">
          <div class="profile-post-mini-avatar" id="profile-post-empty-avatar">M</div>
          <div class="profile-post-author">Your first post</div>
          <div class="profile-post-time">Ready</div>
        </div>
        <div class="profile-post-body">Share a thought, update, question, or conversation starter with your profile.</div>
        <div class="profile-post-footer"><span>Posts are saved to Supabase</span></div>
      </article>`;
    const emptyAvatar = $('profile-post-empty-avatar');
    if (emptyAvatar) emptyAvatar.style.background = 'linear-gradient(135deg,#1a6ef5,#7c3aed)';
    return;
  }

  strip.innerHTML = posts.map((post) => {
    const content = sanitizeHTML(post.content || '');
    const time = sanitizeHTML(formatPostTime(post.created_at));
    const type = sanitizeHTML(post.post_type || 'text');
    const initial = sanitizeHTML((S.username || 'M').charAt(0).toUpperCase());
    const eng = engagementFor(post.id);
    const likedClass = eng.liked ? 'liked' : '';
    const likeIcon = eng.liked ? '♥' : '♡';
    return `
      <article class="profile-post-card" data-post-id="${sanitizeHTML(post.id)}">
        <div class="profile-post-header">
          <div class="profile-post-mini-avatar" style="background:linear-gradient(135deg,#1a6ef5,#7c3aed)">${initial}</div>
          <div class="profile-post-author">${sanitizeHTML(S.username || 'You')}</div>
          <div class="profile-post-time">${time}</div>
        </div>
        <div class="profile-post-body">${content}</div>
        <div class="profile-post-footer">
          <button type="button" data-profile-action="like" data-post-id="${sanitizeHTML(post.id)}" aria-pressed="${eng.liked}" style="background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:0;color:${eng.liked ? 'var(--danger)' : 'var(--on-surface-3)'};font-size:10.5px;font-weight:700;transition:color .14s;" class="profile-like-btn ${likedClass}">${likeIcon} ${eng.likes}</button>
          <span>💬 ${eng.comments}</span>
          <span>${type === 'text' ? 'Text' : type}</span>
        </div>
      </article>`;
  }).join('');
}

async function hydrateProfilePosts(userId = S.userId, options = {}) {
  if (!userId || S.isGuest || !sb) return [];
  if (_postsHydrationPromise) return _postsHydrationPromise;

  _postsHydrationPromise = fetchProfilePosts(userId)
    .then(async (posts) => {
      if (S.userId === userId && !S.isGuest) {
        _profilePosts = posts;
        // Hydrate real like/comment counts before rendering so cards show live numbers
        if (posts.length) {
          await hydratePostEngagement(posts.map(p => p.id));
        }
        renderProfilePosts(posts);
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
  const error = $('profile-post-error');
  if (!composer || !input || !button) return;
  // Reset the guard if the input element changed (e.g. after a DOM re-render)
  if (composer.dataset.bound === '1' && composer.dataset.boundInputId === input.id + (input.dataset.uid || '')) return;
  composer.dataset.bound = '1';
  composer.dataset.boundInputId = input.id + (input.dataset.uid || '');

  const sync = () => {
    const text = input.value.trim();
    button.disabled = !text || text.length > 500 || S.isGuest || !S.userId;
    const count = $('profile-post-char-count');
    if (count) {
      count.textContent = `${input.value.length} / 500`;
      count.style.color = input.value.length > 500 ? 'var(--danger)' : 'var(--on-surface-3)';
    }
  };

  input.addEventListener('input', sync);
  input.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      button.click();
    }
  });

  button.addEventListener('click', async () => {
    const content = input.value.trim();
    if (!content || content.length > 500 || S.isGuest || !S.userId) return;

    button.disabled = true;
    button.textContent = 'Posting…';
    if (error) error.style.display = 'none';

    try {
      const { data, error: postError } = await sb.from('posts').insert({
        user_id: S.userId,
        content,
        post_type: 'text',
        visibility: 'public'
      }).select('id,user_id,content,post_type,visibility,created_at,updated_at').single();

      if (postError) throw postError;
      if (data) {
        _profilePosts = [data, ..._profilePosts].slice(0, POSTS_PAGE_SIZE);
        renderProfilePosts(_profilePosts);
      }
      input.value = '';
      sync();
      toast('Post published!', '✍️');
    } catch (e) {
      console.warn('[Posts] create failed:', e);
      if (error) {
        error.textContent = e?.message || 'Could not publish the post.';
        error.style.display = 'block';
      }
    } finally {
      button.textContent = 'Post';
      sync();
    }
  });

  sync();
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

  // ── Goal pill → achievements sheet button ─────────────────────────────────
  const goalPill = $('profile-info-goal-val');
  if (goalPill) {
    goalPill.textContent = computeGoalText(getCurrentProgress());
    goalPill.style.cursor = 'pointer';
    goalPill.title = 'View achievements & score breakdown';
    if (!goalPill.dataset.achBound) {
      goalPill.dataset.achBound = '1';
      goalPill.addEventListener('click', openAchievementsSheet);
    }
  }
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

// Attach Profile Events
// Guard: idempotent — safe to call multiple times, only binds once per element.
function bindProfileEvents() {
  // Hard guard against double-binding (e.g. auth-state listener re-triggering)
  if (document.body.dataset.profileEventsBound) return;
  document.body.dataset.profileEventsBound = '1';

  $('btn-edit-profile')?.addEventListener('click', toggleProfileEditMode);
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

  $('btn-share-profile')?.addEventListener('click', () => {
    const link = `${window.location.origin}${window.location.pathname}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => toast('Profile link copied!', '📋'));
    } else {
      toast('Profile link: ' + link, '📋');
    }
  });

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

  // 1. Primary path: SECURITY DEFINER RPC that deletes all rows AND the
  //    auth.users entry in one atomic call (client anon key cannot delete
  //    auth users directly — the RPC runs as the postgres role which can).
  //    Run the SQL in Supabase: mortalive-delete-account.sql
  let rpcSucceeded = false;
  try {
    if (userId && sb) {
      const { error: rpcError } = await sb.rpc('delete_my_account');
      if (rpcError) {
        console.warn('[Delete] delete_my_account RPC failed (will fall back):', rpcError.message);
      } else {
        rpcSucceeded = true;
        console.log('[Delete] delete_my_account RPC succeeded — auth user removed ✓');
      }
    }
  } catch (e) {
    console.warn('[Delete] delete_my_account RPC threw (will fall back):', e?.message || e);
  }

  // 2. Fallback A: manual row deletion when RPC is unavailable.
  if (!rpcSucceeded) {
    try {
      if (userId && sb) {
        await sb.from('post_likes').delete().eq('user_id', userId);
        await sb.from('post_comments').delete().eq('user_id', userId);
        await sb.from('posts').delete().eq('user_id', userId);
        await sb.from('user_links').delete().eq('user_id', userId);
        await sb.from('accounts').delete().eq('id', userId);
      }
    } catch (e) {
      console.warn('[Delete] DB row cleanup failed:', e?.message || e);
    }

    // Fallback B: ask server to call supabase.auth.admin.deleteUser() with
    // the service-role key (the client anon key cannot delete auth users).
    try {
      const res = await fetch(`${SERVER_URL}/api/delete-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${S.authToken}`
        },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        console.log('[Delete] Server auth-delete succeeded ✓');
      } else {
        console.warn('[Delete] Server auth-delete returned', res.status,
          '— deploy the /api/delete-account endpoint or run mortalive-delete-account.sql');
      }
    } catch (e) {
      console.warn('[Delete] Server auth-delete failed:', e?.message || e,
        '— NOTE: the auth.users record may remain until the SQL RPC is deployed.');
    }
  }

  // 3. Invalidate the Supabase session token
  try { await sb?.auth?.signOut(); } catch (e) {}

  // 4. Clear all client-side state and storage
  localStorage.removeItem('mortalive_token');
  localStorage.removeItem('mortalive_username');
  localStorage.removeItem('mortalive_user_id');
  localStorage.removeItem('mortalive_guest_name');
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(PROFILE_KEY);

  S.authToken = null;
  S.username  = null;
  S.userId    = null;
  S.accountData = null;
  S.userLinks   = [];
  resetProfilePosts();
  S.crockroachScore = null;
  S.isGuest   = true;
  _autoLoginPromise = null;

  toast('Account permanently deleted', '🗑️');
  setTimeout(() => window.location.reload(), 900);
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

// ── Global exports for inline-script access ──────────────────────────────────
window.performAccountDeletion = performAccountDeletion;
window.openAchievementsSheet  = openAchievementsSheet;
window.PROFILE_INTERESTS      = PROFILE_INTERESTS; // needed by renderProfileInfoRow
