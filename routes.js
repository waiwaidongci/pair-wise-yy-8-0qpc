// 页面操作：HTTP 路由与前端页面。
// 数据与排期规则分别来自 batches.js / scheduling.js，这里只做请求收发与页面渲染。

import http from "node:http";
import {
  BusinessError,
  getSnapshot,
  listBatches,
  createBatch,
  rescheduleBatch,
  updateBatchStatus,
  appendBatchLog,
  addObservation,
  listMaintenances,
  createMaintenance,
  rescheduleMaintenance,
  approveMaintenance,
  startMaintenance,
  getStats,
} from "./batches.js";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, error) {
  sendJson(res, error.status || 500, {
    error: error.businessCode || "internal_error",
    message: error.message,
    details: error.details,
  });
}

function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>纸浆浸泡缸档期排期</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --warnbg:#f7e8e3; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; }
    main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 12px; font-weight:700; cursor:pointer; margin-top:10px; } button.secondary { background:#69736a; } button.warn { background:var(--warn); } button.mini { padding:5px 9px; font-size:12px; margin:4px 6px 0 0; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:150px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:12px; } .card { display:grid; gap:6px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; justify-self:start; }
    .pill.warn { color:var(--warn); border-color:var(--warn); background:var(--warnbg); } .pill.ok { color:var(--accent); border-color:var(--accent); }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:110px; overflow:auto; margin-top:6px; }
    .banner { display:none; border:1px solid var(--warn); background:var(--warnbg); color:var(--warn); border-radius:8px; padding:12px 14px; margin-bottom:14px; font-size:14px; } .banner b { font-size:15px; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .row label { margin-top:0; }
    section .formblock { margin-bottom:14px; }
    .conflict-list { margin:6px 0 0; padding-left:18px; } .resched { border-top:1px dashed var(--line); margin-top:8px; padding-top:8px; }
    @media (max-width:960px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>纸浆浸泡缸档期排期</h1><div class="meta">批次入缸/退缸登记 · 缸位档期复核 · 维保停用与改排</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <section>
      <form id="batchForm" class="formblock">
        <h2>批次登记 / 排期</h2>
        <label>原料来源</label><input name="source" placeholder="如：构树皮">
        <label>浸泡缸</label><select name="vat" id="batchVat"></select>
        <div class="row"><div><label>入缸日</label><input name="vatInDate" type="date" required></div>
        <div><label>预计退缸日</label><input name="expectedVatOutDate" type="date" required></div></div>
        <label>负责人</label><input name="owner">
        <label>状态</label><select name="status" id="batchStatus"></select>
        <button>登记档期</button>
      </form>
      <form id="maintenanceForm" class="formblock">
        <h2>维保停用登记</h2>
        <label>浸泡缸</label><select name="vat" id="mtVat"></select>
        <div class="row"><div><label>停用开始</label><input name="startAt" type="date" required></div>
        <div><label>停用结束</label><input name="endAt" type="date" required></div></div>
        <label>停用原因</label><input name="reason" placeholder="如：清洗 / 维修" required>
        <label>负责人</label><input name="owner" required>
        <button>登记维保</button>
      </form>
      <form id="actionForm" class="formblock">
        <h2>每日观察记录</h2>
        <label>选择批次</label><select name="id" id="itemSelect"></select>
        <div id="extraFields"></div>
        <button>提交记录</button>
      </form>
    </section>
    <section>
      <div id="banner" class="banner"></div>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <input id="search" placeholder="搜索编号 / 缸位 / 负责人">
      </div>
      <div class="panel" style="margin-bottom:16px">
        <h2>维保停用与放行</h2>
        <div class="grid" id="maintenanceCards"></div>
      </div>
      <div class="panel">
        <h2>批次档期档案</h2>
        <div class="grid" id="cards"></div>
      </div>
    </section>
  </main>
  <script>
    const extraFields = [["temperature","温度"],["smell","气味状态"],["fiber","纤维松散度"],["changedWater","是否换水"],["abnormal","异味或霉点（填是/否）"]];
    let state = { vats: [], statuses: [], items: [], maintenances: [] };

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? Object.assign({}, options, { headers: { 'Content-Type': 'application/json' } }) : options);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.message || '请求失败');
        err.payload = data;
        throw err;
      }
      return data;
    }
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function formObject(form) {
      return Object.fromEntries(new FormData(form).entries());
    }
    function vatOptions(selected) {
      return state.vats.map(v => '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    }
    function mtPill(m) {
      if (m.applied) return '<span class="pill warn">停用中</span>';
      if (m.approved) return '<span class="pill ok">已放行待停用</span>';
      return '<span class="pill warn">待确认</span>';
    }
    function showError(error) {
      const p = error.payload || {};
      const d = p.details || {};
      let html = '<b>' + esc(p.message || error.message) + '</b>';
      if (d.vat) html += '<div class="meta">缸位 ' + esc(d.vat) + '　' + esc(d.vatInDate || d.startAt || '') + ' ~ ' + esc(d.expectedVatOutDate || d.endAt || '') + '</div>';
      if (d.batches && d.batches.length) {
        html += '<div class="meta">档期重叠的已排批次：</div><ul class="conflict-list">' + d.batches.map(b =>
          '<li>' + esc(b.code) + ' · ' + esc(b.vat) + ' · ' + esc(b.vatInDate) + '~' + esc(b.expectedVatOutDate) + ' · ' + esc(b.status) + '</li>').join('') + '</ul>';
      }
      if (d.maintenances && d.maintenances.length) {
        html += '<div class="meta">档期重叠的维保：</div><ul class="conflict-list">' + d.maintenances.map(m =>
          '<li>' + esc(m.id) + ' · ' + esc(m.vat) + ' · ' + esc(m.startAt) + '~' + esc(m.endAt) + ' · ' + esc(m.reason) + ' · ' + esc(m.owner) + '</li>').join('') + '</ul>';
      }
      const banner = document.querySelector('#banner');
      banner.innerHTML = html + '<div style="margin-top:8px"><button class="mini secondary" onclick="document.getElementById(\\'banner\\').style.display=\\'none\\'">知道了，去重排</button></div>';
      banner.style.display = 'block';
    }
    function clearBanner() {
      const banner = document.querySelector('#banner');
      banner.style.display = 'none';
      banner.innerHTML = '';
    }

    function renderStaticOptions() {
      document.querySelector('#batchVat').innerHTML = vatOptions();
      document.querySelector('#mtVat').innerHTML = vatOptions();
      document.querySelector('#batchStatus').innerHTML = state.statuses.map((s, i) => '<option' + (s === '待入缸' ? ' selected' : '') + '>' + esc(s) + '</option>').join('');
      document.querySelector('#statusFilter').innerHTML = '<option value="">全部状态</option>' + state.statuses.map(s => '<option>' + esc(s) + '</option>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key, label]) => '<label>' + label + '</label><input name="' + key + '">').join('');
    }

    function renderStats(stats) {
      const cells = Object.entries(stats.batches || {}).map(([k, v]) => '<div class="stat"><span>' + esc(k) + '</span><strong>' + v + '</strong></div>');
      const m = stats.maintenance || {};
      ['待确认', '已放行', '停用中'].forEach(k => cells.push('<div class="stat"><span>维保' + k + '</span><strong>' + (m[k] || 0) + '</strong></div>'));
      document.querySelector('#stats').innerHTML = cells.join('');
    }

    function renderMaintenances() {
      document.querySelector('#maintenanceCards').innerHTML = state.maintenances.map(m => {
        const moves = (m.moves || []).map(x => '<div class="meta">改排：' + esc(x.code) + ' ' + esc(x.fromVat) + ' → ' + esc(x.toVat || '无空闲缸') + '</div>').join('');
        const logs = (m.logs || []).slice(-4).map(l => '<div class="meta">' + esc(l.step) + '：' + esc(l.note) + '</div>').join('');
        let actions = '';
        if (!m.approved) actions += '<button class="mini" data-approve="' + esc(m.id) + '">放行确认</button>';
        if (m.approved && !m.applied) actions += '<button class="mini warn" data-start="' + esc(m.id) + '">停用已开始，执行改排</button>';
        if (m.applied) actions += '<span class="pill warn">停用已执行</span>';
        return '<article class="card"><h3>' + esc(m.id) + '</h3>' + mtPill(m) +
          '<div><b>缸位</b> ' + esc(m.vat) + '</div><div><b>停用</b> ' + esc(m.startAt) + ' ~ ' + esc(m.endAt) + '</div>' +
          '<div><b>原因</b> ' + esc(m.reason) + '</div><div><b>负责人</b> ' + esc(m.owner) + '</div>' +
          '<div class="resched"><label class="meta">调整维保时间（原放行作废，需重新确认）</label>' +
          '<div class="row"><input type="date" data-mt-start="' + esc(m.id) + '" value="' + esc(m.startAt) + '"><input type="date" data-mt-end="' + esc(m.id) + '" value="' + esc(m.endAt) + '"></div>' +
          '<button class="mini secondary" data-mtedit="' + esc(m.id) + '">调整时间</button></div>' +
          actions + moves + '<div class="logs meta">' + (logs || '暂无记录') + '</div></article>';
      }).join('') || '<div class="meta">暂无维保登记</div>';
    }

    function batchCardHtml(item) {
      const range = item.vatInDate ? esc(item.vatInDate) + ' ~ ' + esc(item.expectedVatOutDate) : '未登记档期';
      const logs = (item.logs || []).slice(-5).map(l => '<div class="meta">' + esc(l.step) + '：' + esc(l.note) + '</div>').join('');
      return '<article class="card"><h3>' + esc(item.code) + '</h3><span class="pill">' + esc(item.status) + '</span>' +
        '<div><b>原料</b> ' + esc(item.source || '') + '</div><div><b>负责人</b> ' + esc(item.owner || '') + '</div>' +
        '<div><b>缸位</b> ' + esc(item.vat || '') + '</div><div><b>档期</b> ' + range + '</div>' +
        '<div class="resched"><label class="meta">复核改期 / 改缸（冲突则不保存）</label>' +
        '<select data-b-vat="' + esc(item.code) + '">' + vatOptions(item.vat) + '</select>' +
        '<div class="row"><input type="date" data-b-start="' + esc(item.code) + '" value="' + esc(item.vatInDate || '') + '">' +
        '<input type="date" data-b-end="' + esc(item.code) + '" value="' + esc(item.expectedVatOutDate || '') + '"></div>' +
        '<button class="mini secondary" data-reschedule="' + esc(item.code) + '">复核改期</button></div>' +
        '<label>状态</label><select data-status="' + esc(item.code) + '">' + state.statuses.map(s => '<option' + (s === item.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>' +
        '<div><button class="mini secondary" data-note="' + esc(item.code) + '">追加备注</button></div>' +
        '<div class="logs meta">' + (logs || '暂无记录') + '</div></article>';
    }

    function renderBatches() {
      document.querySelector('#itemSelect').innerHTML = state.items.map(item => '<option value="' + esc(item.code) + '">' + esc(item.code) + ' · ' + esc(item.source || '') + ' · ' + esc(item.vat || '') + '</option>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = state.items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      document.querySelector('#cards').innerHTML = visible.map(batchCardHtml).join('') || '<div class="meta">暂无批次</div>';
    }

    function render(stats) {
      renderStaticOptions();
      if (stats) renderStats(stats);
      renderMaintenances();
      renderBatches();
      bindCardEvents();
    }

    async function load() {
      const [snapshot, stats] = await Promise.all([api('/api/snapshot'), api('/api/stats')]);
      state = snapshot;
      render(stats);
    }

    async function run(promise) {
      try { await promise; clearBanner(); await load(); }
      catch (error) { showError(error); }
    }

    function bindCardEvents() {
      document.querySelectorAll('[data-status]').forEach(sel => {
        sel.onchange = () => run(api('/api/items/' + encodeURIComponent(sel.dataset.status), { method: 'PATCH', body: JSON.stringify({ status: sel.value }) }));
      });
      document.querySelectorAll('[data-note]').forEach(btn => {
        btn.onclick = () => {
          const note = prompt('记录备注');
          if (note) run(api('/api/items/' + encodeURIComponent(btn.dataset.note) + '/logs', { method: 'POST', body: JSON.stringify({ step: '备注', note }) }));
        };
      });
      document.querySelectorAll('[data-reschedule]').forEach(btn => {
        btn.onclick = () => {
          const code = btn.dataset.reschedule;
          const body = {
            vat: document.querySelector('[data-b-vat="' + code + '"]').value,
            vatInDate: document.querySelector('[data-b-start="' + code + '"]').value,
            expectedVatOutDate: document.querySelector('[data-b-end="' + code + '"]').value,
          };
          run(api('/api/items/' + encodeURIComponent(code), { method: 'PATCH', body: JSON.stringify(body) }));
        };
      });
      document.querySelectorAll('[data-approve]').forEach(btn => {
        btn.onclick = () => run(api('/api/maintenances/' + encodeURIComponent(btn.dataset.approve) + '/approve', { method: 'POST' }));
      });
      document.querySelectorAll('[data-start]').forEach(btn => {
        btn.onclick = () => run(api('/api/maintenances/' + encodeURIComponent(btn.dataset.start) + '/start', { method: 'POST' }));
      });
      document.querySelectorAll('[data-mtedit]').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.mtedit;
          const body = {
            startAt: document.querySelector('[data-mt-start="' + id + '"]').value,
            endAt: document.querySelector('[data-mt-end="' + id + '"]').value,
          };
          run(api('/api/maintenances/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }));
        };
      });
    }

    document.querySelector('#batchForm').onsubmit = event => {
      event.preventDefault();
      const form = event.target;
      run(api('/api/items', { method: 'POST', body: JSON.stringify(formObject(form)) })).then(() => form.reset());
    };
    document.querySelector('#maintenanceForm').onsubmit = event => {
      event.preventDefault();
      const form = event.target;
      run(api('/api/maintenances', { method: 'POST', body: JSON.stringify(formObject(form)) })).then(() => form.reset());
    };
    document.querySelector('#actionForm').onsubmit = event => {
      event.preventDefault();
      const form = event.target;
      run(api('/api/items/' + encodeURIComponent(formObject(form).id) + '/action', { method: 'POST', body: JSON.stringify(formObject(form)) })).then(() => form.reset());
    };
    document.querySelector('#statusFilter').onchange = () => render();
    document.querySelector('#search').oninput = () => render();
    document.querySelector('#reload').onclick = () => run(load());
    load();
  </script>
</body>
</html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/") return sendHtml(res, page());
  if (req.method === "GET" && pathname === "/api/snapshot") return sendJson(res, 200, await getSnapshot());
  if (req.method === "GET" && pathname === "/api/items") return sendJson(res, 200, await listBatches());
  if (req.method === "GET" && pathname === "/api/maintenances") return sendJson(res, 200, await listMaintenances());
  if (req.method === "GET" && pathname === "/api/stats") return sendJson(res, 200, await getStats());

  if (req.method === "POST" && pathname === "/api/items") {
    return sendJson(res, 201, await createBatch(await readBody(req)));
  }
  if (req.method === "POST" && pathname === "/api/maintenances") {
    return sendJson(res, 201, await createMaintenance(await readBody(req)));
  }

  const itemPatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemPatch && req.method === "PATCH") {
    const code = decodeURIComponent(itemPatch[1]);
    const input = await readBody(req);
    const keys = Object.keys(input);
    // 仅状态字段走状态更新；含缸位/档期字段走复核改期。
    if (keys.length === 1 && keys[0] === "status") {
      return sendJson(res, 200, await updateBatchStatus(code, input.status));
    }
    return sendJson(res, 200, await rescheduleBatch(code, input));
  }

  const itemLogs = pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
  if (itemLogs && req.method === "POST") {
    return sendJson(res, 201, await appendBatchLog(decodeURIComponent(itemLogs[1]), await readBody(req)));
  }
  const itemAction = pathname.match(/^\/api\/items\/([^/]+)\/action$/);
  if (itemAction && req.method === "POST") {
    return sendJson(res, 201, await addObservation(decodeURIComponent(itemAction[1]), await readBody(req)));
  }

  const mtPatch = pathname.match(/^\/api\/maintenances\/([^/]+)$/);
  if (mtPatch && req.method === "PATCH") {
    return sendJson(res, 200, await rescheduleMaintenance(decodeURIComponent(mtPatch[1]), await readBody(req)));
  }
  const mtApprove = pathname.match(/^\/api\/maintenances\/([^/]+)\/approve$/);
  if (mtApprove && req.method === "POST") {
    return sendJson(res, 200, await approveMaintenance(decodeURIComponent(mtApprove[1])));
  }
  const mtStart = pathname.match(/^\/api\/maintenances\/([^/]+)\/start$/);
  if (mtStart && req.method === "POST") {
    return sendJson(res, 200, await startMaintenance(decodeURIComponent(mtStart[1])));
  }

  sendJson(res, 404, { error: "not_found", message: "接口不存在" });
}

function sendHtml(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      if (error instanceof BusinessError) return sendError(res, error);
      sendError(res, new BusinessError(500, "internal_error", error.message));
    }
  });
}
