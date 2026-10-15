"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import StepBubbles from "./StepBubbles";
import CardSearch from "./sell-wizard/CardSearch";
import Step1Details, { OTHER_GRADER } from "./sell-wizard/Step1Details";
import Step2Photos from "./sell-wizard/Step2Photos";
import Step3Price from "./sell-wizard/Step3Price";
import { apiFetch } from "@/lib/api";
import type { ShippingPreset } from "@/lib/types";

export interface WizardData {
  title: string;
  game: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  condition: string;
  isGraded: boolean;
  // "PSA"/"BGS"/"CGC", or "Other" with the name typed into
  // gradingCompanyOther — the listing stores whichever name applies.
  gradingCompany: string;
  gradingCompanyOther: string;
  grade: string;
  certNumber: string;
  // Ordered list, up to 10 — position 0 is the cover photo (what
  // ListingImage/ListingCard/ListingRow all render as imageUrls[0]
  // everywhere on the site), the rest follow in whatever order the
  // seller drags them into in Step2Photos. Replaces the old fixed
  // photoFront/photoBack/photoCert trio — which side is which, and any
  // corner-detail photos, is a labeling step to design later; for now
  // this is just "the photos, in the order the seller wants them shown."
  photos: string[];
  format: "auction" | "fixed";
  price: string;
  startingBid: string;
  durationMinutes: number;
  // Optional "Buy It Now" price alongside an auction — CLAUDE.md's "Auction,
  // Buy It Now, or Both": auction alone is buyItNowEnabled=false; "both" is
  // buyItNowEnabled=true with a real buyItNowPrice. Only meaningful when
  // format === "auction" — fixed-price listings already are Buy It Now only,
  // their own `price` field is the BIN price.
  buyItNowEnabled: boolean;
  buyItNowPrice: string;
  // Mirrors apps/api/internal/listing.CreateInput's AllowOffers/
  // MinOfferCents (migration 0049) — only meaningful when a real Buy It
  // Now price exists (format === "fixed", or an auction with
  // buyItNowEnabled). minOffer empty string means "no minimum set."
  allowOffers: boolean;
  minOffer: string;
  // ShippingPreset is the seller's chosen shipping method (see
  // Step3Price's picker) — a floor, not a guarantee: the backend
  // re-derives the required mechanism from the actual final sale price at
  // order time and ships at whichever is stricter
  // (internal/shipping.UpgradePreset) — a low-starting-bid auction that
  // closes above $100 always ships via a tracked package regardless of
  // what's picked here. The three free_* presets are only valid on
  // fixed-price listings under $100 — Step3Price hides them otherwise.
  shippingPreset: ShippingPreset;
  // The seller's own voluntary "add signature confirmation" opt-in —
  // meaningful only alongside a package-mechanism preset (Ground
  // Advantage, or Free Shipping's Tracked Bubble Mailer/Tracked Package);
  // Pitney Bowes' envelope options can't support it at all. ORed
  // server-side with the $250 price-driven rule (apps/api/internal/
  // listing.Create), so checking this below $250 has the same real effect
  // as crossing the price bar.
  requestSignature: boolean;
}

export type UpdateField = <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;

const INITIAL: WizardData = {
  title: "",
  game: "Riftbound",
  setName: "",
  cardNumber: "",
  rarity: "",
  condition: "",
  isGraded: false,
  gradingCompany: "PSA",
  gradingCompanyOther: "",
  grade: "",
  certNumber: "",
  photos: [],
  format: "auction",
  price: "",
  startingBid: "",
  durationMinutes: 7 * 24 * 60,
  buyItNowEnabled: false,
  buyItNowPrice: "",
  allowOffers: false,
  minOffer: "",
  shippingPreset: "tracked_envelope",
  requestSignature: false,
};

