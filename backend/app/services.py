"""缫丝盆门槛。

两条规矩：

1. 首次汤温审计：缫丝工只能给种子里的甲-2 写汤温、改盆态，其它盆一律挡住；
   管理员不受此限。授权必须在服务端裁，前端禁用按钮只是辅助。
2. 盆状态不可标成「已缫完」，除非该盆**最近一条**汤温记录落在 38～42℃。
"""

import math

from app.models import Basin, User

MIN_TEMP = 38.0
MAX_TEMP = 42.0

# 合理水温上下界，用于挡 NaN/Inf/离谱值；空汤温在解析时就拒。
TEMP_FLOOR = 0.0
TEMP_CEIL = 100.0

ROLE_ADMIN = "admin"

# 种子盆里唯一允许缫丝工动笔的盆。
WORKER_WRITABLE_CODES = ("甲-2",)


class RuleError(ValueError):
    """业务规则不满足（400）。"""


class ForbiddenError(PermissionError):
    """汤温审计授权不通过（403）。"""


def latest_temp(basin: Basin) -> float | None:
    if not basin.readings:
        return None
    latest = max(basin.readings, key=lambda r: r.taken_at)
    return latest.water_temp_c


def parse_temp(raw) -> float:
    """严格解析汤温：空值、NaN/Inf、非数字、越界值一律中文拒绝。"""
    if raw is None:
        raise RuleError("汤温不能为空")
    # bool 是 int 的子类，JSON 的 true/false 不算合法汤温。
    if isinstance(raw, bool):
        raise RuleError("汤温必须是数字")
    if isinstance(raw, str) and not raw.strip():
        raise RuleError("汤温不能为空")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise RuleError("汤温必须是数字")
    if math.isnan(value) or math.isinf(value):
        raise RuleError("汤温必须是有限数字")
    if value < TEMP_FLOOR or value > TEMP_CEIL:
        raise RuleError(
            f"汤温 {value:g}℃ 超出合理范围（{TEMP_FLOOR:g}～{TEMP_CEIL:g}℃）"
        )
    return value


def assert_can_write_basin(user: User, basin: Basin) -> None:
    """汤温审计：写汤温、改盆态走同一道授权。"""
    if user.role == ROLE_ADMIN:
        return
    if basin.code in WORKER_WRITABLE_CODES:
        return
    raise ForbiddenError(
        f"汤温审计：缫丝工只能操作{WORKER_WRITABLE_CODES[0]}，"
        f"{basin.code} 的汤温与盆态一律不可改动"
    )


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
