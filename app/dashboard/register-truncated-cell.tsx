"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const registerTruncatedCellHostClassName =
  "register-truncated-cell-host";

type TruncatedCellProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Up to two lines, then ellipsis; full text on hover (desktop) or tap (mobile) when clipped.
 */
export default function TruncatedCell({
  children,
  className = "",
}: TruncatedCellProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [mobileTipOpen, setMobileTipOpen] = useState(false);

  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el) {
      setIsTruncated(false);
      return;
    }
    setIsTruncated(
      el.scrollWidth > el.clientWidth + 1 ||
        el.scrollHeight > el.clientHeight + 1,
    );
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [children, measure]);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);
    if (el.parentElement) {
      resizeObserver.observe(el.parentElement);
    }

    return () => resizeObserver.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!mobileTipOpen) return;
    const close = () => setMobileTipOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [mobileTipOpen]);

  const plainText =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : textRef.current?.textContent?.replace(/\s+/g, " ").trim() ?? "";

  return (
    <span
      className={`register-truncated-cell relative block min-w-0 max-w-full ${className}`}
    >
      <span
        ref={textRef}
        className="block min-w-0 overflow-hidden text-ellipsis whitespace-normal [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [line-clamp:2]"
        title={isTruncated && plainText ? plainText : undefined}
        onClick={() => {
          if (isTruncated) {
            setMobileTipOpen((open) => !open);
          }
        }}
        onKeyDown={(event) => {
          if (!isTruncated) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setMobileTipOpen((open) => !open);
          }
        }}
        role={isTruncated ? "button" : undefined}
        tabIndex={isTruncated ? 0 : undefined}
      >
        {children}
      </span>
      {isTruncated && mobileTipOpen && plainText ? (
        <span
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 max-w-[min(20rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-normal normal-case text-slate-800 shadow-md md:hidden"
          role="tooltip"
        >
          {plainText}
        </span>
      ) : null}
    </span>
  );
}
