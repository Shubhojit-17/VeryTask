/**
 * useVeryTask Hook
 * 
 * Manages task operations with:
 * - Supabase for off-chain data (metadata, location)
 * - Smart contracts for on-chain actions (escrow, payments)
 */

import { useState, useCallback } from "react";
import { Contract, BrowserProvider, parseEther, formatEther } from "ethers";

// ============================================================
// Types
// ============================================================

export interface Task {
  id: number;
  title: string;
  description: string;
  category: string;
  amount_display: number;
  amount_wei: string;
  poster_address: string;
  worker_address: string | null;
  status: "open" | "in_progress" | "submitted" | "completed" | "disputed";
  is_boosted: boolean;
  latitude: number;
  longitude: number;
  distance?: number;
  created_at: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  category: string;
  amount: string; // in VERY
  latitude: number;
  longitude: number;
  address_line?: string;
  city?: string;
  deadline?: number; // Unix timestamp
}

// ============================================================
// Contract ABIs
// ============================================================

const TASK_MARKETPLACE_ABI = [
  "function createTask(uint256 deadline) external payable returns (uint256)",
  "function assignWorker(uint256 taskId) external",
  "function submitWork(uint256 taskId, string calldata ipfsProof) external",
  "function approveAndPay(uint256 taskId) external",
  "function raiseDispute(uint256 taskId) external",
  "function boostTask(uint256 taskId) external",
  "function taskCounter() external view returns (uint256)",
  "event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 amount, uint256 deadline)",
];

const MOCK_AD_VERY_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function faucet() external",
];

// ============================================================
// Hook
// ============================================================

export function useVeryTask(
  provider: BrowserProvider | null,
  contractAddresses: {
    taskMarketplace: string;
    mockAdVery: string;
  }
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  // ========================================
  // Fetch Tasks (from Supabase)
  // ========================================

  const fetchNearbyTasks = useCallback(async (
    lat: number,
    lng: number,
    radius: number = 5000,
    category: string = "all"
  ) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        lat: lat.toString(),
        lng: lng.toString(),
        radius: radius.toString(),
        category,
      });

      const res = await fetch(`/api/tasks/nearby?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch tasks");
      }

      setTasks(data.tasks || []);
      return data.tasks;

    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // ========================================
  // Create Task (On-chain + Off-chain)
  // ========================================

  const createTask = useCallback(async (input: CreateTaskInput) => {
    if (!provider) {
      throw new Error("Wallet not connected");
    }

    setLoading(true);
    setError(null);

    try {
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // 1. Create task on-chain
      const marketplace = new Contract(
        contractAddresses.taskMarketplace,
        TASK_MARKETPLACE_ABI,
        signer
      );

      const deadline = input.deadline || 0;
      const amountWei = parseEther(input.amount);

      console.log("[useVeryTask] Creating on-chain task...");
      const tx = await marketplace.createTask(deadline, { value: amountWei });
      const receipt = await tx.wait();

      // Get task ID from event
      const taskCreatedEvent = receipt.logs.find((log: any) => {
        try {
          const parsed = marketplace.interface.parseLog(log);
          return parsed?.name === "TaskCreated";
        } catch {
          return false;
        }
      });

      let taskId = 0;
      if (taskCreatedEvent) {
        const parsed = marketplace.interface.parseLog(taskCreatedEvent);
        taskId = Number(parsed?.args?.taskId || 0);
      } else {
        // Fallback: get task counter
        taskId = Number(await marketplace.taskCounter());
      }

      console.log("[useVeryTask] On-chain task created:", taskId);

      // 2. Store metadata in Supabase
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          poster_address: signerAddress,
          tx_hash: receipt.hash,
          title: input.title,
          description: input.description,
          category: input.category,
          amount_wei: amountWei.toString(),
          amount_display: parseFloat(input.amount),
          latitude: input.latitude,
          longitude: input.longitude,
          address_line: input.address_line,
          city: input.city,
          deadline: input.deadline,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("[useVeryTask] Supabase error:", data);
        // Task is already on-chain, so we return success anyway
      }

      console.log("[useVeryTask] Task created successfully:", taskId);
      return { taskId, txHash: receipt.hash };

    } catch (err: any) {
      console.error("[useVeryTask] Create task error:", err);
      setError(err.message || "Failed to create task");
      throw err;
    } finally {
      setLoading(false);
    }
  }, [provider, contractAddresses.taskMarketplace]);

  // ========================================
  // Accept Task (Assign Worker)
  // ========================================

  const acceptTask = useCallback(async (taskId: number) => {
    if (!provider) throw new Error("Wallet not connected");

    setLoading(true);
    setError(null);

    try {
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      const marketplace = new Contract(
        contractAddresses.taskMarketplace,
        TASK_MARKETPLACE_ABI,
        signer
      );

      console.log("[useVeryTask] Accepting task:", taskId);
      const tx = await marketplace.assignWorker(taskId);
      await tx.wait();

      // Update Supabase
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "in_progress",
          worker_address: signerAddress,
        }),
      });

      console.log("[useVeryTask] Task accepted:", taskId);
      return true;

    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [provider, contractAddresses.taskMarketplace]);

  // ========================================
  // Boost Task
  // ========================================

  const boostTask = useCallback(async (taskId: number, boostCost: string = "100") => {
    if (!provider) throw new Error("Wallet not connected");

    setLoading(true);
    setError(null);

    try {
      const signer = await provider.getSigner();

      // 1. Approve AD VERY spend
      const adVery = new Contract(
        contractAddresses.mockAdVery,
        MOCK_AD_VERY_ABI,
        signer
      );

      const boostAmount = parseEther(boostCost);
      console.log("[useVeryTask] Approving AD VERY...");
      const approveTx = await adVery.approve(
        contractAddresses.taskMarketplace,
        boostAmount
      );
      await approveTx.wait();

      // 2. Boost task
      const marketplace = new Contract(
        contractAddresses.taskMarketplace,
        TASK_MARKETPLACE_ABI,
        signer
      );

      console.log("[useVeryTask] Boosting task:", taskId);
      const boostTx = await marketplace.boostTask(taskId);
      await boostTx.wait();

      // 3. Update Supabase
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_boosted: true }),
      });

      console.log("[useVeryTask] Task boosted:", taskId);
      return true;

    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [provider, contractAddresses]);

  // ========================================
  // Claim Faucet
  // ========================================

  const claimFaucet = useCallback(async () => {
    if (!provider) throw new Error("Wallet not connected");

    setLoading(true);
    try {
      const signer = await provider.getSigner();
      const adVery = new Contract(
        contractAddresses.mockAdVery,
        MOCK_AD_VERY_ABI,
        signer
      );

      const tx = await adVery.faucet();
      await tx.wait();

      console.log("[useVeryTask] Faucet claimed!");
      return true;

    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [provider, contractAddresses.mockAdVery]);

  return {
    // State
    tasks,
    loading,
    error,
    // Actions
    fetchNearbyTasks,
    createTask,
    acceptTask,
    boostTask,
    claimFaucet,
  };
}
