-- #12 withdrawal TOCTOU: the single-in-flight invariant is enforced by the database, not only by the service
-- (separate migration because the new enum value cannot be referenced in the transaction that created it).
CREATE UNIQUE INDEX "withdrawals_one_in_flight_per_user"
  ON "withdrawals" ("user_id")
  WHERE "status" IN ('pending', 'processing', 'flagged_for_review', 'needs_manual_review');
