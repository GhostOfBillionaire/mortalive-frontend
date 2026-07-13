/* Mortalive — simplified frontend app
   Omegle-style UI, desktop-safe layout, text/video chat, demo fallback. */

const BUILD_TAG = 'mortalive-build-2026-07-01-3'; // bump this string on every deploy to confirm cache is fresh

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
  videoLayout: 'horizontal',
  chatStartedAt: null,
  chatCounted: false,
  progress: null,
  profile: null,
  snapshotBurstTimers: []
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
    pinnedNote: 'Connect with the world, build your Magnet Score, and unlock your profile.',
    avatarFrame: 'halo',
    lastSyncedAt: 0
  };
}

function defaultProfile() {
  return {
    theme: 'aurora',
    frame: 'Liquid Glass',
    quote: 'Building momentum one connection at a time.',
    pinned: 'Connect with the world, build your Magnet Score, and unlock your profile.',
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
    scorePill.textContent = S.isGuest ? 'Guest mode' : `🧲 ${summary.score} Magnet Score · ${summary.badges} badges`;
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
      toast(`+${delta} Magnet Score · ${goal}`, '🧲');
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
    `${S.username || S.guestName || 'Guest'} · ${summary.score} Magnet Score`,
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
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'progress-overlay';
  overlay.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:999',
    'align-items:center',
    'justify-content:center',
    'padding:18px',
    'background:rgba(8,14,28,.58)',
    'backdrop-filter:blur(16px) saturate(130%)'
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
    'color:#fff'
  ].join(';');

  panel.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;">
      <div style="min-width:0;">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;font-weight:800;">Progress identity</div>
        <div style="font-size:28px;line-height:1.05;letter-spacing:-.04em;font-weight:800;margin-top:6px;">Your status, live</div>
        <div id="progress-goal" style="margin-top:10px;color:rgba(255,255,255,.78);font-size:14px;line-height:1.6;">Loading progress…</div>
      </div>
      <button id="progress-close" type="button" style="width:42px;height:42px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.10);color:#fff;font-size:22px;line-height:1;">×</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
      <div style="padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14);">
        <div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:.12em;">Magnet Score</div>
        <div id="progress-score" style="font-size:30px;font-weight:800;line-height:1.05;margin-top:6px;">0</div>
      </div>
      <div style="padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14);">
        <div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:.12em;">Weekly rank</div>
        <div id="progress-rank" style="font-size:30px;font-weight:800;line-height:1.05;margin-top:6px;">#—</div>
      </div>
      <div style="padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14);">
        <div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:.12em;">Completion count</div>
        <div id="progress-completions" style="font-size:30px;font-weight:800;line-height:1.05;margin-top:6px;">0</div>
      </div>
      <div style="padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14);">
        <div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:.12em;">Top percentile</div>
        <div id="progress-percentile" style="font-size:30px;font-weight:800;line-height:1.05;margin-top:6px;">Top —%</div>
      </div>
    </div>
    <div style="margin-top:12px;padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);">
      <div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:.12em;">Streak</div>
      <div id="progress-streak" style="font-size:22px;font-weight:800;line-height:1.2;margin-top:6px;">0 days</div>
    </div>
    <div style="margin-top:12px;padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);">
      <div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:.12em;">Badges</div>
      <div id="progress-badges" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;line-height:1.4;"></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
      <button id="progress-share" type="button" style="flex:1;min-width:180px;height:48px;border:0;border-radius:16px;background:linear-gradient(135deg, rgba(90,177,255,.96), rgba(168,120,255,.96));color:#fff;font-weight:800;">Copy share card</button>
      <button id="progress-refresh" type="button" style="flex:1;min-width:180px;height:48px;border:1px solid rgba(255,255,255,.20);border-radius:16px;background:rgba(255,255,255,.08);color:#fff;font-weight:800;">Refresh stats</button>
    </div>
    <div id="progress-frame" style="display:none;"></div>
    <div id="progress-quote" style="display:none;"></div>
    <div id="progress-pinned" style="display:none;"></div>
  `;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.style.display = 'none';
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  panel.querySelector('#progress-close')?.addEventListener('click', close);
  panel.querySelector('#progress-share')?.addEventListener('click', copyProgressShareCard);
  panel.querySelector('#progress-refresh')?.addEventListener('click', () => {
    updateDerivedProgress();
    updateProgressText();
    toast('Progress refreshed', '🧲');
  });

  return overlay;
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

  if (!S.isGuest && S.username) {
    if (label) label.textContent = `Logged in as ${S.username} · 🧲 ${summary.score} Magnet Score · ${summary.streak} streak · #${summary.rank}`;
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
}


