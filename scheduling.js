// 排期判定：浸泡缸档期冲突、最近空闲缸位、停用改排规则。
// 本文件只做纯业务判定，不读写文件、不处理 HTTP。

// 缸位按现场物理顺序排列，"最近空闲缸位"以此顺序计算距离。
export const VATS = ["一号缸", "二号缸", "三号缸", "四号缸"];

// 尚未入缸、可以被改排的状态。兼容历史数据里的"入缸"。
const PENDING_STATUSES = new Set(["待入缸", "入缸"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function day(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function todayStr(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// 入缸日/退缸日是否为合法日期，且退缸严格晚于入缸。
export function isValidRange(start, end) {
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return false;
  const t = Number.isNaN(day(start)) || Number.isNaN(day(end)) ? NaN : day(end) - day(start);
  return t > 0;
}

// 半开区间 [入缸日, 退缸日)：退缸当天可再入新批次，不算重叠。
export function overlaps(startA, endA, startB, endB) {
  return day(startA) < day(endB) && day(startB) < day(endA);
}

export function isPending(batch) {
  return PENDING_STATUSES.has(batch.status);
}

export function isStarted(maintenance, today = todayStr()) {
  return maintenance.startAt <= today;
}

// 取出批次已登记的缸位档期；未登记入缸/退缸日的老批次不参与档期判定。
function batchWindow(batch) {
  if (!batch.vat || !batch.vatInDate || !batch.expectedVatOutDate) return null;
  return { vat: batch.vat, start: batch.vatInDate, end: batch.expectedVatOutDate };
}

// 批次排期复核：同一口缸上档期重叠的已排批次与维保。
// exceptBatchId 用于改期时排除批次自身。
export function findBatchConflicts(db, plan, { exceptBatchId = null } = {}) {
  const batches = (db.items || []).filter((batch) => {
    if (batch.code === exceptBatchId) return false;
    const window = batchWindow(batch);
    return Boolean(
      window &&
        window.vat === plan.vat &&
        overlaps(window.start, window.end, plan.vatInDate, plan.expectedVatOutDate)
    );
  });
  const maintenances = (db.maintenances || []).filter((m) => {
    return (
      m.vat === plan.vat &&
      overlaps(m.startAt, m.endAt, plan.vatInDate, plan.expectedVatOutDate)
    );
  });
  return { batches, maintenances };
}

// 维保登记复核：同一口缸停用时段重叠的其他维保。
// 发酵中的批次按规则保留现场，不阻止维保登记；待入缸批次在停用开始时改排。
export function findMaintenanceConflicts(db, plan, { exceptMaintenanceId = null } = {}) {
  return (db.maintenances || []).filter((m) => {
    return (
      m.id !== exceptMaintenanceId &&
      m.vat === plan.vat &&
      overlaps(m.startAt, m.endAt, plan.startAt, plan.endAt)
    );
  });
}

// 判定某口缸在指定档期内是否空闲（已排批次或维保任一占用即不空闲）。
export function isVatFree(db, vat, start, end, { exceptBatchId = null, exceptMaintenanceId = null } = {}) {
  const batchBusy = (db.items || []).some((batch) => {
    if (batch.code === exceptBatchId) return false;
    const window = batchWindow(batch);
    return Boolean(window && window.vat === vat && overlaps(window.start, window.end, start, end));
  });
  const maintenanceBusy = (db.maintenances || []).some((m) => {
    return (
      m.id !== exceptMaintenanceId &&
      m.vat === vat &&
      overlaps(m.startAt, m.endAt, start, end)
    );
  });
  return !batchBusy && !maintenanceBusy;
}

// 从停用缸向外，按物理距离（同距取编号较小者）找最近的空闲缸位；没有则返回 null。
export function nearestFreeVat(db, fromVat, start, end, opts = {}) {
  const fromIndex = VATS.indexOf(fromVat);
  if (fromIndex < 0) return null;
  const candidates = VATS
    .map((vat, index) => ({ vat, index, distance: Math.abs(index - fromIndex) }))
    .filter((c) => c.index !== fromIndex)
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  for (const candidate of candidates) {
    if (isVatFree(db, candidate.vat, start, end, opts)) return candidate.vat;
  }
  return null;
}

// 停用开始后的现场调度：
// - 与停用时段重叠、且尚待入缸的批次，改排到最近空闲缸位；
// - 发酵中（含可抄纸、异常观察）的批次保留现场不动；
// - 没有任何空闲缸时，待入缸批次留缸并挂警告，交人工处理。
// 返回改排与保留明细，并把动作写入批次和维保双方的日志。
export function applyDowntime(db, maintenance, { today = todayStr(), now = new Date().toISOString() } = {}) {
  const result = { applied: false, moves: [], kept: [] };
  if (!isStarted(maintenance, today)) return result;

  result.applied = true;
  for (const batch of db.items || []) {
    const window = batchWindow(batch);
    if (!window || window.vat !== maintenance.vat) continue;
    if (!overlaps(window.start, window.end, maintenance.startAt, maintenance.endAt)) continue;

    if (!isPending(batch)) {
      result.kept.push({ code: batch.code, status: batch.status });
      continue;
    }

    const target = nearestFreeVat(db, maintenance.vat, window.start, window.end, {
      exceptBatchId: batch.code,
      exceptMaintenanceId: maintenance.id,
    });

    if (!target) {
      const note = maintenance.vat + "停用，周边缸位均无档期，暂留原缸待人工改排";
      pushLog(batch, now, "改缸", note, { warning: true });
      pushMaintenanceLog(maintenance, now, "改排失败", batch.code + "：" + note);
      result.moves.push({ code: batch.code, fromVat: maintenance.vat, toVat: null });
      continue;
    }

    const fromVat = batch.vat;
    batch.vat = target;
    const note = fromVat + "停用（" + maintenance.reason + "），" + batch.code + "由" + fromVat + "改排至" + target;
    pushLog(batch, now, "改缸", note, { movedBy: maintenance.id });
    pushMaintenanceLog(maintenance, now, "改排", note);
    maintenance.moves ||= [];
    maintenance.moves.push({ at: now, code: batch.code, fromVat, toVat: target });
    result.moves.push({ code: batch.code, fromVat, toVat: target });
  }

  const summary =
    "停用开始执行：待入缸改排 " +
    result.moves.length +
    " 批次，发酵中等保留现场 " +
    result.kept.length +
    " 批次";
  pushMaintenanceLog(maintenance, now, "停用执行", summary);
  return result;
}

function pushLog(batch, at, step, note, extra = {}) {
  batch.logs ||= [];
  batch.logs.push({ at, step, note, ...extra });
}

function pushMaintenanceLog(maintenance, at, step, note) {
  maintenance.logs ||= [];
  maintenance.logs.push({ at, step, note });
}