function dollarsToCents(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

export default function SellWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update: UpdateField = (key, value) => setData((d) => ({ ...d, [key]: value }));

  async function handleSubmit() {
    if (
      data.format === "auction" &&
      data.buyItNowEnabled &&
      dollarsToCents(data.buyItNowPrice) <= dollarsToCents(data.startingBid)
    ) {
      setError("Buy It Now price must be higher than the starting bid.");
      return;
    }

    // Mirrors ShippingPresetPicker's own $100 envelope-disable rule — same
    // referencePriceCents shape (starting bid/Buy It Now price/fixed
    // price, whichever is highest), so a seller who picked Tracked
    // Envelope while the price was still low and then raised it past $100
    // (visually greyed out in the picker, but not auto-cleared the way the
    // $250 signature bar auto-corrects) gets a clear, specific error here
    // instead of a generic server rejection after submitting.
    const isLetterMechanism = data.shippingPreset === "free_envelope" || data.shippingPreset === "tracked_envelope";
    const referencePriceCents =
      data.format === "fixed"
        ? dollarsToCents(data.price)
        : Math.max(
            dollarsToCents(data.startingBid),
            data.buyItNowEnabled ? dollarsToCents(data.buyItNowPrice) : 0,
          );
    if (isLetterMechanism && referencePriceCents >= 10000) {
      setError("Anything above $100 can't use Tracked Envelope.");
      return;
    }

    // Mirrors apps/api/internal/listing.Create's allowOffers/minOfferCents
    // validation — same "checked here too, server re-checks regardless"
    // reasoning as the two blocks above.
    const binPriceCents =
      data.format === "fixed"
        ? dollarsToCents(data.price)
        : data.buyItNowEnabled
          ? dollarsToCents(data.buyItNowPrice)
          : 0;
    if (data.allowOffers && data.minOffer.trim() && dollarsToCents(data.minOffer) >= binPriceCents) {
      setError("Minimum offer must be less than the Buy It Now price.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const listing = await apiFetch("/listings", {
        method: "POST",
        body: JSON.stringify({
          title: data.title,
          game: data.game,
          set: data.setName,
          cardNumber: data.cardNumber,
          rarity: data.rarity,
          condition: data.condition,
          isGraded: data.isGraded,
          gradingCompany: !data.isGraded
            ? ""
            : data.gradingCompany === OTHER_GRADER
              ? data.gradingCompanyOther.trim()
              : data.gradingCompany,
          grade: data.isGraded ? data.grade : "",
          certNumber: data.isGraded ? data.certNumber : "",
          format: data.format,
          priceCents: data.format === "fixed" ? dollarsToCents(data.price) : 0,
          startingBidCents: data.format === "auction" ? dollarsToCents(data.startingBid) : 0,
          durationMinutes: data.format === "auction" ? data.durationMinutes : 0,
          buyItNowPriceCents:
            data.format === "auction" && data.buyItNowEnabled
              ? dollarsToCents(data.buyItNowPrice)
              : 0,
          allowOffers: data.allowOffers,
          minOfferCents: data.allowOffers && data.minOffer.trim() ? dollarsToCents(data.minOffer) : 0,
          shippingPreset: data.shippingPreset,
          requestSignature: data.requestSignature,
          imageUrls: data.photos,
        }),
      });
      router.push(`/listing/${listing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-3xl border border-brand-border bg-white px-5 py-4 shadow-xl shadow-brand-navy/5 sm:px-7 sm:py-5">
        <StepBubbles current={step} onStepClick={(target) => target < step && setStep(target)} />
      </div>

      <div className="flex flex-col gap-5">
        {step === 1 && <CardSearch update={update} />}

        <div
          key={step}
          className="animate-step-enter rounded-3xl border border-brand-border bg-white p-6 shadow-xl shadow-brand-navy/5 sm:p-9"
        >
          {step === 1 && (
            <Step1Details data={data} update={update} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <Step2Photos
              data={data}
              update={update}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Price
              data={data}
              update={update}
              onBack={() => setStep(2)}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={error}
            />
          )}
        </div>
      </div>
    </div>
  );
}
