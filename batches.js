// 批次档案：纸浆批次与维保的建档、查询、状态、日志及落库编排。
// 排期判定全部委托给 scheduling.js，本文件负责数据与业务规则执行。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VATS,
  isValidRange,
  findBatchConflicts,
  findMaintenanceConflicts,
  applyDowntime,
  todayStr,
} from "./scheduling.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "paper-pulp-fermentation.json");

export { VATS };

export const STATUSES = ["待入缸", "入缸", "发酵中", "可抄纸", "异常观察"];

const seed = {
  items: [
    {
      code: "PF-001",
      source: "构树皮",
      vat: "三号缸",
      vatInDate: "2026-09-20",
      expectedVatOutDate: "2026-09-28",
      days: 6,
      owner: "林素",
      status: "发酵中",
      logs: [
        { at: "2026-09-20", step: "建档", note: "登记入缸，三号缸，预计2026-09-28退缸" },
        { at: "2026-09-21", step: "观察", note: "温度24.6，气味微酸，纤维开始松散", abnormal: false },
      ],
      observations: [
        { at: "2026-09-21", temperature: "25.1", smell: "微酸", fiber: "松散", changedWater: "是", abnormal: false },
      ],
    },
  ],
  maintenances: [],
};

export class BusinessError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.businessCode = code;
    this.details = details;
  }
}

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.items ||= [];
  db.maintenances ||= [];
  return db;
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function trim(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function summarizeBatch(batch) {
  const logCount = (batch.logs || []).length;
  return { ...batch, logCount };
}

function summarizeMaintenance(maintenance) {
  return { ...maintenance, logCount: (maintenance.logs || []).length };
}

export async function listBatches() {
  const db = await loadDb();
  return db.items.map(summarizeBatch);
}

export async function listMaintenances() {
  const db = await loadDb();
  return db.maintenances.map(summarizeMaintenance);
}

export async function getSnapshot() {
  const db = await loadDb();
  return {
    vats: VATS,
    statuses: STATUSES,
    items: db.items.map(summarizeBatch),
    maintenances: db.maintenances.map(summarizeMaintenance),
  };
}

function pushLog(batch, step, note, extra = {}) {
  batch.logs ||= [];
  batch.logs.push({ at: nowIso(), step, note, ...extra });
}

function pushMaintenanceLog(maintenance, step, note) {
  maintenance.logs ||= [];
  maintenance.logs.push({ at: nowIso(), step, note });
}

function nextBatchCode(db) {
  let max = 0;
  for (const batch of db.items) {
    const match = /^PF-(\d+)$/.exec(batch.code || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return "PF-" + String(max + 1).padStart(3, "0");
}

function nextMaintenanceId(db) {
  let max = 0;
  for (const maintenance of db.maintenances) {
    const match = /^MT-(\d+)$/.exec(maintenance.id || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return "MT-" + String(max + 1).padStart(3, "0");
}

function normalizeBatchInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.code !== undefined) out.code = trim(input.code);
  if (!partial || input.source !== undefined) out.source = trim(input.source);
  if (!partial || input.vat !== undefined) out.vat = trim(input.vat);
  if (!partial || input.vatInDate !== undefined) out.vatInDate = trim(input.vatInDate);
  if (!partial || input.expectedVatOutDate !== undefined) out.expectedVatOutDate = trim(input.expectedVatOutDate);
  if (!partial || input.owner !== undefined) out.owner = trim(input.owner);
  if (!partial || input.status !== undefined) out.status = trim(input.status);
  return out;
}

// 批次登记入缸日、预计退缸日和缸位；档期重叠时只返回冲突清单，原安排不保存。
export async function createBatch(input) {
  const data = normalizeBatchInput(input);
  if (!data.vat) throw new BusinessError(400, "vat_required", "缸位必填");
  if (!isValidRange(data.vatInDate, data.expectedVatOutDate)) {
    throw new BusinessError(400, "invalid_date_range", "入缸日、预计退缸日需为有效日期，且退缸日晚于入缸日");
  }
  if (data.status && !STATUSES.includes(data.status)) {
    throw new BusinessError(400, "invalid_status", "状态不合法");
  }

  const db = await loadDb();
  const code = data.code || nextBatchCode(db);
  if (db.items.some((batch) => batch.code === code)) {
    throw new BusinessError(409, "duplicate_code", "批次编号已存在：" + code);
  }

  const plan = { vat: data.vat, vatInDate: data.vatInDate, expectedVatOutDate: data.expectedVatOutDate };
  const conflicts = findBatchConflicts(db, plan);
  if (conflicts.batches.length || conflicts.maintenances.length) {
    throw new BusinessError(409, "schedule_conflict", "该缸位在该档期与已排批次或维保重叠，原安排未保存，请复核重排", {
      vat: plan.vat,
      vatInDate: plan.vatInDate,
      expectedVatOutDate: plan.expectedVatOutDate,
      batches: conflicts.batches.map(summarizeBatch),
      maintenances: conflicts.maintenances.map(summarizeMaintenance),
    });
  }

  const batch = {
    code,
    source: data.source,
    vat: data.vat,
    vatInDate: data.vatInDate,
    expectedVatOutDate: data.expectedVatOutDate,
    days: Number(input.days || 0),
    owner: data.owner,
    status: data.status || "待入缸",
    logs: [],
    observations: [],
  };
  pushLog(batch, "建档", "登记入缸" + batch.vatInDate + "、预计" + batch.expectedVatOutDate + "退缸，缸位" + batch.vat);
  db.items.unshift(batch);
  await saveDb(db);
  return summarizeBatch(batch);
}

function findBatch(db, code) {
  return db.items.find((batch) => batch.code === code);
}

// 复核后调整批次档期（改缸或改日期）；同样先判冲突，冲突不落库。
export async function rescheduleBatch(code, input) {
  const data = normalizeBatchInput(input);
  const db = await loadDb();
  const batch = findBatch(db, code);
  if (!batch) throw new BusinessError(404, "batch_not_found", "批次不存在：" + code);
  if (data.code && data.code !== code) {
    throw new BusinessError(400, "code_immutable", "批次编号不可修改");
  }

  const next = {
    vat: data.vat || batch.vat,
    vatInDate: data.vatInDate || batch.vatInDate,
    expectedVatOutDate: data.expectedVatOutDate || batch.expectedVatOutDate,
  };
  if (!isValidRange(next.vatInDate, next.expectedVatOutDate)) {
    throw new BusinessError(400, "invalid_date_range", "入缸日、预计退缸日需为有效日期，且退缸日晚于入缸日");
  }

  const conflicts = findBatchConflicts(db, next, { exceptBatchId: code });
  if (conflicts.batches.length || conflicts.maintenances.length) {
    throw new BusinessError(409, "schedule_conflict", "调整后的档期与已排批次或维保重叠，原安排未保存，请复核重排", {
      vat: next.vat,
      vatInDate: next.vatInDate,
      expectedVatOutDate: next.expectedVatOutDate,
      batches: conflicts.batches.map(summarizeBatch),
      maintenances: conflicts.maintenances.map(summarizeMaintenance),
    });
  }

  const before = batch.vat + " " + batch.vatInDate + "~" + batch.expectedVatOutDate;
  batch.vat = next.vat;
  batch.vatInDate = next.vatInDate;
  batch.expectedVatOutDate = next.expectedVatOutDate;
  if (data.source) batch.source = data.source;
  if (data.owner) batch.owner = data.owner;
  pushLog(batch, "改期", "档期由（" + before + "）改为（" + next.vat + " " + next.vatInDate + "~" + next.expectedVatOutDate + "）");
  await saveDb(db);
  return summarizeBatch(batch);
}

export async function updateBatchStatus(code, status, note = "") {
  status = trim(status);
  if (!STATUSES.includes(status)) throw new BusinessError(400, "invalid_status", "状态不合法");
  const db = await loadDb();
  const batch = findBatch(db, code);
  if (!batch) throw new BusinessError(404, "batch_not_found", "批次不存在：" + code);
  batch.status = status;
  pushLog(batch, "状态", "更新为" + status + (note ? "；" + note : ""));
  await saveDb(db);
  return summarizeBatch(batch);
}

export async function appendBatchLog(code, { step = "备注", note = "" } = {}) {
  note = trim(note);
  if (!note) throw new BusinessError(400, "note_required", "备注内容必填");
  const db = await loadDb();
  const batch = findBatch(db, code);
  if (!batch) throw new BusinessError(404, "batch_not_found", "批次不存在：" + code);
  pushLog(batch, trim(step) || "备注", note);
  await saveDb(db);
  return summarizeBatch(batch);
}

// 每日观察记录，沿用原发酵进度规则：异常进异常观察，满 7 天可抄纸。
export async function addObservation(code, input = {}) {
  const db = await loadDb();
  const batch = findBatch(db, code);
  if (!batch) throw new BusinessError(404, "batch_not_found", "批次不存在：" + code);

  const abnormal = String(input.abnormal || "").includes("是") || String(input.abnormal || "").includes("有");
  batch.observations ||= [];
  batch.observations.push({ at: nowIso(), ...input, abnormal });
  batch.days = Number(batch.days || 0) + 1;
  batch.status = abnormal ? "异常观察" : Number(batch.days) >= 7 ? "可抄纸" : "发酵中";
  pushLog(
    batch,
    "观察",
    "温度" + (input.temperature || "") + "，" + (input.smell || "") + "，" + (input.fiber || ""),
    { abnormal }
  );
  await saveDb(db);
  return summarizeBatch(batch);
}

function normalizeMaintenanceInput(input) {
  return {
    vat: trim(input.vat),
    startAt: trim(input.startAt),
    endAt: trim(input.endAt),
    reason: trim(input.reason),
    owner: trim(input.owner),
  };
}

// 维保登记停用时段、原因和负责人。停用已开始时同步执行待入缸批次改排。
export async function createMaintenance(input) {
  const data = normalizeMaintenanceInput(input);
  if (!data.vat) throw new BusinessError(400, "vat_required", "缸位必填");
  if (!isValidRange(data.startAt, data.endAt)) {
    throw new BusinessError(400, "invalid_date_range", "停用开始、结束需为有效日期，且结束晚于开始");
  }
  if (!data.reason) throw new BusinessError(400, "reason_required", "停用原因必填");
  if (!data.owner) throw new BusinessError(400, "owner_required", "负责人必填");

  const db = await loadDb();
  const conflicts = findMaintenanceConflicts(db, data);
  if (conflicts.length) {
    throw new BusinessError(409, "maintenance_conflict", "该缸位停用时段与已登记维保重叠，原安排未保存，请复核", {
      vat: data.vat,
      startAt: data.startAt,
      endAt: data.endAt,
      maintenances: conflicts.map(summarizeMaintenance),
    });
  }

  const maintenance = {
    id: nextMaintenanceId(db),
    ...data,
    approved: false,
    moves: [],
    applied: false,
    logs: [],
  };
  pushMaintenanceLog(maintenance, "登记", "登记停用" + data.startAt + "~" + data.endAt + "，原因：" + data.reason + "，负责人：" + data.owner + "；待放行确认");
  db.maintenances.unshift(maintenance);

  // 登记时停用已开始（含补登记），立即执行现场调度。
  let downtime = null;
  if (data.startAt <= todayStr()) {
    downtime = applyDowntime(db, maintenance);
    maintenance.approved = true;
    maintenance.appliedAt = nowIso();
    maintenance.applied = true;
  }

  await saveDb(db);
  return { maintenance: summarizeMaintenance(maintenance), downtime };
}

function findMaintenance(db, id) {
  return db.maintenances.find((m) => m.id === id);
}

// 调整维保时间：原放行作废，需重新确认；档期与其他维保冲突时不保存。
export async function rescheduleMaintenance(id, input) {
  const db = await loadDb();
  const maintenance = findMaintenance(db, id);
  if (!maintenance) throw new BusinessError(404, "maintenance_not_found", "维保不存在：" + id);

  const next = {
    ...maintenance,
    startAt: trim(input.startAt) || maintenance.startAt,
    endAt: trim(input.endAt) || maintenance.endAt,
  };
  if (!isValidRange(next.startAt, next.endAt)) {
    throw new BusinessError(400, "invalid_date_range", "停用开始、结束需为有效日期，且结束晚于开始");
  }

  const conflicts = findMaintenanceConflicts(db, next, { exceptMaintenanceId: id });
  if (conflicts.length) {
    throw new BusinessError(409, "maintenance_conflict", "调整后的停用时段与已登记维保重叠，原安排未保存，请复核", {
      vat: next.vat,
      startAt: next.startAt,
      endAt: next.endAt,
      maintenances: conflicts.map(summarizeMaintenance),
    });
  }

  const before = maintenance.startAt + "~" + maintenance.endAt;
  maintenance.startAt = next.startAt;
  maintenance.endAt = next.endAt;
  maintenance.approved = false;
  maintenance.applied = false;
  pushMaintenanceLog(maintenance, "改期", "停用时间由（" + before + "）改为（" + next.startAt + "~" + next.endAt + "），原放行作废，需重新确认");
  await saveDb(db);
  return summarizeMaintenance(maintenance);
}

// 维保放行确认：只登记确认动作；停用是否开始决定是否立即改排。
export async function approveMaintenance(id) {
  const db = await loadDb();
  const maintenance = findMaintenance(db, id);
  if (!maintenance) throw new BusinessError(404, "maintenance_not_found", "维保不存在：" + id);
  maintenance.approved = true;
  maintenance.approvedAt = nowIso();
  pushMaintenanceLog(maintenance, "放行", "已放行确认" + maintenance.vat + " " + maintenance.startAt + "~" + maintenance.endAt);

  let downtime = null;
  if (!maintenance.applied && maintenance.startAt <= todayStr()) {
    downtime = applyDowntime(db, maintenance);
    maintenance.applied = true;
    maintenance.appliedAt = nowIso();
  }
  await saveDb(db);
  return { maintenance: summarizeMaintenance(maintenance), downtime };
}

// 停用开始后手动触发调度（改排待入缸批次、保留发酵现场）。
export async function startMaintenance(id) {
  const db = await loadDb();
  const maintenance = findMaintenance(db, id);
  if (!maintenance) throw new BusinessError(404, "maintenance_not_found", "维保不存在：" + id);
  if (!maintenance.approved) throw new BusinessError(400, "not_approved", "维保尚未放行确认");
  if (maintenance.applied) throw new BusinessError(400, "already_applied", "停用调度已执行过");
  if (maintenance.startAt > todayStr()) {
    throw new BusinessError(400, "not_started", "停用尚未到开始日期：" + maintenance.startAt);
  }
  const downtime = applyDowntime(db, maintenance);
  maintenance.applied = true;
  maintenance.appliedAt = nowIso();
  await saveDb(db);
  return { maintenance: summarizeMaintenance(maintenance), downtime };
}

export async function getStats() {
  const db = await loadDb();
  const stats = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const batch of db.items) {
    if (stats[batch.status] !== undefined) stats[batch.status] += 1;
  }
  return {
    batches: stats,
    maintenance: {
      待确认: db.maintenances.filter((m) => !m.approved).length,
      已放行: db.maintenances.filter((m) => m.approved && !m.applied).length,
      停用中: db.maintenances.filter((m) => m.applied).length,
    },
  };
}
