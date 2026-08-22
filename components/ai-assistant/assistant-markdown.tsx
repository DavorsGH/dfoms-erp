"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const assistantMarkdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-1 mt-2 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-1.5 text-sm font-medium first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-slate-100 p-2 text-xs last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-slate-300 pl-2 italic text-slate-600 last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 px-2 py-1">{children}</td>
  ),
  del: ({ children }) => <del className="text-slate-500">{children}</del>,
  hr: () => <hr className="my-2 border-slate-200" />,
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : undefined;
    if (!url) {
      return null;
    }

    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 block last:mb-0"
        title="Open image in new tab"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt ?? "Screenshot"}
          className="max-h-80 w-full max-w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
        />
      </a>
    );
  },
};

export default function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
