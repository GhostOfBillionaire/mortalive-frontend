<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Mortalive — Anonymous chat, simplified</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f3f5f8;
  --bg2:#e8edf5;
  --panel:#ffffff;
  --panel-soft:#f8fafc;
  --border:#d8dee9;
  --border-strong:#c7d0df;
  --text:#1c2430;
  --muted:#667084;
  --muted-2:#8a94a6;
  --primary:#1877f2;
  --primary-2:#6d5efc;
  --primary-soft:rgba(24,119,242,.12);
  --primary-soft-2:rgba(109,94,252,.12);
  --danger:#e5484d;
  --success:#2cb67d;
  --shadow:0 18px 50px rgba(18, 28, 45, .08);
  --shadow-soft:0 10px 30px rgba(18, 28, 45, .06);
  --radius:22px;
  --radius-sm:14px;
  --radius-xs:10px;
}

*{box-sizing:border-box}
html,body{margin:0;min-height:100%;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:var(--bg);color:var(--text);overflow-x:hidden}
body{min-height:100dvh}
button,input{font:inherit}
button{cursor:pointer}
a{color:inherit}

::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#c8d0dc;border-radius:99px;border:2px solid transparent;background-clip:content-box}
::-webkit-scrollbar-track{background:transparent}

.page{
  display:none;
  min-height:100dvh;
  width:100%;
  position:relative;
}
.page.active{display:flex}

.bg{
  position:fixed;
  inset:0;
  pointer-events:none;
  background:
    radial-gradient(circle at 10% 10%, rgba(24,119,242,.12), transparent 30%),
    radial-gradient(circle at 90% 90%, rgba(109,94,252,.10), transparent 28%),
    linear-gradient(180deg, #f7f9fc 0%, #eef3f8 100%);
  z-index:0;
}

.wrap{
  position:relative;
  z-index:1;
  width:min(1120px, calc(100% - 32px));
  margin:auto;
  padding:24px 0;
}

/* Brand */
.brand{
  display:flex;
  align-items:center;
  gap:12px;
  font-weight:800;
  letter-spacing:-0.04em;
}
.brand-mark{
  width:34px;height:34px;border-radius:50%;
  background:linear-gradient(135deg,var(--primary),var(--primary-2));
  display:grid;place-items:center;
  color:#fff;
  box-shadow:0 10px 26px rgba(24,119,242,.22);
  flex:none;
  position:relative;
}
.brand-mark::after{
  content:'';
  width:10px;height:10px;border-radius:50%;
  background:#fff;
  opacity:.95;
}
.brand-name{
  font-size:22px;
}
.brand-sub{
  font-size:12px;
  color:var(--muted);
  letter-spacing:.14em;
  text-transform:uppercase;
  margin-top:2px;
}

/* Shared cards */
.card{
  background:rgba(255,255,255,.88);
  backdrop-filter:blur(14px);
  border:1px solid rgba(216,222,233,.9);
  border-radius:var(--radius);
  box-shadow:var(--shadow);
}

.btn{
  border:0;
  border-radius:14px;
  padding:14px 18px;
  font-weight:700;
  transition:transform .18s ease, box-shadow .18s ease, opacity .18s ease, background .18s ease, border-color .18s ease;
}
.btn:hover{transform:translateY(-1px)}
.btn:disabled{cursor:not-allowed;opacity:.45;transform:none}

.btn-primary{
  background:linear-gradient(135deg,var(--primary),var(--primary-2));
  color:#fff;
  box-shadow:0 12px 30px rgba(24,119,242,.22);
}
.btn-primary:hover{box-shadow:0 14px 34px rgba(24,119,242,.28)}

.btn-ghost{
  background:#fff;
  border:1px solid var(--border);
  color:var(--text);
}
.btn-ghost:hover{border-color:var(--border-strong)}

.auth-tab.active{
  background:linear-gradient(135deg,var(--primary),var(--primary-2));
  border-color:transparent;
  color:#fff;
}


.setup-back{
  padding:11px 14px;
  border-radius:12px;
  font-size:13px;
}
.auth-shell{
  max-width:560px;
  margin:40px auto;
  padding:22px;
}
.auth-topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:16px;
}
.auth-guest{
  padding:18px;
  border-radius:18px;
  border:1px solid var(--border);
  background:linear-gradient(180deg, rgba(24,119,242,.06), rgba(255,255,255,.94));
  box-shadow:var(--shadow-soft);
  margin-bottom:18px;
}
.auth-guest-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:14px;
}
.auth-guest h3{
  margin:0;
  font-size:20px;
  letter-spacing:-.04em;
}
.auth-guest p{
  margin:8px 0 0;
  color:var(--muted);
  line-height:1.6;
  font-size:14px;
}
.auth-mini-note{
  margin-top:10px;
  font-size:12px;
  color:var(--muted-2);
  line-height:1.6;
}
.auth-divider{
  display:flex;
  align-items:center;
  gap:10px;
  margin:18px 0;
  color:var(--muted);
  font-size:12px;
  letter-spacing:.12em;
  text-transform:uppercase;
}
.auth-divider::before,
.auth-divider::after{
  content:'';
  height:1px;
  flex:1;
  background:var(--border);
}
.auth-tabs.auth-tabs-compact{
  margin-bottom:14px;
}
.auth-tabs-compact .auth-tab{
  padding:12px 14px;
  font-size:13px;
}
.auth-form-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:14px;
}
.auth-form-head .pill{
  flex:none;
}
.auth-back-link{
  border:1px solid var(--border);
  background:#fff;
  border-radius:12px;
  padding:10px 12px;
  font-size:13px;
  font-weight:700;
}
.setup-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:14px;
}
.setup-row .btn{
  flex:none;
}
.setup-row .muted{
  color:var(--muted);
  font-size:13px;
}
.layout-toggle{
  border:1px solid var(--border);
  background:#fff;
  border-radius:12px;
  padding:10px 12px;
  font-size:13px;
  font-weight:700;
  color:var(--text);
}
.layout-toggle.active{
  background:var(--primary-soft);
  border-color:rgba(24,119,242,.24);
}
.video-feeds.layout-square #vid-local{
  width:112px;
  height:112px;
  aspect-ratio:1/1;
}
.video-feeds.layout-rect #vid-local{
  width:128px;
  height:92px;
  aspect-ratio:4/3;
}

