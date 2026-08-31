"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = "Select…",
  disabled = false,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function openList() {
    if (disabled || options.length === 0) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(active);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(listId, active) : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center gap-2.5 rounded-lg border bg-zinc-900/80 px-3 py-2.5 text-left text-sm transition-colors duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? "border-[#76b900] ring-2 ring-[#76b900]/25"
            : "border-zinc-700/80 hover:border-zinc-600 focus-visible:border-[#76b900] focus-visible:ring-2 focus-visible:ring-[#76b900]/25"
        }`}
      >
        {selected?.icon && (
          <span className="flex size-5 shrink-0 items-center justify-center">
            {selected.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-zinc-100">
          {selected?.label ?? placeholder}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1.5 max-h-72 w-full origin-top animate-[dropdown_120ms_ease-out] overflow-auto rounded-lg border border-zinc-700/80 bg-zinc-900 p-1 shadow-2xl shadow-black/60"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === active;
            return (
              <div
                key={option.value}
                id={optionId(listId, index)}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(index)}
                onKeyDown={onKeyDown}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-100 ${
                  isActive ? "bg-zinc-800" : ""
                } ${isSelected ? "text-[#9ede2b]" : "text-zinc-200"}`}
              >
                {option.icon && (
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {option.hint}
                    </span>
                  )}
                </span>
                {isSelected && <CheckIcon />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`size-4 shrink-0 text-zinc-500 transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path
        d="m5.5 7.5 4.5 4.5 4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="size-4 shrink-0 text-[#76b900]"
    >
      <path
        d="m4.5 10.5 3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
