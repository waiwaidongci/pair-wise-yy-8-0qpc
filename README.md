# 纸浆浸泡缸档期排期

纸浆班浸泡缸档期排期与复核：批次登记入缸日、预计退缸日和缸位；同缸档期重叠时列出已排批次与维保，冲突安排不保存；维保登记停用时段、原因和负责人，停用开始后待入缸批次改排最近空闲缸位、发酵中批次保留现场；调整维保时间原放行作废需重新确认。

## 运行

```bash
npm start
```

访问 `http://localhost:3039`。数据保存在 `data/paper-pulp-fermentation.json`。

## 业务文件划分

| 文件 | 职责 |
| --- | --- |
| `scheduling.js` | 排期判定：档期重叠、缸位空闲、最近空闲缸位、停用改排（纯函数） |
| `batches.js` | 批次档案与维保登记：建档/改期/状态/日志、冲突拦截、JSON 落库 |
| `routes.js` | 页面操作：HTTP 路由与前端页面（登记、复核、放行、改排交互） |
| `server.js` | 启动入口 |

## 主要接口

- `GET /api/snapshot` — 缸位、状态、批次与维保全量数据
- `POST /api/items` — 批次登记档期（冲突返回 409 及重叠清单，不落库）
- `PATCH /api/items/:code` — 仅 `status` 改状态；含缸位/档期字段走复核改期
- `POST /api/maintenances` — 维保停用登记（停用已开始立即执行改排）
- `PATCH /api/maintenances/:id` — 调整维保时间（原放行作废）
- `POST /api/maintenances/:id/approve` — 放行确认
- `POST /api/maintenances/:id/start` — 停用开始后执行改排调度
