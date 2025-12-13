/**
 * Tasks API - Create/Get tasks
 * 
 * GET /api/tasks - List all tasks
 * POST /api/tasks - Create a new task
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - List tasks
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // No default - allow all statuses
    const category = searchParams.get("category");
    const poster = searchParams.get("poster");
    const worker = searchParams.get("worker");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase.from("tasks").select("*");

    if (status && status !== "all") query = query.eq("status", status);
    if (category && category !== "all") query = query.eq("category", category);
    if (poster) query = query.ilike("poster_address", poster);
    if (worker) query = query.ilike("worker_address", worker);

    const { data: tasks, error } = await query
      .order("is_boosted", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
    }

    // Calculate stats
    const completedCount = tasks?.filter(t => t.status === "completed").length || 0;

    return NextResponse.json({ tasks, count: tasks?.length || 0, completedCount });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST - Create a new task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      id,                    // On-chain task ID
      poster_address,        // Poster wallet address
      tx_hash,               // Transaction hash
      title,
      description,
      category,
      amount_wei,
      amount_display,
      latitude,
      longitude,
      address_line,
      city,
      deadline,
    } = body;

    // Validate required fields
    if (!poster_address || !title || !amount_wei) {
      return NextResponse.json(
        { error: "Missing required fields: poster_address, title, amount_wei" },
        { status: 400 }
      );
    }

    // Insert into Supabase
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        id,
        poster_address: poster_address.toLowerCase(),
        tx_hash,
        title,
        description,
        category,
        amount_wei,
        amount_display,
        latitude,
        longitude,
        // PostGIS point format
        location: latitude && longitude 
          ? `POINT(${longitude} ${latitude})`
          : null,
        address_line,
        city,
        deadline: deadline ? new Date(deadline * 1000).toISOString() : null,
        status: "open",
        is_boosted: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: "Failed to create task", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ task, success: true }, { status: 201 });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
