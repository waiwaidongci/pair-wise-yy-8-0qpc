// 排期判定：浸泡缸档期重叠、空闲缸位、停用开始后的待入缸批次改缸
// 纯函数模块，不读写文件；批次档案由 batch-archive.js 负责存取。

export const VATS = ["一号缸", "二号缸", "三号缸", "四号缸"];

// 停用/已放行的维保都占用档期，已取消的不占
export function activeMaintenance(m) {
  return m && m.status !== "已取消";
}

// 日期统一为 YYYY-MM-DD（按天比较）
export function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

// 半开区间 [start, end) 重叠：A 退缸当日可让 B 入缸，不算撞档
export function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// 列出与 {vat, enterAt, exitAt} 同缸且档期重叠的已排批次和维保
export function findConflicts(db, { vat, enterAt, exitAt }, ignoreId) {
  const batchConflicts = (db.items || [])
    .filter((b) => b.id !== ignoreId && b.code !== ignoreId)
    .filter((b) => b.vat === vat && b.enterAt && b.exitAt)
    .filter((b) => windowsOverlap(enterAt, exitAt, b.enterAt, b.exitAt))
    .map((b) => ({
      kind: "批次",
      id: b.id,
      code: b.code,
      vat: b.vat,
      owner: b.owner,
      status: b.status,
      enterAt: b.enterAt,
      exitAt: b.exitAt,
    }));

  const maintenanceConflicts = (db.maintenance || [])
    .filter(activeMaintenance)
    .filter((m) => m.id !== ignoreId)
    .filter((m) => m.vat === vat && windowsOverlap(enterAt, exitAt, m.startAt, m.endAt))
    .map((m) => ({
      kind: "维保",
      id: m.id,
      vat: m.vat,
      reason: m.reason,
      owner: m.owner,
      status: m.status,
      enterAt: m.startAt,
      exitAt: m.endAt,
    }));

  return [...batchConflicts, ...maintenanceConflicts];
}

// 找“最近空闲缸位”：按缸号顺序取第一口在 [enterAt, exitAt) 无批次、无维保占用的缸
export function nearestFreeVat(db, { enterAt, exitAt }, excludeVat) {
  return VATS.find((vat) => vat !== excludeVat && findConflicts(db, { vat, enterAt, exitAt }).length === 0) || null;
}

// 停用开始：待入缸批次（尚未入缸，状态为待入缸）改到最近空闲缸，发酵中/已入缸批次保留现场。
// 每改一批都向其 logs 追加改缸记录，返回被调整的批次清单。
export function reassignWaitingBatches(db, maintenance) {
  const moved = [];
  for (const batch of db.items || []) {
    // 仅待入缸批次改缸；发酵中（含已入缸）批次保留现场
    if (
      batch.status === "待入缸" &&
      batch.vat === maintenance.vat &&
      batch.enterAt &&
      batch.exitAt &&
      windowsOverlap(maintenance.startAt, maintenance.endAt, batch.enterAt, batch.exitAt)
    ) {
      const target = nearestFreeVat(db, { enterAt: batch.enterAt, exitAt: batch.exitAt }, maintenance.vat);
      if (!target) continue;
      const from = batch.vat;
      batch.vat = target;
      batch.logs ||= [];
      batch.logs.push({
        at: new Date().toISOString(),
        step: "改缸",
        note: from + " 因维保停用（" + maintenance.startAt + " 起），改排 " + target,
      });
      moved.push({ id: batch.id, code: batch.code, from, to: target, enterAt: batch.enterAt, exitAt: batch.exitAt });
    }
  }
  return moved;
}
