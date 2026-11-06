import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ImagePreview({ src, title, onClose }) {
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const panel = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    panel.showModal();
    closeButton.current.focus();
    document.body.style.overflow = "hidden";
    return () => {
      panel.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="image-preview"
      aria-label="商品图片全屏预览"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="image-preview-header">
        <h2>{title || "商品图片"}</h2>
        <button
          ref={closeButton}
          type="button"
          className="image-preview-close"
          aria-label="关闭图片预览"
          onClick={onClose}
        >
          <X size={24} />
        </button>
      </header>
      {failed ? (
        <p role="status">图片暂时无法加载，请关闭后重试。</p>
      ) : (
        <img
          className="image-preview-full"
          src={src}
          alt={title || "商品图片"}
          onClick={onClose}
          onError={() => setFailed(true)}
        />
      )}
      <p className="image-preview-hint">点击背景、关闭按钮或按 Esc 返回</p>
    </dialog>,
    document.body,
  );
}
