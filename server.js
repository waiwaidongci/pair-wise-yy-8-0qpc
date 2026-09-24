// 启动入口：路由与页面操作见 routes.js，批次档案见 batches.js，排期判定见 scheduling.js。
import { createServer } from "./routes.js";

const port = Number(process.env.PORT || 3039);
createServer().listen(port, () => console.log("纸浆浸泡缸档期排期 listening on http://localhost:" + port));
