-- ============================================================
-- VeryTask Supabase Database Setup
-- Enables PostGIS and creates the tasks table with geolocation
-- ============================================================

-- ============================================================
-- STEP 1: Enable PostGIS Extension
-- ============================================================
-- PostGIS adds support for geographic objects (points, polygons, etc.)
-- Required for efficient "find nearby" queries
-- 
-- NOTE: In Supabase, you may need to enable this via the Dashboard:
-- Database > Extensions > Search for "postgis" > Enable
-- 
-- If you have permissions, this SQL will work:
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify PostGIS is enabled
SELECT PostGIS_Version();

-- ============================================================
-- STEP 2: Create Tasks Table
-- ============================================================
-- This table mirrors on-chain tasks but adds off-chain metadata
-- for efficient querying (especially geolocation)

CREATE TABLE IF NOT EXISTS tasks (
    -- Primary identifier (matches on-chain task ID)
    id BIGINT PRIMARY KEY,
    
    -- On-chain references
    poster_address TEXT NOT NULL,          -- Ethereum address of task poster
    worker_address TEXT,                    -- Ethereum address of worker (null if open)
    tx_hash TEXT,                           -- Transaction hash of task creation
    
    -- Task details (off-chain for faster access)
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,                          -- e.g., 'delivery', 'cleaning', 'errands'
    
    -- Payment info (denormalized from chain for UI)
    amount_wei TEXT NOT NULL,               -- Amount in wei (stored as TEXT for precision)
    amount_display DECIMAL(18, 8),          -- Human-readable amount (e.g., 10.5 VERY)
    token_symbol TEXT DEFAULT 'VERY',       -- Payment token symbol
    
    -- Geolocation (THE KEY FEATURE)
    -- GEOGRAPHY type uses lat/long and accounts for Earth's curvature
    -- More accurate than GEOMETRY for real-world distances
    location GEOGRAPHY(POINT, 4326),        -- 4326 = WGS84 (GPS coordinate system)
    
    -- Optional: Store raw coords for easy access
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Address (human-readable location)
    address_line TEXT,                      -- "123 Main St"
    city TEXT,
    postal_code TEXT,
    country_code TEXT DEFAULT 'US',
    
    -- Task status (mirrors on-chain but faster to query)
    status TEXT NOT NULL DEFAULT 'open' 
        CHECK (status IN ('open', 'in_progress', 'submitted', 'completed', 'disputed', 'cancelled')),
    
    -- Boost status
    is_boosted BOOLEAN DEFAULT FALSE,
    boosted_at TIMESTAMPTZ,
    
    -- IPFS proof
    ipfs_proof_hash TEXT,                   -- CID of work proof
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deadline TIMESTAMPTZ,                   -- Optional deadline
    completed_at TIMESTAMPTZ
);

-- ============================================================
-- STEP 3: Create Spatial Index
-- ============================================================
-- CRITICAL: Without this index, geo-queries are O(n) table scans
-- With the index, queries are O(log n)

CREATE INDEX IF NOT EXISTS idx_tasks_location 
    ON tasks USING GIST (location);

-- Additional indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_poster ON tasks (poster_address);
CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks (worker_address);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks (category);
CREATE INDEX IF NOT EXISTS idx_tasks_is_boosted ON tasks (is_boosted) WHERE is_boosted = TRUE;

-- Composite index for common filter + geo queries
CREATE INDEX IF NOT EXISTS idx_tasks_status_location 
    ON tasks USING GIST (location) 
    WHERE status = 'open';

-- ============================================================
-- STEP 4: Create RPC Function for Nearby Tasks
-- ============================================================
-- This function is called from Next.js via Supabase RPC
-- Returns tasks within a radius, sorted by distance

