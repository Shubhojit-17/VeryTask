"use client";

/**
 * VeryTask Dashboard - Main Application Page
 * 
 * Industrial "Fintech" style UI with:
 * - Glassmorphism cards
 * - Very Network purple accents
 * - Dark theme optimized for professionals
 * 
 * Layout:
 * - Sidebar: Navigation + Quick Actions
 * - Header: Search + Wallet Connection
 * - Main: Map View + Task List
 * 
 * Data Sources:
 * - Supabase: Task metadata (title, description, location)
 * - Smart Contracts: On-chain escrow (payments, disputes)
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import WepinAuth, { VERY_CHAIN_CONFIG } from "../components/WepinAuth";
import { BrowserProvider, Contract, parseEther, formatEther } from "ethers";

// ============================================================
// Types
// ============================================================

interface Task {
  id: number;
  title: string;
  description: string;
  amount: string;
  category: string;
  distance: number;
  status: "open" | "in_progress" | "completed" | "submitted" | "disputed";
  paymentStatus: "escrowed" | "released" | "refunded" | "pending";
  isBoosted: boolean;
  poster: string;
  posterAddress: string; // Full address for comparison
  workerAddress?: string; // Worker who accepted the task
  worker?: string; // Display format
  createdAt: string;
  completedAt?: string;
  txHash?: string;
}

interface CreateTaskForm {
  title: string;
  description: string;
  amount: string;
  category: string;
}

interface UserLocation {
  latitude: number;
  longitude: number;
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
  "function getTask(uint256 taskId) external view returns (tuple(uint256 id, address poster, address worker, uint256 amount, uint8 status, bool isDisputed, string ipfsProof, uint256 createdAt, uint256 deadline, bool isBoosted))",
  "function taskCounter() external view returns (uint256)",
  "event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 amount, uint256 deadline)",
  "event TaskBoosted(uint256 indexed taskId, address indexed booster, uint256 adVeryBurned)",
];

const MOCK_AD_VERY_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function faucet() external",
  "function canClaimFaucet(address user) external view returns (bool)",
];

// ============================================================
// Contract Addresses (Replace after deployment!)
// ============================================================

// TODO: Replace these with your deployed contract addresses
const CONTRACT_ADDRESSES = {
  taskMarketplace: process.env.NEXT_PUBLIC_TASK_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000",
  mockAdVery: process.env.NEXT_PUBLIC_MOCK_AD_VERY_ADDRESS || "0x0000000000000000000000000000000000000000",
  userReputation: process.env.NEXT_PUBLIC_USER_REPUTATION_ADDRESS || "0x0000000000000000000000000000000000000000",
};

// ============================================================
// Task Categories
// ============================================================

const CATEGORIES = [
  { id: "all", label: "All Tasks", icon: "🏠" },
  { id: "delivery", label: "Delivery", icon: "📦" },
  { id: "pet_care", label: "Pet Care", icon: "🐕" },
  { id: "yard_work", label: "Yard Work", icon: "🌿" },
  { id: "handyman", label: "Handyman", icon: "🔧" },
  { id: "cleaning", label: "Cleaning", icon: "🧹" },
  { id: "errands", label: "Errands", icon: "🏃" },
];

// Default location (New York City) - used when geolocation fails
const DEFAULT_LOCATION: UserLocation = {
  latitude: 40.7128,
  longitude: -74.0060,
};

// ============================================================
// Main Dashboard Component
// ============================================================

export default function Dashboard() {
  // ========================================
  // State
  // ========================================
  
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [myCreatedTasks, setMyCreatedTasks] = useState<Task[]>([]);
  const [myWorkHistory, setMyWorkHistory] = useState<Task[]>([]);
  const [myPendingTasks, setMyPendingTasks] = useState<Task[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [activeTaskView, setActiveTaskView] = useState<"nearby" | "history" | "pending">("nearby");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isBoostModalOpen, setIsBoostModalOpen] = useState(false);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [adVeryBalance, setAdVeryBalance] = useState<string>("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingTasks, setIsFetchingTasks] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  // Geolocation state
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [searchRadius, setSearchRadius] = useState<number>(5000); // meters
  
  // Track if initial fetch has happened
  const initialFetchDone = useRef(false);
  
  // Completed tasks count (fetched from API)
  const [completedCount, setCompletedCount] = useState<number>(0);
  
  // Task ID counter for new tasks
  const nextTaskId = useRef(1);

  // Form state
  const [createForm, setCreateForm] = useState<CreateTaskForm>({
    title: "",
    description: "",
    amount: "",
    category: "delivery",
  });

  const [editForm, setEditForm] = useState<CreateTaskForm>({
    title: "",
    description: "",
    amount: "",
    category: "delivery",
  });

  // ========================================
  // Wallet Connection Handler
  // ========================================
  
  const handleConnect = useCallback(async (address: string, browserProvider: BrowserProvider) => {
    setUserAddress(address);
    setProvider(browserProvider);
    
    // Store in localStorage for My Tasks pages
    localStorage.setItem("verytask_address", address);
    
    // Fetch AD VERY balance from blockchain
    try {
      if (CONTRACT_ADDRESSES.mockAdVery !== "0x0000000000000000000000000000000000000000") {
        const contract = new Contract(CONTRACT_ADDRESSES.mockAdVery, MOCK_AD_VERY_ABI, browserProvider);
        const balance = await contract.balanceOf(address);
        setAdVeryBalance(formatEther(balance));
      }
    } catch (error) {
      console.error("Failed to fetch AD VERY balance:", error);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    setUserAddress(null);
    setProvider(null);
    setAdVeryBalance("0");
    localStorage.removeItem("verytask_address");
    
    // Reset all task states
    setMyCreatedTasks([]);
    setMyWorkHistory([]);
    setMyPendingTasks([]);
    setActiveTaskView("nearby");
  }, []);

  // ========================================
  // Restore wallet from localStorage on page load
  // ========================================
  
  useEffect(() => {
    const storedAddress = localStorage.getItem("verytask_address");
    if (storedAddress && !userAddress) {
      setUserAddress(storedAddress);
      console.log("[VeryTask] Restored wallet from localStorage:", storedAddress);
    }
  }, [userAddress]);

  // ========================================
  // Get User Location (Geolocation API)
  // ========================================
  
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation not supported by browser");
      setUserLocation(DEFAULT_LOCATION);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationError(null);
        console.log("[VeryTask] Got user location:", position.coords);
      },
      (error) => {
        console.warn("[VeryTask] Geolocation error:", error.message);
        setLocationError("Location access denied. Using default location.");
        setUserLocation(DEFAULT_LOCATION);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000, // Cache for 1 minute
      }
    );
  }, []);

  // ========================================
  // Fetch Tasks from Supabase
  // ========================================
  
  const fetchTasks = useCallback(async (category?: string) => {
    if (!userLocation) return;

    setIsFetchingTasks(true);

    try {
      const params = new URLSearchParams({
        lat: userLocation.latitude.toString(),
        lng: userLocation.longitude.toString(),
        radius: searchRadius.toString(),
        category: category || selectedCategory,
      });

      const res = await fetch(`/api/tasks/nearby?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch tasks");
      }

      // Map API response to local Task interface
      const mappedTasks: Task[] = (data.tasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        amount: t.amount_display?.toString() || "0",
        category: t.category,
        distance: Math.round(t.distance || 0),
        status: t.status,
        paymentStatus: t.payment_status || (t.status === "completed" ? "released" : "escrowed"),
        isBoosted: t.is_boosted || false,
        poster: t.poster_address ? `${t.poster_address.slice(0, 6)}...${t.poster_address.slice(-4)}` : "Unknown",
        posterAddress: t.poster_address?.toLowerCase() || "",
        workerAddress: t.worker_address?.toLowerCase() || "",
        worker: t.worker_address ? `${t.worker_address.slice(0, 6)}...${t.worker_address.slice(-4)}` : undefined,
        createdAt: t.created_at,
        completedAt: t.completed_at,
        txHash: t.tx_hash,
      }));

      setTasks(mappedTasks);
      console.log("[VeryTask] Fetched", mappedTasks.length, "tasks from Supabase");
      
      // Also fetch completed count
      if (data.completedCount !== undefined) {
        setCompletedCount(data.completedCount);
      }

    } catch (error: any) {
      console.error("[VeryTask] Fetch tasks error:", error);
      // Show error notification
      showNotification("error", "Failed to load tasks: " + error.message);
    } finally {
      setIsFetchingTasks(false);
      initialFetchDone.current = true;
    }
  }, [userLocation, searchRadius, selectedCategory]);

  // ========================================
  // Fetch User's Created Tasks
  // ========================================
  
  const fetchMyCreatedTasks = useCallback(async () => {
    if (!userAddress) return;
    
    try {
      const res = await fetch(`/api/tasks?poster=${userAddress}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      
      const mappedTasks: Task[] = (data.tasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        amount: t.amount_display?.toString() || "0",
        category: t.category,
        distance: 0,
        status: t.status,
        paymentStatus: t.payment_status || (t.status === "completed" ? "released" : "escrowed"),
        isBoosted: t.is_boosted || false,
        poster: t.poster_address ? `${t.poster_address.slice(0, 6)}...${t.poster_address.slice(-4)}` : "Unknown",
        posterAddress: t.poster_address?.toLowerCase() || "",
        workerAddress: t.worker_address?.toLowerCase() || "",
        worker: t.worker_address ? `${t.worker_address.slice(0, 6)}...${t.worker_address.slice(-4)}` : undefined,
        createdAt: t.created_at,
        completedAt: t.completed_at,
        txHash: t.tx_hash,
      }));
      
      setMyCreatedTasks(mappedTasks);
    } catch (error) {
      console.error("[VeryTask] Failed to fetch created tasks:", error);
    }
  }, [userAddress]);

  // ========================================
  // Fetch User's Work History
  // ========================================
  
  const fetchMyWorkHistory = useCallback(async () => {
    if (!userAddress) return;
    
    try {
      const res = await fetch(`/api/tasks?worker=${userAddress}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      
      const mappedTasks: Task[] = (data.tasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        amount: t.amount_display?.toString() || "0",
        category: t.category,
        distance: 0,
        status: t.status,
        paymentStatus: t.payment_status || (t.status === "completed" ? "released" : "escrowed"),
        isBoosted: t.is_boosted || false,
        poster: t.poster_address ? `${t.poster_address.slice(0, 6)}...${t.poster_address.slice(-4)}` : "Unknown",
        posterAddress: t.poster_address?.toLowerCase() || "",
        workerAddress: t.worker_address?.toLowerCase() || "",
        worker: t.worker_address ? `${t.worker_address.slice(0, 6)}...${t.worker_address.slice(-4)}` : undefined,
        createdAt: t.created_at,
        completedAt: t.completed_at,
        txHash: t.tx_hash,
      }));
      
      setMyWorkHistory(mappedTasks);
    } catch (error) {
      console.error("[VeryTask] Failed to fetch work history:", error);
    }
  }, [userAddress]);

  // ========================================
  // Fetch User's Pending Tasks (In Progress)
  // ========================================
  
  const fetchMyPendingTasks = useCallback(async () => {
    if (!userAddress) return;
    
    try {
      const res = await fetch(`/api/tasks?worker=${userAddress}&status=pending`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);
      
      const mappedTasks: Task[] = (data.tasks || []).filter((t: any) => 
        t.status === "in_progress" || t.status === "submitted"
      ).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description || "",
        amount: t.amount_display?.toString() || "0",
        category: t.category,
        distance: 0,
        status: t.status,
        paymentStatus: t.payment_status || "escrowed",
        isBoosted: t.is_boosted || false,
        poster: t.poster_address ? `${t.poster_address.slice(0, 6)}...${t.poster_address.slice(-4)}` : "Unknown",
        posterAddress: t.poster_address?.toLowerCase() || "",
        workerAddress: t.worker_address?.toLowerCase() || "",
        worker: t.worker_address ? `${t.worker_address.slice(0, 6)}...${t.worker_address.slice(-4)}` : undefined,
        createdAt: t.created_at,
        completedAt: t.completed_at,
        txHash: t.tx_hash,
      }));
      
      setMyPendingTasks(mappedTasks);
    } catch (error) {
      console.error("[VeryTask] Failed to fetch pending tasks:", error);
    }
  }, [userAddress]);

  // Fetch user's tasks when address changes or tab changes
  useEffect(() => {
    if (userAddress) {
      // Fetch all task types when user connects (or reconnects)
      fetchMyCreatedTasks();
      fetchMyWorkHistory();
      fetchMyPendingTasks();
    }
  }, [userAddress, fetchMyCreatedTasks, fetchMyWorkHistory, fetchMyPendingTasks]);

  // Fetch tasks when location or category changes
  useEffect(() => {
    if (userLocation) {
      fetchTasks();
    }
  }, [userLocation, selectedCategory, fetchTasks]);

  // ========================================
  // Show Notification
  // ========================================
  
  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // ========================================
  // Create Task Handler
  // ========================================
  
  const handleCreateTask = async () => {
    if (!userAddress) {
      showNotification("error", "Please connect your wallet first");
      return;
    }

    if (!createForm.title || !createForm.amount) {
      showNotification("error", "Please fill in all required fields");
      return;
    }

    if (!userLocation) {
      showNotification("error", "Location not available. Please allow location access.");
      return;
    }

    setIsLoading(true);

    try {
      const signer = await provider!.getSigner();
      const contract = new Contract(CONTRACT_ADDRESSES.taskMarketplace, TASK_MARKETPLACE_ABI, signer);

      // Create task with payment (deadline = 0 means no deadline)
      const tx = await contract.createTask(0, {
        value: parseEther(createForm.amount),
      });

      showNotification("success", "Transaction submitted! Waiting for confirmation...");
      
      const receipt = await tx.wait();

      // Get task ID from event
      let taskId = Date.now(); // fallback
      try {
        const taskCreatedEvent = receipt.logs.find((log: any) => {
          try {
            const parsed = contract.interface.parseLog(log);
            return parsed?.name === "TaskCreated";
          } catch {
            return false;
          }
        });
        if (taskCreatedEvent) {
          const parsed = contract.interface.parseLog(taskCreatedEvent);
          taskId = Number(parsed?.args?.taskId || taskId);
        }
      } catch (e) {
        console.warn("Could not parse TaskCreated event:", e);
      }

      // Save task metadata to Supabase
      const supabaseRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskId,
          poster_address: userAddress,
          tx_hash: receipt.hash,
          title: createForm.title,
          description: createForm.description,
          category: createForm.category,
          amount_wei: parseEther(createForm.amount).toString(),
          amount_display: parseFloat(createForm.amount),
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        }),
      });

      if (!supabaseRes.ok) {
        console.error("Supabase save failed:", await supabaseRes.json());
        // Task is on-chain, so still show success
      }

      showNotification("success", "Task created successfully!");
      setIsCreateModalOpen(false);
      setCreateForm({ title: "", description: "", amount: "", category: "delivery" });

      // Refresh tasks from API
      await fetchTasks();

    } catch (error: any) {
      console.error("Create task failed:", error);
      
      if (error.code === "ACTION_REJECTED") {
        showNotification("error", "Transaction rejected by user");
      } else if (error.message?.includes("insufficient funds")) {
        showNotification("error", "Insufficient VERY balance");
      } else {
        showNotification("error", "Failed to create task. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Boost Task Handler
  // ========================================
  
  const handleBoostTask = async () => {
    if (!userAddress || !selectedTask) {
      showNotification("error", "Please connect your wallet and select a task");
      return;
    }

    setIsLoading(true);

    try {
      const signer = await provider!.getSigner();
      
      // First approve AD VERY tokens
      const adVeryContract = new Contract(CONTRACT_ADDRESSES.mockAdVery, MOCK_AD_VERY_ABI, signer);
      const marketplaceContract = new Contract(CONTRACT_ADDRESSES.taskMarketplace, TASK_MARKETPLACE_ABI, signer);

      // Approve spending (100 tokens for boost)
      const boostCost = parseEther("100");
      const approveTx = await adVeryContract.approve(CONTRACT_ADDRESSES.taskMarketplace, boostCost);
      await approveTx.wait();

      showNotification("success", "Approval confirmed! Boosting task...");

      // Now boost the task
      const boostTx = await marketplaceContract.boostTask(selectedTask.id);
      await boostTx.wait();

      showNotification("success", "Task boosted! It will now appear at the top of search results.");
      setIsBoostModalOpen(false);

      // Update Supabase
      try {
        await fetch(`/api/tasks/${selectedTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_boosted: true }),
        });
      } catch (e) {
        console.warn("Supabase update failed:", e);
      }

      // Refresh tasks from API
      await fetchTasks();

      // Refresh AD VERY balance
      const newBalance = await adVeryContract.balanceOf(userAddress);
      setAdVeryBalance(formatEther(newBalance));

    } catch (error: any) {
      console.error("Boost task failed:", error);
      
      if (error.code === "ACTION_REJECTED") {
        showNotification("error", "Transaction rejected by user");
      } else {
        showNotification("error", "Failed to boost task. Check your AD VERY balance.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Claim Faucet Handler
  // ========================================
  
  const handleClaimFaucet = async () => {
    if (!userAddress) {
      showNotification("error", "Please connect your wallet first");
      return;
    }

    setIsLoading(true);

    try {
      const signer = await provider!.getSigner();
      const contract = new Contract(CONTRACT_ADDRESSES.mockAdVery, MOCK_AD_VERY_ABI, signer);

      const tx = await contract.faucet();
      await tx.wait();

      showNotification("success", "Claimed 100 AD VERY tokens!");

      // Refresh balance
      const newBalance = await contract.balanceOf(userAddress);
      setAdVeryBalance(formatEther(newBalance));

    } catch (error: any) {
      console.error("Faucet claim failed:", error);
      
      if (error.message?.includes("FaucetCooldownActive")) {
        showNotification("error", "Faucet on cooldown. Try again in 1 hour.");
      } else {
        showNotification("error", "Failed to claim tokens. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Accept Task Handler
  // ========================================
  
  const handleAcceptTask = async (task: Task) => {
    if (!userAddress || !provider) {
      showNotification("error", "Please connect your wallet first");
      return;
    }

    setIsLoading(true);
    
    try {
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESSES.taskMarketplace, TASK_MARKETPLACE_ABI, signer);

      // Call assignWorker on the contract
      const tx = await contract.assignWorker(task.id);
      showNotification("success", "Transaction submitted! Waiting for confirmation...");
      await tx.wait();

      // Update Supabase with status and payment_status = escrowed
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "in_progress",
          worker_address: userAddress,
          payment_status: "escrowed",
        }),
      });

      showNotification("success", `Task accepted! ${task.amount} VERY is now held in escrow until you complete the work.`);
      setIsTaskDetailOpen(false);
      
      // Refresh tasks
      await fetchTasks();
      await fetchMyPendingTasks();
      
    } catch (error: any) {
      console.error("Accept task failed:", error);
      if (error.code === "ACTION_REJECTED") {
        showNotification("error", "Transaction rejected by user");
      } else {
        showNotification("error", "Failed to accept task. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Cancel Task Handler
  // ========================================
  
  const handleCancelTask = async (task: Task) => {
    if (!userAddress || !provider) return;

    setIsLoading(true);
    
    try {
      // Update Supabase to reset task status
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "open",
          worker_address: null,
        }),
      });

      showNotification("success", "Task cancelled. It's now available for other workers.");
      setIsTaskDetailOpen(false);
      
      // Refresh tasks
      await fetchTasks();
      await fetchMyPendingTasks();
      
    } catch (error: any) {
      console.error("Cancel task failed:", error);
      showNotification("error", "Failed to cancel task. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Edit Task Handler
  // ========================================
  
  const openEditModal = (task: Task) => {
    setSelectedTask(task);
    setEditForm({
      title: task.title,
      description: task.description,
      amount: task.amount,
      category: task.category,
    });
    setIsEditModalOpen(true);
  };

  const handleEditTask = async () => {
    if (!selectedTask || !userAddress) {
      showNotification("error", "Please connect your wallet");
      return;
    }

    if (!editForm.title) {
      showNotification("error", "Task title is required");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description,
          category: editForm.category,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to update task");
      }

      showNotification("success", "Task updated successfully!");
      setIsEditModalOpen(false);
      setEditForm({ title: "", description: "", amount: "", category: "delivery" });

      // Refresh tasks
      await fetchTasks();
      await fetchMyCreatedTasks();

    } catch (error: any) {
      console.error("Edit task failed:", error);
      showNotification("error", "Failed to update task. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Delete Task Handler
  // ========================================
  
  const openDeleteConfirm = (task: Task) => {
    setSelectedTask(task);
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteTask = async () => {
    if (!selectedTask || !userAddress) {
      showNotification("error", "Please connect your wallet");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete task");
      }

      showNotification("success", "Task deleted successfully!");
      setIsDeleteConfirmOpen(false);
      setSelectedTask(null);

      // Refresh tasks
      await fetchTasks();
      await fetchMyCreatedTasks();

    } catch (error: any) {
      console.error("Delete task failed:", error);
      showNotification("error", "Failed to delete task. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Submit Work Handler
  // ========================================
  
  const handleSubmitWork = async (task: Task) => {
    if (!userAddress || !provider) return;

    setIsLoading(true);
    
    try {
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESSES.taskMarketplace, TASK_MARKETPLACE_ABI, signer);

      // For now, we'll submit with an empty proof - can be enhanced with IPFS later
      const tx = await contract.submitWork(task.id, "");
      showNotification("success", "Transaction submitted! Waiting for confirmation...");
      await tx.wait();

      // Update Supabase
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "submitted" }),
      });

      showNotification("success", "Work submitted! Waiting for poster approval.");
      setIsTaskDetailOpen(false);
      
      // Refresh tasks
      await fetchTasks();
      await fetchMyPendingTasks();
      
    } catch (error: any) {
      console.error("Submit work failed:", error);
      if (error.code === "ACTION_REJECTED") {
        showNotification("error", "Transaction rejected by user");
      } else {
        showNotification("error", "Failed to submit work. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Approve & Release Payment Handler
  // ========================================
  
  const handleApproveTask = async (task: Task) => {
    if (!userAddress || !provider) return;

    setIsLoading(true);
    
    try {
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESSES.taskMarketplace, TASK_MARKETPLACE_ABI, signer);

      // Call approveAndPay on the contract to release funds
      const tx = await contract.approveAndPay(task.id);
      showNotification("success", "Transaction submitted! Releasing payment...");
      await tx.wait();

      // Update Supabase
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          status: "completed",
        }),
      });

      showNotification("success", "Task approved! Payment released to worker.");
      setIsTaskDetailOpen(false);
      
      // Refresh tasks
      await fetchTasks();
      await fetchMyCreatedTasks();
      
    } catch (error: any) {
      console.error("Approve task failed:", error);
      if (error.code === "ACTION_REJECTED") {
        showNotification("error", "Transaction rejected by user");
      } else {
        showNotification("error", "Failed to approve task. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================
  // Filter Tasks
  // ========================================
  
  // Filter by category and exclude user's own tasks from nearby view
  // Also only show "open" tasks that are available for workers to accept
  // Only show tasks when wallet is connected
  const filteredTasks = userAddress ? tasks.filter(t => {
    // Exclude user's own created tasks from nearby tasks
    if (t.posterAddress === userAddress.toLowerCase()) return false;
    // Only show open tasks available for acceptance (exclude in_progress, completed, etc.)
    if (t.status !== "open") return false;
    // Filter by category
    if (selectedCategory !== "all" && t.category !== selectedCategory) return false;
    return true;
  }) : [];

  // Sort: Boosted first, then by distance
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (a.isBoosted && !b.isBoosted) return -1;
    if (!a.isBoosted && b.isBoosted) return 1;
    return a.distance - b.distance;
  });

  // ========================================
  // Render
  // ========================================
  
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      
      {/* ======================================== */}
      {/* Notification Toast */}
      {/* ======================================== */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-2xl backdrop-blur-md border ${
          notification.type === "success" 
            ? "bg-green-500/20 border-green-500/50 text-green-300" 
            : "bg-red-500/20 border-red-500/50 text-red-300"
        } animate-slide-in`}>
          <div className="flex items-center gap-3">
            {notification.type === "success" ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      {/* ======================================== */}
      {/* Header */}
      {/* ======================================== */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <span className="text-xl font-bold">V</span>
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                VeryTask
              </h1>
              <p className="text-xs text-slate-500">Hyper-Local Gig Economy</p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <div className="relative w-full">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search tasks near you..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
              />
            </div>
          </div>

          {/* Right Section: AD VERY Balance + Wallet */}
          <div className="flex items-center gap-4">
            {/* AD VERY Balance */}
            {userAddress && (
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                <span className="text-purple-400 text-sm">💎</span>
                <span className="text-purple-300 font-medium">
                  {parseFloat(adVeryBalance).toFixed(0)} AD VERY
                </span>
                <button
                  onClick={handleClaimFaucet}
                  disabled={isLoading}
                  className="ml-2 text-xs text-purple-400 hover:text-purple-300 underline"
                >
                  Get Free
                </button>
              </div>
            )}

            {/* Wepin Auth Button */}
            <WepinAuth 
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          </div>
        </div>
      </header>

      <div className="flex">
        {/* ======================================== */}
        {/* Sidebar */}
        {/* ======================================== */}
        <aside className="hidden lg:flex flex-col w-64 min-h-[calc(100vh-73px)] border-r border-white/10 bg-slate-900/50">
          {/* Create Task Button */}
          <div className="p-4">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all hover:scale-[1.02]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Task
            </button>
          </div>

          {/* Categories */}
          <nav className="flex-1 px-3 py-4">
            <h3 className="px-3 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Categories
            </h3>
            <ul className="space-y-1">
              {CATEGORIES.map((category) => (
                <li key={category.id}>
                  <button
                    onClick={() => setSelectedCategory(category.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                      selectedCategory === category.id
                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <span className="text-lg">{category.icon}</span>
                    <span className="font-medium">{category.label}</span>
                    {selectedCategory === category.id && (
                      <span className="ml-auto w-2 h-2 bg-indigo-400 rounded-full" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            
            {/* My Tasks Section */}
            <h3 className="px-3 mt-6 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              My Tasks
            </h3>
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => setActiveTaskView("pending")}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                    activeTaskView === "pending" 
                      ? "bg-amber-500/20 text-amber-300" 
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span className="text-lg">⏳</span>
                  <span className="font-medium">Pending Tasks</span>
                  {myPendingTasks.length > 0 && (
                    <span className="ml-auto px-2 py-0.5 bg-amber-600/50 text-amber-200 text-xs rounded-full">
                      {myPendingTasks.length}
                    </span>
                  )}
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTaskView("history")}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                    activeTaskView === "history" 
                      ? "bg-emerald-500/20 text-emerald-300" 
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span className="text-lg">✅</span>
                  <span className="font-medium">Work History</span>
                  {myWorkHistory.length > 0 && (
                    <span className="ml-auto px-2 py-0.5 bg-emerald-600/50 text-emerald-200 text-xs rounded-full">
                      {myWorkHistory.length}
                    </span>
                  )}
                </button>
              </li>
            </ul>
          </nav>

          {/* Stats */}
          <div className="p-4 border-t border-white/10">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-800/50 rounded-xl border border-white/5">
                <p className="text-2xl font-bold text-indigo-400">{tasks.filter(t => t.status === "open").length}</p>
                <p className="text-xs text-slate-500">Active Tasks</p>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-xl border border-white/5">
                <p className="text-2xl font-bold text-green-400">{completedCount}</p>
                <p className="text-xs text-slate-500">Completed</p>
              </div>
            </div>
          </div>
        </aside>

        {/* ======================================== */}
        {/* Main Content */}
        {/* ======================================== */}
        <main className="flex-1 p-6">
          {/* Map Placeholder */}
          <div className="mb-6 h-64 md:h-80 bg-slate-800/50 rounded-2xl border border-white/10 overflow-hidden relative backdrop-blur-md">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5" />
            
            {/* Mock Map Grid */}
            <div className="absolute inset-0 opacity-10">
              <svg className="w-full h-full">
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            </div>

            {/* User Location Marker (Center) */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-20">
              <div className="relative">
                {/* Pulsing ring */}
                <div className="absolute inset-0 w-12 h-12 -m-2 bg-blue-500/30 rounded-full animate-ping" />
                <div className="absolute inset-0 w-10 h-10 -m-1 bg-blue-500/20 rounded-full animate-pulse" />
                {/* User marker */}
                <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/50 border-2 border-white z-10 relative">
                  <span className="text-sm">📍</span>
                </div>
              </div>
              <p className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-blue-400 whitespace-nowrap font-medium">
                You
              </p>
            </div>

            {/* Map Pins (Task Markers) */}
            {sortedTasks.slice(0, 6).map((task, index) => {
              // Distribute tasks around user's center position
              const angle = (index / 6) * 2 * Math.PI - Math.PI / 2;
              const radius = 25 + (index % 2) * 15; // Vary distance
              const top = 50 + Math.sin(angle) * radius;
              const left = 50 + Math.cos(angle) * radius;
              
              return (
                <div
                  key={task.id}
                  className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all hover:scale-125 ${
                    task.isBoosted ? "z-10" : ""
                  }`}
                  style={{
                    top: `${top}%`,
                    left: `${left}%`,
                  }}
                  title={`${task.title} - ${task.amount} VERY (${task.distance < 1000 ? task.distance + 'm' : (task.distance / 1000).toFixed(1) + 'km'})`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${
                    task.isBoosted 
                      ? "bg-gradient-to-br from-yellow-400 to-orange-500 shadow-yellow-500/50 animate-pulse" 
                      : task.status === "open"
                      ? "bg-gradient-to-br from-green-400 to-emerald-500 shadow-green-500/30"
                      : "bg-gradient-to-br from-red-400 to-rose-500 shadow-red-500/30"
                  }`}>
                    <span className="text-xs">💼</span>
                  </div>
                  {task.isBoosted && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full animate-ping" />
                  )}
                </div>
              );
            })}

            {/* Legend */}
            <div className="absolute bottom-4 left-4 flex items-center gap-4 px-4 py-2 bg-slate-900/80 backdrop-blur-md rounded-lg border border-white/10 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500 border border-white" />
                <span className="text-slate-400">You</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-slate-400">Open</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-slate-400">Taken</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-slate-400">Boosted</span>
              </div>
            </div>

            {/* Map CTA */}
            <div className="absolute top-4 right-4 px-4 py-2 bg-slate-900/80 backdrop-blur-md rounded-lg border border-white/10">
              {userLocation ? (
                <p className="text-xs text-slate-400">
                  📍 Showing {sortedTasks.length} tasks within {(searchRadius / 1000).toFixed(0)}km
                </p>
              ) : (
                <p className="text-xs text-yellow-400">
                  ⚠️ {locationError || "Getting your location..."}
                </p>
              )}
            </div>
          </div>

          {/* Task View Tabs */}
          <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-4">
            <button
              onClick={() => setActiveTaskView("nearby")}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTaskView === "nearby"
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              📍 Nearby Tasks
              <span className="ml-2 text-xs opacity-75">({sortedTasks.length + myCreatedTasks.length})</span>
            </button>
            <button
              onClick={() => setActiveTaskView("pending")}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTaskView === "pending"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              ⏳ Pending Tasks
              <span className="ml-2 text-xs opacity-75">({myPendingTasks.length})</span>
            </button>
            <button
              onClick={() => setActiveTaskView("history")}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTaskView === "history"
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              ✅ Work History
              <span className="ml-2 text-xs opacity-75">({myWorkHistory.length})</span>
            </button>
          </div>

          {/* Task List Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">
              {activeTaskView === "nearby" && "Nearby Tasks"}
              {activeTaskView === "pending" && "My Pending Tasks"}
              {activeTaskView === "history" && "My Work History"}
              <span className="ml-2 text-sm text-slate-500 font-normal">
                ({activeTaskView === "nearby" ? (sortedTasks.length + myCreatedTasks.length) : 
                  activeTaskView === "pending" ? myPendingTasks.length :
                  myWorkHistory.length} {activeTaskView === "nearby" ? "total" : "tasks"})
              </span>
            </h2>
            <div className="flex items-center gap-2">
              {activeTaskView === "nearby" && (
                <button className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-white/10 rounded-lg hover:bg-slate-800 transition-all">
                  Sort by Distance
                </button>
              )}
              <button className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-white/10 rounded-lg hover:bg-slate-800 transition-all">
                Filter
              </button>
            </div>
          </div>

          {/* Task Grid */}
          <div className="space-y-8">
            {/* Loading State */}
            {isFetchingTasks && activeTaskView === "nearby" && (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-3 text-slate-400">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Loading tasks from database...</span>
                </div>
              </div>
            )}

            {/* ===== NEARBY VIEW - Two Sections ===== */}
            {activeTaskView === "nearby" && !isFetchingTasks && (
              <>
                {/* Section 1: Your Tasks (Created by current user) */}
                {userAddress && myCreatedTasks.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <span className="text-xl">📝</span> Your Tasks
                      <span className="ml-2 text-sm text-slate-500 font-normal">({myCreatedTasks.length})</span>
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {myCreatedTasks.map((task) => (
                        <div
                          key={`created-${task.id}`}
                          onClick={() => {
                            setSelectedTask(task);
                            setIsTaskDetailOpen(true);
                          }}
                          className={`group relative p-5 rounded-2xl border backdrop-blur-md transition-all hover:scale-[1.02] cursor-pointer ${
                            task.isBoosted
                              ? "bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30 shadow-lg shadow-yellow-500/10"
                              : "bg-slate-800/50 border-indigo-500/30 hover:border-indigo-500/50"
                          }`}
                        >
                          {/* Boosted Badge */}
                          {task.isBoosted && (
                            <div className="absolute -top-2 -right-2 px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full text-xs font-bold text-black shadow-lg">
                              ⚡ BOOSTED
                            </div>
                          )}

                          {/* Edit & Delete Icons - Only for open tasks */}
                          {task.status === "open" && (
                            <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
                              {/* Edit Icon */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditModal(task);
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/20 rounded-lg transition-all"
                                title="Edit task"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              {/* Delete Icon */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDeleteConfirm(task);
                                }}
                                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition-all"
                                title="Delete task"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}

                          {/* Your Task Badge */}
                          <div className="absolute -top-2 -left-2 px-2 py-1 bg-indigo-500 rounded-full text-xs font-bold text-white shadow-lg">
                            Your Task
                          </div>

                          {/* Category + Status Badges */}
                          <div className="flex items-center gap-2 mb-3 flex-wrap mt-2">
                            <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-lg text-xs font-medium capitalize">
                              {task.category.replace("_", " ")}
                            </span>
                            {/* Payment Status for in-progress tasks */}
                            {task.status === "in_progress" && (
                              <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded-lg text-xs font-medium">
                                🔒 {task.amount} VERY in Escrow
                              </span>
                            )}
                            {/* Status Badge */}
                            <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                              task.status === "open" 
                                ? "bg-green-500/20 text-green-300" 
                                : task.status === "in_progress" 
                                ? "bg-blue-500/20 text-blue-300"
                                : task.status === "submitted"
                                ? "bg-yellow-500/20 text-yellow-300"
                                : task.status === "completed"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-red-500/20 text-red-300"
                            }`}>
                              {task.status === "open" && "🟢 Open"}
                              {task.status === "in_progress" && "🔵 In Progress"}
                              {task.status === "submitted" && "🟡 Pending Approval"}
                              {task.status === "completed" && "✅ Completed"}
                              {task.status === "disputed" && "🔴 Disputed"}
                            </span>
                          </div>

                          {/* Title */}
                          <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-indigo-300 transition-colors">
                            {task.title}
                          </h3>

                          {/* Description */}
                          <p className="text-sm text-slate-400 mb-4 line-clamp-2">
                            {task.description}
                          </p>

                          {/* Worker info */}
                          {task.worker && (
                            <div className="mb-3 text-xs text-slate-500">
                              👷 Worker: <span className="text-slate-300">{task.worker}</span>
                            </div>
                          )}

                          {/* Footer */}
                          <div className="flex items-center justify-between pt-3 border-t border-white/10">
                            {/* Payment */}
                            <div className="flex items-center gap-2">
                              <span className="text-2xl font-bold text-white">{task.amount}</span>
                              <span className="text-sm text-indigo-400 font-medium">VERY</span>
                            </div>

                            {/* Actions - Manage buttons, NO accept button */}
                            <div className="flex items-center gap-2">
                              {/* Boost button */}
                              {!task.isBoosted && task.status === "open" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTask(task);
                                    setIsBoostModalOpen(true);
                                  }}
                                  className="px-3 py-1.5 text-xs text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 transition-all"
                                >
                                  ⚡ Boost
                                </button>
                              )}
                              {/* View Details */}
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTask(task);
                                  setIsTaskDetailOpen(true);
                                }}
                                className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-all"
                              >
                                Manage
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 2: Tasks Near You (From other users) */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <span className="text-xl">📍</span> Tasks Near You
                    <span className="ml-2 text-sm text-slate-500 font-normal">
                      ({sortedTasks.filter(t => !userAddress || t.posterAddress.toLowerCase() !== userAddress.toLowerCase()).length} available)
                    </span>
                  </h3>
                  
                  {/* Filter out user's own tasks from nearby */}
                  {sortedTasks.filter(t => !userAddress || t.posterAddress.toLowerCase() !== userAddress.toLowerCase()).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-20 h-20 mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                        <span className="text-4xl">{userAddress ? "📋" : "🔐"}</span>
                      </div>
                      <h3 className="text-xl font-semibold text-white mb-2">
                        {userAddress ? "No Tasks Available" : "Connect Your Wallet"}
                      </h3>
                      <p className="text-slate-400 mb-4 max-w-md">
                        {!userAddress 
                          ? "Please connect your wallet to browse and accept tasks near you."
                          : locationError 
                          ? "Location access was denied. Please allow location access to find tasks near you."
                          : "There are no tasks from other users in your area yet. Check back later!"}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {sortedTasks
                        .filter(t => !userAddress || t.posterAddress.toLowerCase() !== userAddress.toLowerCase())
                        .map((task) => (
                        <div
                          key={`nearby-${task.id}`}
                          onClick={() => {
                            setSelectedTask(task);
                            setIsTaskDetailOpen(true);
                          }}
                          className={`group relative p-5 rounded-2xl border backdrop-blur-md transition-all hover:scale-[1.02] cursor-pointer ${
                            task.isBoosted
                              ? "bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30 shadow-lg shadow-yellow-500/10"
                              : "bg-slate-800/50 border-white/10 hover:border-indigo-500/30"
                          }`}
                        >
                          {/* Boosted Badge */}
                          {task.isBoosted && (
                            <div className="absolute -top-2 -right-2 px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full text-xs font-bold text-black shadow-lg">
                              ⚡ BOOSTED
                            </div>
                          )}

                          {/* Category + Status Badges */}
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-lg text-xs font-medium capitalize">
                              {task.category.replace("_", " ")}
                            </span>
                            <span className="text-xs text-slate-500">
                              {task.distance < 1000 
                                ? `${task.distance}m away` 
                                : `${(task.distance / 1000).toFixed(1)}km away`}
                            </span>
                            {/* Escrow Badge for in-progress tasks */}
                            {task.status === "in_progress" && (
                              <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded-lg text-xs font-medium">
                                🔒 {task.amount} VERY in Escrow
                              </span>
                            )}
                            {/* Status Badge */}
                            <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                              task.status === "open" 
                                ? "bg-green-500/20 text-green-300" 
                                : task.status === "in_progress" 
                                ? "bg-blue-500/20 text-blue-300"
                                : task.status === "submitted"
                                ? "bg-yellow-500/20 text-yellow-300"
                                : task.status === "completed"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-red-500/20 text-red-300"
                            }`}>
                              {task.status === "open" && "🟢 Open"}
                              {task.status === "in_progress" && "🔵 In Progress"}
                              {task.status === "submitted" && "🟡 Pending Approval"}
                              {task.status === "completed" && "✅ Completed"}
                              {task.status === "disputed" && "🔴 Disputed"}
                            </span>
                          </div>

                          {/* Title */}
                          <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-indigo-300 transition-colors">
                            {task.title}
                          </h3>

                          {/* Description */}
                          <p className="text-sm text-slate-400 mb-4 line-clamp-2">
                            {task.description}
                          </p>

                          {/* Poster info */}
                          <div className="mb-3 text-xs text-slate-500">
                            👤 Posted by: <span className="text-slate-300">{task.poster}</span>
                          </div>

                          {/* Footer */}
                          <div className="flex items-center justify-between pt-3 border-t border-white/10">
                            {/* Payment */}
                            <div className="flex items-center gap-2">
                              <span className="text-2xl font-bold text-white">{task.amount}</span>
                              <span className="text-sm text-indigo-400 font-medium">VERY</span>
                            </div>

                            {/* Actions - Accept button for tasks from other users */}
                            <div className="flex items-center gap-2">
                              {task.status === "open" && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAcceptTask(task);
                                  }}
                                  className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-all"
                                >
                                  Accept Task
                                </button>
                              )}
                              {task.status !== "open" && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTask(task);
                                    setIsTaskDetailOpen(true);
                                  }}
                                  className="px-4 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-lg transition-all"
                                >
                                  View Details
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Empty state when no tasks at all and not connected */}
                {!userAddress && sortedTasks.length === 0 && myCreatedTasks.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                      <span className="text-4xl">🔐</span>
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">Connect Your Wallet</h3>
                    <p className="text-slate-400 mb-4 max-w-md">
                      Please connect your wallet to browse and accept tasks near you.
                    </p>
                    <p className="text-sm text-slate-500">Use the Connect Wallet button in the header to get started.</p>
                  </div>
                )}
              </>
            )}

            {/* ===== OTHER VIEWS (Pending, History) ===== */}

            {/* Empty State - Work History */}
            {activeTaskView === "history" && myWorkHistory.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                <div className="w-20 h-20 mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                  <span className="text-4xl">✅</span>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">No Work History</h3>
                <p className="text-slate-400 mb-4 max-w-md">
                  {userAddress 
                    ? "You haven't completed any tasks yet. Browse nearby tasks to start earning!"
                    : "Connect your wallet to view your work history."}
                </p>
                {userAddress && (
                  <button
                    onClick={() => setActiveTaskView("nearby")}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-xl hover:scale-105 transition-transform shadow-lg shadow-indigo-500/30"
                  >
                    Browse Nearby Tasks
                  </button>
                )}
              </div>
            )}

            {/* Empty State - Pending Tasks */}
            {activeTaskView === "pending" && myPendingTasks.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                <div className="w-20 h-20 mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                  <span className="text-4xl">⏳</span>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">No Pending Tasks</h3>
                <p className="text-slate-400 mb-4 max-w-md">
                  {userAddress 
                    ? "You don't have any tasks in progress. Accept a task from nearby to get started!"
                    : "Connect your wallet to view your pending tasks."}
                </p>
                {userAddress && (
                  <button
                    onClick={() => setActiveTaskView("nearby")}
                    className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold rounded-xl hover:scale-105 transition-transform shadow-lg shadow-amber-500/30"
                  >
                    Find Tasks to Accept
                  </button>
                )}
              </div>
            )}

            {/* Task Cards - Render for Pending and History views */}
            {activeTaskView !== "nearby" && (activeTaskView === "pending" ? myPendingTasks : myWorkHistory).map((task) => (
              <div
                key={task.id}
                onClick={() => {
                  setSelectedTask(task);
                  setIsTaskDetailOpen(true);
                }}
                className={`group relative p-5 rounded-2xl border backdrop-blur-md transition-all hover:scale-[1.02] cursor-pointer ${
                  task.isBoosted
                    ? "bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border-yellow-500/30 shadow-lg shadow-yellow-500/10"
                    : "bg-slate-800/50 border-white/10 hover:border-indigo-500/30"
                }`}
              >
                {/* Boosted Badge */}
                {task.isBoosted && (
                  <div className="absolute -top-2 -right-2 px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full text-xs font-bold text-black shadow-lg">
                    ⚡ BOOSTED
                  </div>
                )}

                {/* Category + Status Badges */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-lg text-xs font-medium capitalize">
                    {task.category.replace("_", " ")}
                  </span>
                  {/* Status Badge */}
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                    task.status === "open" 
                      ? "bg-green-500/20 text-green-300" 
                      : task.status === "in_progress" 
                      ? "bg-blue-500/20 text-blue-300"
                      : task.status === "submitted"
                      ? "bg-yellow-500/20 text-yellow-300"
                      : task.status === "completed"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-red-500/20 text-red-300"
                  }`}>
                    {task.status === "open" && "🟢 Open"}
                    {task.status === "in_progress" && "🔵 In Progress"}
                    {task.status === "submitted" && "🟡 Pending Approval"}
                    {task.status === "completed" && "✅ Completed"}
                    {task.status === "disputed" && "🔴 Disputed"}
                  </span>
                  {/* Payment Status Badge for pending/history views */}
                  {(activeTaskView === "pending" || activeTaskView === "history") && task.status !== "open" && (
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      task.paymentStatus === "released" 
                        ? "bg-green-500/20 text-green-300" 
                        : task.paymentStatus === "escrowed" 
                        ? "bg-purple-500/20 text-purple-300"
                        : task.paymentStatus === "refunded"
                        ? "bg-orange-500/20 text-orange-300"
                        : "bg-slate-500/20 text-slate-300"
                    }`}>
                      {task.paymentStatus === "released" && "💰 Paid"}
                      {task.paymentStatus === "escrowed" && "🔒 In Escrow"}
                      {task.paymentStatus === "refunded" && "↩️ Refunded"}
                      {task.paymentStatus === "pending" && "⏳ Payment Pending"}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-indigo-300 transition-colors">
                  {task.title}
                </h3>

                {/* Description */}
                <p className="text-sm text-slate-400 mb-4 line-clamp-2">
                  {task.description}
                </p>

                {/* Poster info for work history and pending tasks */}
                {(activeTaskView === "history" || activeTaskView === "pending") && (
                  <div className="mb-3 text-xs text-slate-500">
                    👤 Posted by: <span className="text-slate-300">{task.poster}</span>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-white/10">
                  {/* Payment */}
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-white">{task.amount}</span>
                    <span className="text-sm text-indigo-400 font-medium">VERY</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {/* Pending tasks - Cancel button */}
                    {activeTaskView === "pending" && task.status === "in_progress" && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelTask(task);
                        }}
                        className="px-3 py-1.5 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-all"
                      >
                        Cancel Task
                      </button>
                    )}
                    {/* View Details button for pending/history */}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTask(task);
                        setIsTaskDetailOpen(true);
                      }}
                      className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-all"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* ======================================== */}
      {/* Create Task Modal */}
      {/* ======================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">Create New Task</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Task Title *
                </label>
                <input
                  type="text"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  placeholder="e.g., Walk my dog for 30 minutes"
                  className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Description
                </label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Provide more details about the task..."
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 resize-none"
                />
              </div>

              {/* Category & Amount */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Category
                  </label>
                  <select
                    value={createForm.category}
                    onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {CATEGORIES.filter(c => c.id !== "all").map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.icon} {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Payment (VERY) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={createForm.amount}
                    onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                    placeholder="10"
                    className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {/* Info Box */}
              <div className="flex items-start gap-3 p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-xl">
                <svg className="w-5 h-5 text-indigo-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-indigo-300">
                  Your payment will be held in escrow until you approve the completed work.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-slate-800/50">
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="px-5 py-2.5 text-slate-400 hover:text-white border border-white/10 rounded-xl hover:bg-slate-800 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTask}
                disabled={isLoading || !createForm.title || !createForm.amount}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 transition-all disabled:cursor-not-allowed"
              >
                {isLoading ? "Creating..." : `Create Task (${createForm.amount || "0"} VERY)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================== */}
      {/* Edit Task Modal */}
      {/* ======================================== */}
      {isEditModalOpen && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">✏️ Edit Task</h2>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Task Title *
                </label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  placeholder="e.g., Walk my dog for 30 minutes"
                  className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Description
                </label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Provide more details about the task..."
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 resize-none"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Category
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
                >
                  {CATEGORIES.filter(c => c.id !== "all").map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.icon} {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount (read-only) */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Payment Amount
                </label>
                <div className="px-4 py-3 bg-slate-800/50 border border-white/10 rounded-xl text-slate-400">
                  {selectedTask.amount} VERY <span className="text-xs">(cannot be changed)</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-slate-800/30">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="px-5 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleEditTask}
                disabled={isLoading || !editForm.title}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 transition-all disabled:cursor-not-allowed"
              >
                {isLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================== */}
      {/* Delete Confirmation Modal */}
      {/* ======================================== */}
      {isDeleteConfirmOpen && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-red-500/10">
              <h2 className="text-xl font-semibold text-white">🗑️ Delete Task</h2>
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-500/20 rounded-full">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Are you sure?</h3>
                  <p className="text-slate-400 text-sm">
                    This will permanently delete <span className="text-white font-medium">"{selectedTask.title}"</span> and refund the escrowed amount back to your wallet. This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-slate-800/30">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="px-5 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTask}
                disabled={isLoading}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 text-white font-semibold rounded-xl shadow-lg shadow-red-500/25 transition-all disabled:cursor-not-allowed"
              >
                {isLoading ? "Deleting..." : "Delete Task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================== */}
      {/* Boost Task Modal */}
      {/* ======================================== */}
      {isBoostModalOpen && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-yellow-500/10 to-orange-500/10">
              <h2 className="text-xl font-semibold text-white">⚡ Boost Task</h2>
              <button
                onClick={() => setIsBoostModalOpen(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                <h3 className="font-semibold text-white mb-1">{selectedTask.title}</h3>
                <p className="text-sm text-slate-400">{selectedTask.amount} VERY</p>
              </div>

              <p className="text-slate-300">
                Boosting your task will make it appear at the <strong className="text-yellow-400">top of search results</strong> with a 
                golden pin on the map, increasing visibility and faster pickup.
              </p>

              <div className="flex items-center justify-between p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                <div>
                  <p className="text-sm text-slate-400">Boost Cost</p>
                  <p className="text-xl font-bold text-purple-300">100 AD VERY</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-400">Your Balance</p>
                  <p className="text-xl font-bold text-white">{parseFloat(adVeryBalance).toFixed(0)} AD VERY</p>
                </div>
              </div>

              {parseFloat(adVeryBalance) < 100 && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Insufficient balance. <button onClick={handleClaimFaucet} className="underline">Claim free tokens</button></span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-slate-800/50">
              <button
                onClick={() => setIsBoostModalOpen(false)}
                className="px-5 py-2.5 text-slate-400 hover:text-white border border-white/10 rounded-xl hover:bg-slate-800 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleBoostTask}
                disabled={isLoading || parseFloat(adVeryBalance) < 100}
                className="px-5 py-2.5 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 disabled:from-slate-600 disabled:to-slate-600 text-black font-semibold rounded-xl shadow-lg shadow-yellow-500/25 transition-all disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {isLoading ? "Boosting..." : "⚡ Boost for 100 AD VERY"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================== */}
      {/* Task Detail Modal */}
      {/* ======================================== */}
      {isTaskDetailOpen && selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
              <h2 className="text-xl font-semibold text-white">Task Details</h2>
              <button
                onClick={() => setIsTaskDetailOpen(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Task Title & Category */}
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-lg text-sm font-medium capitalize">
                    {selectedTask.category.replace("_", " ")}
                  </span>
                  {selectedTask.isBoosted && (
                    <span className="px-3 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg text-sm font-bold text-black">
                      ⚡ BOOSTED
                    </span>
                  )}
                </div>
                <h3 className="text-2xl font-bold text-white">{selectedTask.title}</h3>
              </div>

              {/* Status Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                  <p className="text-xs text-slate-500 mb-1">Task Status</p>
                  <p className={`text-lg font-semibold ${
                    selectedTask.status === "open" ? "text-green-400" 
                    : selectedTask.status === "in_progress" ? "text-blue-400"
                    : selectedTask.status === "submitted" ? "text-yellow-400"
                    : selectedTask.status === "completed" ? "text-emerald-400"
                    : "text-red-400"
                  }`}>
                    {selectedTask.status === "open" && "🟢 Open"}
                    {selectedTask.status === "in_progress" && "🔵 In Progress"}
                    {selectedTask.status === "submitted" && "🟡 Work Submitted"}
                    {selectedTask.status === "completed" && "✅ Completed"}
                    {selectedTask.status === "disputed" && "🔴 Disputed"}
                  </p>
                </div>
                <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                  <p className="text-xs text-slate-500 mb-1">Payment Status</p>
                  <p className={`text-lg font-semibold ${
                    selectedTask.paymentStatus === "released" ? "text-green-400" 
                    : selectedTask.paymentStatus === "escrowed" ? "text-purple-400"
                    : selectedTask.paymentStatus === "refunded" ? "text-orange-400"
                    : "text-slate-400"
                  }`}>
                    {selectedTask.paymentStatus === "released" && "💰 Released to Worker"}
                    {selectedTask.paymentStatus === "escrowed" && "🔒 Held in Escrow"}
                    {selectedTask.paymentStatus === "refunded" && "↩️ Refunded"}
                    {selectedTask.paymentStatus === "pending" && "⏳ Pending"}
                  </p>
                </div>
              </div>

              {/* Payment Amount */}
              <div className="p-4 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-500/30">
                <p className="text-xs text-slate-500 mb-1">Payment Amount</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white">{selectedTask.amount}</span>
                  <span className="text-lg text-indigo-400 font-medium">VERY</span>
                </div>
              </div>

              {/* Description */}
              <div>
                <h4 className="text-sm font-medium text-slate-400 mb-2">Description</h4>
                <p className="text-white leading-relaxed">
                  {selectedTask.description || "No description provided."}
                </p>
              </div>

              {/* People Involved */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                  <p className="text-xs text-slate-500 mb-1">Posted By</p>
                  <p className="text-white font-mono">{selectedTask.poster}</p>
                  {userAddress && selectedTask.posterAddress === userAddress.toLowerCase() && (
                    <span className="text-xs text-indigo-400">(You)</span>
                  )}
                </div>
                <div className="p-4 bg-slate-800/50 rounded-xl border border-white/10">
                  <p className="text-xs text-slate-500 mb-1">Worker</p>
                  <p className="text-white font-mono">
                    {selectedTask.worker || "Not assigned yet"}
                  </p>
                  {userAddress && selectedTask.workerAddress === userAddress.toLowerCase() && (
                    <span className="text-xs text-indigo-400">(You)</span>
                  )}
                </div>
              </div>

              {/* Timestamps */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Created</p>
                  <p className="text-slate-300 text-sm">
                    {new Date(selectedTask.createdAt).toLocaleDateString()} at {new Date(selectedTask.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                {selectedTask.completedAt && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Completed</p>
                    <p className="text-slate-300 text-sm">
                      {new Date(selectedTask.completedAt).toLocaleDateString()} at {new Date(selectedTask.completedAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>

              {/* Transaction Hash */}
              {selectedTask.txHash && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Transaction Hash</p>
                  <a 
                    href={`https://www.veryscan.io/tx/${selectedTask.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 text-sm font-mono break-all"
                  >
                    {selectedTask.txHash}
                  </a>
                </div>
              )}
            </div>

            {/* Modal Footer - Actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-slate-800/50">
              <button
                onClick={() => setIsTaskDetailOpen(false)}
                className="px-5 py-2.5 text-slate-400 hover:text-white border border-white/10 rounded-xl hover:bg-slate-800 transition-all"
              >
                Close
              </button>
              
              {/* Show action buttons based on context */}
              {selectedTask.status === "open" && userAddress && selectedTask.posterAddress !== userAddress.toLowerCase() && (
                <button
                  onClick={() => handleAcceptTask(selectedTask)}
                  disabled={isLoading}
                  className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 transition-all"
                >
                  {isLoading ? "Processing..." : "Accept Task"}
                </button>
              )}
              
              {/* For task poster: approve or dispute */}
              {selectedTask.status === "submitted" && userAddress && selectedTask.posterAddress === userAddress.toLowerCase() && (
                <>
                  <button
                    className="px-5 py-2.5 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-xl transition-all"
                  >
                    Dispute
                  </button>
                  <button
                    onClick={() => handleApproveTask(selectedTask)}
                    disabled={isLoading}
                    className="px-5 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl shadow-lg shadow-green-500/25 transition-all"
                  >
                    {isLoading ? "Processing..." : "Approve & Release Payment"}
                  </button>
                </>
              )}
              
              {/* For worker: submit work or cancel */}
              {selectedTask.status === "in_progress" && userAddress && selectedTask.workerAddress === userAddress.toLowerCase() && (
                <>
                  <button
                    onClick={() => handleCancelTask(selectedTask)}
                    disabled={isLoading}
                    className="px-5 py-2.5 border border-red-500/50 text-red-400 hover:bg-red-500/20 disabled:opacity-50 rounded-xl transition-all"
                  >
                    {isLoading ? "Processing..." : "Cancel Task"}
                  </button>
                  <button
                    onClick={() => handleSubmitWork(selectedTask)}
                    disabled={isLoading}
                    className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 transition-all"
                  >
                    {isLoading ? "Processing..." : "Submit Work"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
