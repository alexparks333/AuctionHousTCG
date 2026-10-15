import { getCatalogSets, getMySingles } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import { ENABLED_GAMES } from "@/lib/types";
import SinglesShopStudio from "@/components/singles/SinglesShopStudio";

// Games TCG Haven's catalog covers (apps/api/internal/cardcatalog/games.go)
// — the Singles Shop can only stock catalog cards.
const CATALOG_GAMES = ["Pokémon", "Disney Lorcana", "Riftbound"];

export default async function SinglesShopPage() {
  // app/account/layout.tsx already gates this route on a verified session;
  // the local cookie read is only used to fetch the caller's own stock.
  const local = await getLocalSession();
  const games = ENABLED_GAMES.filter((g) => CATALOG_GAMES.includes(g));
  const initialGame = games[0] ?? "Riftbound";

  const [singles, groups] = await Promise.all([
    local ? getMySingles(local.accessToken).catch(() => []) : Promise.resolve([]),
    getCatalogSets(initialGame),
  ]);

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Singles Shop</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-500">
        Sell singles by quantity alongside your listings. Cards in full color are in your shop; greyed-out cards
        aren&apos;t. Click any card to stock it. Prices are set automatically from the market price, the same in every
        shop. Buyers can add your singles to any order from you at checkout, and it all ships together.
      </p>
      <SinglesShopStudio games={games} initialGame={initialGame} initialGroups={groups} initialSingles={singles} />
    </div>
  );
}