/* Landing */
#pg-land{
  align-items:center;
  justify-content:center;
  padding:20px 0;
}
.landing-grid{
  display:grid;
  grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);
  gap:18px;
  align-items:stretch;
}
.hero-card{
  padding:30px;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  min-height:540px;
  min-width:0;
}
.hero-top{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:16px;
  flex-wrap:wrap;
  min-width:0;
}
.hero-copy{
  max-width:560px;
  padding-top:10px;
  min-width:0;
}
.hero-kicker{
  margin-bottom:18px;
}
.hero-title{
  margin:0;
  font-size:clamp(32px, 4.4vw, 58px);
  line-height:1.03;
  letter-spacing:-0.06em;
}
.hero-title em{
  font-style:normal;
  color:var(--primary);
}
.hero-text{
  margin:18px 0 0;
  color:var(--muted);
  font-size:16px;
  line-height:1.7;
  max-width:50ch;
}
.feature-row{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:22px;
}
.feature{
  padding:10px 12px;
  border-radius:999px;
  background:var(--panel-soft);
  border:1px solid var(--border);
  font-size:13px;
  color:var(--text);
  font-weight:600;
}
.hero-foot{
  margin-top:26px;
  display:flex;
  gap:12px;
  flex-wrap:wrap;
}
.hero-visual{
  margin-top:26px;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.preview-box{
  border-radius:18px;
  border:1px solid var(--border);
  background:
    linear-gradient(180deg, rgba(24,119,242,.08), rgba(255,255,255,.92)),
    #fff;
  padding:18px;
  min-height:120px;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
}
.preview-box strong{font-size:16px}
.preview-box span{color:var(--muted);font-size:13px;line-height:1.5}
.preview-box.blue{
  background:
    linear-gradient(180deg, rgba(24,119,242,.13), rgba(255,255,255,.92)),
    #fff;
}
.preview-box.lav{
  background:
    linear-gradient(180deg, rgba(109,94,252,.11), rgba(255,255,255,.92)),
    #fff;
}

.consent-card{
  padding:28px;
  display:flex;
  flex-direction:column;
  justify-content:center;
  min-height:540px;
}
.consent-head{
  margin-bottom:18px;
}
.consent-title{
  margin:12px 0 8px;
  font-size:28px;
  line-height:1.08;
  letter-spacing:-0.05em;
}
.consent-sub{
  margin:0;
  color:var(--muted);
  line-height:1.65;
  font-size:15px;
}
.notice{
  margin-top:16px;
  padding:12px 14px;
  border-radius:14px;
  background:var(--panel-soft);
  border:1px solid var(--border);
  color:var(--muted);
  font-size:13px;
  line-height:1.6;
}
.notice b{color:var(--text)}
.toggle{
  margin-top:18px;
  padding:16px;
  border-radius:16px;
  border:1px solid var(--border);
  background:#fff;
  display:flex;
  align-items:flex-start;
  gap:12px;
  cursor:pointer;
  user-select:none;
}
.toggle input{
  position:absolute;
  opacity:0;
  pointer-events:none;
}
.toggle-ui{
  width:22px;height:22px;border-radius:7px;
  border:1.8px solid var(--border-strong);
  background:#fff;
  flex:none;
  display:grid;
  place-items:center;
  transition:all .18s ease;
  margin-top:1px;
}
.toggle input:checked + .toggle-ui{
  background:linear-gradient(135deg,var(--primary),var(--primary-2));
  border-color:transparent;
}
.toggle input:checked + .toggle-ui::after{
  content:'✓';
  color:#fff;
  font-size:13px;
  font-weight:800;
}
.toggle-text{
  font-size:14px;
  line-height:1.55;
  color:var(--muted);
}
.toggle-text b{color:var(--text)}
.enter-row{
  margin-top:18px;
  display:flex;
  gap:12px;
}
.btn-wide{width:100%;padding:15px 18px}
.small-links{
  margin-top:14px;
  font-size:12px;
  color:var(--muted-2);
  line-height:1.6;
}

/* Permission */
#pg-perm{
  align-items:center;
  justify-content:center;
  padding:24px 0;
}
.perm-card{
  width:min(680px, calc(100% - 32px));
  padding:24px;
}
.perm-inner{
  display:grid;
  grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);
  gap:18px;
  align-items:stretch;
}
.perm-video-card{
  border-radius:18px;
  overflow:hidden;
  border:1px solid var(--border);
  background:#f7f9fc;
  min-height:330px;
  position:relative;
}
#perm-video{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
  transform:scaleX(-1);
  background:#dfe6f1;
}
.perm-overlay{
  position:absolute;
  inset:0;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:10px;
  color:var(--muted-2);
  text-align:center;
  padding:20px;
}
.perm-overlay .icon{
  width:68px;height:68px;border-radius:50%;
  background:#fff;
  border:1px solid var(--border);
  display:grid;place-items:center;
  font-size:28px;
  box-shadow:var(--shadow-soft);
}
.status-chip{
  position:absolute;
  left:12px;bottom:12px;
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-radius:999px;
  background:rgba(255,255,255,.9);
  border:1px solid rgba(216,222,233,.95);
  font-size:12px;
  color:var(--muted);
}
.dot{
  width:8px;height:8px;border-radius:50%;
  background:var(--muted-2);
}
.dot.ok{background:var(--success)}
.dot.bad{background:var(--danger)}
.perm-copy{
  display:flex;
  flex-direction:column;
  justify-content:center;
}
.perm-copy h2{
  margin:0;
  font-size:26px;
  letter-spacing:-0.05em;
}
.perm-copy p{
  margin:12px 0 0;
  color:var(--muted);
  line-height:1.65;
}
.permission-list{
  margin-top:16px;
  display:grid;
  gap:10px;
}
.permission-item{
  display:flex;
  gap:10px;
  align-items:center;
  padding:12px 14px;
  border-radius:14px;
  border:1px solid var(--border);
  background:#fff;
  color:var(--muted);
}
.permission-item strong{color:var(--text)}
.permission-item .badge{
  margin-left:auto;
  font-size:12px;
  font-weight:700;
}
.badge.ok{color:var(--success)}
.badge.warn{color:var(--primary)}
.perm-actions{
  margin-top:18px;
  display:flex;
  gap:12px;
  flex-wrap:wrap;
}

