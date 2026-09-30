-- OPTIONAL. Run only after final migration evidence has been exported and accepted.
-- Do NOT drop the v3.2.3 provenance or audit tables; they are part of the durable migration record.
DROP TABLE IF EXISTS migration_v323_verification_snapshot;
DROP TABLE IF EXISTS migration_v323_protected_baseline;
