// 批次档案：批次与维保登记的存取、建档、流转日志
// 只负责“档案怎么存”，档期是否冲突由 scheduling.js 判定。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "paper-pulp-fermentation.json");

const seed = {
  "items": [
    {
      "id": "PF-001",
      "code": "PF-001",
      "source": "构树皮",
      "vat": "三号缸",
      "days": 5,
      "owner": "林素",
      "status": "发酵中",
      "enterAt": "2026-09-20",
      "exitAt": "2026-09-27",
      "logs": [
        {
          "at": "2026-09-20",
          "step": "入缸",
          "note": "登记入缸三号缸，预计 2026-09-27 退缸",
          "abnormal": false
        },
        {
          "at": "2026-09-22",
          "step": "观察",
          "note": "温度24.6，气味微酸，纤维开始松散",
          "abnormal": false
        }
      ]
    }
  ],
  "maintenance": [
    {
      "id": "MT-001",
      "vat": "三号缸",
      "startAt": "2026-09-28",
      "endAt": "2026-09-30",
      "reason": "季度清洗与缸壁除垢",
      "owner": "老周",
      "status": "待确认",
      "released": false,
      "logs": [
        { "at": "2026-09-24", "step": "登记", "note": "登记三号缸停用清洗，等待放行确认" }
      ]
    }
  ]
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  db.items ||= [];
  db.maintenance ||= [];
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function newBatchId() {
  return "PF-" + Date.now().toString(36).toUpperCase();
}
export function newMaintenanceId() {
  return "MT-" + Date.now().toString(36).toUpperCase();
}

// 批次登记入缸：入缸日、预计退缸日、缸位随档案落库
export function createBatch(db, input) {
  const batch = {
    id: newBatchId(),
    code: input.code || newBatchId(),
    source: input.source || "",
    vat: input.vat,
    enterAt: input.enterAt,
    exitAt: input.exitAt,
    days: Number(input.days || 0),
    owner: input.owner || "",
    status: input.status || (input.enterAt <= today() ? "入缸" : "待入缸"),
    logs: [
      {
        at: new Date().toISOString(),
        step: "建档",
        note: "登记入缸 " + input.vat + "：" + input.enterAt + " 至 " + input.exitAt,
      },
    ],
  };
  db.items.unshift(batch);
  return batch;
}

// 维保登记停用时段、原因和负责人，默认待确认（放行前可再改）
export function createMaintenance(db, input) {
  const record = {
    id: newMaintenanceId(),
    vat: input.vat,
    startAt: input.startAt,
    endAt: input.endAt,
    reason: input.reason || "",
    owner: input.owner || "",
    status: "待确认",
    released: false,
    logs: [
      {
        at: new Date().toISOString(),
        step: "登记",
        note: "登记 " + input.vat + " 停用：" + input.startAt + " 至 " + input.endAt + "（" + (input.reason || "") + "）",
      },
    ],
  };
  db.maintenance.unshift(record);
  return record;
}

export function findBatch(db, id) {
  return db.items.find((x) => x.id === id || x.code === id) || null;
}
export function findMaintenance(db, id) {
  return db.maintenance.find((x) => x.id === id) || null;
}

// 调整维保时间：原放行作废，回到待确认并需重新确认
export function changeMaintenanceWindow(record, { startAt, endAt }) {
  record.logs ||= [];
  const before = record.startAt + " 至 " + record.endAt;
  if (record.released) {
    record.logs.push({
      at: new Date().toISOString(),
      step: "放行作废",
      note: "维保时间由 " + before + " 调整，原放行确认作废，需重新确认",
    });
  }
  record.startAt = startAt;
  record.endAt = endAt;
  record.released = false;
  record.status = "待确认";
  record.logs.push({
    at: new Date().toISOString(),
    step: "改期",
    note: "停用时段调整为 " + startAt + " 至 " + endAt,
  });
  return record;
}

// 放行确认
export function releaseMaintenance(record) {
  record.released = true;
  record.status = "已放行";
  record.logs ||= [];
  record.logs.push({ at: new Date().toISOString(), "step": "放行", note: "停用安排已确认放行" });
  return record;
}

// 停用开始：进入停用中，记录待入缸批次的改缸结果
export function startMaintenance(record, moved) {
  record.status = "停用中";
  record.logs ||= [];
  record.logs.push({
    at: new Date().toISOString(),
    step: "停用开始",
    note: moved.length
      ? "待入缸批次改缸：" + moved.map((m) => m.code + "→" + m.to).join("，") + "；发酵中批次保留现场"
      : "停用开始，发酵中批次保留现场",
  });
  return record;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
