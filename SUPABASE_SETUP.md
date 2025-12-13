# VeryTask - Supabase Setup Guide

## Step 1: Get Your Supabase API Keys

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `zcorlxfjqnaecshsuvpf`
3. Navigate to **Settings** → **API** (in the left sidebar)
4. Copy these values:

   - **Project URL**: `https://zcorlxfjqnaecshsuvpf.supabase.co`
   - **service_role (secret)**: The long JWT token starting with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

5. Update `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://zcorlxfjqnaecshsuvpf.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpjb3JseGZqcW5hZWNzaHN1dnBmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6...
   ```

## Step 2: Create the Tasks Table

1. Go to **SQL Editor** in Supabase Dashboard
2. Create a **New Query**
3. Copy and paste the contents of `supabase/migrations/001_create_tasks_table.sql`
4. Click **Run** to execute

This will:
- Enable PostGIS extension
- Create the `tasks` table
- Create spatial indexes for geo-queries
- Set up Row Level Security policies

## Step 3: Verify Setup

After running the migration, you can verify by:

1. Go to **Table Editor** in Supabase Dashboard
2. You should see the `tasks` table
3. The table should have columns: `id`, `title`, `description`, `location`, etc.

## Step 4: Test the API

1. Restart your dev server: `pnpm dev`
2. Open http://localhost:3000/api/debug
3. You should see:
   ```json
   {
     "connection": "✅ Connected",
     "taskCount": 0,
     "sampleTasks": []
   }
   ```

## Troubleshooting

### "relation 'tasks' does not exist"
- Run the SQL migration from Step 2

### "Invalid API key"
- Make sure you're using the `service_role` key (not `anon` key)
- The key should start with `eyJ...`

### Database password note
Your database password `Shubhojit(007)` is for direct Postgres connections, not for the REST API.
The REST API uses JWT tokens (service_role key).
