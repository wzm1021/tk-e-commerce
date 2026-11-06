import { useState } from "react";
import { Select } from "./Select.jsx";
import { LogOut, Menu } from "lucide-react";
import {
  BRAND_NAME,
  BRAND_NAME_ZH,
  BRAND_NAME_EN,
  BRAND_TAGLINE,
} from "../lib/brand.mjs";

export function Shell({
  session,
  workspace,
  setWorkspace,
  nav,
  page,
  setPage,
  children,
  audience = "web",
  onLogout,
  balance,
  platformSelector,
}) {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="scrim"
          aria-label="关闭菜单"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <div className="wordmark small" aria-label={BRAND_NAME}>
          {BRAND_NAME_ZH}
          <span>{BRAND_NAME_EN}</span>
          <i>{audience === "admin" ? "平台管理" : "跨境研究工作台"}</i>
        </div>
        {audience === "web" && (
          <div className="sidebar-selector">
            <span className="sidebar-selector-label">工作空间</span>
            <Select
              className="workspace-select"
              variant="box"
              size="sm"
              ariaLabel="工作空间"
              value={workspace}
              onChange={setWorkspace}
              options={session.workspaces.map((w) => ({
                value: w.id,
                title: w.name,
              }))}
            />
          </div>
        )}
        {platformSelector && (
          <div className="sidebar-selector">
            <span className="sidebar-selector-label">跨境电商平台</span>
            {typeof platformSelector === "function"
              ? platformSelector(() => setMobile(false))
              : platformSelector}
          </div>
        )}
        <nav>
          {nav.map((n) => (
            <button
              key={n.key}
              className={"nav-item " + (page === n.key ? "active" : "")}
              onClick={() => {
                setPage(n.key);
                setMobile(false);
              }}
            >
              {n.icon && <n.icon size={18} />}
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          内测环境<span>v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="打开菜单"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <span>
            {audience === "admin" ? "平台管理" : "研究工作空间"}
            <b>/</b>
            {nav.find((n) => n.key === page)?.label}
          </span>
          {balance}
          <div>
            <span className="avatar">
              {session.user.display_name.slice(0, 1)}
            </span>
            <span>{session.user.display_name}</span>
            <button
              className="icon-button"
              onClick={onLogout}
              aria-label="退出登录"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="main-content">{children}</main>
        <footer className="app-footer">
          {BRAND_NAME} · {BRAND_TAGLINE}
        </footer>
      </div>
    </div>
  );
}
