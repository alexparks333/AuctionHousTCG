import { cache } from "react";
import { apiFetch, apiUrl } from "./api";

// Current versions of the legal documents members accept. These must match
// apps/api internal/agreement's TermsVersion/SellerVersion — the API is what
// actually records and enforces them. Bump both (and the effective date)
// when a document changes materially; everyone is then asked to accept again.
export const TERMS_VERSION = "2026-10-15";
export const SELLER_AGREEMENT_VERSION = "2026-10-15";
export const TERMS_EFFECTIVE_DATE = "October 15, 2026";
export const SELLER_AGREEMENT_EFFECTIVE_DATE = "October 15, 2026";

export type AgreementDocument = "terms" | "seller";

export interface AgreementStatus {
  terms: boolean;
  seller: boolean;
  termsVersion: string;
  sellerVersion: string;
}

// Server-side read (Header, the Sell page). null if it can't be loaded — the
// API still enforces acceptance on every write either way.
export const getAgreementStatus = cache(async (accessToken: string): Promise<AgreementStatus | null> => {
  try {
    const res = await fetch(apiUrl("/me/agreements"), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
});

export async function acceptAgreement(document: AgreementDocument): Promise<AgreementStatus> {
  return apiFetch("/me/agreements", {
    method: "POST",
    body: JSON.stringify({ document }),
  });
}
