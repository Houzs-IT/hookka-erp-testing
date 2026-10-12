// Rights a wildcard ("delivery-orders:*", "*:*") does NOT grant: the account
// needs the exact tick. ADMIN / SUPER_ADMIN still pass (BUG-34 credit override).
export const EXPLICIT_ONLY_RIGHTS: ReadonlySet<string> = new Set(["delivery-orders:credit-override"]);
