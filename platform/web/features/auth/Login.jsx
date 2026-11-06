import { ProfileFields, emptyProfile } from "../accounts/ProfileFields.jsx";
import React, { useState } from "react";
import { makeApi } from "../../lib/api.mjs";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Button, Field, ErrorBox } from "../../components/ui.jsx";
import { ArrowRight } from "lucide-react";
import {
  BRAND_NAME,
  BRAND_NAME_ZH,
  BRAND_NAME_EN,
  BRAND_TAGLINE,
} from "../../lib/brand.mjs";

export function Login({ audience, onLogin }) {
  const [step, setStep] = useState(1),
    [profile, setProfile] = useState(emptyProfile);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [challenge, setChallenge] = useState(null);
  const loginApi = React.useMemo(() => makeApi(audience), [audience]);
  const { data: options } = useLoad(loginApi, "/api/auth/options", 0);
  const isEmail = audience !== "admin" && mode !== "login";
  function changeMode(next) {
    setMode(next);
    setStep(1);
    setError("");
    setMessage("");
    setChallenge(null);
  }
  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const r = await makeApi(audience)(`/api/auth/${mode}/code`, {
        method: "POST",
        body: { email },
      });
      setChallenge(r.challenge_id);
      setMessage(r.message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (mode === "register" && step === 1) {
      if (!profile.company_size) {
        setError("请选择公司规模");
        return;
      }
      setError("");
      setStep(2);
      return;
    }
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      api = makeApi(audience);
    try {
      if (isEmail) {
        await api(`/api/auth/${mode}`, {
          method: "POST",
          body: {
            email,
            challenge_id: challenge,
            code: f.get("code"),
            password: f.get("password"),
            ...(mode === "register" ? { profile } : {}),
          },
        });
        if (mode === "reset") {
          changeMode("login");
          setMessage("密码已重置，请重新登录。");
          return;
        }
      }
      await api("/api/auth/login", {
        method: "POST",
        body: {
          login: isEmail ? email : f.get("login"),
          password: f.get("password"),
          audience,
        },
      });
      await onLogin();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className={
        "login-screen" + (mode === "register" ? " registration-screen" : "")
      }
    >
      <section className="login-story">
        <div className="wordmark" aria-label={BRAND_NAME}>
          {BRAND_NAME_ZH}
          <span>{BRAND_NAME_EN}</span>
          <i>跨境研究工作台</i>
        </div>
        <div>
          <small>从发现，到有依据的下一步</small>
          <h1>{BRAND_TAGLINE}</h1>
          <p>
            市场机会、内容线索、采购与利润，
            <br />
            在一个持续研究的工作空间里连接起来。
          </p>
        </div>
        <footer>FORM → AGENT + SKILLS → EVIDENCE</footer>
      </section>
      <section className="login-form">
        <small>{audience === "admin" ? "PLATFORM CONSOLE" : "WORKSPACE"}</small>
        <h2>
          {audience === "admin"
            ? "平台管理登录"
            : mode === "register"
              ? "用户注册"
              : mode === "reset"
                ? "找回密码"
                : "进入研究工作台"}
        </h2>
        <p className="muted">
          {audience === "admin"
            ? "管理租户、供应商连接、价格与技能版本。"
            : isEmail
              ? mode === "register"
                ? "填写联系与公司资料，创建你的个人用户账号。"
                : "验证邮箱后找回账户。"
              : "使用邮箱和密码登录；原有内测账号仍然可用。"}
        </p>
        {audience !== "admin" ? (
          <div className="segmented account-auth-tabs">
            <button
              type="button"
              onClick={() => changeMode("login")}
              className={mode === "login" ? "active" : ""}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => changeMode("register")}
              className={mode === "register" ? "active" : ""}
            >
              用户注册
            </button>
          </div>
        ) : null}
        {mode === "register" && (
          <ol className="registration-steps">
            <li className={step === 1 ? "active" : ""}>1　联系与公司资料</li>
            <li className={step === 2 ? "active" : ""}>2　账号验证</li>
          </ol>
        )}
        <form onSubmit={submit}>
          {mode === "register" && step === 1 ? (
            <ProfileFields
              value={profile}
              onChange={setProfile}
              email={email}
              onEmail={(v) => {
                setEmail(v);
                setChallenge(null);
              }}
            />
          ) : (
            <>
              {isEmail ? (
                <>
                  <Field label="邮箱">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setChallenge(null);
                      }}
                      maxLength={254}
                      required
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="邮箱验证码">
                    <input
                      name="code"
                      inputMode="numeric"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      autoComplete="one-time-code"
                      required
                    />
                  </Field>
                  <Button
                    type="button"
                    secondary
                    disabled={
                      busy || !email || options?.email_registration === false
                    }
                    onClick={sendCode}
                  >
                    发送验证码
                  </Button>
                  {options?.email_registration === false ? (
                    <p className="muted">
                      邮箱服务正在配置，请稍后注册。已有账号可继续登录。
                    </p>
                  ) : null}
                </>
              ) : (
                <Field label={audience === "admin" ? "账号" : "邮箱或原有账号"}>
                  <input
                    name="login"
                    autoComplete="username"
                    maxLength={254}
                    required
                    autoFocus
                  />
                </Field>
              )}
              <Field label={isEmail ? "设置密码（至少 12 位）" : "密码"}>
                <input
                  name="password"
                  type="password"
                  minLength={isEmail ? 12 : undefined}
                  maxLength={256}
                  autoComplete={isEmail ? "new-password" : "current-password"}
                  required
                />
              </Field>
            </>
          )}
          {message ? <p className="notice">{message}</p> : null}
          <ErrorBox error={error} />
          {mode === "register" && step === 2 && (
            <Button type="button" secondary onClick={() => setStep(1)}>
              返回修改资料
            </Button>
          )}
          <Button
            disabled={
              busy ||
              (isEmail && !(mode === "register" && step === 1) && !challenge)
            }
          >
            {busy
              ? "正在处理…"
              : mode === "register"
                ? step === 1
                  ? "下一步：验证邮箱"
                  : "注册并登录"
                : mode === "reset"
                  ? "重置密码"
                  : "登录"}
            <ArrowRight size={17} />
          </Button>
        </form>
        {audience !== "admin" ? (
          <button
            className="text-button"
            type="button"
            onClick={() => changeMode("reset")}
          >
            忘记密码
          </button>
        ) : null}
        <small className="login-note">
          {audience === "admin"
            ? "仅平台管理员可访问"
            : "注册后可由团队负责人或管理员通过邮箱添加到团队，共享额度。"}
        </small>
        {audience === "admin" ||
        ["127.0.0.1", "localhost", "[::1]"].includes(
          window.location.hostname,
        ) ? (
          <a href={audience === "admin" ? "/" : "/admin"}>
            {audience === "admin" ? "返回用户工作台" : "平台管理入口"}
          </a>
        ) : null}
      </section>
    </main>
  );
}
