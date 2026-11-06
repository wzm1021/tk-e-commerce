import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button, ErrorBox } from "../../components/ui.jsx";

export function ReportDownload({ api, runId, workspace, disabled }) {
  const [pdf, setPdf] = useState({ status: "not_requested" }),
    [starting, setStarting] = useState(false),
    [error, setError] = useState("");
  const live = useRef(true),
    autoDownload = useRef(false),
    requested = useRef(false);
  const path = `/api/ai-tests/runs/${runId}/report/pdf`;
  const href = (id) =>
    `/api/artifacts/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}&download=1`;
  const busy = ["queued", "rendering"].includes(pdf.status);
  const receive = (next) => {
    if (!live.current) return;
    setPdf(next);
    if (next.status === "ready" && autoDownload.current) {
      autoDownload.current = false;
      const link = document.createElement("a");
      link.href = href(next.artifact_id);
      link.download = next.name;
      document.body.append(link);
      link.click();
      link.remove();
    }
  };
  useEffect(() => {
    live.current = true;
    let active = true;
    api(path)
      .then((next) => {
        if (active && !requested.current) receive(next);
      })
      .catch(() => {});
    return () => {
      active = false;
      live.current = false;
    };
  }, [api, path]);
  useEffect(() => {
    if (!busy) return;
    let active = true,
      timer;
    const poll = async () => {
      try {
        const next = await api(path);
        if (!active) return;
        receive(next);
        if (["queued", "rendering"].includes(next.status))
          timer = setTimeout(poll, 2000);
      } catch (e) {
        if (active) {
          setError(e.message);
          autoDownload.current = false;
          setPdf({ status: "failed" });
        }
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, path, busy]);
  const start = async () => {
    requested.current = true;
    setStarting(true);
    setError("");
    autoDownload.current = true;
    try {
      receive(await api(path, { method: "POST", body: {} }));
    } catch (e) {
      if (live.current) setError(e.message);
      autoDownload.current = false;
    } finally {
      if (live.current) setStarting(false);
    }
  };
  return (
    <div className="ai-report-download">
      <div>
        <Button disabled={disabled || starting || busy} onClick={start}>
          <Download size={16} />
          {starting || busy ? "正在生成中文 PDF…" : "下载中文 PDF"}
        </Button>
        {pdf.status === "ready" && (
          <a
            className="ai-pdf-ready"
            href={href(pdf.artifact_id)}
            download={pdf.name}
          >
            文件已就绪，点击下载
          </a>
        )}
      </div>
      <p className="muted" role="status">
        {disabled
          ? "中文反馈准备完成后即可下载完整报告。"
          : busy
            ? "正在排版完整报告，生成后会自动下载。可关闭页面，稍后回来下载。"
            : pdf.status === "failed"
              ? "PDF 生成未完成，请重试下载；已完成的测品报告不受影响。"
              : "包含全部结果、消费者反馈和确认截图，可直接发给客户。"}
      </p>
      <ErrorBox error={error} />
    </div>
  );
}
