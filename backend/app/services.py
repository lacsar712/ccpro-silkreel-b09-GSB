"""缫丝盆门槛：标成已缫完须最近一次汤温落在 38～42℃；缫丝工只能料理甲-2盆。"""

import math

from app.models import Basin, User

MIN_TEMP = 38.0
MAX_TEMP = 42.0

ROLE_ADMIN = "admin"
ROLE_WORKER = "worker"

# 缫丝工只能给这口盆写汤温、改盆态；管理员不受这条限制。
WORKER_BASIN_CODE = "甲-2"


class RuleError(ValueError):
    pass


class ForbiddenError(RuleError):
    """角色权限不够，路由层翻成 403。"""


def latest_temp(basin: Basin) -> float | None:
    if not basin.readings:
        return None
    latest = max(basin.readings, key=lambda r: r.taken_at)
    return latest.water_temp_c


def assert_can_operate(user: User, basin: Basin) -> None:
    """写汤温、改盆态之前的角色门槛。界面禁用不算数，这里必须再挡一次。"""
    if user.role == ROLE_ADMIN:
        return
    if basin.code != WORKER_BASIN_CODE:
        raise ForbiddenError(
            f"缫丝工只能给{WORKER_BASIN_CODE}盆写汤温、改盆态；{basin.code}盆请找管理员"
        )


def parse_water_temp(raw) -> float:
    """登记汤温一律先过这关：空汤温不许过关，NaN/无穷也不许。"""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise RuleError("汤温不能为空")
    try:
        temp = float(raw)
    except (TypeError, ValueError):
        raise RuleError("汤温必须是数字")
    if not math.isfinite(temp):
        raise RuleError("汤温必须是有限数字")
    return temp


def assert_can_set_status(basin: Basin, new_status: str) -> None:
    allowed = {Basin.STATUS_SOAKING, Basin.STATUS_REELING, Basin.STATUS_REELED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Basin.STATUS_REELED:
        return
    temp = latest_temp(basin)
    if temp is None:
        raise RuleError("该盆尚无汤温记录，不能标已缫完")
    if temp < MIN_TEMP or temp > MAX_TEMP:
        raise RuleError(
            f"最近汤温 {temp}℃ 不在 {MIN_TEMP:.0f}～{MAX_TEMP:.0f}℃，不能标已缫完"
        )
