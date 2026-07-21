/**
 * classifyEscapeValveListError — map a failed `escape_valve_list` revert to a
 * user-facing i18n key.
 *
 * Why this exists (and isn't just `summarizeSimError`): the on-chain `#[msg]`
 * texts are terse, English, and for the behind-seller gate actively WRONG.
 * The listing gate reuses `RoundfiError::MemberNotBehind`, whose message —
 * "Member is current on contributions — default not applicable" — was written
 * for `settle_default`. So a seller who is BEHIND and can't list would see a
 * message claiming they're CURRENT: the exact opposite of the truth. This
 * classifier overrides the distilled message with the correct reason, keyed by
 * the Anchor error NAME that appears in the simulation logs
 * ("Error Code: MemberNotBehind. …").
 *
 * Pure + string-only so it unit-tests without a chain. Returns null for an
 * unrecognized revert → the caller falls back to the generic distilled reason
 * (summarizeSimError), never a blank.
 *
 * `errorText` is the caller's combined blob: the error `message` plus its
 * program `logs` joined — so a match works whether Anchor surfaced the named
 * error (logs present) or only a raw code slipped through.
 */
export function classifyEscapeValveListError(errorText: string): string | null {
  const s = errorText;
  // Behind on installments — the misleading MemberNotBehind reuse. This is the
  // one that bit a real seller, so it leads.
  if (/MemberNotBehind/i.test(s)) return "modal.sell.err.behind";
  if (/InvalidListingPrice/i.test(s)) return "modal.sell.err.price";
  if (/DefaultedMember/i.test(s)) return "modal.sell.err.defaulted";
  if (/PoolNotActive/i.test(s)) return "modal.sell.err.poolInactive";
  if (/CommitRevealRequired/i.test(s)) return "modal.sell.err.commitReveal";
  // `init` on an existing Listing PDA → the seat is already listed. Anchor
  // surfaces this as an allocate/"already in use" runtime failure.
  if (/already in use|AccountAlreadyInUse/i.test(s)) return "modal.sell.err.alreadyListed";
  return null;
}
