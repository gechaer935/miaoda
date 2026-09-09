package httpapi

const adminHTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>秒答管理中心</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#182033;background:#f3f6fb;--ink:#182033;--muted:#778198;--line:#e4e9f2;--panel:#fff;--brand:#5b61ef;--brand-soft:#eef0ff;--success:#159466;--danger:#cf4058;--warning:#b87912;--sidebar:#11182a}*{box-sizing:border-box}html,body{min-height:100%}body{margin:0;background:radial-gradient(circle at 80% -10%,#e8ecff 0,transparent 34%),#f3f6fb}button,input,select{font:inherit}[hidden]{display:none!important}.button{height:40px;padding:0 15px;border:0;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:7px;color:#33405a;background:#edf1f7;font-weight:700;cursor:pointer;transition:.18s ease}.button:hover{transform:translateY(-1px);filter:brightness(.985)}.button:disabled{cursor:not-allowed;opacity:.58;transform:none}.button.primary{color:#fff;background:linear-gradient(135deg,#5662f3,#7160e9);box-shadow:0 9px 22px #5962ed30}.button.danger{color:#bd3048;background:#fff0f3}.button.warning{color:#99620d;background:#fff5df}.button.ghost{border:1px solid var(--line);background:#fff}.small-button{height:31px;padding:0 10px;border-radius:8px;font-size:12px}.input,select{width:100%;height:42px;border:1px solid #d9e0eb;border-radius:10px;padding:0 12px;color:var(--ink);background:#fff;outline:0}.input:focus,select:focus{border-color:#7278ee;box-shadow:0 0 0 3px #656deb18}.login-shell{min-height:100vh;padding:28px;display:grid;place-items:center}.login-card{width:min(430px,100%);padding:38px;border:1px solid rgba(219,225,237,.9);border-radius:24px;background:rgba(255,255,255,.94);box-shadow:0 28px 90px #2432561b;backdrop-filter:blur(18px)}.login-brand{display:flex;align-items:center;gap:13px}.brand-mark{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,#5c63f1,#8762e9);font-size:23px;font-weight:800;box-shadow:0 12px 30px #6264ed38}.login-card h1{margin:28px 0 8px;font-size:29px;letter-spacing:-.04em}.login-card>p{margin:0;color:var(--muted);font-size:14px;line-height:1.7}.login-form{display:grid;gap:14px;margin-top:28px}.login-form label,.field{display:grid;gap:7px;color:#4d5870;font-size:13px;font-weight:700}.login-form .input{height:48px}.login-button{height:48px}.login-error{min-height:20px;color:var(--danger);font-size:13px}.login-security{display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);color:#8a94a8;font-size:12px}.security-dot{width:8px;height:8px;border-radius:50%;background:#30c38d;box-shadow:0 0 0 4px #30c38d18}.app{min-height:100vh;display:grid;grid-template-columns:250px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;padding:25px 18px;display:flex;flex-direction:column;color:#dce3f2;background:linear-gradient(180deg,#11192b,#172136)}.side-brand{display:flex;align-items:center;gap:12px;padding:0 10px 25px;border-bottom:1px solid #ffffff12}.side-brand .brand-mark{width:40px;height:40px;border-radius:12px;font-size:19px}.side-brand strong{display:block;color:#fff;font-size:17px}.side-brand span{display:block;margin-top:3px;color:#8592ad;font-size:11px}.nav-label{margin:25px 12px 9px;color:#697792;font-size:10px;font-weight:800;letter-spacing:.16em}.nav-list{display:grid;gap:6px}.nav-button{width:100%;height:46px;padding:0 13px;border:0;border-radius:11px;display:flex;align-items:center;gap:12px;color:#aeb9cd;background:transparent;font-weight:700;text-align:left;cursor:pointer}.nav-button:hover{color:#fff;background:#ffffff0a}.nav-button.active{color:#fff;background:linear-gradient(135deg,#5a63ed,#6e5bdd);box-shadow:0 12px 26px #0b10244f}.nav-icon{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:inherit;background:#ffffff0c;font-size:13px}.side-bottom{margin-top:auto;display:grid;gap:7px;padding-top:18px;border-top:1px solid #ffffff12}.side-action{height:39px;padding:0 11px;border:0;border-radius:9px;color:#96a3ba;background:transparent;text-align:left;cursor:pointer}.side-action:hover{color:#fff;background:#ffffff0a}.workspace{min-width:0}.topbar{height:88px;padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.72);backdrop-filter:blur(14px)}.topbar-left{display:flex;align-items:center;gap:13px}.menu-toggle{display:none;width:40px;padding:0}.topbar h1{margin:0;font-size:23px;letter-spacing:-.03em}.topbar p{margin:4px 0 0;color:var(--muted);font-size:12px}.secure-chip{display:flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid #dfe6ef;border-radius:999px;color:#667287;background:#fff;font-size:12px}.content{width:min(1500px,100%);margin:auto;padding:26px 30px 42px}.view{display:none}.view.active{display:block}.section-actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px}.panel{border:1px solid var(--line);border-radius:17px;background:var(--panel);box-shadow:0 9px 28px #2938520b}.panel+.panel{margin-top:18px}.panel-head{padding:19px 20px 15px;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;border-bottom:1px solid #edf0f5}.panel-head h2{margin:0;font-size:17px}.panel-head p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:13px;margin-bottom:18px}.kpi{min-height:122px;padding:20px;border:1px solid var(--line);border-radius:16px;background:#fff;box-shadow:0 8px 25px #2638530a}.kpi-label{display:flex;align-items:center;justify-content:space-between;color:#7e899e;font-size:12px}.kpi-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#5964eb;background:#eef0ff;font-weight:900}.kpi strong{display:block;margin-top:18px;font-size:28px;letter-spacing:-.04em}.kpi small{display:block;margin-top:6px;color:#9aa3b3;font-size:11px}.notice{margin-bottom:18px;padding:13px 15px;border:1px solid #dfe4ff;border-radius:12px;color:#596582;background:#f7f8ff;font-size:12px;line-height:1.65}.analytics-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,.7fr);gap:18px;margin-bottom:18px}.chart-wrap{padding:22px 20px}.visitor-chart{height:230px;display:flex;align-items:flex-end;gap:5px;padding:15px 2px 2px;border-bottom:1px solid #e9edf4}.chart-column{height:100%;min-width:5px;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px}.chart-bar{width:min(18px,72%);min-height:3px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#7068ec,#5966f4);box-shadow:0 5px 13px #5e66ef2e}.chart-label{height:13px;color:#9aa4b6;font-size:9px}.platform-list{display:grid;gap:10px;padding:16px}.platform-card{padding:13px 14px;border:1px solid #e7ebf2;border-radius:12px;background:#fbfcfe}.platform-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.platform-card b{font-size:13px}.platform-card strong{font-size:15px}.platform-card p{margin:7px 0 0;color:#8a94a7;font-size:11px}.table-wrap{overflow:auto}.data-table{width:100%;min-width:820px;border-collapse:collapse}.data-table th,.data-table td{padding:13px 15px;border-top:1px solid #edf0f5;text-align:left;white-space:nowrap;font-size:12px}.data-table th{color:#758198;background:#fafbfe;font-size:11px;letter-spacing:.02em}.data-table tbody tr:hover{background:#fafbff}.empty{text-align:center!important;color:#939daf;padding:36px!important}.pill{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;color:#17774f;background:#e9f8f0;font-size:11px}.pill.off{color:#bd3a51;background:#fff0f3}.pill.warn{color:#94640d;background:#fff5df}.pill.brand{color:#4f59cb;background:#eef0ff}.money{font-weight:800;color:#25304a}.split-panels{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.unpriced-note{padding:16px 18px;color:#8a631b;background:#fff9ea;border:1px solid #f3e4b7;border-radius:14px;font-size:12px;line-height:1.6}.card-form{padding:18px 20px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:13px;align-items:end}.card-form .button{min-width:130px}.form-tip{margin:0 20px 18px;padding:12px 14px;border-radius:11px;color:#68748a;background:#f7f8fc;font-size:12px;line-height:1.6}.toolbar{padding:15px 18px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}.toolbar .input{width:270px}.batch-name,.username{color:#4854c7;font-weight:800}.key{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#3f4fc2;font-weight:700}.actions{display:flex;align-items:center;gap:6px}.user-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.user-stat{padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:#fff}.user-stat span{color:#8792a5;font-size:11px}.user-stat strong{display:block;margin-top:8px;font-size:22px}.toast{position:fixed;right:24px;bottom:24px;z-index:80;max-width:380px;padding:12px 16px;border-radius:11px;color:#fff;background:#152039;box-shadow:0 16px 45px #10182c45;opacity:0;transform:translateY(12px);pointer-events:none;transition:.2s}.toast.show{opacity:1;transform:none}.mask{position:fixed;inset:0;z-index:60;padding:22px;display:none;place-items:center;background:#0f172a70;backdrop-filter:blur(5px)}.mask.open{display:grid}.modal{width:min(460px,100%);padding:23px;border-radius:18px;background:#fff;box-shadow:0 28px 90px #0d142c52}.modal h2{margin:0;font-size:20px}.modal>p{margin:7px 0 0;color:#778298;font-size:12px;line-height:1.65}.modal-fields{display:grid;gap:12px;margin-top:18px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:21px}.batch-dialog{width:min(1180px,100%);max-height:90vh;padding:0;display:flex;flex-direction:column;overflow:hidden}.batch-dialog-head{padding:20px 22px 15px;display:flex;align-items:flex-start;justify-content:space-between;gap:15px;border-bottom:1px solid var(--line)}.batch-dialog-head h2{margin:0}.batch-dialog-head p{margin:5px 0 0;color:var(--muted);font-size:12px}.batch-summary{padding:13px 22px;display:flex;gap:8px;flex-wrap:wrap;background:#f8f9fd}.summary-chip{padding:7px 10px;border:1px solid var(--line);border-radius:9px;color:#5c687f;background:#fff;font-size:11px}.batch-table{overflow:auto}.batch-table .data-table{min-width:980px}.batch-table .actions{min-width:225px}.mobile-overlay{display:none}@media(max-width:1180px){.kpis{grid-template-columns:repeat(3,1fr)}.card-form{grid-template-columns:repeat(2,1fr)}.card-form .button{width:100%}.analytics-grid{grid-template-columns:1fr}.split-panels{grid-template-columns:1fr}}@media(max-width:820px){.app{grid-template-columns:1fr}.sidebar{position:fixed;left:-270px;z-index:90;width:250px;transition:.2s}.app.menu-open .sidebar{left:0}.app.menu-open .mobile-overlay{position:fixed;inset:0;z-index:85;display:block;background:#0f172a66}.topbar{height:76px;padding:0 18px}.menu-toggle{display:inline-flex}.content{padding:20px 14px 35px}.kpis{grid-template-columns:1fr 1fr}.user-stats{grid-template-columns:1fr 1fr}.toolbar .input{width:100%}.login-card{padding:30px 24px}}@media(max-width:520px){.kpis,.user-stats,.card-form{grid-template-columns:1fr}.topbar h1{font-size:19px}.secure-chip{display:none}.login-shell{padding:14px}.panel-head{align-items:flex-start;flex-direction:column}}
    .panel-head-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.growth-chart .chart-bar{background:linear-gradient(180deg,#31bf96,#159466);box-shadow:0 5px 13px #1594662e}.user-stats{grid-template-columns:repeat(5,minmax(0,1fr))}@media(max-width:1180px){.user-stats{grid-template-columns:repeat(3,1fr)}}@media(max-width:820px){.user-stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.user-stats{grid-template-columns:1fr}}
    .nav-badge{margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;display:grid;place-items:center;color:#fff;background:#e44862;font-size:10px}.feedback-layout{display:grid;grid-template-columns:390px minmax(0,1fr);min-height:650px;overflow:hidden}.feedback-list{border-right:1px solid var(--line);background:#fafbfe}.feedback-toolbar{padding:15px;display:flex;gap:8px;border-bottom:1px solid var(--line)}.feedback-toolbar select{height:38px}.feedback-items{max-height:650px;overflow:auto}.feedback-item{width:100%;padding:16px 17px;border:0;border-bottom:1px solid #edf0f5;display:grid;gap:8px;color:var(--ink);background:transparent;text-align:left;cursor:pointer}.feedback-item:hover,.feedback-item.active{background:#f1f3ff}.feedback-item-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.feedback-item-user{display:flex;align-items:center;gap:7px;font-size:13px}.feedback-preview{overflow:hidden;color:#69748a;font-size:12px;line-height:1.5;text-overflow:ellipsis;white-space:nowrap}.feedback-time{color:#99a1b1;font-size:10px}.feedback-detail{min-width:0;padding:25px}.feedback-placeholder{height:100%;display:grid;place-items:center;color:#8b94a7;text-align:center}.feedback-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;padding-bottom:17px;border-bottom:1px solid var(--line)}.feedback-detail-head h2{margin:0;font-size:19px}.feedback-detail-head p{margin:6px 0 0;color:var(--muted);font-size:11px}.feedback-status-select{width:110px;height:36px}.feedback-messages{display:grid;gap:15px;max-height:380px;padding:20px 2px;overflow:auto}.feedback-bubble{max-width:85%;padding:13px 15px;border-radius:14px;color:#364058;background:#eef1f6}.feedback-bubble.admin{justify-self:end;color:#fff;background:linear-gradient(135deg,#5962ef,#705ade)}.feedback-bubble-head{display:flex;justify-content:space-between;gap:20px;margin-bottom:7px;font-size:10px;opacity:.7}.feedback-bubble-body{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.7}.feedback-images{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.feedback-images a{width:104px;height:78px;display:block;overflow:hidden;border-radius:9px;background:#dfe4ed}.feedback-images img{width:100%;height:100%;object-fit:cover}.feedback-reply{padding-top:17px;border-top:1px solid var(--line)}.feedback-reply textarea{width:100%;min-height:95px;padding:12px;border:1px solid #d9e0eb;border-radius:11px;resize:vertical;outline:0}.feedback-reply-actions{display:flex;justify-content:flex-end;margin-top:10px}@media(max-width:1050px){.feedback-layout{grid-template-columns:1fr}.feedback-list{border-right:0;border-bottom:1px solid var(--line)}.feedback-items{max-height:280px}}
    .trial-settings-form{padding:22px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px}.trial-settings-form .full{grid-column:1/-1}.trial-state{padding:18px;border:1px solid #dfe3ff;border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:20px;background:linear-gradient(135deg,#f7f7ff,#f2fbfd)}.trial-state strong{display:block;font-size:14px}.trial-state p{margin:6px 0 0;color:var(--muted);font-size:11px;line-height:1.6}.trial-state select{width:150px;flex:0 0 auto}.trial-security{padding:16px 18px;border:1px solid #f0e0b8;border-radius:13px;color:#765c24;background:#fffaf0;font-size:12px;line-height:1.75}.trial-form-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px}.trial-updated{margin-right:auto;color:#9099aa;font-size:11px}@media(max-width:700px){.trial-settings-form{grid-template-columns:1fr}.trial-state{align-items:flex-start;flex-direction:column}.trial-state select{width:100%}}
    .user-table-wrap{position:relative;max-width:100%;scrollbar-gutter:stable}.user-table{min-width:1250px!important}.user-table th:last-child,.user-table td:last-child{position:sticky;right:0;border-left:1px solid #e8ecf3}.user-table th:last-child{z-index:4;background:#fafbfe}.user-table td:last-child{z-index:3;min-width:232px;background:#fff;box-shadow:-12px 0 20px -20px #1d294a}.user-table tbody tr:hover td:last-child{background:#fafbff}.user-table .user-actions{display:grid;grid-template-columns:repeat(3,max-content);gap:6px;justify-content:start;min-width:202px}.table-sort-button{margin:-6px -8px;padding:6px 8px;border:0;border-radius:7px;display:inline-flex;align-items:center;gap:5px;color:inherit;background:transparent;font:inherit;font-weight:inherit;letter-spacing:inherit;cursor:pointer}.table-sort-button:hover{color:#4f59cb;background:#eef0ff}.table-sort-button.active{color:#4854c7}.table-sort-button:focus-visible{outline:2px solid #6870ed;outline-offset:1px}.sort-indicator{width:11px;color:#a5adbc;font-size:10px;text-align:center}.table-sort-button.active .sort-indicator{color:#5962ef}
    .log-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}.log-chart .chart-bar{background:linear-gradient(180deg,#40c7b0,#159466);box-shadow:0 5px 13px #1594662e}.log-day-button{padding:0;border:0;color:inherit;background:transparent;cursor:pointer}.log-day-button:hover .chart-bar,.log-day-button.active .chart-bar{background:linear-gradient(180deg,#7566ee,#5862ed);box-shadow:0 5px 16px #5e66ef48}.log-day-button:focus-visible{outline:2px solid #6870ed;outline-offset:3px;border-radius:7px}.log-day-row{cursor:pointer}.log-day-row.active{background:#f0f2ff}.log-date-button{height:auto;padding:4px 8px;color:#4854c7;background:#eef0ff}.live-chip{display:inline-flex;align-items:center;gap:7px}.live-chip:before{content:"";width:7px;height:7px;border-radius:50%;background:#23b982;box-shadow:0 0 0 4px #23b98218}.pagination-bar{padding:13px 16px;display:flex;align-items:center;justify-content:flex-end;gap:9px;border-top:1px solid #edf0f5;background:#fafbfe}.pagination-bar label{display:flex;align-items:center;gap:7px;color:#778198;font-size:12px}.pagination-bar select{width:auto;height:32px;padding:0 28px 0 9px}.page-info{min-width:92px;color:#667287;text-align:center;font-size:12px}.log-dialog{width:min(1600px,96vw);max-height:92vh;padding:0;display:flex;flex-direction:column;overflow:hidden}.log-dialog-head{padding:18px 20px 14px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line)}.log-dialog-head h2{margin:0}.log-dialog-head p{margin:5px 0 0;color:var(--muted);font-size:12px}.log-dialog-actions{display:flex;align-items:center;gap:8px}.log-dialog-table{min-height:240px;overflow:auto}.model-chain{min-width:220px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}.attempt-pill{display:inline-flex;align-items:center;padding:4px 7px;border-radius:7px;color:#17774f;background:#e9f8f0;font-size:10px}.attempt-pill.failed{color:#bd3a51;background:#fff0f3}.attempt-pill.running{color:#94640d;background:#fff5df}.attempt-arrow{color:#a2aabc;font-size:10px}.log-question{min-width:220px;max-width:440px;white-space:normal;overflow-wrap:anywhere;line-height:1.55}.log-result{min-width:160px;max-width:340px;white-space:normal;overflow-wrap:anywhere;line-height:1.5}.log-table{min-width:1180px}.log-table td{vertical-align:middle}@media(max-width:1180px){.log-kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:820px){.log-kpis{grid-template-columns:repeat(2,1fr)}.pagination-bar{justify-content:center;flex-wrap:wrap}}@media(max-width:520px){.log-kpis{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <section class="login-shell" id="login-view">
    <div class="login-card">
      <div class="login-brand"><div class="brand-mark">秒</div><div><strong>秒答</strong><div style="color:#8792a6;font-size:12px;margin-top:3px">企业管理中心</div></div></div>
      <h1>管理员登录</h1>
      <p>请输入管理员用户名和密码进入控制台。初始密码保持不变，登录后仍可在后台修改。</p>
      <form class="login-form" id="login-form">
        <label>管理员用户名<input class="input" id="login-username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="128" placeholder="请输入管理员用户名"></label>
        <label>管理密码<input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="请输入管理密码"></label>
        <button class="button primary login-button" id="login-button" type="submit">登录管理中心</button>
        <div class="login-error" id="login-error" role="alert"></div>
      </form>
      <div class="login-security"><span class="security-dot"></span>支持公网安全访问，登录会话使用安全 Cookie、CSRF 校验与失败限流</div>
    </div>
  </section>

  <div class="app" id="app" hidden>
    <div class="mobile-overlay" id="mobile-overlay"></div>
    <aside class="sidebar">
      <div class="side-brand"><div class="brand-mark">秒</div><div><strong>秒答管理中心</strong><span>MIAODA CONSOLE</span></div></div>
      <div class="nav-label">业务管理</div>
      <nav class="nav-list">
        <button class="nav-button" data-view="cards"><span class="nav-icon">卡</span>卡密管理</button>
        <button class="nav-button" data-view="users"><span class="nav-icon">人</span>用户管理</button>
        <button class="nav-button" data-view="analytics"><span class="nav-icon">数</span>网站访问统计</button>
        <button class="nav-button" data-view="logs"><span class="nav-icon">录</span>请求日志</button>
        <button class="nav-button" data-view="trial"><span class="nav-icon">赠</span>新客赠送</button>
        <button class="nav-button" data-view="feedback"><span class="nav-icon">问</span>问题反馈<span class="nav-badge" id="feedback-badge" hidden>0</span></button>
      </nav>
      <div class="side-bottom">
        <button class="side-action" id="change-admin-password">修改管理密码</button>
        <button class="side-action" id="logout">退出登录</button>
      </div>
    </aside>
    <section class="workspace">
      <header class="topbar">
        <div class="topbar-left"><button class="button ghost menu-toggle" id="menu-toggle" aria-label="打开导航">☰</button><div><h1 id="page-title">网站访问统计</h1><p id="page-subtitle">访客趋势、累计销量与收益估算</p></div></div>
        <div class="secure-chip"><span class="security-dot"></span><span id="session-state">安全会话已登录</span></div>
      </header>
      <main class="content">
        <section class="view" id="view-trial">
          <section class="panel">
            <div class="panel-head"><div><h2>新客体验赠送</h2><p>配置新注册账户的面试与笔试体验额度，修改后立即生效，不影响已有账户余额。</p></div><span class="pill brand">服务端控制</span></div>
            <form class="trial-settings-form" id="trial-form">
              <div class="trial-state full"><div><strong>赠送状态</strong><p>关闭后官网不再展示赠送公告，新注册账户额度从 0 开始。</p></div><select id="trial-enabled"><option value="true">已开启</option><option value="false">已关闭</option></select></div>
              <label class="field">赠送面试时长（分钟）<input class="input" id="trial-minutes" type="number" min="0" max="1440" step="1" required></label>
              <label class="field">赠送笔试次数（次）<input class="input" id="trial-written" type="number" min="0" max="100" step="1" required></label>
              <label class="field">同一 IP 最多赠送账号数<input class="input" id="trial-ip-limit" type="number" min="1" max="20" step="1" required></label>
              <label class="field">IP 限制周期（天）<input class="input" id="trial-ip-days" type="number" min="1" max="365" step="1" required></label>
              <div class="trial-security full"><strong>防重复领取：</strong>同一设备终身只赠送一次；同一公网 IP 在限制周期内最多赠送设定数量的账号。超过限制仍允许注册，但不赠送体验额度。该策略能阻止普通用户清缓存或连续注册；若要进一步拦截 VPN 和批量设备，需要增加手机号验证。</div>
              <div class="trial-form-actions full"><span class="trial-updated" id="trial-updated">正在读取配置……</span><button class="button primary" id="save-trial" type="submit">保存配置</button></div>
            </form>
          </section>
        </section>

        <section class="view" id="view-feedback">
          <div class="section-actions"><button class="button ghost" id="refresh-feedback">刷新反馈</button></div>
          <section class="panel feedback-layout">
            <aside class="feedback-list"><div class="feedback-toolbar"><select id="feedback-filter"><option value="all">全部反馈</option><option value="open">待处理</option><option value="answered">已回复</option><option value="closed">已关闭</option></select></div><div class="feedback-items" id="feedback-items"><div class="empty">正在加载反馈……</div></div></aside>
            <div class="feedback-detail" id="feedback-detail"><div class="feedback-placeholder">选择一条反馈，查看用户描述与图片并进行回复。</div></div>
          </section>
        </section>

        <section class="view" id="view-logs">
          <div class="section-actions"><span class="pill brand live-chip" id="logs-updated">每 5 秒自动更新</span><button class="button ghost" id="refresh-logs">立即刷新</button></div>
          <div class="kpis log-kpis">
            <article class="kpi"><div class="kpi-label"><span>今日面试请求</span><span class="kpi-icon">次</span></div><strong id="log-today-requests">-</strong><small id="log-today-attempts">模型调用 - 次</small></article>
            <article class="kpi"><div class="kpi-label"><span>成功请求</span><span class="kpi-icon">成</span></div><strong id="log-today-succeeded">-</strong><small>最终获得有效回答</small></article>
            <article class="kpi"><div class="kpi-label"><span>失败请求</span><span class="kpi-icon">失</span></div><strong id="log-today-failed">-</strong><small>所有备用模型均未成功</small></article>
            <article class="kpi"><div class="kpi-label"><span>发生重试</span><span class="kpi-icon">重</span></div><strong id="log-today-retried">-</strong><small id="log-today-failed-attempts">失败模型尝试 - 次</small></article>
            <article class="kpi"><div class="kpi-label"><span>正在处理</span><span class="kpi-icon">实</span></div><strong id="log-today-running">-</strong><small>当前尚未完成的请求</small></article>
          </div>
          <div class="notice" id="logs-privacy">记录问题内容、用户、模型、状态与错误摘要，用于排查重复触发；不保存回答、简历和上下文。</div>
          <section class="panel">
            <div class="panel-head"><div><h2>每日面试请求</h2><p>点击日期查看当天全部请求；一次用户请求只计数一次，重试次数单独统计</p></div><span class="pill brand">最近 30 天</span></div>
            <div class="chart-wrap"><div class="visitor-chart log-chart" id="log-chart"></div></div>
            <div class="table-wrap" id="log-day-detail"><table class="data-table"><thead><tr><th>日期（点击查看）</th><th>请求数</th><th>成功</th><th>失败</th><th>发生重试</th></tr></thead><tbody id="log-days"></tbody></table></div>
            <div class="pagination-bar"><label>每页<select id="log-day-page-size"><option value="15">15 条</option><option value="30">30 条</option></select></label><button class="button small-button ghost" id="log-day-prev" type="button">上一页</button><span class="page-info" id="log-day-page-info">第 1 / 1 页</span><button class="button small-button ghost" id="log-day-next" type="button">下一页</button></div>
          </section>
        </section>

        <section class="view" id="view-analytics">
          <div class="section-actions"><button class="button ghost" id="refresh-dashboard">刷新统计</button></div>
          <div class="kpis">
            <article class="kpi"><div class="kpi-label"><span>今日访问人数</span><span class="kpi-icon">UV</span></div><strong id="stat-today-uv">-</strong><small id="stat-today-pv">页面浏览 - 次</small></article>
            <article class="kpi"><div class="kpi-label"><span>累计独立访客</span><span class="kpi-icon">访</span></div><strong id="stat-total-uv">-</strong><small id="stat-total-pv">累计浏览 - 次</small></article>
            <article class="kpi"><div class="kpi-label"><span>累计销售卡密</span><span class="kpi-icon">卡</span></div><strong id="stat-redeemed">-</strong><small>仅统计已兑换卡密</small></article>
            <article class="kpi"><div class="kpi-label"><span>累计收益估算</span><span class="kpi-icon">¥</span></div><strong id="stat-revenue">-</strong><small id="stat-unpriced">未定价卡密 - 张</small></article>
            <article class="kpi"><div class="kpi-label"><span>注册用户</span><span class="kpi-icon">人</span></div><strong id="stat-users">-</strong><small>当前账户总数</small></article>
          </div>
          <div class="notice" id="analytics-notice">正在加载统计口径……</div>
          <div class="analytics-grid">
            <section class="panel"><div class="panel-head"><div><h2>每日访问趋势</h2><p>按独立浏览器去重，不保存原始 IP</p></div><div class="panel-head-actions"><span class="pill brand">最近 30 天</span><button class="button small-button ghost" id="visitor-detail-toggle" type="button" aria-expanded="false" aria-controls="visitor-detail">展开访问明细</button></div></div><div class="chart-wrap"><div class="visitor-chart" id="visitor-chart"></div></div><div class="table-wrap" id="visitor-detail" hidden><table class="data-table"><thead><tr><th>日期</th><th>独立访客（UV）</th><th>浏览次数（PV）</th></tr></thead><tbody id="visitor-days"></tbody></table></div></section>
            <section class="panel"><div class="panel-head"><div><h2>销售平台</h2><p>按已兑换卡密所属批次归类</p></div></div><div class="platform-list" id="sales-platforms"></div></section>
          </div>
          <section class="panel"><div class="panel-head"><div><h2>套餐销量与收益</h2><p>固定售价来自当前链动小铺商品；金额单位为人民币</p></div><span class="pill brand">已兑换口径</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>套餐</th><th>类型</th><th>单价</th><th>已售数量</th><th>收益小计</th></tr></thead><tbody id="sales-products"></tbody></table></div></section>
          <div class="unpriced-note" id="unpriced-block" hidden><strong>未定价卡密</strong><div id="unpriced-rows" style="margin-top:6px"></div></div>
        </section>

        <section class="view" id="view-cards">
          <div class="section-actions"><button class="button ghost" id="refresh-cards">刷新卡组</button></div>
          <section class="panel">
            <div class="panel-head"><div><h2>生成卡密</h2><p>按销售平台建立独立批次并生成下载文件</p></div></div>
            <form class="card-form" id="card-form">
              <label class="field">生成数量（张）<input class="input" id="count" type="number" min="1" max="100" value="1" required></label>
              <label class="field">面试额度（分钟）<input class="input" id="minutes" type="number" min="0" step="1" value="10" required></label>
              <label class="field">笔试额度（题）<input class="input" id="written" type="number" min="0" step="1" value="0" required></label>
              <label class="field">销售平台<select id="platform"><option value="taobao">淘宝</option><option value="xianyu">闲鱼</option><option value="liandong">链动小铺</option></select></label>
              <button class="button primary" id="create-cards" type="submit">生成卡密</button>
            </form>
            <div class="form-tip"><div id="card-preview"></div><div style="margin-top:5px">卡密只充值额度，不改变设备数；每个账号固定可登录 5 台设备。同一账号兑换多张卡密时，额度自动叠加。</div></div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h2>卡密分组</h2><p>查看生成批次、使用情况与单张卡密</p></div></div>
            <div class="table-wrap"><table class="data-table" style="min-width:1080px"><thead><tr><th>卡密分组</th><th>平台</th><th>总数</th><th>使用情况</th><th>面试额度</th><th>笔试额度</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="batch-rows"><tr><td class="empty" colspan="8">正在加载卡密分组……</td></tr></tbody></table></div>
          </section>
        </section>

        <section class="view" id="view-users">
          <div class="user-stats"><article class="user-stat"><span>账户总数</span><strong id="user-total">-</strong></article><article class="user-stat"><span>今日新增</span><strong id="user-today-new">-</strong></article><article class="user-stat"><span>正常账户</span><strong id="user-active">-</strong></article><article class="user-stat"><span>已停用</span><strong id="user-disabled">-</strong></article><article class="user-stat"><span>累计兑换次数</span><strong id="user-redemptions">-</strong></article></div>
          <section class="panel">
            <div class="panel-head"><div><h2>每日新增用户</h2><p>按北京时间统计注册账户</p></div><div class="panel-head-actions"><span class="pill brand">最近 30 天</span><button class="button small-button ghost" id="user-growth-detail-toggle" type="button" aria-expanded="false" aria-controls="user-growth-detail">展开新增用户明细</button></div></div>
            <div class="chart-wrap"><div class="visitor-chart growth-chart" id="user-growth-chart"></div></div>
            <div class="table-wrap" id="user-growth-detail" hidden><table class="data-table"><thead><tr><th>日期</th><th>新增用户</th></tr></thead><tbody id="user-growth-days"></tbody></table></div>
          </section>
          <section class="panel">
            <div class="toolbar"><input class="input" id="user-search" placeholder="搜索用户名"><button class="button primary" id="search-users">搜索</button><button class="button ghost" id="refresh-users">刷新</button></div>
            <div class="table-wrap user-table-wrap"><table class="data-table user-table"><thead id="user-table-head"><tr><th>用户名</th><th>状态</th><th aria-sort="none"><button type="button" class="table-sort-button" data-user-sort="interview">面试余额 <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th>笔试余额</th><th>设备/活跃会话</th><th>兑换次数</th><th>注册 IP</th><th>注册时间</th><th aria-sort="none"><button type="button" class="table-sort-button" data-user-sort="activity">最近活动 <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th>操作</th></tr></thead><tbody id="user-rows"><tr><td class="empty" colspan="10">正在加载用户……</td></tr></tbody></table></div>
          </section>
        </section>
      </main>
    </section>
  </div>

  <div class="toast" id="toast"></div>
  <div class="mask" id="modal-mask">
    <div class="modal">
      <h2 id="modal-title"></h2><p id="modal-note"></p><div class="modal-fields" id="modal-fields"></div>
      <div class="modal-actions"><button class="button" id="modal-cancel">取消</button><button class="button primary" id="modal-confirm">确认</button></div>
    </div>
  </div>
  <div class="mask" id="batch-mask">
    <div class="modal batch-dialog">
      <div class="batch-dialog-head"><div><h2 id="batch-title"></h2><p id="batch-subtitle"></p></div><button class="button ghost" id="batch-close">关闭</button></div>
      <div class="batch-summary" id="batch-summary"></div>
      <div class="batch-table"><table class="data-table"><thead><tr><th>卡密</th><th>状态</th><th>面试额度</th><th>笔试额度</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="batch-card-rows"></tbody></table></div>
    </div>
  </div>
  <div class="mask" id="log-mask">
    <div class="modal log-dialog" role="dialog" aria-modal="true" aria-labelledby="log-selected-title">
      <div class="log-dialog-head"><div><h2 id="log-selected-title">请求明细</h2><p>展示所选日期的请求、模型切换路径和最终结果</p></div><div class="log-dialog-actions"><span class="pill brand" id="log-selected-count">0 条</span><button class="button small-button ghost" id="close-log-date" type="button">关闭</button></div></div>
      <div class="log-dialog-table"><table class="data-table log-table"><thead><tr><th>发起时间</th><th>用户</th><th>客户端版本</th><th>问题内容</th><th>状态</th><th>尝试</th><th>模型链路</th><th>结果 / 错误摘要</th><th>耗时</th></tr></thead><tbody id="log-rows"><tr><td class="empty" colspan="9">请选择日期查看请求</td></tr></tbody></table></div>
      <div class="pagination-bar"><label>每页<select id="log-request-page-size"><option value="15">15 条</option><option value="30">30 条</option></select></label><button class="button small-button ghost" id="log-request-prev" type="button">上一页</button><span class="page-info" id="log-request-page-info">第 1 / 1 页</span><button class="button small-button ghost" id="log-request-next" type="button">下一页</button></div>
    </div>
  </div>

  <script>
    const $=id=>document.getElementById(id);
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const when=value=>value?new Date(value).toLocaleString('zh-CN'):'-';
    const number=value=>Number(value||0).toLocaleString('zh-CN');
    const money=cents=>'¥'+(Number(cents||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const duration=seconds=>{seconds=Number(seconds||0);if(seconds%3600===0&&seconds>0)return seconds/3600+' 小时';if(seconds%60===0)return seconds/60+' 分钟';return seconds+' 秒'};
    const platformName=value=>({taobao:'淘宝',xianyu:'闲鱼',liandong:'链动小铺',legacy:'历史/未归类'}[value]||value||'历史/未归类');
    let activeView=location.pathname==='/manage'?'users':((location.hash||'#analytics').slice(1));
    if(!['feedback','logs','trial','cards','users','analytics'].includes(activeView))activeView='analytics';
    let dashboardLoaded=false,logsLoaded=false,logsLoading=false,trialLoaded=false,cardsLoaded=false,usersLoaded=false,userGrowthLoaded=false,feedbackLoaded=false,feedbackRows=[],activeFeedbackID='',batchMap=new Map(),detailCards=[],currentBatchCode='',users=[],userSort={key:'',direction:'desc'},modalAction=null,toastTimer=0;

    function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600)}
    function showLogin(message=''){$('app').hidden=true;$('login-view').hidden=false;$('login-error').textContent=message;setTimeout(()=>($('login-username').value.trim()?$('login-password'):$('login-username')).focus(),30)}
    function showApp(){$('login-view').hidden=true;$('app').hidden=false;setView(activeView);loadFeedbackUnread()}
    async function api(path,options={}){
      const headers=Object.assign({'X-Admin-CSRF':'1'},options.headers||{});
      if(options.body!==undefined&&!headers['Content-Type'])headers['Content-Type']='application/json';
      const response=await fetch('/api/admin'+path,Object.assign({},options,{headers,credentials:'same-origin',cache:'no-store'}));
      let data={};if(response.status!==204){try{data=await response.json()}catch{}}
      if(response.status===401){showLogin('登录已失效，请重新输入用户名和密码');throw Error(data.error?.message||'登录已失效')}
      if(!response.ok)throw Error(data.error?.message||'请求失败');
      return data;
    }
    async function bootstrap(){
      try{const response=await fetch('/api/admin/auth/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('not signed in');showApp()}
      catch{showLogin()}
    }
    $('login-form').addEventListener('submit',async event=>{
      event.preventDefault();const username=$('login-username').value.trim(),password=$('login-password').value;$('login-button').disabled=true;$('login-error').textContent='';
      try{const response=await fetch('/api/admin/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});let data={};try{data=await response.json()}catch{}if(!response.ok)throw Error(data.error?.message||'登录失败');showApp();toast('登录成功')}
      catch(error){$('login-error').textContent=error.message;$('login-password').value='';$('login-password').focus()}
      finally{$('login-button').disabled=false}
    });

    const viewCopy={
      feedback:['问题反馈','查看用户问题、截图并回复处理结果'],
      logs:['请求日志','面试请求量、模型失败与容错重试实时监控'],
      trial:['新客赠送','体验额度、官网公告与防重复领取配置'],
      cards:['卡密管理','生成、下载和管理销售卡密'],
      users:['用户管理','账户状态、额度、设备与密码管理'],
      analytics:['网站访问统计','访客趋势、累计销量与收益估算']
    };
    function setView(name){
      activeView=name;document.querySelectorAll('.nav-button').forEach(button=>button.classList.toggle('active',button.dataset.view===name));document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id==='view-'+name));
      $('page-title').textContent=viewCopy[name][0];$('page-subtitle').textContent=viewCopy[name][1];history.replaceState(null,'','#'+name);$('app').classList.remove('menu-open');
      if(name==='feedback'&&!feedbackLoaded)loadFeedback();if(name==='logs'&&!logsLoaded)loadInterviewLogs();if(name==='trial'&&!trialLoaded)loadTrialOffer();if(name==='analytics'&&!dashboardLoaded)loadDashboard();if(name==='cards'&&!cardsLoaded)loadCards();if(name==='users'){if(!usersLoaded)loadUsers();if(!userGrowthLoaded)loadUserGrowth()}
    }
    document.querySelectorAll('.nav-button').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
    $('menu-toggle').onclick=()=>$('app').classList.toggle('menu-open');$('mobile-overlay').onclick=()=>$('app').classList.remove('menu-open');

    function renderTrialOffer(settings){$('trial-enabled').value=String(Boolean(settings.enabled));$('trial-minutes').value=String(Math.round(Number(settings.interviewSeconds||0)/60));$('trial-written').value=String(Number(settings.writtenQuestions||0));$('trial-ip-limit').value=String(Number(settings.maxGrantsPerIp||2));$('trial-ip-days').value=String(Math.max(1,Math.round(Number(settings.ipWindowHours||720)/24)));$('trial-updated').textContent=settings.updatedAt?'最后更新：'+when(settings.updatedAt):'配置已加载'}
    async function loadTrialOffer(){try{renderTrialOffer(await api('/trial-offer'));trialLoaded=true}catch(error){toast(error.message)}}
    $('trial-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('save-trial');button.disabled=true;try{const settings=await api('/trial-offer',{method:'PUT',body:JSON.stringify({enabled:$('trial-enabled').value==='true',interviewSeconds:Math.round(Number($('trial-minutes').value)*60),writtenQuestions:Number($('trial-written').value),maxGrantsPerIp:Number($('trial-ip-limit').value),ipWindowHours:Math.round(Number($('trial-ip-days').value)*24)})});renderTrialOffer(settings);trialLoaded=true;toast('新客赠送配置已保存，官网公告已同步')}catch(error){toast(error.message)}finally{button.disabled=false}});

    const feedbackStatus={open:'待处理',answered:'已回复',closed:'已关闭'};
    function feedbackPill(status){return '<span class="pill '+(status==='answered'?'':status==='closed'?'off':'warn')+'">'+esc(feedbackStatus[status]||status)+'</span>'}
    async function loadFeedbackUnread(){try{const data=await api('/feedback/unread'),count=Number(data.count||0);$('feedback-badge').hidden=count<1;$('feedback-badge').textContent=count}catch{}}
    function renderFeedbackList(){const filter=$('feedback-filter').value,rows=filter==='all'?feedbackRows:feedbackRows.filter(item=>item.status===filter);$('feedback-items').innerHTML=rows.length?rows.map(item=>'<button class="feedback-item '+(item.id===activeFeedbackID?'active':'')+'" data-feedback-id="'+esc(item.id)+'"><span class="feedback-item-top"><span class="feedback-item-user"><b>'+esc(item.username)+'</b>'+(item.unread?'<i class="nav-badge" style="display:grid;position:static;padding:0;width:8px;min-width:8px;height:8px"></i>':'')+'</span>'+feedbackPill(item.status)+'</span><span class="feedback-preview">'+esc(item.latestBody)+'</span><time class="feedback-time">'+esc(when(item.updatedAt))+' · '+number(item.messageCount)+' 条</time></button>').join(''):'<div class="empty">暂无符合条件的反馈</div>'}
    async function loadFeedback(){try{const data=await api('/feedback');feedbackRows=Array.isArray(data)?data:[];renderFeedbackList();feedbackLoaded=true;await loadFeedbackUnread()}catch(error){toast(error.message)}}
    async function openFeedback(id){activeFeedbackID=id;renderFeedbackList();$('feedback-detail').innerHTML='<div class="feedback-placeholder">正在读取反馈……</div>';try{const item=await api('/feedback/'+encodeURIComponent(id));const row=feedbackRows.find(entry=>entry.id===id);if(row)row.unread=false;renderFeedbackList();const messages=(item.messages||[]).map(message=>{const images=(message.attachments||[]).map(file=>{const src='/api/admin/feedback/'+encodeURIComponent(id)+'/attachments/'+encodeURIComponent(file.id);return '<a href="'+src+'" target="_blank" rel="noopener"><img src="'+src+'" alt="'+esc(file.filename)+'" loading="lazy"></a>'}).join('');return '<article class="feedback-bubble '+message.sender+'"><div class="feedback-bubble-head"><b>'+(message.sender==='admin'?'管理员':'用户')+'</b><time>'+esc(when(message.createdAt))+'</time></div><div class="feedback-bubble-body">'+esc(message.body)+'</div>'+(images?'<div class="feedback-images">'+images+'</div>':'')+'</article>'}).join('');$('feedback-detail').innerHTML='<div class="feedback-detail-head"><div><h2>'+esc(item.username)+'</h2><p>反馈编号 '+esc(item.id)+' · 创建于 '+esc(when(item.createdAt))+'</p></div><select class="feedback-status-select" id="feedback-detail-status"><option value="open">待处理</option><option value="answered">已回复</option><option value="closed">已关闭</option></select></div><div class="feedback-messages">'+messages+'</div><form class="feedback-reply" id="feedback-reply"><textarea id="feedback-reply-message" maxlength="4000" required placeholder="输入给用户的回复……"></textarea><div class="feedback-reply-actions"><button class="button primary" type="submit">回复用户</button></div></form>';$('feedback-detail-status').value=item.status;$('feedback-detail-status').onchange=changeFeedbackStatus;$('feedback-reply').onsubmit=replyFeedback;await loadFeedbackUnread()}catch(error){toast(error.message)}}
    async function replyFeedback(event){event.preventDefault();const message=$('feedback-reply-message').value.trim(),button=event.currentTarget.querySelector('button');if(!message)return;button.disabled=true;try{await api('/feedback/'+encodeURIComponent(activeFeedbackID)+'/reply',{method:'POST',body:JSON.stringify({message})});toast('回复已发送，用户首页将显示红点');await loadFeedback();await openFeedback(activeFeedbackID)}catch(error){toast(error.message)}finally{button.disabled=false}}
    async function changeFeedbackStatus(){try{await api('/feedback/'+encodeURIComponent(activeFeedbackID)+'/status',{method:'POST',body:JSON.stringify({status:$('feedback-detail-status').value})});toast('反馈状态已更新');await loadFeedback()}catch(error){toast(error.message)}}
    $('feedback-items').onclick=event=>{const item=event.target.closest('[data-feedback-id]');if(item)openFeedback(item.dataset.feedbackId)};$('feedback-filter').onchange=renderFeedbackList;$('refresh-feedback').onclick=()=>{feedbackLoaded=false;loadFeedback()};
    setInterval(()=>{if(!$('app').hidden)loadFeedbackUnread()},60000);

    const logStatusText={running:'处理中',succeeded:'成功',failed:'失败'};
    let selectedLogDate='',logDays=[],logDayPage=1,logDayPageSize=15,logRequestPage=1,logRequestPageSize=15,logRequestTotal=0,logRequestTotalPages=0;
    function logStatusPill(status){return '<span class="pill '+(status==='succeeded'?'':status==='failed'?'off':'warn')+'">'+esc(logStatusText[status]||status)+'</span>'}
    function isHistoricalLog(item){return String(item.requestId||'').startsWith('legacy-usage-')}
    function logDuration(item){if(isHistoricalLog(item))return '历史未采集';const start=new Date(item.startedAt).getTime(),end=item.completedAt?new Date(item.completedAt).getTime():Date.now(),ms=Math.max(0,end-start);if(!Number.isFinite(ms))return '-';return ms<1000?ms+' ms':(ms/1000).toFixed(ms<10000?1:0)+' 秒'}
    function logModelChain(item){const attempts=Array.isArray(item.attempts)?item.attempts:[];if(!attempts.length)return item.finalModel?'<span class="attempt-pill">'+esc(item.finalModel)+'（历史）</span>':'<span style="color:#99a2b3">无尝试明细</span>';return attempts.map((attempt,index)=>'<span class="attempt-pill '+(attempt.status==='failed'?'failed':attempt.status==='running'?'running':'')+'" title="'+esc(attempt.errorMessage||'')+'">'+esc(attempt.model||attempt.provider)+' · '+esc(logStatusText[attempt.status]||attempt.status)+'</span>'+(index<attempts.length-1?'<span class="attempt-arrow">→</span>':'')).join('')}
    function logQuestion(item){return item.questionText|| (isHistoricalLog(item)?'历史未记录':'-')}
    function logClientVersion(item){const version=String(item.clientVersion||'').trim();return version?(version.toLowerCase().startsWith('v')?version:'v'+version):'未记录'}
    function renderLogRows(requests){$('log-rows').innerHTML=requests.length?requests.map(item=>{const attempts=Array.isArray(item.attempts)?item.attempts:[],failed=attempts.find(attempt=>attempt.status==='failed'),result=item.status==='succeeded'?'最终模型：'+(item.finalModel||'-'):(item.errorMessage||failed?.errorMessage||'等待处理'),question=logQuestion(item);return '<tr><td>'+esc(when(item.startedAt))+'</td><td class="username">'+esc(item.username)+'</td><td>'+esc(logClientVersion(item))+'</td><td><div class="log-question" title="'+esc(question)+'">'+esc(question)+'</div></td><td>'+logStatusPill(item.status)+'</td><td>'+number(item.attemptCount)+' 次'+(Number(item.retryCount)>0?' <span class="pill warn">重试 '+number(item.retryCount)+'</span>':'')+'</td><td><div class="model-chain">'+logModelChain(item)+'</div></td><td><div class="log-result" title="'+esc(result)+'">'+esc(result)+'</div></td><td>'+esc(logDuration(item))+'</td></tr>'}).join(''):'<tr><td class="empty" colspan="9">该日期暂无面试请求</td></tr>'}
    function renderLogDays(){const rows=logDays.slice().reverse(),pages=Math.max(1,Math.ceil(rows.length/logDayPageSize));logDayPage=Math.min(logDayPage,pages);const visible=rows.slice((logDayPage-1)*logDayPageSize,logDayPage*logDayPageSize);$('log-days').innerHTML=visible.length?visible.map(day=>'<tr class="log-day-row '+(day.date===selectedLogDate?'active':'')+'" data-log-date="'+esc(day.date)+'"><td><button type="button" class="button small-button log-date-button" data-log-date="'+esc(day.date)+'">'+esc(day.date)+'</button></td><td>'+number(day.requests)+'</td><td>'+number(day.succeeded)+'</td><td>'+number(day.failed)+'</td><td>'+number(day.retried)+'</td></tr>').join(''):'<tr><td class="empty" colspan="5">暂无面试请求</td></tr>';$('log-day-page-info').textContent='第 '+logDayPage+' / '+pages+' 页';$('log-day-prev').disabled=logDayPage<=1;$('log-day-next').disabled=logDayPage>=pages}
    function renderInterviewLogs(data){const today=data.today||{},days=Array.isArray(data.days)?data.days:[],requests=Array.isArray(data.selectedRequests)?data.selectedRequests:[];$('log-today-requests').textContent=number(today.requests);$('log-today-attempts').textContent='模型调用 '+number(today.attempts)+' 次';$('log-today-succeeded').textContent=number(today.succeeded);$('log-today-failed').textContent=number(today.failed);$('log-today-retried').textContent=number(today.retried);$('log-today-failed-attempts').textContent='失败模型尝试 '+number(today.failedAttempts)+' 次';$('log-today-running').textContent=number(today.running);$('logs-privacy').textContent=data.privacyNotice||'记录问题内容用于排查重复触发，不保存回答、简历和上下文。';logDays=days;renderLogDays();const maxRequests=Math.max(1,...days.map(day=>Number(day.requests||0)));$('log-chart').innerHTML=days.map((day,index)=>'<button type="button" class="chart-column log-day-button '+(day.date===selectedLogDate?'active':'')+'" data-log-date="'+esc(day.date)+'" title="'+esc(day.date)+' · 请求 '+number(day.requests)+' · 失败 '+number(day.failed)+' · 重试 '+number(day.retried)+'" aria-label="查看 '+esc(day.date)+' 的全部 '+number(day.requests)+' 条请求"><span class="chart-bar" style="height:'+Math.max(2,Math.round(Number(day.requests||0)/maxRequests*100))+'%"></span><span class="chart-label">'+(index%5===0||index===days.length-1?esc(day.date.slice(5)):'')+'</span></button>').join('');if(data.selectedDate){selectedLogDate=data.selectedDate;logRequestPage=Number(data.selectedPage||1);logRequestPageSize=Number(data.selectedPageSize||15);logRequestTotal=Number(data.selectedTotal||0);logRequestTotalPages=Number(data.selectedTotalPages||0);$('log-request-page-size').value=String(logRequestPageSize);$('log-selected-title').textContent=selectedLogDate+' 请求明细';$('log-selected-count').textContent=number(logRequestTotal)+' 条';$('log-request-page-info').textContent='第 '+logRequestPage+' / '+Math.max(1,logRequestTotalPages)+' 页';$('log-request-prev').disabled=logRequestPage<=1;$('log-request-next').disabled=logRequestTotalPages===0||logRequestPage>=logRequestTotalPages;renderLogRows(requests);$('log-mask').classList.add('open')}else if(!selectedLogDate){$('log-mask').classList.remove('open')}$('logs-updated').textContent='实时更新 · '+new Date(data.serverTime||Date.now()).toLocaleTimeString('zh-CN');logsLoaded=true}
    async function loadInterviewLogs(silent=false){if(logsLoading)return;logsLoading=true;if(!silent)$('refresh-logs').disabled=true;try{const dateQuery=selectedLogDate?'&date='+encodeURIComponent(selectedLogDate)+'&page='+logRequestPage+'&pageSize='+logRequestPageSize:'';renderInterviewLogs(await api('/interview-logs?days=30'+dateQuery))}catch(error){if(!silent)toast(error.message)}finally{logsLoading=false;$('refresh-logs').disabled=false}}
    async function openLogDate(date){if(!date)return;selectedLogDate=date;logRequestPage=1;$('log-selected-title').textContent=date+' 请求明细';$('log-selected-count').textContent='加载中';$('log-rows').innerHTML='<tr><td class="empty" colspan="9">正在加载请求明细……</td></tr>';$('log-mask').classList.add('open');await loadInterviewLogs()}
    function closeLogDate(){selectedLogDate='';$('log-mask').classList.remove('open');document.querySelectorAll('[data-log-date].active').forEach(item=>item.classList.remove('active'));renderLogDays()}
    $('refresh-logs').onclick=()=>loadInterviewLogs();$('log-chart').onclick=event=>{const item=event.target.closest('[data-log-date]');if(item)openLogDate(item.dataset.logDate)};$('log-days').onclick=event=>{const item=event.target.closest('[data-log-date]');if(item)openLogDate(item.dataset.logDate)};$('close-log-date').onclick=closeLogDate;$('log-mask').onclick=event=>{if(event.target===$('log-mask'))closeLogDate()};$('log-day-page-size').onchange=event=>{logDayPageSize=Number(event.target.value);logDayPage=1;renderLogDays()};$('log-day-prev').onclick=()=>{if(logDayPage>1){logDayPage--;renderLogDays()}};$('log-day-next').onclick=()=>{if(logDayPage<Math.ceil(logDays.length/logDayPageSize)){logDayPage++;renderLogDays()}};$('log-request-page-size').onchange=event=>{logRequestPageSize=Number(event.target.value);logRequestPage=1;loadInterviewLogs()};$('log-request-prev').onclick=()=>{if(logRequestPage>1){logRequestPage--;loadInterviewLogs()}};$('log-request-next').onclick=()=>{if(logRequestPage<logRequestTotalPages){logRequestPage++;loadInterviewLogs()}};document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('log-mask').classList.contains('open'))closeLogDate()});setInterval(()=>{if(!$('app').hidden&&activeView==='logs')loadInterviewLogs(true)},5000);

    async function loadDashboard(){
      $('refresh-dashboard').disabled=true;
      try{
        const data=await api('/dashboard?days=30'),visitor=data.visitor||{},sales=data.sales||{};
        $('stat-today-uv').textContent=number(visitor.todayUnique);$('stat-today-pv').textContent='页面浏览 '+number(visitor.todayViews)+' 次';
        $('stat-total-uv').textContent=number(visitor.totalUnique);$('stat-total-pv').textContent='累计浏览 '+number(visitor.totalViews)+' 次';
        $('stat-redeemed').textContent=number(sales.redeemedCards);$('stat-revenue').textContent=money(sales.estimatedRevenueCents);$('stat-unpriced').textContent='未定价卡密 '+number(sales.unpricedCards)+' 张';$('stat-users').textContent=number(data.users?.total);
        $('analytics-notice').textContent=data.notice||'';
        const days=Array.isArray(visitor.days)?visitor.days:[],maxUV=Math.max(1,...days.map(day=>Number(day.uniqueVisitors||0)));
        $('visitor-chart').innerHTML=days.map((day,index)=>'<div class="chart-column" title="'+esc(day.date)+' · UV '+number(day.uniqueVisitors)+' · PV '+number(day.pageViews)+'"><div class="chart-bar" style="height:'+Math.max(2,Math.round(Number(day.uniqueVisitors||0)/maxUV*100))+'%"></div><div class="chart-label">'+(index%5===0||index===days.length-1?esc(day.date.slice(5)):'')+'</div></div>').join('');
        $('visitor-days').innerHTML=days.length?days.slice().reverse().map(day=>'<tr><td>'+esc(day.date)+'</td><td>'+number(day.uniqueVisitors)+'</td><td>'+number(day.pageViews)+'</td></tr>').join(''):'<tr><td class="empty" colspan="3">暂无访问数据</td></tr>';
        const products=Array.isArray(sales.products)?sales.products:[];
        $('sales-products').innerHTML=products.map(product=>'<tr><td><strong>'+esc(product.label)+'</strong></td><td><span class="pill brand">'+(product.category==='interview'?'面试':'笔试')+'</span></td><td>'+money(product.unitPriceCents)+'</td><td>'+number(product.soldCount)+' 张</td><td class="money">'+money(product.revenueCents)+'</td></tr>').join('');
        const platforms=Array.isArray(sales.platforms)?sales.platforms:[];
        $('sales-platforms').innerHTML=platforms.map(platform=>'<article class="platform-card"><div class="platform-card-top"><b>'+esc(platform.label)+'</b><strong>'+number(platform.soldCount)+' 张</strong></div><p>收益 '+money(platform.revenueCents)+' · 未定价 '+number(platform.unpricedCount)+' 张</p></article>').join('');
        const unpriced=Array.isArray(sales.unpriced)?sales.unpriced:[];$('unpriced-block').hidden=!unpriced.length;$('unpriced-rows').innerHTML=unpriced.map(item=>esc(item.platformLabel)+' · '+esc(item.label)+'：'+number(item.soldCount)+' 张').join('<br>');
        dashboardLoaded=true;
      }catch(error){toast(error.message)}
      finally{$('refresh-dashboard').disabled=false}
    }
    $('refresh-dashboard').onclick=()=>{dashboardLoaded=false;loadDashboard()};
    function bindDetailToggle(toggleID,detailID,expandText,collapseText){
      $(toggleID).onclick=()=>{const detail=$(detailID),expanded=detail.hidden;detail.hidden=!expanded;$(toggleID).setAttribute('aria-expanded',String(expanded));$(toggleID).textContent=expanded?collapseText:expandText};
    }
    bindDetailToggle('visitor-detail-toggle','visitor-detail','展开访问明细','收起访问明细');

    async function loadUserGrowth(){
      try{
        const data=await api('/dashboard?days=30'),growth=data.users||{},days=Array.isArray(growth.days)?growth.days:[],maxNew=Math.max(1,...days.map(day=>Number(day.newUsers||0)));
        $('user-today-new').textContent=number(growth.todayNew);
        $('user-growth-chart').innerHTML=days.map((day,index)=>'<div class="chart-column" title="'+esc(day.date)+' · 新增 '+number(day.newUsers)+'"><div class="chart-bar" style="height:'+Math.max(2,Math.round(Number(day.newUsers||0)/maxNew*100))+'%"></div><div class="chart-label">'+(index%5===0||index===days.length-1?esc(day.date.slice(5)):'')+'</div></div>').join('');
        $('user-growth-days').innerHTML=days.length?days.slice().reverse().map(day=>'<tr><td>'+esc(day.date)+'</td><td>'+number(day.newUsers)+'</td></tr>').join(''):'<tr><td class="empty" colspan="2">暂无新增用户</td></tr>';
        userGrowthLoaded=true;
      }catch(error){toast(error.message)}
    }
    bindDetailToggle('user-growth-detail-toggle','user-growth-detail','展开新增用户明细','收起新增用户明细');

    function updateCardPreview(){const count=Math.max(0,Number($('count').value)||0),minutes=Math.max(0,Number($('minutes').value)||0),written=Math.max(0,Number($('written').value)||0);$('card-preview').innerHTML='将为 <strong>'+esc(platformName($('platform').value))+'</strong> 生成 <strong>'+number(count)+' 张</strong>卡密，每张含 <strong>'+number(minutes)+' 分钟面试</strong>、<strong>'+number(written)+' 道笔试题</strong>。'}
    ['count','minutes','written','platform'].forEach(id=>$(id).addEventListener('input',updateCardPreview));updateCardPreview();
    function batchName(batch){if(batch?.displayName)return batch.displayName;return batch?.batchCode||'未命名卡组'}
    function renderBatches(batches){
      batchMap=new Map(batches.map(batch=>[batch.batchCode,batch]));
      $('batch-rows').innerHTML=batches.length?batches.map(batch=>'<tr><td><button class="button small-button ghost batch-name" data-open-batch="'+esc(batch.batchCode)+'">'+esc(batchName(batch))+'</button></td><td><span class="pill brand">'+esc(platformName(batch.salesPlatform))+'</span></td><td>'+number(batch.cardCount)+' 张</td><td><span class="pill">可用 '+number(batch.activeCount)+'</span> <span class="pill off">已兑换 '+number(batch.redeemedCount)+'</span></td><td>'+duration(batch.interviewSeconds)+'</td><td>'+number(batch.writtenQuestions)+' 题</td><td>'+esc(when(batch.createdAt))+'</td><td><div class="actions"><button class="button small-button ghost" data-open-batch="'+esc(batch.batchCode)+'">查看</button><button class="button small-button primary" data-download-batch="'+esc(batch.batchCode)+'">下载</button><button class="button small-button danger" data-delete-batch="'+esc(batch.batchCode)+'">删除</button></div></td></tr>').join(''):'<tr><td class="empty" colspan="8">暂无卡密分组</td></tr>';
    }
    async function loadCards(){try{const batches=await api('/card-batches?limit=200');renderBatches(Array.isArray(batches)?batches:[]);cardsLoaded=true}catch(error){toast(error.message)}}
    $('refresh-cards').onclick=()=>loadCards();
    $('card-form').addEventListener('submit',async event=>{
      event.preventDefault();$('create-cards').disabled=true;
      try{const data=await api('/cards/create',{method:'POST',body:JSON.stringify({count:Number($('count').value),interviewSeconds:Math.round(Number($('minutes').value)*60),writtenQuestions:Number($('written').value),salesPlatform:$('platform').value})});toast('已生成 '+batchName(data.batch));await loadCards()}
      catch(error){toast(error.message)}
      finally{$('create-cards').disabled=false}
    });
    function cardStatus(status){return status==='active'?'可用':status==='redeemed'?'已兑换':status==='disabled'?'已停用':status}
    function cardStatusClass(status){return status==='active'?'':status==='disabled'?' warn':' off'}
    function renderBatchDetails(data){
      const batch=data.batch;detailCards=Array.isArray(data.cards)?data.cards:[];currentBatchCode=batch.batchCode;$('batch-title').textContent=batchName(batch);$('batch-subtitle').textContent='内部编号：'+batch.batchCode+' · '+platformName(batch.salesPlatform)+' · '+detailCards.length+' 张卡密';
      $('batch-summary').innerHTML='<span class="summary-chip">面试额度：'+esc(duration(batch.interviewSeconds))+'</span><span class="summary-chip">笔试额度：'+number(batch.writtenQuestions)+' 题</span><span class="summary-chip">已兑换：'+number(batch.redeemedCount)+' 张</span>';
      $('batch-card-rows').innerHTML=detailCards.map(card=>{const editable=card.status==='active'||card.status==='disabled';return '<tr><td class="key">'+esc(card.cardKey)+'</td><td><span class="pill'+cardStatusClass(card.status)+'">'+esc(cardStatus(card.status))+'</span></td><td>'+duration(card.remainingInterviewSeconds)+'</td><td>'+number(card.remainingWrittenQuestions)+' 题</td><td>'+esc(when(card.createdAt))+'</td><td><div class="actions">'+(editable?'<button class="button small-button ghost" data-card-action="recharge" data-card-key="'+esc(card.cardKey)+'">充值</button><button class="button small-button '+(card.status==='active'?'danger':'primary')+'" data-card-action="toggle" data-card-key="'+esc(card.cardKey)+'">'+(card.status==='active'?'停用':'启用')+'</button>':'')+'<button class="button small-button danger" data-card-action="delete" data-card-key="'+esc(card.cardKey)+'">删除</button></div></td></tr>'}).join('')||'<tr><td class="empty" colspan="6">该分组暂无卡密</td></tr>';
      $('batch-mask').classList.add('open');
    }
    async function openBatch(code){try{renderBatchDetails(await api('/card-batches/'+encodeURIComponent(code)))}catch(error){toast(error.message)}}
    function closeBatch(){$('batch-mask').classList.remove('open');detailCards=[];currentBatchCode=''}
    $('batch-close').onclick=closeBatch;$('batch-mask').onclick=event=>{if(event.target===$('batch-mask'))closeBatch()};
    async function refreshBatch(){if(!currentBatchCode)return;try{renderBatchDetails(await api('/card-batches/'+encodeURIComponent(currentBatchCode)));await loadCards()}catch(error){closeBatch();toast(error.message)}}
    async function downloadBatch(code){
      try{const response=await fetch('/api/admin/card-batches/'+encodeURIComponent(code)+'/download',{credentials:'same-origin',cache:'no-store'});if(response.status===401){showLogin('登录已失效，请重新输入管理密码');throw Error('登录已失效')}if(!response.ok){let data={};try{data=await response.json()}catch{}throw Error(data.error?.message||'下载失败')}const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=batchName(batchMap.get(code)||{batchCode:code})+'.txt';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)}
      catch(error){toast(error.message)}
    }
    function openModal(title,note,fields,action,{danger=false,confirmText='确认'}={}){$('modal-title').textContent=title;$('modal-note').textContent=note;$('modal-fields').innerHTML=fields;$('modal-confirm').className='button '+(danger?'danger':'primary');$('modal-confirm').textContent=confirmText;$('modal-confirm').disabled=false;modalAction=action;$('modal-mask').classList.add('open')}
    function closeModal(){$('modal-mask').classList.remove('open');modalAction=null}
    $('modal-cancel').onclick=closeModal;$('modal-mask').onclick=event=>{if(event.target===$('modal-mask'))closeModal()};
    $('modal-confirm').onclick=async()=>{if(!modalAction)return;const action=modalAction;$('modal-confirm').disabled=true;try{const result=await action();if(modalAction===action&&result!==false)closeModal()}catch(error){toast(error.message)}finally{if(modalAction===action)$('modal-confirm').disabled=false}};
    function deleteBatch(code){const batch=batchMap.get(code);openModal('删除卡密分组','将删除“'+batchName(batch||{batchCode:code})+'”及其中 '+number(batch?.cardCount)+' 张卡密。已充值到账户的额度不会回退，累计销售台账会保留。','',async()=>{const result=await api('/card-batches/'+encodeURIComponent(code),{method:'DELETE'});if(currentBatchCode===code)closeBatch();toast('已删除 '+number(result.deletedCards)+' 张卡密');await loadCards();dashboardLoaded=false},{danger:true,confirmText:'确认删除'})}
    function detailCard(key){return detailCards.find(card=>card.cardKey===key)}
    function cardAction(action,key){
      const card=detailCard(key);if(!card)return toast('卡密信息已刷新，请重新打开分组');
      if(action==='recharge')openModal('充值卡密','为 '+card.cardKey+' 增加额度。','<label class="field">增加面试时长（分钟）<input class="input" id="recharge-minutes" type="number" min="0" value="60"></label><label class="field">增加笔试额度（题）<input class="input" id="recharge-written" type="number" min="0" value="10"></label>',async()=>{const seconds=Math.round(Number($('recharge-minutes').value)*60),written=Number($('recharge-written').value);if(!Number.isFinite(seconds)||!Number.isFinite(written)||seconds<0||written<0||(seconds===0&&written===0))throw Error('请输入有效额度');await api('/cards/recharge',{method:'POST',body:JSON.stringify({cardKey:card.cardKey,interviewSeconds:seconds,writtenQuestions:written})});toast('充值成功');await refreshBatch()});
      if(action==='toggle'){const next=card.status==='active'?'disabled':'active';openModal(next==='active'?'启用卡密':'停用卡密',next==='active'?'启用后该卡密可继续兑换。':'停用后该卡密暂时无法兑换。','',async()=>{await api('/cards/'+encodeURIComponent(card.cardKey),{method:'PUT',body:JSON.stringify({status:next,interviewSeconds:card.remainingInterviewSeconds,writtenQuestions:card.remainingWrittenQuestions,maxDevices:card.maxDevices,note:card.note})});toast(next==='active'?'卡密已启用':'卡密已停用');await refreshBatch()},{danger:next==='disabled'});}
      if(action==='delete')openModal('删除卡密','将永久删除 '+card.cardKey+'。已兑换产生的销售台账仍会保留。','',async()=>{await api('/cards/'+encodeURIComponent(card.cardKey),{method:'DELETE'});toast('卡密已删除');await refreshBatch();dashboardLoaded=false},{danger:true,confirmText:'确认删除'});
    }
    document.addEventListener('click',event=>{const target=event.target.closest('[data-open-batch],[data-download-batch],[data-delete-batch],[data-card-action]');if(!target)return;if(target.dataset.openBatch)openBatch(target.dataset.openBatch);else if(target.dataset.downloadBatch)downloadBatch(target.dataset.downloadBatch);else if(target.dataset.deleteBatch)deleteBatch(target.dataset.deleteBatch);else if(target.dataset.cardAction)cardAction(target.dataset.cardAction,target.dataset.cardKey)});

    function sortedUsers(){
      if(!userSort.key)return users;
      return [...users].sort((left,right)=>{
        let leftValue=0,rightValue=0;
        if(userSort.key==='interview'){
          leftValue=Number(left.remainingInterviewSeconds||0);rightValue=Number(right.remainingInterviewSeconds||0);
        }else{
          leftValue=Date.parse(left.lastSeenAt||'');rightValue=Date.parse(right.lastSeenAt||'');
          const leftMissing=!Number.isFinite(leftValue),rightMissing=!Number.isFinite(rightValue);
          if(leftMissing!==rightMissing)return leftMissing?1:-1;
          if(leftMissing&&rightMissing)return String(left.username||'').localeCompare(String(right.username||''),'zh-CN');
        }
        const difference=leftValue-rightValue;
        if(difference!==0)return userSort.direction==='asc'?difference:-difference;
        return String(left.username||'').localeCompare(String(right.username||''),'zh-CN');
      });
    }
    function updateUserSortHeaders(){
      document.querySelectorAll('[data-user-sort]').forEach(button=>{
        const active=button.dataset.userSort===userSort.key,direction=active?userSort.direction:'none';
        button.classList.toggle('active',active);button.closest('th').setAttribute('aria-sort',direction==='asc'?'ascending':direction==='desc'?'descending':'none');button.querySelector('.sort-indicator').textContent=direction==='asc'?'▲':direction==='desc'?'▼':'↕';
      });
    }
    function renderUsers(){
      $('user-total').textContent=number(users.length);$('user-active').textContent=number(users.filter(user=>user.status==='active').length);$('user-disabled').textContent=number(users.filter(user=>user.status!=='active').length);$('user-redemptions').textContent=number(users.reduce((sum,user)=>sum+Number(user.redemptionCount||0),0));
      const visibleUsers=sortedUsers();updateUserSortHeaders();
      $('user-rows').innerHTML=visibleUsers.length?visibleUsers.map(user=>'<tr><td class="username">'+esc(user.username)+'</td><td><span class="pill'+(user.status==='active'?'':' off')+'">'+(user.status==='active'?'正常':'已停用')+'</span></td><td>'+number(Math.floor(Number(user.remainingInterviewSeconds||0)/60))+' 分钟</td><td>'+number(user.remainingWrittenQuestions)+' 题</td><td>'+number(user.deviceCount)+' / '+number(user.activeSessionCount)+'</td><td>'+number(user.redemptionCount)+'</td><td>'+esc(user.registrationIp||'-')+'</td><td>'+esc(when(user.createdAt))+'</td><td>'+esc(when(user.lastSeenAt))+'</td><td><div class="actions user-actions" data-user="'+esc(user.username)+'"><button class="button small-button ghost" data-user-action="quota">额度</button><button class="button small-button '+(user.status==='active'?'danger':'primary')+'" data-user-action="status">'+(user.status==='active'?'停用':'启用')+'</button><button class="button small-button ghost" data-user-action="devices">清设备</button><button class="button small-button warning" data-user-action="password">重置密码</button><button class="button small-button danger" data-user-action="delete">删除账号</button></div></td></tr>').join(''):'<tr><td class="empty" colspan="10">暂无用户</td></tr>';
    }
    function openUserDeleteFinal(username,path){
      openModal('永久删除账号：第二次确认','请输入完整且大小写一致的用户名“'+username+'”。删除后无法恢复。','<label class="field">输入用户名 <b>'+esc(username)+'</b><input class="input" id="delete-user-confirm" autocomplete="off" autocapitalize="none" spellcheck="false"></label>',async()=>{const confirmation=$('delete-user-confirm').value;if(confirmation!==username)throw Error('输入的用户名不一致');await api(path,{method:'DELETE',body:JSON.stringify({confirmUsername:confirmation})});toast('账号 '+username+' 已永久删除');await loadUsers();dashboardLoaded=false;userGrowthLoaded=false},{danger:true,confirmText:'永久删除账号'});
      const input=$('delete-user-confirm'),confirm=$('modal-confirm');confirm.disabled=true;input.oninput=()=>{confirm.disabled=input.value!==username};setTimeout(()=>input.focus(),30)
    }
    function openUserDeleteConfirmation(username,path){openModal('删除账号：第一次确认','将永久删除“'+username+'”的账号余额、登录会话、设备绑定和问题反馈，且无法恢复。已产生的销售统计会保留。','',async()=>{openUserDeleteFinal(username,path);return false},{danger:true,confirmText:'继续删除'})}
    async function loadUsers(){try{const query=encodeURIComponent($('user-search').value.trim());const data=await api('/users?limit=500&search='+query);users=Array.isArray(data)?data:[];renderUsers();usersLoaded=true}catch(error){toast(error.message)}}
    $('search-users').onclick=loadUsers;$('refresh-users').onclick=()=>{usersLoaded=false;userGrowthLoaded=false;loadUsers();loadUserGrowth()};$('user-search').onkeydown=event=>{if(event.key==='Enter')loadUsers()};
    $('user-table-head').onclick=event=>{const button=event.target.closest('[data-user-sort]');if(!button)return;const key=button.dataset.userSort;userSort=key===userSort.key?{key,direction:userSort.direction==='desc'?'asc':'desc'}:{key,direction:'desc'};renderUsers()};
    $('user-rows').onclick=event=>{
      const button=event.target.closest('[data-user-action]');if(!button)return;const username=button.closest('[data-user]').dataset.user,user=users.find(item=>item.username===username),path='/users/'+encodeURIComponent(username);if(!user)return;
      if(button.dataset.userAction==='quota')openModal('编辑用户额度','直接设置 '+username+' 的当前余额。','<label class="field">面试余额（分钟）<input class="input" id="quota-minutes" type="number" min="0" step="0.1" value="'+Number(user.remainingInterviewSeconds||0)/60+'"></label><label class="field">笔试余额（题）<input class="input" id="quota-written" type="number" min="0" step="1" value="'+Number(user.remainingWrittenQuestions||0)+'"></label>',async()=>{await api(path+'/quota',{method:'POST',body:JSON.stringify({interviewSeconds:Math.round(Number($('quota-minutes').value)*60),writtenQuestions:Number($('quota-written').value)})});toast('用户额度已更新');await loadUsers()});
      if(button.dataset.userAction==='status'){const next=user.status==='active'?'disabled':'active';openModal(next==='active'?'启用账户':'停用账户',next==='active'?'启用后用户可以重新登录。':'停用会立即撤销该用户的全部登录会话。','',async()=>{await api(path+'/status',{method:'POST',body:JSON.stringify({status:next})});toast(next==='active'?'账户已启用':'账户已停用');await loadUsers()},{danger:next==='disabled'});}
      if(button.dataset.userAction==='devices')openModal('清除设备绑定','将撤销 '+username+' 的全部会话，用户需要重新登录。','',async()=>{await api(path+'/reset-devices',{method:'POST',body:'{}'});toast('设备绑定已清除');await loadUsers()},{danger:true});
      if(button.dataset.userAction==='password')openModal('重置用户密码','为 '+username+' 设置新密码，现有登录会全部失效。','<label class="field">新密码（8～24 位）<input class="input" id="user-new-password" type="password" minlength="8" maxlength="24" autocomplete="new-password"></label>',async()=>{await api(path+'/password',{method:'POST',body:JSON.stringify({password:$('user-new-password').value})});toast('用户密码已重置')},{danger:true});
      if(button.dataset.userAction==='delete')openUserDeleteConfirmation(username,path);
    };

    $('change-admin-password').onclick=()=>openModal('修改管理密码','修改后其他管理会话以及旧管理密钥会立即失效。新密码至少 12 个字符。','<label class="field">当前密码<input class="input" id="admin-current-password" type="password" autocomplete="current-password"></label><label class="field">新密码<input class="input" id="admin-new-password" type="password" minlength="12" maxlength="72" autocomplete="new-password"></label><label class="field">确认新密码<input class="input" id="admin-confirm-password" type="password" minlength="12" maxlength="72" autocomplete="new-password"></label>',async()=>{const next=$('admin-new-password').value;if(next!==$('admin-confirm-password').value)throw Error('两次输入的新密码不一致');await api('/auth/password',{method:'POST',body:JSON.stringify({currentPassword:$('admin-current-password').value,newPassword:next})});toast('管理密码已修改')});
    $('logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST',body:'{}'})}catch{}showLogin('已安全退出管理中心')};

    bootstrap();
  </script>
</body>
</html>`
