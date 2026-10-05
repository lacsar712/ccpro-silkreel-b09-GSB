import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, clearToken, setToken, token } from "./api.js";
import "./app.css";

const STATUS_LABEL = { soaking: "浸茧", reeling: "缫丝中", reeled: "已缫完" };

function Login({ onOk }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("123456");
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(data.access_token);
      onOk(data.user);
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <div class="login">
      <h1>江口缫丝坞</h1>
      <p>汤温环盆作业台，不是列表台账。</p>
      <form onSubmit={submit} autocomplete="off">
        <label>
          用户名
          <input name="username" autocomplete="off" value={username} onInput={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          密码
          <input name="password" type="password" autocomplete="off" value={password} onInput={(e) => setPassword(e.target.value)} />
        </label>
        <p class="hint">已预填 admin / 123456，另有 worker / 123456、admin2 / 123456</p>
        <button type="submit">登录</button>
      </form>
      {err && <p class="err">{err}</p>}
    </div>
  );
}

function Topbar({ board, view, onView, onLogout }) {
  return (
    <div class="topbar">
      <div>
        <h1>{board ? board.filature : "江口缫丝坞"}</h1>
        {board && <p>{board.riverside} · 首次汤温审计：缫丝工只可动甲-2</p>}
      </div>
      <nav class="nav">
        <button class={view === "yard" ? "on" : ""} onClick={() => onView("yard")}>
          环盆作业台
        </button>
        <button class={view === "audit" ? "on" : ""} onClick={() => onView("audit")}>
          汤温审计
        </button>
        <button onClick={onLogout}>退出</button>
      </nav>
    </div>
  );
}

function Yard({ user, board, setBoard }) {
  const [picked, setPicked] = useState(null);
  const [temp, setTemp] = useState("40");
  const [err, setErr] = useState("");

  const isAdmin = user.role === "admin";

  async function refresh() {
    const data = await api("/api/board");
    setBoard(data);
    if (picked) {
      setPicked(data.basins.find((b) => b.id === picked.id) || null);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  if (!board) {
    return <div class="yard">{err || "装载环盆…"}</div>;
  }

  const n = board.basins.length;
  const canWrite = (b) => isAdmin || b.workerWritable;

  async function writeTemp() {
    setErr("");
    // 空汤温前端先挡一道，后端还会再挡。
    if (!String(temp).trim()) {
      setErr("汤温不能为空");
      return;
    }
    const value = Number(temp);
    if (!Number.isFinite(value)) {
      setErr("汤温必须是数字");
      return;
    }
    try {
      const row = await api(`/api/basins/${picked.id}/readings`, {
        method: "POST",
        body: JSON.stringify({ waterTempC: value }),
      });
      await refresh();
      setPicked(row);
    } catch (ex) {
      setErr(ex.message);
    }
  }
  async function setStatus(status) {
    setErr("");
    try {
      const row = await api(`/api/basins/${picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await refresh();
      setPicked(row);
    } catch (ex) {
      setErr(ex.message);
    }
  }

  return (
    <div class="yard-body">
      <div class="ring">
        {board.basins.map((b, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const left = 50 + Math.cos(angle) * 38;
          const top = 50 + Math.sin(angle) * 38;
          const writable = canWrite(b);
          return (
            <button
              key={b.id}
              class={`basin ${b.status} ${writable ? "" : "locked"}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              disabled={!writable}
              title={writable ? b.code : `汤温审计：缫丝工不可动 ${b.code}，仅甲-2 可操作`}
              onClick={() => writable && setPicked(b)}
            >
              <strong>{b.code}</strong>
              <span>{STATUS_LABEL[b.status]}</span>
              {!writable && <span class="lock">禁</span>}
            </button>
          );
        })}
      </div>
      <p class="hint audit-note">
        {isAdmin
          ? "管理员视角：可写任一盆的汤温与盆态；两名管理员交叉改同一盆只留一版合法值。"
          : "缫丝工视角：仅甲-2 可登记汤温、改盆态；其它盆已锁定，绕界面直发请求同样被服务端拒绝。"}
      </p>
      {picked && (
        <div class="drawer">
          <h3>
            {picked.code} · {STATUS_LABEL[picked.status]}
          </h3>
          <p>最近汤温：{picked.latestTempC ?? "无"} ℃ · 记录 {picked.readingCount} 次</p>
          <input value={temp} onInput={(e) => setTemp(e.target.value)} inputmode="decimal" />
          <button onClick={writeTemp}>登记汤温</button>
          <div>
            <button onClick={() => setStatus("soaking")}>浸茧</button>
            <button onClick={() => setStatus("reeling")}>缫丝中</button>
            <button onClick={() => setStatus("reeled")}>已缫完</button>
          </div>
          {err && <p class="err">{err}</p>}
        </div>
      )}
    </div>
  );
}

function Audit({ policy }) {
  if (!policy) {
    return <div class="audit-page">装载汤温审计…</div>;
  }
  return (
    <div class="audit-page">
      <h2>汤温审计（只读）</h2>
      <p class="hint">本页只列权限，不提供任何写汤温、改盆态的入口。</p>
      <ul class="audit-rules">
        {policy.rules.map((r) => (
          <li>{r}</li>
        ))}
      </ul>
      <table class="audit-table">
        <thead>
          <tr>
            <th>盆号</th>
            <th>当前盆态</th>
            <th>最近汤温</th>
            <th>缫丝工</th>
            <th>管理员</th>
          </tr>
        </thead>
        <tbody>
          {policy.basins.map((b) => (
            <tr key={b.id} class={b.workerWritable ? "ok" : "deny"}>
              <td>
                <strong>{b.code}</strong>
              </td>
              <td>{STATUS_LABEL[b.status] || b.status}</td>
              <td>{b.latestTempC == null ? "无记录" : `${b.latestTempC} ℃`}</td>
              <td>{b.workerWritable ? "可写汤温 / 改盆态" : "一律禁止"}</td>
              <td>{policy.admins.join("、")}（不限盆）</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="hint">
        管理员名单：{policy.admins.join("、")}；缫丝工可动盆号：
        {policy.workerWritableCodes.join("、")}。
      </p>
    </div>
  );
}

function Shell() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("yard");
  const [board, setBoard] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [bootErr, setBootErr] = useState("");

  useEffect(() => {
    if (!token()) return;
    api("/api/auth/me")
      .then(setUser)
      .catch((e) => setBootErr(e.message));
  }, []);

  useEffect(() => {
    if (!user || view !== "audit") return;
    // 每次切到审计页都重取，保证盆态/最近汤温是新的。
    api("/api/audit/policy").then(setPolicy).catch((e) => setBootErr(e.message));
  }, [user, view]);

  async function logout() {
    clearToken();
    location.reload();
  }

  if (!user) {
    return (
      <Login
        onOk={(u) => {
          setUser(u);
          setBoard(null);
          setPolicy(null);
        }}
      />
    );
  }

  return (
    <div class="yard">
      <Topbar board={board} view={view} onView={setView} onLogout={logout} />
      {bootErr && <p class="err">{bootErr}</p>}
      {view === "yard" ? (
        <Yard user={user} board={board} setBoard={setBoard} />
      ) : (
        <Audit policy={policy} />
      )}
    </div>
  );
}

render(<Shell />, document.getElementById("app"));
