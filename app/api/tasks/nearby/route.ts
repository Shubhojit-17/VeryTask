/**
 * Tasks API - Nearby tasks with geolocation
 * 
 * GET /api/tasks/nearby?lat=XX&lng=XX&radius=5000&category=all
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const lat = parseFloat(searchParams.get("lat") || "0");
    const lng = parseFloat(searchParams.get("lng") || "0");
    const radius = parseInt(searchParams.get("radius") || "5000"); // meters
    const category = searchParams.get("category") || "all";
    const status = searchParams.get("status") || "open";

    if (!lat || !lng) {
      return NextResponse.json(
        { error: "lat and lng parameters are required" },
        { status: 400 }
      );
    }

    // Build query with PostGIS
    let query = supabase
      .from("tasks")
      .select("*")
      .eq("status", status);

    // Filter by category if specified
    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    // Execute query
    const { data: tasks, error } = await query
      .order("is_boosted", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Failed to fetch tasks" },
        { status: 500 }
      );
    }

    // Calculate distance for each task (client-side for now)
    // In production, use PostGIS ST_Distance for server-side filtering
    const tasksWithDistance = tasks?.map((task) => {
      const distance = calculateDistance(
        lat,
        lng,
        task.latitude,
        task.longitude
      );
      return {
        ...task,
        distance: Math.round(distance),
      };
    }).filter((task) => task.distance <= radius);

    // Sort by distance
    tasksWithDistance?.sort((a, b) => {
      // Boosted tasks first
      if (a.is_boosted && !b.is_boosted) return -1;
      if (!a.is_boosted && b.is_boosted) return 1;
      // Then by distance
      return a.distance - b.distance;
    });

    // Get completed count
    const { count: completedCount } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed");

    return NextResponse.json({
      tasks: tasksWithDistance,
      count: tasksWithDistance?.length || 0,
      completedCount: completedCount || 0,
      center: { lat, lng },
      radius,
    });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Haversine formula to calculate distance between two points
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
