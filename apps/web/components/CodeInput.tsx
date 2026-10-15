"use client";

import { useRef, useState } from "react";

// A 6-box one-time-code input — typing a digit auto-advances to the next
// box, backspace on an empty box steps back to the previous one, and
// pasting a full code (e.g. from a password manager or a copied text)
// fills every box at once. onComplete fires exactly once per distinct
// completed code (submittedRef guards against firing again on every
// keystroke after the boxes are already full, e.g. while correcting a
// digit) — callers use it to auto-submit immediately, no separate
// "Confirm" click needed.
export default function CodeInput({
  length = 6,
  onComplete,
  disabled,
}: {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const submittedRef = useRef<string | null>(null);

  function maybeComplete(next: string[]) {
    const code = next.join("");
    if (code.length === length && submittedRef.current !== code) {
      submittedRef.current = code;
      onComplete(code);
    }
  }

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    // Only ever keep the last character of whatever the field reports —
    // some mobile keyboards/autofill report the full field value rather
    // than just the newly typed key.
    const char = e.target.value.slice(-1).replace(/[^0-9]/g, "");
    if (e.target.value && !char) return;
    // Built from the current closure's `digits`, not a functional setState
    // updater — onComplete (called below, via maybeComplete) can itself
    // trigger a parent setState (PhoneVerifyForm/EmailVerifyForm's
    // setBusy), and React disallows that from inside another component's
    // updater callback ("Cannot update a component while rendering a
    // different component"). Calling maybeComplete as a plain statement
    // after setDigits, in the normal event-handler flow, avoids it.
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    maybeComplete(next);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setDigits((prev) => {
        const next = [...prev];
        next[index - 1] = "";
        return next;
      });
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(length).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, length - 1)]?.focus();
    maybeComplete(next);
  }

  return (
    <div className="flex justify-center gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="h-16 w-14 rounded-lg border-2 border-gray-400 text-center text-2xl font-semibold outline-none focus:border-brand-navy disabled:opacity-60"
        />
      ))}
    </div>
  );
}
