import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, clearToken, setToken, token } from "./api.js";
import "./app.css";

const STATUS_LABEL = { soaking: "浸茧", reeling: "缫丝中", reeled: "已缫完" };
const ROLE_LABEL = { admin: "管理员", worker: "缫丝工" };
// 与后端 services.WORKER_BASIN_CODE 对齐：缫丝工只能料理这口盆。
const WORKER_BASIN_CODE = "甲-2";

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
        <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
        <button type="submit">登录</button>
      </form>
      {err && <p class="err">{err}</p>}
    </div>
  );
}

function TopBar({ user, view, onNav, onLogout }) {
  return (
    <div class="topbar">
      <div>
        <h1>江口缫丝坞</h1>
        <p>
          {view === "yard"
            ? "环盆作业台 · 点盆登记汤温；已缫完须最近汤温 38～42℃"
            : "汤温审计 · 只读列出谁能改哪盆"}
        </p>
      </div>
      <nav class="tabs">
        <button class={view === "yard" ? "on" : ""} onClick={() => onNav("yard")}>
          环盆作业台
        </button>
        <button class={view === "audit" ? "on" : ""} onClick={() => onNav("audit")}>
          汤温审计
        </button>
      </nav>
      <div class="who">
        <span>
          {user.username}（{ROLE_LABEL[user.role] || user.role}）
        </span>
        <button onClick={onLogout}>退出</button>
      </div>
    </div>
  );
}

function Yard({ user }) {
  const [board, setBoard] = useState(null);
  const [picked, setPicked] = useState(null);
  const [temp, setTemp] = useState("40");
  const [err, setErr] = useState("");

  const canOperate = (b) => user.role === "admin" || b.code === WORKER_BASIN_CODE;

  async function refresh() {
    const data = await api("/api/board");
    setBoard(data);
    setPicked((prev) => {
      if (prev) {
        return data.basins.find((b) => b.id === prev.id) || data.basins[0];
      }
      if (user.role !== "admin") {
        return data.basins.find((b) => b.code === WORKER_BASIN_CODE) || null;
      }
      return null;
    });
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  if (!board) {
    return <p>{err || "装载环盆…"}</p>;
  }

  const n = board.basins.length;
  async function writeTemp() {
    setErr("");
    if (!picked || !canOperate(picked)) {
      setErr(`缫丝工只能给${WORKER_BASIN_CODE}盆写汤温、改盆态`);
      return;
    }
    try {
      const row = await api(`/api/basins/${picked.id}/readings`, {
        method: "POST",
        // 原样上交输入，空值/非数字由后端用中文挡回，不在前端悄悄转成 0。
        body: JSON.stringify({ waterTempC: temp }),
      });
      await refresh();
      setPicked(row);
    } catch (ex) {
      setErr(ex.message);
    }
  }
  async function setStatus(status) {
    setErr("");
    if (!picked || !canOperate(picked)) {
      setErr(`缫丝工只能给${WORKER_BASIN_CODE}盆写汤温、改盆态`);
      return;
    }
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
    <div>
      <p class="hint">
        {board.riverside} ·{" "}
        {user.role === "admin"
          ? "管理员不限盆位。"
          : `缫丝工只能给${WORKER_BASIN_CODE}盆写汤温、改盆态，其余盆位已锁定。`}
      </p>
      <div class="ring">
        {board.basins.map((b, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const left = 50 + Math.cos(angle) * 38;
          const top = 50 + Math.sin(angle) * 38;
          const locked = !canOperate(b);
          return (
            <button
              key={b.id}
              class={`basin ${b.status}${locked ? " locked" : ""}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              disabled={locked}
              title={locked ? `缫丝工只能料理${WORKER_BASIN_CODE}盆` : b.code}
              onClick={() => setPicked(b)}
            >
              <strong>{b.code}</strong>
              <span>{STATUS_LABEL[b.status]}</span>
            </button>
          );
        })}
      </div>
      {picked && (
        <div class="drawer">
          <h3>
            {picked.code} · {STATUS_LABEL[picked.status]}
          </h3>
          <p>最近汤温：{picked.latestTempC ?? "无"} ℃ · 记录 {picked.readingCount} 次</p>
          <input value={temp} onInput={(e) => setTemp(e.target.value)} />
          <button onClick={writeTemp}>登记汤温</button>
          <div>
            <button onClick={() => setStatus("soaking")}>浸茧</button>
            <button onClick={() => setStatus("reeling")}>缫丝中</button>
            <button onClick={() => setStatus("reeled")}>已缫完</button>
          </div>
          {err && <p class="err">{err}</p>}
        </div>
      )}
      {!picked && err && <p class="err">{err}</p>}
    </div>
  );
}

function Audit() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/audit")
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  if (!data) {
    return <p>{err || "装载审计…"}</p>;
  }

  return (
    <div class="audit">
      <p class="hint">
        只读专页：谁能给哪盆写汤温、改盆态。缫丝工仅 {data.workerBasinCode}
        盆；管理员不限盆。标「已缫完」须最近汤温 {data.tempBand.minC}～{data.tempBand.maxC}℃，空汤温不许登记。
      </p>
      <table>
        <thead>
          <tr>
            <th>盆位</th>
            <th>状态</th>
            <th>最近汤温</th>
            <th>记录次数</th>
            <th>可写汤温 / 改盆态</th>
          </tr>
        </thead>
        <tbody>
          {data.basins.map((b) => (
            <tr key={b.id}>
              <td>{b.code}</td>
              <td>{STATUS_LABEL[b.status] || b.status}</td>
              <td>{b.latestTempC == null ? "—" : `${b.latestTempC} ℃`}</td>
              <td>{b.readingCount}</td>
              <td>
                {b.writers
                  .map((w) => `${w.username}（${ROLE_LABEL[w.role] || w.role}）`)
                  .join("、")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(token()));
  const [view, setView] = useState("yard");

  useEffect(() => {
    if (!token()) return;
    api("/api/auth/me")
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return <div class="login">核对登录…</div>;
  }
  if (!user) {
    return (
      <Login
        onOk={(u) => {
          setView("yard");
          setUser(u);
        }}
      />
    );
  }
  return (
    <div class="yard">
      <TopBar
        user={user}
        view={view}
        onNav={setView}
        onLogout={() => {
          clearToken();
          location.reload();
        }}
      />
      {view === "yard" ? <Yard user={user} /> : <Audit />}
    </div>
  );
}

render(<App />, document.getElementById("app"));
