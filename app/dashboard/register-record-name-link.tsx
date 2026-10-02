"use client";

import type { MouseEvent, ReactNode } from "react";

type RegisterRecordNameLinkProps = {
  children: ReactNode;
  onOpen: () => void;
  className?: string;
};

/** Opens register record detail; styled as a link without navigating away. */
export function RegisterRecordNameLink({
  children,
  onOpen,
  className = "",
}: RegisterRecordNameLinkProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onOpen();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`min-w-0 max-w-full cursor-pointer whitespace-normal text-left font-medium text-sky-800 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${className}`}
    >
      {children}
    </button>
  );
}
