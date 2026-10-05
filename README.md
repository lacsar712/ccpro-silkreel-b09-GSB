# SilkReel-01 · 江口缫丝坞

缫丝盆环状作业台。登录后看到的是沿汤池围成一圈的盆位，点盆登记汤温并改状态——不是侧栏双列表 CRUD。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Quart（异步 Flask 族）· Hypercorn |
| 结构 | `repositories.py` 仓储 + `services.py` 门槛，路由不直接拼 SQL |
| 数据 | SQLAlchemy 2 async · asyncpg · PostgreSQL 15 |
| 前端 | Preact 10 · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4760
- API：http://localhost:8760
- PostgreSQL：localhost:6160

## 演示账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `123456` | 管理员 |
| `admin2` | `123456` | 管理员 |
| `worker` | `123456` | 缫丝工 |

## 业务规则

1. **首次汤温审计**：缫丝工只能给种子里的甲-2 写汤温或改盆态；其它盆一律拒绝（HTTP 403 中文提示）。授权在服务端（`backend/app/services.py` 的 `assert_can_write_basin`）裁决，前端把非甲-2 盆置灰只是辅助——绕过界面直发写甲-1 等请求同样失败。管理员不受此限，可改任一盆。
2. 盆状态不可标成「已缫完」，除非该盆**最近一条**汤温记录落在 **38～42℃**；空汤温（缺字段、空串、NaN/Inf、非数字、越界值）一律 400 拒绝，不得放成空汤温过关。规则在 `backend/app/services.py`。
3. 顶栏挂两页：**环盆作业台**（既有抽屉登记汤温/改盆态）与**汤温审计**（只读列出每盆谁能改哪盆，无任何写入入口）。
4. 两名管理员交叉改同一口非甲-2 盆的汤温时，写接口在同一事务内 `SELECT … FOR UPDATE` 行锁串行化，两次提交只落成一版合法值。

## 快速启动

```bash
cd SilkReel/SilkReel-01
docker compose up --build
```
