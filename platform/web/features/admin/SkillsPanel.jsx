import { useState, useEffect } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Button, Field, Badge, ErrorBox } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime, jobLabels } from "../../lib/format.mjs";
import { BookOpen } from "lucide-react";
import { skills } from "./constants.mjs";

export function SkillsPanel({ api, workspace, version, reload }) {
  const [skill, setSkill] = useState(skills.scouting),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const { data } = useLoad(
    api,
    `/api/admin/workspaces/${workspace}/skills/${skill}`,
    version,
  );
  const { data: detail } = useLoad(
    api,
    "/api/admin/workspaces/" + workspace,
    version,
  );
  const [instructions, setInstructions] = useState("");
  useEffect(() => setInstructions(data?.instructions || ""), [data]);
  async function publish() {
    setBusy(true);
    setError("");
    try {
      const r = await api(
        `/api/admin/workspaces/${workspace}/skills/${skill}/publish`,
        {
          method: "POST",
          body: { expected_generation: data.generation, instructions },
        },
      );
      setMessage(
        `已发布 v${r.version}。新任务使用该版本，进行中的任务继续使用原版本。`,
      );
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function rollback(release) {
    try {
      await api(`/api/admin/workspaces/${workspace}/skills/${skill}/rollback`, {
        method: "POST",
        body: { release_id: release.id, expected_generation: data.generation },
      });
      setMessage("已切换到所选历史版本，新任务开始生效。");
      reload();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <div className="section-line">
        <Select
          variant="box"
          size="sm"
          value={skill}
          ariaLabel="选择技能"
          onChange={(v) => {
            setSkill(v);
            setMessage("");
          }}
          options={Object.entries(skills).map(([k, v]) => ({
            value: v,
            title: k === "amazon_scouting" ? "亚马逊选品" : jobLabels[k],
          }))}
        />
        <Badge value={data?.version ? "v" + data.version : "未发布"} />
        <Button onClick={publish} disabled={!data || busy}>
          <BookOpen size={16} />
          {busy ? "发布中…" : "发布到当前租户"}
        </Button>
      </div>
      <p className="muted">
        发布采用原子版本切换，整个服务无需停服。每个租户独立保存技能包；历史版本保持不可变。
      </p>
      <ErrorBox error={error} />
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <Field label="SKILL.md 指令">
        <textarea
          className="code-editor"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          spellCheck={false}
        />
      </Field>
      <section className="panel">
        <h2>当前技能历史版本</h2>
        <div className="job-list">
          {detail?.releases
            .filter((r) => r.skill_id === skill)
            .map((r) => (
              <div className="job-row" key={r.id}>
                <strong>v{r.version}</strong>
                <span>
                  {datetime(r.created_at)}
                  <small>{r.digest.slice(0, 20)}</small>
                </span>
                <Button
                  secondary
                  disabled={r.version === data?.version}
                  onClick={() => rollback(r)}
                >
                  切换到此版本
                </Button>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}
