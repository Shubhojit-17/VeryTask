/**
 * Task API - Single task operations
 * 
 * GET /api/tasks/[id] - Get task by ID
 * PATCH /api/tasks/[id] - Update task status
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Get single task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: task, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH - Update task
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const {
      status,
      worker_address,
      is_boosted,
      ipfs_proof_hash,
      tx_hash,
      title,
      description,
      category,
      payment_status,
    } = body;

    // Build update object
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status) updates.status = status;
    if (worker_address !== undefined) {
      updates.worker_address = worker_address ? worker_address.toLowerCase() : null;
    }
    if (is_boosted !== undefined) {
      updates.is_boosted = is_boosted;
      if (is_boosted) updates.boosted_at = new Date().toISOString();
    }
    if (ipfs_proof_hash) updates.ipfs_proof_hash = ipfs_proof_hash;
    if (tx_hash) updates.tx_hash = tx_hash;
    if (title) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category) updates.category = category;
    if (payment_status) updates.payment_status = payment_status;
    if (status === "completed") updates.completed_at = new Date().toISOString();
    if (status === "in_progress") updates.payment_status = "escrowed";

    const { data: task, error } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase update error:", error);
      return NextResponse.json(
        { error: "Failed to update task" },
        { status: 500 }
      );
    }

    return NextResponse.json({ task, success: true });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE - Delete task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // First check if the task exists and is in "open" status
    const { data: existingTask, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Only allow deletion of tasks that are still "open" (no worker assigned)
    if (existingTask.status !== "open") {
      return NextResponse.json(
        { error: "Cannot delete task that is already in progress or completed" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Supabase delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete task" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "Task deleted successfully" });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
