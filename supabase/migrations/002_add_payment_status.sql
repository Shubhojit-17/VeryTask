-- ============================================================
-- Add payment_status column to tasks table
-- ============================================================

-- Add payment status column to track escrow state
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'escrowed'
    CHECK (payment_status IN ('pending', 'escrowed', 'released', 'refunded'));

-- Add comment
COMMENT ON COLUMN tasks.payment_status IS 'Payment status: pending (not yet deposited), escrowed (in contract), released (paid to worker), refunded (returned to poster)';

-- ============================================================
-- Update existing tasks
-- ============================================================

-- Set payment_status based on current status
UPDATE tasks 
SET payment_status = 
    CASE 
        WHEN status = 'completed' THEN 'released'
        WHEN status = 'cancelled' THEN 'refunded'
        ELSE 'escrowed'
    END
WHERE payment_status IS NULL;
