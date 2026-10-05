from quart import Quart, g, jsonify, request

from app.db import SessionLocal
from app.models import Basin
from app.repositories import BasinRepo, UserRepo
from app.security import make_token, parse_token, verify_password
from app.services import (
    ForbiddenError,
    RuleError,
    ROLE_ADMIN,
    WORKER_WRITABLE_CODES,
    assert_can_set_status,
    assert_can_write_basin,
    latest_temp,
    parse_temp,
)

app = Quart(__name__)


def _bearer() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


@app.before_request
async def load_user():
    g.user = None
    token = _bearer()
    if not token:
        return
    username = parse_token(token)
    if not username:
        return
    async with SessionLocal() as session:
        g.user = await UserRepo(session).by_username(username)


def require_user():
    if g.user is None:
        return jsonify({"detail": "未登录"}), 401
    return None


@app.route("/api/health")
async def health():
    return {"status": "ok", "service": "SilkReel"}


@app.route("/api/auth/login", methods=["POST"])
async def login():
    body = await request.get_json(force=True)
    username = (body or {}).get("username", "")
    password = (body or {}).get("password", "")
    async with SessionLocal() as session:
        user = await UserRepo(session).by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            return jsonify({"detail": "用户名或密码错误"}), 401
        return {
            "access_token": make_token(user.username),
            "user": {"username": user.username, "role": user.role},
        }


@app.route("/api/auth/me")
async def me():
    denied = require_user()
    if denied:
        return denied
    return {"username": g.user.username, "role": g.user.role}


def _basin_json(basin: Basin) -> dict:
    return {
        "id": basin.id,
        "code": basin.code,
        "status": basin.status,
        "ringIndex": basin.ring_index,
        "latestTempC": latest_temp(basin),
        "readingCount": len(basin.readings or []),
        "workerWritable": basin.code in WORKER_WRITABLE_CODES,
    }


@app.route("/api/board")
async def board():
    denied = require_user()
    if denied:
        return denied
    async with SessionLocal() as session:
        mill = await BasinRepo(session).board()
        if mill is None:
            return jsonify({"detail": "尚无缫丝坞"}), 404
        basins = sorted(mill.basins, key=lambda b: b.ring_index)
        return {
            "filature": mill.name,
            "riverside": mill.riverside,
            "basins": [_basin_json(b) for b in basins],
        }


@app.route("/api/basins/<int:basin_id>/readings", methods=["POST"])
async def add_reading(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await request.get_json(force=True)
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        # 行锁 + 授权 + 写入同一事务：绕过界面直发请求同样被挡，
        # 两名管理员交叉写也只落成一版合法值。
        basin = await repo.get_for_update(basin_id)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_write_basin(g.user, basin)
            temp = parse_temp((body or {}).get("waterTempC"))
        except ForbiddenError as exc:
            return jsonify({"detail": str(exc)}), 403
        except RuleError as exc:
            return jsonify({"detail": str(exc)}), 400
        await repo.add_reading(basin, temp, g.user.username)
        await session.commit()
        basin = await repo.get(basin_id)
        return _basin_json(basin)


@app.route("/api/basins/<int:basin_id>/status", methods=["POST"])
async def set_status(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await request.get_json(force=True)
    status = (body or {}).get("status", "")
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        basin = await repo.get_for_update(basin_id)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_write_basin(g.user, basin)
            assert_can_set_status(basin, status)
        except ForbiddenError as exc:
            return jsonify({"detail": str(exc)}), 403
        except RuleError as exc:
            return jsonify({"detail": str(exc)}), 400
        await repo.save_status(basin, status)
        await session.commit()
        basin = await repo.get(basin_id)
        return _basin_json(basin)


@app.route("/api/audit/policy")
async def audit_policy():
    """汤温审计专页（只读）：逐盆列出谁能写汤温、改盆态。"""
    denied = require_user()
    if denied:
        return denied
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        mill = await repo.board()
        if mill is None:
            return jsonify({"detail": "尚无缫丝坞"}), 404
        admins = await UserRepo(session).all_by_role(ROLE_ADMIN)
        basins = sorted(mill.basins, key=lambda b: b.ring_index)
        return {
            "filature": mill.name,
            "workerWritableCodes": list(WORKER_WRITABLE_CODES),
            "admins": [u.username for u in admins],
            "rules": [
                "缫丝工只能给种子里的甲-2 写汤温或改盆态，其它盆一律拒绝（含绕过界面直发请求）",
                "管理员可改任一盆；两名管理员交叉改同一盆只留一版合法值",
                "已缫完须最近一条汤温落在 38～42℃，空汤温不得过关",
            ],
            "basins": [
                {
                    "id": b.id,
                    "code": b.code,
                    "status": b.status,
                    "ringIndex": b.ring_index,
                    "latestTempC": latest_temp(b),
                    "workerWritable": b.code in WORKER_WRITABLE_CODES,
                }
                for b in basins
            ],
        }