/* Lobby */
#pg-lobby{
  align-items:center;
  justify-content:center;
  padding:24px 0;
}
.lobby-card{
  width:min(720px, calc(100% - 32px));
  padding:22px;
}
.lobby-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  margin-bottom:18px;
}
.mini-copy{
  color:var(--muted);
  font-size:13px;
  line-height:1.6;
  margin-top:8px;
  max-width:62ch;
}
.mode-switch{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
  margin-top:18px;
  padding:6px;
  border-radius:16px;
  background:#eef2f8;
  border:1px solid var(--border);
}
.mode-btn{
  border:0;
  border-radius:12px;
  padding:13px 14px;
  background:transparent;
  color:var(--muted);
  font-weight:700;
}
.mode-btn.active{
  background:#fff;
  color:var(--text);
  box-shadow:0 6px 16px rgba(18,28,45,.06);
}
.lobby-grid{
  margin-top:18px;
  display:grid;
  grid-template-columns:1fr auto;
  gap:12px;
  align-items:end;
}
.field label{
  display:block;
  font-size:12px;
  color:var(--muted);
  margin-bottom:8px;
  font-weight:700;
  letter-spacing:.04em;
  text-transform:uppercase;
}
.field input{
  width:100%;
  padding:14px 15px;
  border-radius:14px;
  border:1px solid var(--border);
  background:#fff;
  color:var(--text);
  outline:none;
}
.field input:focus{border-color:rgba(24,119,242,.45);box-shadow:0 0 0 4px rgba(24,119,242,.08)}
.help-row{
  margin-top:10px;
  display:flex;
  justify-content:space-between;
  gap:10px;
  color:var(--muted-2);
  font-size:12px;
  flex-wrap:wrap;
}
.live-line{
  display:flex;
  align-items:center;
  gap:10px;
  color:var(--muted);
  font-size:13px;
}
.live-dot{
  width:9px;height:9px;border-radius:50%;
  background:var(--success);
  box-shadow:0 0 0 6px rgba(44,182,125,.12);
}
.start-row{
  margin-top:18px;
  display:flex;
  gap:12px;
}