CREATE OR REPLACE FUNCTION get_nearby_tasks(
    user_lat DOUBLE PRECISION,
    user_long DOUBLE PRECISION,
    radius_meters INTEGER DEFAULT 2000,
    task_status TEXT DEFAULT 'open',
    limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
    id BIGINT,
    poster_address TEXT,
    worker_address TEXT,
    title TEXT,
    description TEXT,
    category TEXT,
    amount_display DECIMAL,
    token_symbol TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    address_line TEXT,
    city TEXT,
    status TEXT,
    is_boosted BOOLEAN,
    created_at TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    distance_meters DOUBLE PRECISION
) 
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs with definer's permissions
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.poster_address,
        t.worker_address,
        t.title,
        t.description,
        t.category,
        t.amount_display,
        t.token_symbol,
        t.latitude,
        t.longitude,
        t.address_line,
        t.city,
        t.status,
        t.is_boosted,
        t.created_at,
        t.deadline,
        -- Calculate distance from user to task in meters
        ST_Distance(
            t.location,
            ST_SetSRID(ST_MakePoint(user_long, user_lat), 4326)::GEOGRAPHY
        ) AS distance_meters
    FROM tasks t
    WHERE 
        -- Filter by status if provided
        (task_status IS NULL OR t.status = task_status)
        -- Filter by radius using spatial index
        AND ST_DWithin(
            t.location,
            ST_SetSRID(ST_MakePoint(user_long, user_lat), 4326)::GEOGRAPHY,
            radius_meters
        )
    ORDER BY 
        -- Boosted tasks first, then by distance
        t.is_boosted DESC,
        distance_meters ASC
    LIMIT limit_count;
END;
$$;

-- ============================================================
-- STEP 5: Create Helper Functions
-- ============================================================

-- Function to update task location from lat/long
CREATE OR REPLACE FUNCTION update_task_location()
RETURNS TRIGGER AS $$
BEGIN
    -- Automatically create GEOGRAPHY point from lat/long
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::GEOGRAPHY;
    END IF;
    
    -- Update timestamp
    NEW.updated_at := NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update location and timestamp
DROP TRIGGER IF EXISTS trigger_update_task_location ON tasks;
CREATE TRIGGER trigger_update_task_location
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_task_location();

-- ============================================================
-- STEP 6: Row Level Security (RLS)
-- ============================================================
-- IMPORTANT: Enable RLS for production security

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read open tasks
CREATE POLICY "Anyone can read open tasks" ON tasks
    FOR SELECT
    USING (status IN ('open', 'in_progress'));

-- Policy: Authenticated users can insert tasks
-- (In production, verify the poster_address matches the JWT)
CREATE POLICY "Authenticated users can create tasks" ON tasks
    FOR INSERT
    WITH CHECK (true);  -- Add proper auth check in production

-- Policy: Only poster or worker can update their task
CREATE POLICY "Task participants can update" ON tasks
    FOR UPDATE
    USING (true);  -- Add proper auth check in production

-- ============================================================
-- STEP 7: Sample Data for Testing
-- ============================================================

-- Insert sample tasks (uncomment to test)
/*
INSERT INTO tasks (id, poster_address, title, description, category, amount_wei, amount_display, latitude, longitude, address_line, city, status) VALUES
(1, '0x1234...', 'Walk my dog', 'Need someone to walk my golden retriever for 30 mins', 'pet_care', '10000000000000000000', 10.0, 40.7128, -74.0060, '123 Broadway', 'New York', 'open'),
(2, '0x5678...', 'Deliver groceries', 'Pick up groceries from Whole Foods', 'delivery', '15000000000000000000', 15.0, 40.7580, -73.9855, '456 5th Ave', 'New York', 'open'),
(3, '0x9abc...', 'Mow my lawn', 'Front and back yard, riding mower provided', 'yard_work', '25000000000000000000', 25.0, 40.7282, -73.7949, '789 Queens Blvd', 'Queens', 'open');
*/

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check table structure
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks';

-- Test the nearby function (Times Square coordinates)
-- SELECT * FROM get_nearby_tasks(40.7580, -73.9855, 5000, 'open', 10);
