/**
 * Debug API - Check Supabase connection
 * GET /api/debug
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const debug: Record<string, any> = {
    timestamp: new Date().toISOString(),
    env: {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ Set" : "❌ Missing",
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing",
    },
  };

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      debug.error = "Missing Supabase credentials";
      return NextResponse.json(debug, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test connection by querying tasks table
    const { data, error, count } = await supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .limit(5);

    if (error) {
      debug.supabaseError = error.message;
      debug.errorCode = error.code;
      debug.errorHint = error.hint;
      
      // Common error: table doesn't exist
      if (error.code === "42P01") {
        debug.fix = "Run the SQL migration in Supabase Dashboard: supabase/migrations/001_create_tasks_table.sql";
      }
    } else {
      debug.connection = "✅ Connected";
      debug.taskCount = count;
      debug.sampleTasks = data;
    }

    return NextResponse.json(debug);

  } catch (err: any) {
    debug.exception = err.message;
    return NextResponse.json(debug, { status: 500 });
  }
}
