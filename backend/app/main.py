from quart import Quart, g, jsonify, request
from quart.helpers import make_response

from app.db import SessionLocal
from app.models import Basin
from app.repositories import BasinRepo, UserRepo
from app.security import make_token, parse_token, verify_password
from app.services import (
    MAX_TEMP,
    MIN_TEMP,
    WORKER_BASIN_CODE,
    ForbiddenError,
    RuleError,
    assert_can_operate,
    assert_can_set_status,
    latest_temp,
    parse_water_temp,
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


async def _json_object() -> dict:
    body = await request.get_json(force=True)
    return body if isinstance(body, dict) else {}


def _forbidden(exc: ForbiddenError):
    return jsonify({"detail": str(exc)}), 403


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
    body = await _json_object()
    try:
        temp = parse_water_temp(body.get("waterTempC"))
    except RuleError as exc:
        return jsonify({"detail": str(exc)}), 400
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        basin = await repo.get(basin_id, for_update=True)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_operate(g.user, basin)
        except ForbiddenError as exc:
            return _forbidden(exc)
        await repo.add_reading(basin, temp, g.user.username)
        basin = await repo.get(basin_id)
        return _basin_json(basin)


@app.route("/api/basins/<int:basin_id>/status", methods=["POST"])
async def set_status(basin_id: int):
    denied = require_user()
    if denied:
        return denied
    body = await _json_object()
    status = body.get("status", "")
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        basin = await repo.get(basin_id, for_update=True)
        if basin is None:
            return jsonify({"detail": "盆不存在"}), 404
        try:
            assert_can_operate(g.user, basin)
        except ForbiddenError as exc:
            return _forbidden(exc)
        try:
            assert_can_set_status(basin, status)
        except RuleError as exc:
            return jsonify({"detail": str(exc)}), 400
        await repo.save_status(basin, status)
        basin = await repo.get(basin_id)
        return _basin_json(basin)


@app.route("/api/audit")
async def audit():
    """汤温审计专页数据：只读列出谁能给哪盆写汤温、改盆态。"""
    denied = require_user()
    if denied:
        return denied
    async with SessionLocal() as session:
        repo = BasinRepo(session)
        mill = await repo.board()
        if mill is None:
            return jsonify({"detail": "尚无缫丝坞"}), 404
        users = await UserRepo(session).all()
        admins = [u.username for u in users if u.role == "admin"]
        workers = [u.username for u in users if u.role == "worker"]
        basins = sorted(mill.basins, key=lambda b: b.ring_index)
        return {
            "filature": mill.name,
            "riverside": mill.riverside,
            "workerBasinCode": WORKER_BASIN_CODE,
            "tempBand": {"minC": MIN_TEMP, "maxC": MAX_TEMP},
            "basins": [
                {
                    **_basin_json(b),
                    "writers": [
                        *[{"username": name, "role": "admin"} for name in admins],
                        *(
                            [{"username": name, "role": "worker"} for name in workers]
                            if b.code == WORKER_BASIN_CODE
                            else []
                        ),
                    ],
                }
                for b in basins
            ],
        }
