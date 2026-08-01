"use client";

import { useRef } from "react";

export const imageFileUploadButtonClassName =
  "inline-flex cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const hintClassName = "mt-1 text-xs text-slate-500";

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp";
const DEFAULT_EMPTY_HINT = "JPEG, PNG, or WebP.";

export type ImageFileUploadButtonProps = {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  accept?: string;
  emptyHint?: string;
  /** Label when no files selected. */
  addLabel?: string;
  /** Label when files are selected. Defaults to Change photos (n) / Change file. */
  changeLabel?: string;
  showClear?: boolean;
  inputId?: string;
  /**
   * When true, clears the native input after selection so the same file can be
   * re-picked (useful for immediate-upload flows that do not retain File state).
   */
  resetInputAfterSelect?: boolean;
};

/**
 * Shared photo/file picker: hidden native input + secondary button +
 * filename list + type hint (portal Repairs pattern).
 */
export default function ImageFileUploadButton({
  files,
  onChange,
  multiple = true,
  disabled = false,
  accept = DEFAULT_ACCEPT,
  emptyHint = DEFAULT_EMPTY_HINT,
  addLabel = "Add photos",
  changeLabel,
  showClear = true,
  inputId,
  resetInputAfterSelect = false,
}: ImageFileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const resolvedChangeLabel =
    changeLabel ??
    (multiple
      ? `Change photos (${files.length})`
      : files[0]
        ? "Change file"
        : "Change file");

  function clearSelection() {
    onChange([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          const next = Array.from(event.target.files ?? []);
          onChange(next);
          if (resetInputAfterSelect && inputRef.current) {
            inputRef.current.value = "";
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={imageFileUploadButtonClassName}
        >
          {files.length > 0 ? resolvedChangeLabel : addLabel}
        </button>
        {showClear && files.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={clearSelection}
            className={imageFileUploadButtonClassName}
          >
            Clear
          </button>
        ) : null}
      </div>
      {files.length > 0 ? (
        <p className={hintClassName}>
          {files.map((file) => file.name).join(", ")}
        </p>
      ) : (
        <p className={hintClassName}>{emptyHint}</p>
      )}
    </div>
  );
}