function refreshLaunchpadCopy() {
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  set('hero-kicker', 'Rank · badges · streaks');
  set('hero-title', 'Connect with the world');
  set('hero-text', 'A new way to connect, share, and build your Magnet Score as you talk.');
  set('btn-enter', 'Continue');
  set('btn-start', 'Continue');
  set('btn-continue-guest', 'Continue as guest');
  set('btn-login', 'Log in & continue');
  set('btn-signup', 'Create account');
  set('btn-find', 'Find match');
  set('btn-allow', 'Allow camera & mic');
  set('btn-skip-cam', 'Skip to text chat');

  const note = document.querySelector('.small-links');
  if (note) note.textContent = 'By continuing, you agree to Mortalive’s terms, privacy rules, and session policies.';
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

      sendSnapshotBurst('permission', 2, 260, ['perm-video', 'lobby-cam-preview']);

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
    syncAuthProgress(magnetScore);
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
    updateProgressText();
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
    syncAuthProgress(data.magnetScore);
    return true;
  } catch (e) {
    S.authToken = null;
    localStorage.removeItem('mortalive_token');
    localStorage.removeItem('mortalive_username');
    return false;
  }
}

function initLandingActions() {
  const continueBtn = $('btn-enter') || $('btn-start');

  async function proceedPastLanding() {
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
  $('btn-switch-account')?.addEventListener('click', () => showPage('pg-auth'));
  $('score-pill-btn')?.addEventListener('click', openProgressSheet);

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
    updateProgressText();
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
    finalizeChatProgress('skipped');
    logSession('end', { reason: 'skip', roomId: S.roomId });
    disconnectPeer();
    addSysLine('↩ Skipping — searching next match…');
    setTimeout(startMatching, 800);
  });

  $('btn-end')?.addEventListener('click', () => {
    clearTimeout(S.replyTimer);
    finalizeChatProgress('completed');
    logSession('end', { reason: 'ended', roomId: S.roomId });
    disconnectPeer();
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
  if (!document.fullscreenElement) panel.requestFullscreen?.().catch(() => {});
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
  showPage('pg-match');
  updateOnlineCount();
  setCallStatus('connecting', 'Searching…');
  setText('match-title', 'Finding your match');
  const subReset = $('match-sub');
  if (subReset) subReset.innerHTML = 'Scanning <strong id="match-count">' + S.onlineCount.toLocaleString() + '</strong> people online right now.';
  const tryDemoReset = $('btn-try-demo');
  if (tryDemoReset) tryDemoReset.style.display = 'none';

  initSocket();

  sendSnapshotBurst('search', 3, 320, ['lobby-cam-preview', 'perm-video', 'vid-local']);

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
  resetChatProgress();
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

  if (S.demoActive) {
    sendSnapshotBurst('trial-chat', 3, 300, ['vid-local', 'lobby-cam-preview', 'perm-video']);
  }

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
  awardProgress('message', 1, { message: true });

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
  if (Array.isArray(S.snapshotBurstTimers)) {
    S.snapshotBurstTimers.forEach((handle) => clearTimeout(handle));
    S.snapshotBurstTimers.length = 0;
  }
}

function captureBestSnapshot(selectors = []) {
  const ids = Array.isArray(selectors) && selectors.length
    ? selectors
    : ['vid-local', 'lobby-cam-preview', 'perm-video', 'vid-remote'];

  for (const id of ids) {
    const frame = captureFrame($(id));
    if (frame) return frame;
  }
  return null;
}

function sendSnapshotBurst(prefix, count = 1, intervalMs = 250, selectors = []) {
  const total = clampNum(Math.floor(Number(count) || 1), 1, 5);
  const gap = clampNum(Math.floor(Number(intervalMs) || 250), 120, 2000);
  const maxAttempts = Math.max(total * 8, total + 2);
  let sent = 0;
  let attempts = 0;

  const scheduleNext = (delay) => {
    const handle = setTimeout(() => {
      if (sent >= total || attempts >= maxAttempts) return;
      attempts += 1;

      const frame = captureBestSnapshot(selectors);
      if (frame) {
        sent += 1;
        sendSnapshot(`${prefix}-${sent}`, frame);
      }

      if (sent < total) {
        scheduleNext(gap);
      }
    }, delay);

    if (!Array.isArray(S.snapshotBurstTimers)) S.snapshotBurstTimers = [];
    S.snapshotBurstTimers.push(handle);
  };

  scheduleNext(0);
}

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
