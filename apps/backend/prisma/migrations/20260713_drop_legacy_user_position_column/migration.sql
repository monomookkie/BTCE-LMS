-- Drop legacy free-text position column — fully superseded by User.positionId
-- (FK -> Position). Backfill + verification completed in the prior migration
-- (20260713_add_position_table); safe to drop now.
ALTER TABLE `User` DROP COLUMN `position`;