/* Matching */
#pg-match{
  align-items:center;
  justify-content:center;
  padding:24px 0;
}
.match-card{
  width:min(420px, calc(100% - 32px));
  padding:28px 24px;
  text-align:center;
}
.spinner{
  width:88px;
  height:88px;
  border-radius:50%;
  margin:0 auto 18px;
  border:4px solid #dfe6f1;
  border-top-color:var(--primary);
  border-right-color:var(--primary-2);
  animation:spin 1s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
.match-title{
  margin:0;
  font-size:24px;
  letter-spacing:-.05em;
}
.match-sub{
  margin:10px 0 0;
  color:var(--muted);
  line-height:1.6;
}
.match-badge{
  display:inline-flex;
  align-items:center;
  gap:8px;
  margin-top:16px;
  padding:9px 14px;
  border-radius:999px;
  background:#fff;
  border:1px solid var(--border);
  color:var(--muted);
  font-size:12px;
}

/* Chat */
#pg-chat{
  flex-direction:column;
  padding:16px;
  gap:16px;
}
.chat-shell{
  width:min(1180px, 100%);
  margin:0 auto;
  min-height:calc(100dvh - 32px);
  display:flex;
  flex-direction:column;
  gap:16px;
}
.chat-topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:14px 16px;
}
.chat-peer{
  display:flex;
  align-items:center;
  gap:12px;
  min-width:0;
}
.peer-ava{
  width:42px;height:42px;border-radius:50%;
  display:grid;place-items:center;
  background:linear-gradient(135deg,var(--primary),var(--primary-2));
  color:#fff;
  font-size:18px;
  flex:none;
  box-shadow:0 10px 24px rgba(24,119,242,.20);
}
.peer-meta{min-width:0}
.peer-name{font-size:15px;font-weight:800;line-height:1.1}
.peer-sub{font-size:12px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conn-badge{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:8px 12px;
  border-radius:999px;
  background:#fff;
  border:1px solid var(--border);
  color:var(--muted);
  font-size:12px;
  font-weight:600;
}
.conn-dot{
  width:8px;height:8px;border-radius:50%;
  background:#f0b429;
}
.conn-dot.connected{background:var(--success)}
.conn-dot.failed{background:var(--danger)}
.top-actions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.icon-btn{
  width:40px;height:40px;
  border-radius:50%;
  border:1px solid var(--border);
  background:#fff;
  color:var(--muted);
  display:grid;
  place-items:center;
}
.icon-btn:hover{border-color:var(--border-strong);color:var(--text)}
.icon-btn.danger:hover{border-color:rgba(229,72,77,.35);color:var(--danger)}

.chat-body{
  flex:1;
  min-height:0;
  display:grid;
  grid-template-columns:minmax(0,1.06fr) minmax(320px,.94fr);
  gap:16px;
}
.video-panel,.chat-panel{
  min-height:0;
}
.video-panel{
  display:none;
  flex-direction:column;
  overflow:hidden;
}
.video-panel.visible{display:flex}
.video-feeds{
  position:relative;
  flex:1;
  min-height:0;
  background:#121826;
  overflow:hidden;
  border-radius:var(--radius);
  border:1px solid var(--border);
  box-shadow:var(--shadow-soft);
}
#vid-remote{
  width:100%;
  height:100%;
  object-fit:cover;
  display:none;
  background:#121826;
}
#vid-local{
  position:absolute;
  right:12px;
  bottom:12px;
  width:128px;
  height:92px;
  object-fit:cover;
  border-radius:14px;
  border:2px solid rgba(255,255,255,.9);
  display:none;
  transform:scaleX(-1);
  background:#192232;
  box-shadow:0 12px 24px rgba(0,0,0,.22);
}
.no-video{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  flex-direction:column;
  gap:10px;
  color:#d5def0;
  text-align:center;
  padding:18px;
}
.no-video .big{
  width:72px;height:72px;border-radius:50%;
  display:grid;place-items:center;
  background:rgba(255,255,255,.08);
  font-size:30px;
}
.quality{
  position:absolute;
  left:12px;
  top:12px;
  display:none;
  align-items:center;
  gap:8px;
  padding:7px 11px;
  border-radius:999px;
  background:rgba(18,24,38,.7);
  color:#fff;
  font-size:12px;
  backdrop-filter:blur(10px);
}
.quality .qdot{width:8px;height:8px;border-radius:50%;background:var(--success)}
.video-controls{
  margin-top:12px;
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}
.vc-btn{
  width:44px;height:44px;
  border-radius:50%;
  border:1px solid var(--border);
  background:#fff;
  color:var(--muted);
  display:grid;
  place-items:center;
}
.vc-btn.active,.vc-btn:hover{border-color:rgba(24,119,242,.35);color:var(--primary)}
.vc-btn.off{border-color:rgba(229,72,77,.25);color:var(--danger);background:rgba(229,72,77,.06)}

