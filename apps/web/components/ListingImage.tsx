import Image from "next/image";
import CardArt from "./CardArt";
import type { Game } from "@/lib/types";

// How wide a listing card's photo is on screen: half the screen on phones
// (2-up grid), a third on tablets, ~320px on desktop.
export const CARD_IMAGE_SIZES = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 320px";

// Real uploaded photo when one exists (CLAUDE.md §6.13), the gradient
// placeholder otherwise — never both, and never a fake photo.
//
// `sizes` tells next/image how wide the photo appears so it downloads a
// matching file (Next multiplies by the screen's pixel density, so it stays
// sharp on Retina). Without it, Next assumes full screen width and every
// small card pulled a ~3840px image — measured 278KB vs 59KB per card.
// Pass the real on-screen width for small thumbnails, e.g. sizes="48px".
export default function ListingImage({
  src,
  game,
  label,
  sizes = CARD_IMAGE_SIZES,
  loading,
}: {
  src?: string;
  game: Game;
  label: string;
  sizes?: string;
  // "eager" to fetch even while hidden (e.g. warming a popup's thumbnails).
  loading?: "eager" | "lazy";
}) {
  if (src) {
    // bg-white so a photo with alpha transparency (a card scan cut out
    // from its background, say) never shows whatever's behind this
    // component through it — a dark hero background turning a "see-through"
    // card into a rendering bug, not a stylistic choice.
    return (
      <div className="relative h-full w-full bg-white">
        <Image src={src} alt={label} fill sizes={sizes} loading={loading} className="object-cover" />
      </div>
    );
  }
  return (
    <div className="h-full w-full">
      <CardArt game={game} label={label} />
    </div>
  );
}
