"use client";

/**
 * My Tasks - Created Tasks Page
 * Shows all tasks created by the current user
 */

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { BrowserProvider } from "ethers";

interface Task {
  id: number;
  title: string;
  description: string;
  amount: string;
  category: string;
  status: "open" | "in_progress" | "submitted" | "completed" | "disputed";
  worker_address: string | null;
  created_at: string;
  is_boosted: boolean;
}

export default function MyCreatedTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [userAddress, setUserAddress] = useState<string | null>(null);

  // Get user address from localStorage or session
  useEffect(() => {
    const storedAddress = localStorage.getItem("verytask_address");
    if (storedAddress) {
      setUserAddress(storedAddress);
    }
  }, []);

  // Fetch tasks created by user
  const fetchMyTasks = useCallback(async () => {
    if (!userAddress) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/tasks?poster=${userAddress}`);
      const data = await res.json();
      
      if (res.ok) {
        setTasks(data.tasks || []);
      }
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchMyTasks();
  }, [fetchMyTasks]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "in_progress": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "submitted": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "completed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "disputed": return "bg-red-500/20 text-red-400 border-red-500/30";
      default: return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back
            </Link>
            <div className="h-6 w-px bg-white/10" />
            <h1 className="text-xl font-bold">My Created Tasks</h1>
          </div>
          {userAddress && (
            <div className="px-4 py-2 bg-slate-800 rounded-lg text-sm text-slate-400">
              {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {!userAddress ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
              <span className="text-4xl">🔐</span>
            </div>
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-slate-400 mb-4">Please connect your wallet to view your created tasks</p>
            <Link href="/" className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors">
              Go to Dashboard
            </Link>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3 text-slate-400">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Loading your tasks...</span>
            </div>
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
              <span className="text-4xl">📝</span>
            </div>
            <h2 className="text-xl font-semibold mb-2">No Tasks Created Yet</h2>
            <p className="text-slate-400 mb-4">You haven't created any tasks. Start by posting your first task!</p>
            <Link href="/" className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition-colors">
              Create a Task
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
              <p className="text-slate-400">{tasks.length} task{tasks.length !== 1 ? 's' : ''} created</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-5 rounded-2xl border bg-slate-800/50 border-white/10 hover:border-indigo-500/30 transition-all"
                >
                  {/* Status Badge */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${getStatusColor(task.status)}`}>
                      {task.status.replace("_", " ").toUpperCase()}
                    </span>
                    {task.is_boosted && (
                      <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg text-xs font-bold">
                        ⚡ BOOSTED
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-lg font-semibold text-white mb-2">{task.title}</h3>
                  
                  {/* Description */}
                  <p className="text-sm text-slate-400 mb-4 line-clamp-2">{task.description}</p>

                  {/* Worker Info */}
                  {task.worker_address && (
                    <div className="mb-4 p-2 bg-slate-900/50 rounded-lg">
                      <p className="text-xs text-slate-500">Assigned to:</p>
                      <p className="text-sm text-slate-300 font-mono">
                        {task.worker_address.slice(0, 10)}...{task.worker_address.slice(-8)}
                      </p>
                    </div>
                  )}

                  {/* Amount & Date */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/10">
                    <span className="text-lg font-bold text-indigo-400">{task.amount} VERY</span>
                    <span className="text-xs text-slate-500">
                      {new Date(task.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
