"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Minus, Plus, Trash2, X } from "lucide-react";
import { addSingle, removeSingle, updateSingle } from "@/lib/api";
import {
  CONDITION_SHORT,
  SINGLES_CONDITIONS,
  SINGLES_PRICE_CAP_CENTS,
  SINGLES_PRICE_LADDER_CENTS,
  formatPrice,
  isFoilOnly,
  marketPriceCents,
  singlesPriceCents,
  type CatalogCard,
  type ShopSingle,
} from "@/lib/types";

// The slide-over that opens when a seller clicks a card in their Singles
// Shop: the card itself (big), its market price, every variant they
// already stock (edit quantity inline, or remove), and a form to stock
// more. Prices are standardized from the market price (singlesPriceCents)
// — the seller only picks condition, finish, and quantity.
export default function StockDrawer({
  card,
  game,
  variants,
  onClose,
  onSaved,
  onRemoved,
}: {
  card: CatalogCard | null;
  game: string;
  // This card's rows from the seller's shop.
  variants: ShopSingle[];
  onClose: () => void;
  onSaved: (s: ShopSingle) => void;
  onRemoved: (id: string) => void;
}) {
  useEffect(() => {
    if (!card) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  const number = card.displayNumber || card.number;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={card.name}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-gray-950/40 backdrop-blur-[1px]" />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-border bg-white/95 px-5 py-3 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-gold">{card.setName}</p>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-gray-400 hover:bg-brand-surface hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-4 px-5 pt-5">
          <div className="w-36 shrink-0">
            {card.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.imageUrl} alt={card.name} className="aspect-[5/7] w-full rounded-xl object-cover shadow-lg" />
            ) : (
              <div className="aspect-[5/7] w-full rounded-xl bg-brand-surface" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight text-gray-900">{card.name}</h2>
            <p className="mt-1 text-sm text-gray-500">
              #{number}
              {card.rarity && <> · {card.rarity.replace("_", " ")}</>}
            </p>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              {!isFoilOnly(card) && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Market (non-foil)</dt>
                  <dd className="font-semibold text-gray-900">{card.marketPrice ? `$${card.marketPrice.toFixed(2)}` : "—"}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">{isFoilOnly(card) ? "Market (foil only)" : "Market (foil)"}</dt>
                <dd className="font-semibold text-gray-900">
                  {(card.marketPriceFoil || card.marketPrice) ? `$${(card.marketPriceFoil || card.marketPrice || 0).toFixed(2)}` : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] leading-snug text-gray-400">TCGplayer market price, via TCG Haven.</p>
          </div>
        </div>

        <section className="mt-6 border-t border-brand-border px-5 pt-5">
          <h3 className="text-sm font-semibold text-gray-900">In your shop</h3>
          {variants.length === 0 ? (
            <p className="mt-1.5 text-sm text-gray-500">You aren&apos;t selling this card yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {variants.map((v) => (
                <VariantRow key={`${v.id}-${v.updatedAt}`} single={v} onSaved={onSaved} onRemoved={onRemoved} />
              ))}
            </ul>
          )}
        </section>

        {/* Keyed by card so switching cards resets the form to that card's
            defaults (foil-only, condition) instead of carrying the
            last card's values over. */}
        {card.singlesEligible === false ? (
          <section className="mt-6 border-t border-brand-border px-5 py-5">
            <h3 className="text-sm font-semibold text-gray-900">Sell this as a listing</h3>
            <p className="mt-1.5 text-sm text-gray-500">
              The Singles Shop is for Commons, Uncommons and Rares. {card.rarity ? `${card.rarity.replace("_", " ")} cards` : "Chase cards"}{" "}
              are sold as a regular listing with your own photos.
            </p>
            <a
              href="/sell"
              className="mt-4 block w-full rounded-full bg-brand-navy py-3 text-center text-sm font-semibold text-white hover:bg-brand-navy/90"
            >
              Create a listing
            </a>
          </section>
        ) : (
          <AddVariantForm key={card.id} card={card} game={game} variants={variants} onSaved={onSaved} />
        )}
      </aside>
    </div>
  );
}

function VariantRow({
  single,
  onSaved,
  onRemoved,
}: {
  single: ShopSingle;
  onSaved: (s: ShopSingle) => void;
  onRemoved: (id: string) => void;
}) {
  const [qty, setQty] = useState(single.quantity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = qty !== single.quantity;
  // Rows stocked before HP/DMG were dropped stay editable (so they can be
  // sold off the seller's own way or removed) but buyers never see them.
  const retired = !(SINGLES_CONDITIONS as readonly string[]).includes(single.condition);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await updateSingle(single.id, { quantity: qty });
      onSaved(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await removeSingle(single.id);
      onRemoved(single.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove.");
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-lg border p-2.5 ${single.quantity === 0 || retired ? "border-dashed border-gray-300 bg-gray-50" : "border-brand-border"}`}>
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[11px] font-bold text-white" title={single.condition}>
          {CONDITION_SHORT[single.condition] ?? single.condition}
        </span>
        <FinishChip foil={single.isFoil} />
        {retired ? (
          <span className="text-[11px] font-semibold text-gray-500">Hidden — HP/DMG can&apos;t be sold here</span>
        ) : (
          single.quantity === 0 && <span className="text-[11px] font-semibold text-gray-500">Sold out</span>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="ml-auto rounded p-1 text-gray-400 hover:bg-red-50 hover:text-brand-urgent disabled:opacity-40"
          aria-label="Remove this variant from your shop"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Stepper value={qty} onChange={setQty} min={0} />
        <span className="flex h-[38px] flex-1 items-center justify-end gap-1 pr-1 text-sm">
          <span className="font-bold text-gray-900">{formatPrice(single.priceCents)}</span>
          <span className="text-xs text-gray-400">each</span>
        </span>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="flex h-[38px] w-16 items-center justify-center gap-1 rounded-full bg-brand-navy text-xs font-semibold text-white transition-opacity disabled:opacity-30"
        >
          {saved ? <Check size={13} /> : "Save"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-brand-urgent">{error}</p>}
    </li>
  );
}

function AddVariantForm({
  card,
  game,
  variants,
  onSaved,
}: {
  card: CatalogCard;
  game: string;
  variants: ShopSingle[];
  onSaved: (s: ShopSingle) => void;
}) {
  const foilOnly = isFoilOnly(card);
  const [condition, setCondition] = useState<string>(SINGLES_CONDITIONS[0]);
  const [isFoil, setIsFoil] = useState(foilOnly);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justAdded, setJustAdded] = useState("");

  const market = marketPriceCents(card, isFoil);
  const price = market > 0 ? singlesPriceCents(market, condition) : 0;
  const capped = market > SINGLES_PRICE_CAP_CENTS;
  const existing = variants.find((v) => v.condition === condition && v.isFoil === isFoil);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const saved = await addSingle({ game, catalogCardId: card.id, condition, isFoil, quantity });
      onSaved(saved);
      setJustAdded(`Added. You now have ${saved.quantity} ${CONDITION_SHORT[condition] ?? condition}${isFoil ? " foil" : ""} for sale.`);
      setQuantity(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add this card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border-t border-brand-border px-5 py-5">
      <h3 className="text-sm font-semibold text-gray-900">{variants.length > 0 ? "Add more copies" : "Start selling this card"}</h3>

      <p className="mt-3 text-xs font-medium text-gray-500">Condition</p>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {SINGLES_CONDITIONS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCondition(c)}
            title={c}
            className={`rounded-lg border py-1.5 text-xs font-bold transition-colors ${
              condition === c
                ? "border-brand-navy bg-brand-navy text-white"
                : "border-gray-300 text-gray-600 hover:border-gray-400"
            }`}
          >
            {CONDITION_SHORT[c]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">
        Heavily Played and Damaged cards can&apos;t go in the Singles Shop.
        {condition === "Moderately Played" && " Moderately Played sells one price step lower."}
      </p>

      <p className="mt-4 text-xs font-medium text-gray-500">Finish</p>
      {foilOnly ? (
        <p className="mt-1.5 flex items-center justify-between rounded-lg border border-brand-gold/40 bg-amber-50/50 px-3 py-2 text-xs">
          <FinishChip foil />
          <span className="text-gray-500">This card only comes in foil.</span>
        </p>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {[false, true].map((foil) => {
            const m = marketPriceCents(card, foil);
            return (
              <button
                key={String(foil)}
                type="button"
                onClick={() => setIsFoil(foil)}
                aria-pressed={isFoil === foil}
                className={`flex flex-col items-center rounded-lg border py-1.5 text-xs font-bold transition-colors ${
                  isFoil === foil
                    ? "border-brand-navy bg-brand-navy text-white"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
                }`}
              >
                {foil ? "Foil" : "Non-foil"}
                <span className={`text-[10px] font-medium ${isFoil === foil ? "text-white/70" : "text-gray-400"}`}>
                  {m > 0 ? `sells for ${formatPrice(singlesPriceCents(m, condition))}` : "no price"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-start gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Quantity</p>
          <Stepper value={quantity} onChange={setQuantity} min={1} />
        </div>
        <div className="flex-1">
          <p className="mb-1.5 text-xs font-medium text-gray-500">Price each</p>
          <p className="flex h-[38px] items-center rounded-full bg-brand-surface px-4 text-sm font-bold text-gray-900">
            {price > 0 ? formatPrice(price) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            {market > 0 ? <>Market {formatPrice(market)}, set automatically</> : "No market price for this card"}
          </p>
        </div>
      </div>

      {capped && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            This card&apos;s market price is <strong>{formatPrice(market)}</strong>, but Singles Shop prices stop at{" "}
            {formatPrice(SINGLES_PRICE_CAP_CENTS)}, so it will sell for <strong>{formatPrice(price)}</strong>.{" "}
            <a href="/sell" className="font-semibold underline">
              List it instead
            </a>{" "}
            to get full value.
          </p>
        </div>
      )}

      {existing && (
        <p className="mt-3 rounded-lg bg-brand-surface px-3 py-2 text-xs text-gray-600">
          You already sell {existing.quantity} of this. Adding puts {quantity} more on top.
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || price <= 0 || quantity < 1}
        className="mt-4 w-full rounded-full bg-brand-navy py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-40"
      >
        {busy ? "Adding..." : `Add ${quantity} to shop${price > 0 ? ` · ${formatPrice(price)} each` : ""}`}
      </button>
      {error && <p className="mt-2 text-sm text-brand-urgent">{error}</p>}
      {!error && justAdded && <p className="mt-2 text-sm text-green-700">{justAdded}</p>}

      <PriceLadderNote />
    </section>
  );
}

// How Singles Shop prices work, collapsed by default.
function PriceLadderNote() {
  return (
    <details className="mt-5 rounded-lg border border-brand-border px-3 py-2 text-xs text-gray-600">
      <summary className="cursor-pointer font-semibold text-gray-700">How Singles Shop prices work</summary>
      <p className="mt-2">
        Every seller sells the same card at the same price, so nobody gets undercut. The price is the market price rounded
        down to the nearest step below, so it&apos;s always at or under market:
      </p>
      <p className="mt-2 flex flex-wrap gap-1">
        {SINGLES_PRICE_LADDER_CENTS.map((c) => (
          <span key={c} className="rounded bg-brand-surface px-1.5 py-0.5 font-semibold text-gray-800">
            {formatPrice(c)}
          </span>
        ))}
      </p>
      <p className="mt-2">
        Cards under {formatPrice(SINGLES_PRICE_LADDER_CENTS[0])} sell for {formatPrice(SINGLES_PRICE_LADDER_CENTS[0])}; cards
        over {formatPrice(SINGLES_PRICE_CAP_CENTS)} sell for {formatPrice(SINGLES_PRICE_CAP_CENTS)}. Prices update on their
        own when the market moves.
      </p>
    </details>
  );
}

// "Foil" (rainbow) / "Non-foil" (plain) badge — always shown, so two rows
// of the same card are never ambiguous.
export function FinishChip({ foil }: { foil: boolean }) {
  return foil ? (
    <span className="rounded bg-gradient-to-r from-amber-400 via-fuchsia-400 to-sky-400 px-1.5 py-0.5 text-[11px] font-bold text-white">
      Foil
    </span>
  ) : (
    <span className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-bold text-gray-600">Non-foil</span>
  );
}

function Stepper({ value, onChange, min }: { value: number; onChange: (n: number) => void; min: number }) {
  return (
    <div className="flex h-[38px] items-center rounded-full border border-gray-300">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="rounded-full p-2 text-gray-600 hover:bg-brand-surface disabled:opacity-30"
        aria-label="Decrease quantity"
      >
        <Minus size={13} />
      </button>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value.replace(/\D/g, ""), 10);
          onChange(Number.isFinite(n) ? Math.max(min, Math.min(9999, n)) : min);
        }}
        aria-label="Quantity"
        className="w-10 bg-transparent text-center text-sm font-bold text-gray-900 outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(9999, value + 1))}
        className="rounded-full p-2 text-gray-600 hover:bg-brand-surface"
        aria-label="Increase quantity"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
