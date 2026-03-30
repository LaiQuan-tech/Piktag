-- Add display_mode to biolinks: 'icon' (compact circle) or 'card' (full-width Linktree-style)
ALTER TABLE piktag_biolinks ADD COLUMN IF NOT EXISTS display_mode text DEFAULT 'card';
