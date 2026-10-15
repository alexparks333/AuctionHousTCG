"use client";

import type { FormEvent } from "react";
import { ArrowRight, Award, FileText } from "lucide-react";
import type { WizardData, UpdateField } from "../SellWizard";
import { inputClass, labelClass, optionalTagClass } from "./styles";
import StepHeader, { StepFooter, primaryButtonClass } from "./StepHeader";
import { CONDITIONS, CONDITION_SHORT, ENABLED_GAMES } from "@/lib/types";

// The grading-company choice that reveals a free-text name field.
export const OTHER_GRADER = "Other";
const GRADING_COMPANIES = ["PSA", "BGS", "CGC", OTHER_GRADER];

export default function Step1Details({
  data,
  update,
  onNext,
}: {
  data: WizardData;
  update: UpdateField;
  onNext: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeader icon={<FileText size={20} />} step={1} title="Describe the card">
        Only the title is required to continue — the rest can be filled in now or refined later.
      </StepHeader>

      <label className={labelClass}>
        Title
        <input
          required
          value={data.title}
          onChange={(e) => update("title", e.target.value)}
          className={`${inputClass} py-3 text-base`}
          placeholder="Rengar, Pouncing — Spiritforged"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Game
          <select value={data.game} onChange={(e) => update("game", e.target.value)} className={inputClass}>
            {ENABLED_GAMES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>
            Set<span className={optionalTagClass}>Optional</span>
          </span>
          <input
            value={data.setName}
            onChange={(e) => update("setName", e.target.value)}
            className={inputClass}
            placeholder="Spiritforged"
          />
        </label>
        <label className={labelClass}>
          <span>
            Card number<span className={optionalTagClass}>Optional</span>
          </span>
          <input
            value={data.cardNumber}
            onChange={(e) => update("cardNumber", e.target.value)}
            className={inputClass}
            placeholder="025/221"
          />
        </label>
        <label className={labelClass}>
          <span>
            Rarity<span className={optionalTagClass}>Optional</span>
          </span>
          <input
            value={data.rarity}
            onChange={(e) => update("rarity", e.target.value)}
            className={inputClass}
            placeholder="Rare"
          />
        </label>
      </div>

      {/* Same NM/LP/MP/HP/DMG choices as the Singles Shop's stock drawer.
          Optional, so clicking the selected one again clears it. */}
      <div className="flex flex-col gap-2">
        <span id="condition-label" className="text-sm font-semibold text-gray-800">
          Condition<span className={optionalTagClass}>Optional</span>
        </span>
        <div role="radiogroup" aria-labelledby="condition-label" className="grid grid-cols-5 gap-2">
          {CONDITIONS.map((c) => {
            const selected = data.condition === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update("condition", selected ? "" : c)}
                title={c}
                className={`flex flex-col items-center rounded-xl border px-1 py-2.5 transition-all ${
                  selected
                    ? "border-brand-navy bg-brand-navy text-white shadow-md shadow-brand-navy/20"
                    : "border-gray-200 bg-gray-50/70 text-gray-700 hover:-translate-y-0.5 hover:border-gray-300 hover:bg-white"
                }`}
              >
                <span className="text-sm font-bold">{CONDITION_SHORT[c]}</span>
                <span
                  className={`mt-0.5 hidden text-[10px] leading-tight sm:block ${selected ? "text-white/70" : "text-gray-400"}`}
                >
                  {c}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Graded slab: a switch row that opens the grading fields. */}
      <div
        className={`rounded-2xl border transition-colors ${
          data.isGraded ? "border-brand-gold/40 bg-amber-50/40" : "border-gray-200"
        }`}
      >
        <label className="flex cursor-pointer items-center gap-3 p-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              data.isGraded ? "bg-brand-gold/15 text-brand-gold" : "bg-gray-100 text-gray-400"
            }`}
          >
            <Award size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-900">This card is professionally graded</span>
            <span className="block text-xs text-gray-500">PSA, BGS or CGC slab with a cert number</span>
          </span>
          <input
            type="checkbox"
            checked={data.isGraded}
            onChange={(e) => update("isGraded", e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-6 w-11 shrink-0 rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-navy peer-checked:after:translate-x-5 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-navy/20"
          />
        </label>

        {data.isGraded && (
          <div
            className={`grid gap-4 border-t border-brand-gold/20 p-4 ${
              data.gradingCompany === OTHER_GRADER ? "sm:grid-cols-2" : "sm:grid-cols-3"
            }`}
          >
            <label className={labelClass}>
              Grading company
              <select
                value={data.gradingCompany}
                onChange={(e) => update("gradingCompany", e.target.value)}
                className={`${inputClass} bg-white`}
              >
                {GRADING_COMPANIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {data.gradingCompany === OTHER_GRADER && (
              <label className={labelClass}>
                Grading service name
                <input
                  required
                  autoFocus
                  maxLength={40}
                  value={data.gradingCompanyOther}
                  onChange={(e) => update("gradingCompanyOther", e.target.value)}
                  className={`${inputClass} bg-white`}
                  placeholder="e.g. TAG, SGC, ACE"
                />
              </label>
            )}
            <label className={labelClass}>
              Grade
              <input
                value={data.grade}
                onChange={(e) => update("grade", e.target.value)}
                className={`${inputClass} bg-white`}
                placeholder="10"
              />
            </label>
            <label className={labelClass}>
              Cert number
              <input
                value={data.certNumber}
                onChange={(e) => update("certNumber", e.target.value)}
                className={`${inputClass} bg-white`}
                placeholder="88401552"
              />
            </label>
          </div>
        )}
      </div>

      <StepFooter>
        <span />
        <button type="submit" className={primaryButtonClass}>
          Continue to photos
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </StepFooter>
    </form>
  );
}