.chat-panel{
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
.chat-messages{
  flex:1;
  min-height:0;
  overflow:auto;
  padding:16px;
  display:flex;
  flex-direction:column;
  gap:10px;
  background:#fff;
  border:1px solid var(--border);
  border-radius:var(--radius);
  box-shadow:var(--shadow-soft);
}
.sys-line{
  display:flex;
  align-items:center;
  gap:10px;
  color:var(--muted-2);
  font-size:12px;
  padding:4px 0;
}
.sys-line::before,.sys-line::after{
  content:'';
  height:1px;
  flex:1;
  background:var(--border);
}
.msg{
  display:flex;
  gap:10px;
  max-width:84%;
  align-self:flex-start;
}
.msg.me{
  align-self:flex-end;
  flex-direction:row-reverse;
}
.msg-ava{
  width:30px;height:30px;border-radius:50%;
  display:grid;place-items:center;
  background:#eef3fb;
  border:1px solid var(--border);
  flex:none;
  font-size:13px;
}
.msg.me .msg-ava{
  background:linear-gradient(135deg,var(--primary),var(--primary-2));
  color:#fff;
  border-color:transparent;
}
.msg-bubble{
  padding:11px 14px;
  border-radius:16px 16px 16px 5px;
  border:1px solid var(--border);
  background:var(--panel-soft);
  color:var(--text);
  line-height:1.55;
  font-size:14px;
  word-break:break-word;
}
.msg.me .msg-bubble{
  background:var(--primary-soft);
  border-color:rgba(24,119,242,.22);
  border-radius:16px 16px 5px 16px;
}
.msg-time{
  margin-top:4px;
  font-size:10px;
  color:var(--muted-2);
  text-align:right;
}
.chat-input{
  margin-top:12px;
  display:flex;
  gap:10px;
}
.chat-input input{
  flex:1;
  border:1px solid var(--border);
  border-radius:16px;
  padding:14px 16px;
  background:#fff;
  outline:none;
}
.chat-input input:focus{border-color:rgba(24,119,242,.45);box-shadow:0 0 0 4px rgba(24,119,242,.08)}
.send-btn{
  width:52px;
  border-radius:16px;
  padding:0;
}

/* Modal / Sheet */
.overlay{
  display:none;
  position:fixed;
  inset:0;
  background:rgba(9,14,22,.56);
  backdrop-filter:blur(10px);
  z-index:100;
  padding:18px;
  align-items:center;
  justify-content:center;
}
.overlay.open{display:flex}
.modal{
  width:min(420px,100%);
  background:#fff;
  border:1px solid var(--border);
  border-radius:22px;
  box-shadow:var(--shadow);
  padding:24px;
  text-align:center;
}
.modal-ico{font-size:40px}
.modal-title{font-size:22px;letter-spacing:-.05em;margin-top:8px}
.modal-sub{color:var(--muted);line-height:1.6;margin:10px 0 18px}
.stars,.vibes{
  display:flex;
  gap:8px;
  justify-content:center;
  flex-wrap:wrap;
}
.star,.vibe{
  border:1px solid var(--border);
  background:#fff;
  border-radius:999px;
  padding:8px 12px;
  color:var(--muted);
  font-size:13px;
  cursor:pointer;
}
.star.lit,.vibe.on{
  border-color:rgba(24,119,242,.26);
  background:var(--primary-soft);
  color:var(--text);
}
.modal-row{
  display:flex;
  gap:10px;
  margin-top:18px;
}
.modal-row .btn{flex:1}
.sheet-overlay{
  display:none;
  position:fixed;
  inset:0;
  background:rgba(9,14,22,.56);
  backdrop-filter:blur(10px);
  z-index:90;
  padding:18px;
  align-items:flex-end;
  justify-content:center;
}
.sheet-overlay.open{display:flex}
.sheet{
  width:min(500px,100%);
  background:#fff;
  border:1px solid var(--border);
  border-radius:24px 24px 18px 18px;
  box-shadow:var(--shadow);
  padding:22px;
  max-height:82vh;
  overflow:auto;
}
.sheet-handle{
  width:38px;height:4px;border-radius:99px;
  background:#dde4ee;
  margin:0 auto 18px;
}
.toast-root{
  position:fixed;
  left:50%;
  bottom:22px;
  transform:translateX(-50%);
  z-index:120;
  display:flex;
  flex-direction:column;
  gap:10px;
  align-items:center;
  pointer-events:none;
}
.toast{
  background:#fff;
  border:1px solid var(--border);
  border-radius:999px;
  padding:11px 16px;
  box-shadow:var(--shadow-soft);
  color:var(--text);
  font-size:13px;
  white-space:nowrap;
  animation:toastIn .18s ease-out;
}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* Responsive */
@media (max-width: 980px){
  .landing-grid,.perm-inner,.chat-body{grid-template-columns:1fr}
  .hero-card,.consent-card{min-height:auto}
  .chat-body{gap:14px}
}
@media (max-width: 720px){
  .wrap{width:min(100% - 20px, 1120px)}
  .hero-card,.consent-card,.lobby-card,.perm-card,.match-card{padding:18px}
  .hero-top,.lobby-head,.chat-topbar{flex-direction:column;align-items:flex-start}
  .lobby-grid{grid-template-columns:1fr}
  .start-row,.modal-row{flex-direction:column}
  .mode-switch{grid-template-columns:1fr}
  .chat-topbar{position:sticky;top:0;z-index:5}
  #pg-chat{padding:10px}
  .chat-shell{min-height:calc(100dvh - 20px)}
  .msg{max-width:94%}
  .peer-sub{white-space:normal}
  #vid-local{width:96px;height:72px}
}
</style>
</head>
<body>
<div class="bg"></div>

<!-- Landing -->
<section id="pg-land" class="page active">
  <div class="wrap">
    <div class="landing-grid">
      <div class="card hero-card">
        <div>
          <div class="hero-top">
            <div>
              <div class="brand">
                <div class="brand-mark" aria-hidden="true"></div>
                <div>
                  <div class="brand-name">Mortalive</div>
                  <div class="brand-sub">Anonymous chat</div>
                </div>
              </div>
            </div>
            <span class="pill">18+ only · consent required</span>
          </div>

          <div class="hero-copy">
            <h1 class="hero-title">A cleaner way to <em>talk to strangers</em>.</h1>
            <p class="hero-text">Mortalive keeps the familiar random-chat feel, but with a softer light-grey and blue interface, easier navigation, and a layout that behaves better on desktop and mobile.</p>

            <div class="feature-row">
              <span class="feature">Text or video</span>
              <span class="feature">No account</span>
              <span class="feature">Fast matching</span>
              <span class="feature">Anonymous by default</span>
            </div>
          </div>

          <div class="hero-visual">
            <div class="preview-box blue">
              <strong>Simple interface</strong>
              <span>Fewer screens, fewer distractions, and a layout that feels closer to a classic random chat site.</span>
            </div>
            <div class="preview-box lav">
              <strong>Desktop friendly</strong>
              <span>Responsive spacing and viewport-safe sizing to stop the top section from pushing outside the window.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="card consent-card">
        <div class="consent-head">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true"></div>
            <div>
              <div class="brand-name">Continue</div>
              <div class="brand-sub">Before entering</div>
            </div>
          </div>
          <h2 class="consent-title">Read once, then enter.</h2>
          <p class="consent-sub">A single consent step keeps the landing screen clean and fixes the clicking issues from the old custom toggle setup.</p>
        </div>

        <label class="toggle" for="landing-consent">
          <input id="landing-consent" type="checkbox">
          <span class="toggle-ui" aria-hidden="true"></span>
          <span class="toggle-text"><b>I confirm I am 18+</b> and agree to Mortalive's Terms, privacy rules, and session policies.</span>
        </label>

        <div class="notice">
          <b>Quick note:</b> Video mode will ask for camera and microphone access. Text mode works without permissions.
        </div>

        <div class="enter-row">
          <button class="btn btn-primary btn-wide" id="btn-enter" disabled>Enter Mortalive</button>
        </div>

        <div class="small-links">
          By continuing, you agree to use the service responsibly and follow the community rules.
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Auth: login / sign up / continue as guest -->
<section id="pg-auth" class="page">
  <div class="wrap">
    <div class="card auth-shell">
      <div class="auth-topbar">
        <button class="btn btn-ghost setup-back" type="button" data-target="pg-land">← Back</button>
        <span class="pill">Guest-first · fast entry</span>
      </div>

      <div class="auth-guest">
        <div class="auth-guest-head">
          <div>
            <h3>Continue as guest</h3>
            <p>No account, no setup walls. Pick a name and jump in.</p>
          </div>
          <span class="pill">Recommended</span>
        </div>

        <div class="field">
          <label for="guest-name">Guest name</label>
          <input id="guest-name" type="text" maxlength="24" placeholder="Pick a display name for this session" autocomplete="off">
          <div class="help-row">
            <span>Private session name</span>
            <span>Quickest way in</span>
          </div>
        </div>

        <button class="btn btn-primary btn-wide" id="btn-continue-guest">Continue as guest</button>
        <div class="auth-mini-note">You can still log in later from the lobby if you need an account.</div>
      </div>

      <div class="auth-divider">or use an account</div>

      <div class="auth-tabs auth-tabs-compact" style="display:flex;gap:8px;">
        <button class="btn btn-ghost auth-tab active" id="tab-login" type="button" style="flex:1;">Log in</button>
        <button class="btn btn-ghost auth-tab" id="tab-signup" type="button" style="flex:1;">Sign up</button>
      </div>

      <!-- Login form -->
      <div id="auth-login-form">
        <div class="auth-form-head">
          <span class="pill">Existing account</span>
          <button class="btn btn-ghost auth-back-link" id="btn-auth-back-login" type="button">← Back</button>
        </div>
        <div class="field">
          <label for="login-username">Username</label>
          <input id="login-username" type="text" autocomplete="username" placeholder="yourname">
        </div>
        <div class="field">
          <label for="login-password">Password</label>
          <input id="login-password" type="password" autocomplete="current-password" placeholder="••••••••">
        </div>
        <div id="login-error" class="notice" style="display:none;color:#b42318;background:#fef2f2;border-color:#fecaca;"></div>
        <button class="btn btn-primary btn-wide" id="btn-login" style="margin-top:8px;">Log in</button>
        <button class="btn btn-ghost btn-wide" id="btn-forgot" type="button" style="margin-top:8px;">Forgot password?</button>
      </div>

      <!-- Signup form -->
      <div id="auth-signup-form" style="display:none;">
        <div class="auth-form-head">
          <span class="pill">Create account</span>
          <button class="btn btn-ghost auth-back-link" id="btn-auth-back-signup" type="button">← Back</button>
        </div>
        <div class="field">
          <label for="signup-username">Username</label>
          <input id="signup-username" type="text" autocomplete="username" placeholder="3-20 letters, numbers, underscore" maxlength="20">
        </div>
        <div class="field">
          <label for="signup-email">Email <span style="font-weight:400;color:var(--muted);">(for password reset only)</span></label>
          <input id="signup-email" type="email" autocomplete="email" placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="signup-password">Password</label>
          <input id="signup-password" type="password" autocomplete="new-password" placeholder="At least 6 characters">
        </div>
        <div id="signup-error" class="notice" style="display:none;color:#b42318;background:#fef2f2;border-color:#fecaca;"></div>
        <button class="btn btn-primary btn-wide" id="btn-signup" style="margin-top:8px;">Create account</button>
      </div>

      <!-- Forgot password form -->
      <div id="auth-forgot-form" style="display:none;">
        <div class="auth-form-head">
          <span class="pill">Reset link</span>
          <button class="btn btn-ghost auth-back-link" id="btn-auth-back-forgot" type="button">← Back</button>
        </div>
        <div class="field">
          <label for="forgot-email">Email</label>
          <input id="forgot-email" type="email" autocomplete="email" placeholder="you@example.com">
        </div>
        <div id="forgot-message" class="notice" style="display:none;"></div>
        <button class="btn btn-primary btn-wide" id="btn-forgot-submit" style="margin-top:8px;">Send reset link</button>
        <button class="btn btn-ghost btn-wide" id="btn-forgot-back" type="button" style="margin-top:8px;">Back to log in</button>
      </div>
    </div>
  </div>
</section>

<!-- Permission -->
<section id="pg-perm" class="page">
  <div class="wrap">
    <div class="card perm-card">
      <div class="setup-row">
        <span class="pill">Video permission</span>
        <button class="btn btn-ghost setup-back" type="button" data-target="pg-auth">← Back</button>
      </div>
      <div class="perm-inner">
        <div class="perm-video-card">
          <video id="perm-video" autoplay playsinline muted></video>
          <div class="perm-overlay" id="perm-overlay">
            <div class="icon">📷</div>
            <div id="perm-overlay-txt">Tap allow to preview your camera.</div>
          </div>
          <div class="status-chip">
            <span class="dot" id="perm-dot"></span>
            <span id="perm-status-txt">Waiting for permission</span>
          </div>
        </div>

        <div class="perm-copy">
          <h2>Camera & microphone</h2>
          <p>Video chat needs browser permission. You can always skip this step and continue with text chat only.</p>

          <div class="permission-list">
            <div class="permission-item">
              <span>📷</span>
              <strong>Camera</strong>
              <span class="badge warn" id="cam-status-lbl">waiting</span>
            </div>
            <div class="permission-item">
              <span>🎤</span>
              <strong>Microphone</strong>
              <span class="badge warn" id="mic-status-lbl">waiting</span>
            </div>
          </div>

          <div class="perm-actions">
            <button class="btn btn-primary" id="btn-allow">Allow camera & mic</button>
            <button class="btn btn-ghost" id="btn-skip-cam">Skip to text chat</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Lobby -->
<section id="pg-lobby" class="page">
  <div class="wrap">
    <div class="card lobby-card">
      <div class="setup-row" style="margin-bottom:16px;">
        <span class="pill">Setup</span>
        <button class="btn btn-ghost setup-back" type="button" data-target="pg-auth">← Back</button>
      </div>
      <div class="lobby-head">
        <div>
          <div class="brand">
            <div class="brand-mark" aria-hidden="true"></div>
            <div>
              <div class="brand-name">Mortalive</div>
              <div class="brand-sub">Lobby</div>
            </div>
          </div>
          <div class="mini-copy">Pick text or video, add an interest, then start matching. This keeps the flow close to the old random-chat experience without the heavy dashboard look.</div>
        </div>
        <div class="live-line">
          <span class="live-dot"></span>
          <span><strong id="online-n">2,847</strong> online now</span>
        </div>
      </div>

      <div class="identity-row" id="identity-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0;padding:10px 14px;background:var(--panel-2,#f6f7fb);border:1px solid var(--border);border-radius:10px;font-size:13px;">
        <span id="identity-label">Browsing as guest</span>
        <button class="btn btn-ghost" id="btn-switch-account" type="button" style="padding:4px 10px;font-size:12px;">Log in / Sign up</button>
        <button class="btn btn-ghost" id="btn-logout" type="button" style="padding:4px 10px;font-size:12px;display:none;">Log out</button>
      </div>

      <div class="mode-switch" id="mode-toggle">
        <button class="mode-btn active" data-mode="text">💬 Text</button>
        <button class="mode-btn" data-mode="video">📹 Video</button>
      </div>

      <div class="lobby-grid">
        <div class="field">
          <label for="interest-input">Interest</label>
          <input id="interest-input" type="text" maxlength="64" placeholder="music, gaming, study, travel..." autocomplete="off">
          <div class="help-row">
            <span>Optional</span>
            <span>Used for matching only if your backend supports it</span>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-find">Find a stranger</button>
      </div>

      <div class="start-row">
        <button class="btn btn-ghost" id="score-pill-btn" type="button" style="display:none;">Open score sheet</button>
      </div>
    </div>
  </div>
</section>

<!-- Matching -->
<section id="pg-match" class="page">
  <div class="wrap">
    <div class="card match-card">
      <div class="spinner" aria-hidden="true"></div>
      <h2 class="match-title" id="match-title">Finding your match</h2>
      <p class="match-sub" id="match-sub">Scanning <strong id="match-count">2,847</strong> people online right now.</p>
      <div class="match-badge">
        <span class="dot" id="conn-dot"></span>
        <span id="conn-text">Searching…</span>
      </div>
      <div style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-try-demo" style="display:none;">Try a demo chat instead</button>
      </div>
    </div>
  </div>
</section>

<!-- Chat -->
<section id="pg-chat" class="page">
  <div class="chat-shell">
    <div class="card chat-topbar">
      <div class="chat-peer">
        <div class="peer-ava" id="peer-ava">👤</div>
        <div class="peer-meta">
          <div class="peer-name" id="peer-name">Stranger</div>
          <div class="peer-sub" id="peer-score">Anonymous chat · connected</div>
        </div>
      </div>

      <div class="top-actions">
        <div class="conn-badge">
          <span class="conn-dot" id="call-dot"></span>
          <span id="call-text">connecting</span>
        </div>
        <button class="icon-btn" id="btn-toggle-video" title="Toggle video panel">📹</button>
        <button class="icon-btn" id="btn-rate-top" title="Rate chat">⭐</button>
        <button class="icon-btn danger" id="btn-skip" title="Next">⏭</button>
        <button class="icon-btn danger" id="btn-end" title="End">✕</button>
      </div>
    </div>

    <div class="chat-body">
      <div class="video-panel" id="video-panel">
        <div class="video-feeds" id="video-feeds">
          <div class="no-video" id="no-video-ph">
            <div class="big">📹</div>
            <div id="ph-txt">Waiting for video…</div>
          </div>
          <video id="vid-remote" autoplay playsinline></video>
          <video id="vid-local" autoplay playsinline muted></video>
          <div class="quality" id="quality-bar"><span class="qdot" id="qual-dot"></span><span id="qual-text">HD</span></div>
        </div>

        <div class="video-controls">
          <button class="vc-btn" id="vc-mic" title="Mute microphone">🎤</button>
          <button class="vc-btn" id="vc-cam" title="Toggle camera">📷</button>
          <button class="vc-btn" id="vc-flip" title="Flip local camera">🔄</button>
          <button class="vc-btn" id="vc-layout" title="Toggle local preview shape">▭</button>
          <button class="vc-btn" id="vc-fs" title="Fullscreen">⛶</button>
        </div>
      </div>

      <div class="chat-panel">
        <div class="chat-messages" id="chat-msgs"></div>
        <div class="chat-input">
          <input id="cin" type="text" placeholder="Say something…" maxlength="500" autocomplete="off">
          <button class="btn btn-primary send-btn" id="btn-send">➤</button>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- Rating -->
<div class="overlay" id="rating-overlay">
  <div class="modal">
    <div class="modal-ico">⭐</div>
    <div class="modal-title">Rate this chat</div>
    <div class="modal-sub">A simple rating keeps the chat quality better without turning the UI into a dashboard.</div>
    <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:700;margin-bottom:10px;">Overall experience</div>
    <div class="stars" id="stars">
      <span class="star" data-v="1">1</span>
      <span class="star" data-v="2">2</span>
      <span class="star" data-v="3">3</span>
      <span class="star" data-v="4">4</span>
      <span class="star" data-v="5">5</span>
    </div>

    <div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:700;margin:16px 0 10px;">Tag the vibe</div>
    <div class="vibes" id="vibes">
      <span class="vibe" data-v="funny">Funny</span>
      <span class="vibe" data-v="deep">Deep</span>
      <span class="vibe" data-v="kind">Kind</span>
      <span class="vibe" data-v="interesting">Interesting</span>
      <span class="vibe" data-v="chill">Chill</span>
      <span class="vibe" data-v="honest">Honest</span>
    </div>

    <div class="modal-row">
      <button class="btn btn-ghost" id="btn-skip-rating">Skip</button>
      <button class="btn btn-primary" id="btn-submit-rating">Submit</button>
    </div>
  </div>
</div>

<!-- Optional score sheet kept hidden for compatibility -->
<div class="sheet-overlay" id="sheet-overlay">
  <div class="sheet">
    <div class="sheet-handle"></div>
    <h3 style="margin:0 0 8px;letter-spacing:-.04em;">Mortalive score</h3>
    <p style="margin:0;color:var(--muted);line-height:1.6;">Hidden by default in the redesigned UI.</p>
  </div>
</div>

<div class="toast-root" id="toast-root"></div>

<script>
  // Set your deployed Railway server URL here (no trailing slash).
  window.MORTALIVE_SERVER_URL = 'https://mortalive-server-production.up.railway.app';
</script>
<!--
  Self-hosted, NOT loaded from a third-party CDN. cdn.socket.io is
  routinely blocked by Brave's built-in Shields, uBlock Origin, AdGuard,
  and some corporate/school network filters — silently breaking real-time
  matching for anyone using those, with no visible error to the user other
  than "no one is online." Serving this file from your own domain avoids
  that entire class of problem.
-->
<script src="socket.io.min.js"></script>
<script src="app.js"></script>
</body>
</html>
