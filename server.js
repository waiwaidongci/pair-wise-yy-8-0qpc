import http from "node:http";
import { VATS, isDate, findConflicts, reassignWaitingBatches } from "./scheduling.js";
import {
  loadDb,
  saveDb,
  createBatch,
  createMaintenance,
  findBatch,
  findMaintenance,
  changeMaintenanceWindow,
  releaseMaintenance,
  startMaintenance,
} from "./batch-archive.js";
import { page } from "./page.js";

const port = Number(process.env.PORT || 3039);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.observations || []).length;
  return { ...item, logCount };
}
function validateWindow(input) {
  if (!VATS.includes(input.vat)) return "缸位无效";
  if (!isDate(input.startAt || input.enterAt)) return "开始/入缸日期格式应为 YYYY-MM-DD";
  if (!isDate(input.endAt || input.exitAt)) return "结束/退缸日期格式应为 YYYY-MM-DD";
  const start = input.startAt || input.enterAt;
  const end = input.endAt || input.exitAt;
  if (start >= end) return "结束日期必须晚于开始日期";
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") return html(res, page());

    // 排期总览：批次档案 + 维保安排
    if (req.method === "GET" && url.pathname === "/api/schedule/overview") {
      return send(res, 200, { items: db.items.map(summarize), maintenance: db.maintenance });
    }

    // 批次补排期：同缸档期重叠则列出已排批次和维保，原安排不保存
    if (req.method === "POST" && url.pathname === "/api/schedules") {
      const input = await body(req);
      const windowError = validateWindow(input);
      if (windowError) return send(res, 400, { error: windowError });
      if (!input.code || !String(input.code).trim()) return send(res, 400, { error: "批次编号必填" });

      const conflicts = findConflicts(db, { vat: input.vat, enterAt: input.enterAt, exitAt: input.exitAt });
      if (conflicts.length) {
        return send(res, 409, {
          error: "schedule_conflict",
          message: "该缸档期与已排批次或维保重叠，原安排未保存",
          vat: input.vat,
          enterAt: input.enterAt,
          exitAt: input.exitAt,
          conflicts,
        });
      }

      const batch = createBatch(db, input);
      await saveDb(db);
      return send(res, 201, summarize(batch));
    }

    // 维保登记：停用时段、原因、负责人
    if (req.method === "POST" && url.pathname === "/api/maintenance") {
      const input = await body(req);
      const windowError = validateWindow(input);
      if (windowError) return send(res, 400, { error: windowError });
      if (!input.reason || !String(input.reason).trim()) return send(res, 400, { error: "停用原因必填" });
      if (!input.owner || !String(input.owner).trim()) return send(res, 400, { error: "负责人必填" });

      const record = createMaintenance(db, input);
      await saveDb(db);
      return send(res, 201, record);
    }

    // 调整维保时间：原放行作废并重新确认
    const patchMt = url.pathname.match(/^\/api\/maintenance\/([^/]+)$/);
    if (patchMt && req.method === "PATCH") {
      const record = findMaintenance(db, patchMt[1]);
      if (!record) return send(res, 404, { error: "maintenance_not_found" });
      if (record.status === "停用中") {
        return send(res, 400, { error: "maintenance_already_started", message: "停用已开始，不能再调整时间" });
      }
      const input = await body(req);
      const next = { vat: record.vat, startAt: input.startAt || record.startAt, endAt: input.endAt || record.endAt };
      const windowError = validateWindow(next);
      if (windowError) return send(res, 400, { error: windowError });

      const voided = !!record.released || record.status === "已放行";
      changeMaintenanceWindow(record, next);
      await saveDb(db);
      return send(res, 200, { voided, maintenance: record });
    }

    // 放行确认
    const releaseMt = url.pathname.match(/^\/api\/maintenance\/([^/]+)\/release$/);
    if (releaseMt && req.method === "POST") {
      const record = findMaintenance(db, releaseMt[1]);
      if (!record) return send(res, 404, { error: "maintenance_not_found" });
      if (record.status === "停用中") return send(res, 400, { error: "maintenance_already_started" });
      releaseMaintenance(record);
      await saveDb(db);
      return send(res, 200, record);
    }

    // 停用开始：待入缸批次改最近空闲缸，发酵中批次保留现场
    const startMt = url.pathname.match(/^\/api\/maintenance\/([^/]+)\/start$/);
    if (startMt && req.method === "POST") {
      const record = findMaintenance(db, startMt[1]);
      if (!record) return send(res, 404, { error: "maintenance_not_found" });
      if (record.status === "停用中") return send(res, 400, { error: "maintenance_already_started" });
      if (!record.released || record.status !== "已放行") {
        return send(res, 400, { error: "maintenance_not_released", message: "请先放行确认，再开始停用" });
      }

      const moved = reassignWaitingBatches(db, record);
      startMaintenance(record, moved);
      await saveDb(db);
      return send(res, 200, { maintenance: record, moved });
    }

    // ---- 批次档案兼容接口（观察记录、状态、备注） ----
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items.map(summarize));
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const batch = createBatch(db, input);
      await saveDb(db);
      return send(res, 201, batch);
    }
    const patchItem = url.pathname.match(/^\/api\/items\/([^/]+)$/);
    if (patchItem && req.method === "PATCH") {
      const item = findBatch(db, patchItem[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      Object.assign(item, await body(req));
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
      await saveDb(db);
      return send(res, 200, item);
    }
    const addLog = url.pathname.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (addLog && req.method === "POST") {
      const item = findBatch(db, addLog[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      item.logs ||= [];
      item.logs.push({ at: new Date().toISOString(), step: input.step || "记录", note: input.note || "" });
      await saveDb(db);
      return send(res, 201, item);
    }
    const action = url.pathname.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      const item = findBatch(db, action[1]);
      if (!item) return send(res, 404, { error: "item_not_found" });
      const input = await body(req);
      const abnormal = String(input.abnormal || "").includes("是") || String(input.abnormal || "").includes("有");
      item.observations ||= [];
      item.observations.push({ at: new Date().toISOString(), ...input, abnormal });
      item.days = Number(item.days || 0) + 1;
      item.status = abnormal ? "异常观察" : Number(item.days) >= 7 ? "可抄纸" : "发酵中";
      item.logs ||= [];
      item.logs.push({
        at: new Date().toISOString(),
        step: "观察",
        note: "温度" + (input.temperature || "") + "，" + (input.smell || "") + "，" + (input.fiber || ""),
      });
      await saveDb(db);
      return send(res, 201, item);
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});
server.listen(port, () => console.log("纸浆班浸泡缸排期 listening on http://localhost:" + port));
