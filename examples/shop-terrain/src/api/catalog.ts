// region api::catalog

import type { Deps, Sku, SkuId } from "../domain.ts";

/** @nindub query products at GET /products */
export async function products(deps: Deps): Promise<Sku[]> {
  // The Map orders by name with plain string comparison (code units), not
  // a locale collation. Survey caught the difference (see README).
  return deps.store.skus.all().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** @nindub query product at GET /products/{sku} */
export async function product(deps: Deps, sku: SkuId): Promise<Sku | undefined> {
  return deps.store.skus.get(sku);
}
