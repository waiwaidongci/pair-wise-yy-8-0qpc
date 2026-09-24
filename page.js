// 页面操作：浸泡缸排期页面的渲染与全部前端交互
// 补排期、冲突复核、维保放行/改期/停用开始都在此发起，业务判定由后端接口完成。

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>纸浆班浸泡缸排期</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:15px; }
    main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    form + form { margin-top:14px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 12px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.warn { background:var(--warn); } button:disabled { background:#aab3a6; cursor:default; }
    .row2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .btnrow { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.mt { background:#f3e7e2; border-color:#d8b3a6; color:var(--warn); } .pill.wait { background:#fdf6df; border-color:#e0d18a; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; }
    .banner { display:none; border:1px solid #d8b3a6; background:#f7eae5; color:var(--warn); border-radius:8px; padding:14px 16px; margin-bottom:14px; } .banner.show { display:block; }
    .banner table { width:100%; border-collapse:collapse; margin-top:8px; } .banner th,.banner td { border:1px solid #e2c6bb; padding:5px 8px; text-align:left; font-size:13px; background:#fff; }
    .boards { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; margin-top:12px; }
    .vatcol { border:1px solid var(--line); border-radius:8px; background:#fafcf8; overflow:hidden; } .vatcol h3 { padding:9px 12px; background:#eef2ea; border-bottom:1px solid var(--line); }
    .slot { padding:8px 12px; border-bottom:1px dashed var(--line); font-size:13px; } .slot:last-child { border-bottom:0; } .slot .when { color:var(--muted); font-size:12px; margin-top:2px; }
    .mtlist { display:grid; gap:10px; margin-top:12px; } .mtcard { border:1px solid var(--line); border-radius:8px; padding:12px 14px; background:#fff; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>纸浆班浸泡缸排期</h1><div class="meta">补排期与复核 · 批次入缸档期 · 清洗维修停用</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <section>
      <form id="scheduleForm">
        <h2>批次补排期</h2>
        <div id="scheduleFields"></div>
        <div class="btnrow"><button>登记入缸档期</button></div>
      </form>
      <form id="maintenanceForm">
        <h2>维保登记（停用）</h2>
        <div id="maintenanceFields"></div>
        <div class="btnrow"><button class="warn">登记停用时段</button></div>
      </form>
      <form id="actionForm">
        <h2>每日观察记录</h2>
        <label>选择纸浆批次</label><select name="id" id="itemSelect"></select>
        <div id="extraFields"></div>
        <div class="btnrow"><button class="secondary">提交记录</button></div>
      </form>
    </section>
    <section>
      <div class="banner" id="conflictBanner"></div>
      <div class="stats" id="stats"></div>
      <div class="panel">
        <h2>分缸档期复核</h2>
        <div class="meta">同一口缸的已排批次与维保停用按时间列出；撞档时新安排不保存。</div>
        <div class="boards" id="boards"></div>
      </div>
      <div class="panel" style="margin-top:14px">
        <h2>维保安排</h2>
        <div class="meta">停用开始后待入缸批次改到最近空闲缸位，发酵中批次保留现场；调整时间后原放行作废，需重新确认。</div>
        <div class="mtlist" id="mtCards"></div>
      </div>
      <div class="panel" style="margin-top:14px">
        <h2>批次档案</h2>
        <div class="grid" id="cards"></div>
      </div>
    </section>
  </main>
  <script>
    var vats = ["一号缸", "二号缸", "三号缸", "四号缸"];
    var stages = ["待入缸", "入缸", "发酵中", "可抄纸", "异常观察"];
    var scheduleFields = [["code","批次编号","text",1],["source","原料来源","text",0],["owner","负责人","text",0]];
    var maintenanceFields = [["reason","停用原因","text",1],["owner","负责人","text",1]];
    var extraFields = [["temperature","温度"],["smell","气味状态"],["fiber","纤维松散度"],["changedWater","是否换水"],["abnormal","异味或霉点"]];
    var items = [];
    var maintenance = [];

    function esc(v) {
      return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }
    async function request(path, options) {
      var res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { "Content-Type": "application/json" } }) : options);
      var data = await res.json();
      if (!res.ok) { var err = new Error(data.error || "请求失败"); err.data = data; throw err; }
      return data;
    }
    function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

    function renderForms() {
      document.querySelector("#scheduleFields").innerHTML =
        scheduleFields.map(function (f) { return "<label>" + f[1] + (f[3] ? " *" : "") + '</label><input name="' + f[0] + '" type="' + f[2] + '">'; }).join("") +
        '<label>浸泡缸 *</label><select name="vat">' + vats.map(function (v) { return "<option>" + v + "</option>"; }).join("") + "</select>" +
        '<div class="row2"><div><label>入缸日 *</label><input name="enterAt" type="date" required></div>' +
        '<div><label>预计退缸日 *</label><input name="exitAt" type="date" required></div></div>';
      document.querySelector("#maintenanceFields").innerHTML =
        '<label>浸泡缸 *</label><select name="vat">' + vats.map(function (v) { return "<option>" + v + "</option>"; }).join("") + "</select>" +
        '<div class="row2"><div><label>停用开始 *</label><input name="startAt" type="date" required></div>' +
        '<div><label>停用结束 *</label><input name="endAt" type="date" required></div></div>' +
        maintenanceFields.map(function (f) { return "<label>" + f[1] + (f[3] ? " *" : "") + '</label><input name="' + f[0] + '" type="' + f[2] + '">'; }).join("");
      document.querySelector("#extraFields").innerHTML = extraFields.map(function (f) { return "<label>" + f[1] + '</label><input name="' + f[0] + '">'; }).join("");
      var today = new Date().toISOString().slice(0, 10);
      var later = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      scheduleForm.enterAt.value = today; scheduleForm.exitAt.value = later;
      maintenanceForm.startAt.value = today; maintenanceForm.endAt.value = later;
    }

    function showConflicts(data) {
      var banner = document.querySelector("#conflictBanner");
      var rows = data.conflicts.map(function (c) {
        var name = c.kind === "维保" ? c.reason : (c.code || c.id);
        return "<tr><td>" + esc(c.kind) + "</td><td>" + esc(name) + "</td><td>" + esc(c.enterAt) + " 至 " + esc(c.exitAt) +
          "</td><td>" + esc(c.status || "") + "</td><td>" + esc(c.owner || "") + "</td></tr>";
      }).join("");
      banner.innerHTML = "<b>「" + esc(data.vat) + "」" + esc(data.enterAt) + " 至 " + esc(data.exitAt) +
        " 档期重叠，原安排未保存</b><div class=meta>该缸已排批次和维保如下，请错开日期或改缸后重新登记：</div>" +
        '<table><tr><th>类型</th><th>编号/原因</th><th>档期</th><th>状态</th><th>负责人</th></tr>' + rows + "</table>";
      banner.classList.add("show");
    }
    function hideConflicts() { document.querySelector("#conflictBanner").classList.remove("show"); }

    function renderStats() {
      var statsEl = document.querySelector("#stats");
      var html = stages.map(function (s) {
        return '<div class="stat"><span>' + s + "</span><strong>" + items.filter(function (i) { return i.status === s; }).length + "</strong></div>";
      }).join("");
      html += '<div class="stat"><span>待确认维保</span><strong style="color:var(--warn)">' +
        maintenance.filter(function (m) { return m.status === "待确认"; }).length + "</strong></div>";
      statsEl.innerHTML = html;
    }

    function renderBoards() {
      document.querySelector("#boards").innerHTML = vats.map(function (vat) {
        var slots = []
          .concat(items.filter(function (i) { return i.vat === vat && i.enterAt; }).map(function (i) {
            return { sort: i.enterAt, kind: "批次", name: i.code, status: i.status, owner: i.owner, start: i.enterAt, end: i.exitAt };
          }))
          .concat(maintenance.filter(function (m) { return m.vat === vat; }).map(function (m) {
            return { sort: m.startAt, kind: "维保", name: m.reason, status: m.status, owner: m.owner, start: m.startAt, end: m.endAt };
          }))
          .sort(function (a, b) { return a.sort < b.sort ? -1 : 1; });
        var body = slots.length ? slots.map(function (s) {
          var cls = s.kind === "维保" ? "pill mt" : (s.status === "待入缸" ? "pill wait" : "pill");
          return '<div class="slot"><span class="' + cls + '">' + esc(s.kind) + " · " + esc(s.status) + "</span> <b>" + esc(s.name) +
            '</b><div class="when">' + esc(s.start) + " 至 " + esc(s.end) + " · " + esc(s.owner || "") + "</div></div>";
        }).join("") : '<div class="slot meta">暂无安排</div>';
        return '<div class="vatcol"><h3>' + vat + "</h3>" + body + "</div>";
      }).join("");
    }

    function renderMaintenance() {
      document.querySelector("#mtCards").innerHTML = maintenance.map(function (m) {
        var buttons = "";
        if (m.status === "待确认") {
          buttons += '<button data-action="release" data-id="' + m.id + '">放行确认</button>';
        } else if (m.status === "已放行") {
          buttons += '<button data-action="start" data-id="' + m.id + '" class="warn">开始停用</button><span class="pill">已放行</span>';
        } else {
          buttons += '<span class="pill mt">停用中</span>';
        }
        if (m.status !== "停用中") {
          buttons += '<button class="secondary" data-action="reschedule" data-id="' + m.id + '">调整维保时间</button>';
        }
        return '<div class="mtcard"><b>' + esc(m.vat) + " 停用 · " + esc(m.reason) + '</b> <span class="pill ' +
          (m.status === "停用中" ? "mt" : "") + '">' + esc(m.status) + '</span><div class="meta">' + esc(m.startAt) + " 至 " +
          esc(m.endAt) + " · 负责人 " + esc(m.owner) + (m.released ? "" : " · 未放行") + "</div>" +
          '<div class="logs meta">' + (m.logs || []).slice(-3).map(function (l) { return esc(l.step) + "：" + esc(l.note); }).join("<br>") +
          '</div><div class="btnrow">' + buttons + "</div></div>";
      }).join("") || '<div class="meta">暂无维保安排</div>';
    }

    function cardHtml(item) {
      var windowInfo = item.enterAt ? '<div><b>入缸/退缸</b> ' + esc(item.enterAt) + " 至 " + esc(item.exitAt) + "</div>" : "";
      var logs = (item.logs || []).slice(-4).map(function (l) { return "<div>" + esc(l.step) + "：" + esc(l.note) + "</div>"; }).join("");
      return '<article class="card"><h3>' + esc(item.code || item.id) + '</h3><span class="pill">' + esc(item.status) + "</span>" +
        "<div><b>浸泡缸</b> " + esc(item.vat) + "</div>" + windowInfo +
        "<div><b>原料</b> " + esc(item.source || "") + " · <b>负责人</b> " + esc(item.owner || "") + "</div>" +
        "<label>状态</label><select data-status=" + esc(item.id) + ">" + stages.map(function (s) {
          return "<option " + (s === item.status ? "selected" : "") + ">" + s + "</option>";
        }).join("") + "</select>" +
        '<button class="secondary" data-note=' + esc(item.id) + ">追加备注</button>" +
        '<div class="logs meta">' + (logs || "暂无记录") + "</div></article>";
    }
    function renderCards() {
      document.querySelector("#cards").innerHTML = items.map(cardHtml).join("");
      document.querySelector("#itemSelect").innerHTML = items.map(function (i) {
        return '<option value="' + esc(i.id) + '">' + esc(i.code) + " · " + esc(i.vat || "") + " · " + esc(i.source || "") + "</option>";
      }).join("");
    }

    function render() { renderStats(); renderBoards(); renderMaintenance(); renderCards(); }
    async function load() {
      var data = await request("/api/schedule/overview");
      items = data.items; maintenance = data.maintenance;
      render();
    }

    var scheduleForm = document.querySelector("#scheduleForm");
    var maintenanceForm = document.querySelector("#maintenanceForm");
    var actionForm = document.querySelector("#actionForm");

    scheduleForm.onsubmit = async function (event) {
      event.preventDefault();
      try {
        await request("/api/schedules", { method: "POST", body: JSON.stringify(formData(scheduleForm)) });
        scheduleForm.reset(); renderForms(); hideConflicts(); await load();
      } catch (e) { if (e.data && e.data.conflicts) { showConflicts(e.data); } else { alert(e.message); } }
    };
    maintenanceForm.onsubmit = async function (event) {
      event.preventDefault();
      try {
        await request("/api/maintenance", { method: "POST", body: JSON.stringify(formData(maintenanceForm)) });
        maintenanceForm.reset(); renderForms(); await load();
      } catch (e) { alert(e.message); }
    };
    actionForm.onsubmit = async function (event) {
      event.preventDefault();
      await request("/api/items/" + actionForm.id.value + "/action", { method: "POST", body: JSON.stringify(formData(actionForm)) });
      actionForm.reset(); await load();
    };

    document.querySelector("#mtCards").onclick = async function (event) {
      var btn = event.target.closest("[data-action]");
      if (!btn) return;
      var id = btn.dataset.id; var action = btn.dataset.action;
      try {
        if (action === "release") {
          await request("/api/maintenance/" + id + "/release", { method: "POST" });
        } else if (action === "start") {
          if (!confirm("确认停用开始？待入缸批次将改到最近空闲缸位，发酵中批次保留现场。")) return;
          var r = await request("/api/maintenance/" + id + "/start", { method: "POST" });
          alert(r.moved.length ? ("已改缸批次：\\n" + r.moved.map(function (m) { return m.code + "：" + m.from + " → " + m.to; }).join("\\n")) : "停用开始，无待入缸批次需要调整。");
        } else if (action === "reschedule") {
          var cur = maintenance.find(function (m) { return m.id === id; });
          var startAt = prompt("新的停用开始日（YYYY-MM-DD）", cur.startAt);
          if (!startAt) return;
          var endAt = prompt("新的停用结束日（YYYY-MM-DD）", cur.endAt);
          if (!endAt) return;
          var r2 = await request("/api/maintenance/" + id, { method: "PATCH", body: JSON.stringify({ startAt: startAt, endAt: endAt }) });
          alert(r2.voided ? "维保时间已调整，原放行作废，请重新确认放行。" : "维保时间已调整。");
        }
        await load();
      } catch (e) { alert(e.message); }
    };

    document.querySelector("#cards").onchange = async function (event) {
      var sel = event.target.closest("[data-status]");
      if (!sel) return;
      await request("/api/items/" + sel.dataset.status, { method: "PATCH", body: JSON.stringify({ status: sel.value }) });
      await load();
    };
    document.querySelector("#cards").onclick = async function (event) {
      var btn = event.target.closest("[data-note]");
      if (!btn) return;
      var note = prompt("记录备注");
      if (note) { await request("/api/items/" + btn.dataset.note + "/logs", { method: "POST", body: JSON.stringify({ step: "备注", note: note }) }); await load(); }
    };

    document.querySelector("#reload").onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}
