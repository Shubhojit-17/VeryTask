"use client";

/**
 * WepinAuth Component
 * 
 * Handles Wepin Wallet authentication for VeryTask.
 * Uses @wepin/sdk-js for widget integration.
 * 
 * @see https://docs.wepin.io/widget-integration/web-javascript-sdk
 */

import React, { useState, useEffect, useCallback } from "react";
import { BrowserProvider, formatEther } from "ethers";

// ============================================================
// Types
// ============================================================

interface WepinAuthState {
  isInitialized: boolean;
  isLoggedIn: boolean;
  isLoading: boolean;
  address: string | null;
  balance: string | null;
  error: string | null;
}

interface WepinAuthProps {
  onConnect?: (address: string, provider: BrowserProvider) => void;
  onDisconnect?: () => void;
  className?: string;
}

// ============================================================
// Very Chain Network Configuration
// ============================================================

export const VERY_CHAIN_CONFIG = {
  chainId: 4613,
  chainIdHex: "0x1205",
  chainName: "Very Chain Mainnet",
  rpcUrl: "https://rpc.verylabs.io",
  currencySymbol: "VERY",
  currencyDecimals: 18,
  blockExplorer: "https://www.veryscan.io",
};

// ============================================================
// Wepin Configuration
// ============================================================

const WEPIN_CONFIG = {
  appId: process.env.NEXT_PUBLIC_WEPIN_APP_ID || "",
  appKey: process.env.NEXT_PUBLIC_WEPIN_APP_KEY || "",
};

// ============================================================
// WepinAuth Component
// ============================================================

export default function WepinAuth({ 
  onConnect, 
  onDisconnect,
  className = "" 
}: WepinAuthProps) {
  const [state, setState] = useState<WepinAuthState>({
    isInitialized: false,
    isLoggedIn: false,
    isLoading: false,
    address: null,
    balance: null,
    error: null,
  });

  const [wepinSdk, setWepinSdk] = useState<any>(null);

  // ========================================
  // Initialize Wepin SDK
  // ========================================
  
  useEffect(() => {
    const initWepin = async () => {
      try {
        // Validate config first
        if (!WEPIN_CONFIG.appId || !WEPIN_CONFIG.appKey) {
          console.warn("[WepinAuth] Missing Wepin credentials");
          setState(prev => ({
            ...prev,
            isInitialized: true,
            error: "Wepin not configured. Add NEXT_PUBLIC_WEPIN_APP_ID and NEXT_PUBLIC_WEPIN_APP_KEY to .env.local",
          }));
          return;
        }

        // Dynamic import for client-side only
        const { WepinSDK } = await import("@wepin/sdk-js");

        // Create SDK instance
        const sdk = new WepinSDK({
          appId: WEPIN_CONFIG.appId,
          appKey: WEPIN_CONFIG.appKey,
        });

        // Initialize with widget options
        await sdk.init({
          type: "hide",
          defaultLanguage: "en",
          defaultCurrency: "USD",
          loginProviders: ["google", "apple"],
        });

        setWepinSdk(sdk);

        // Check if already logged in
        if (sdk.isInitialized()) {
          const status = await sdk.getStatus();
          // Status can be: 'not_initialized' | 'initializing' | 'initialized' | 'before_login' | 'login' | 'login_before_register'
          if (status === "login" || status === "login_before_register") {
            await restoreSession(sdk);
          }
        }

        setState(prev => ({
          ...prev,
          isInitialized: true,
        }));

        console.log("[WepinAuth] SDK initialized successfully");

      } catch (error: any) {
        console.error("[WepinAuth] Initialization failed:", error);
        setState(prev => ({
          ...prev,
          isInitialized: true,
          error: error?.message || "Failed to initialize wallet",
        }));
      }
    };

    // Timeout for initialization
    const timeoutId = setTimeout(() => {
      setState(prev => {
        if (!prev.isInitialized) {
          console.warn("[WepinAuth] Initialization timed out");
          return {
            ...prev,
            isInitialized: true,
            error: "Wallet initialization timed out. Make sure localhost is whitelisted in Wepin Workspace.",
          };
        }
        return prev;
      });
    }, 15000);

    initWepin();

    return () => clearTimeout(timeoutId);
  }, []);

  // ========================================
  // Restore Session
  // ========================================
  
  const restoreSession = useCallback(async (sdk: any) => {
    try {
      const accounts = await sdk.getAccounts();
      if (accounts && accounts.length > 0) {
        const account = accounts[0];
        setState(prev => ({
          ...prev,
          isLoggedIn: true,
          address: account.address,
        }));
        
        // Store in localStorage for persistence
        localStorage.setItem("verytask_address", account.address);
        
        // Create provider and call onConnect
        const provider = await sdk.getProvider({ network: "verychain" }).catch(() => null);
        if (provider && onConnect) {
          try {
            const browserProvider = new BrowserProvider(provider);
            onConnect(account.address, browserProvider);
            console.log("[WepinAuth] Session restored for:", account.address);
          } catch (e) {
            console.warn("[WepinAuth] Provider creation failed, using RPC fallback");
            // Fallback: create provider from RPC
            const { JsonRpcProvider } = await import("ethers");
            const rpcProvider = new JsonRpcProvider(VERY_CHAIN_CONFIG.rpcUrl);
            onConnect(account.address, rpcProvider as any);
          }
        }
      }
    } catch (error) {
      console.error("[WepinAuth] Failed to restore session:", error);
    }
  }, [onConnect]);

  // ========================================
  // Login
  // ========================================
  
  const handleLogin = useCallback(async () => {
    if (!wepinSdk) {
      setState(prev => ({ ...prev, error: "SDK not initialized" }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Open Wepin login modal
      const result = await wepinSdk.loginWithUI();

      if (result) {
        // Get accounts after login
        const accounts = await wepinSdk.getAccounts();
        
        if (accounts && accounts.length > 0) {
          const account = accounts[0];
          
          setState(prev => ({
            ...prev,
            isLoggedIn: true,
            isLoading: false,
            address: account.address,
          }));
          
          // Store in localStorage for persistence
          localStorage.setItem("verytask_address", account.address);
          
          // Create provider and call onConnect
          try {
            const provider = await wepinSdk.getProvider({ network: "verychain" }).catch(() => null);
            if (provider && onConnect) {
              const browserProvider = new BrowserProvider(provider);
              onConnect(account.address, browserProvider);
            } else if (onConnect) {
              // Fallback: create provider from RPC
              const { JsonRpcProvider } = await import("ethers");
              const rpcProvider = new JsonRpcProvider(VERY_CHAIN_CONFIG.rpcUrl);
              onConnect(account.address, rpcProvider as any);
            }
          } catch (e) {
            console.warn("[WepinAuth] Provider creation failed:", e);
          }

          console.log("[WepinAuth] Logged in:", account.address);
        }
      }
    } catch (error: any) {
      console.error("[WepinAuth] Login failed:", error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error?.message || "Login failed",
      }));
    }
  }, [wepinSdk]);

  // ========================================
  // Logout
  // ========================================
  
  const handleLogout = useCallback(async () => {
    if (!wepinSdk) return;

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      await wepinSdk.logout();
      
      // Clear localStorage
      localStorage.removeItem("verytask_address");
      
      setState(prev => ({
        ...prev,
        isLoggedIn: false,
        isLoading: false,
        address: null,
        balance: null,
      }));

      onDisconnect?.();
      console.log("[WepinAuth] Logged out");

    } catch (error) {
      console.error("[WepinAuth] Logout failed:", error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [wepinSdk, onDisconnect]);

  // ========================================
  // Open Wallet Widget
  // ========================================
  
  const openWallet = useCallback(async () => {
    if (!wepinSdk) return;
    
    try {
      await wepinSdk.openWidget();
    } catch (error) {
      console.error("[WepinAuth] Failed to open wallet:", error);
    }
  }, [wepinSdk]);

  // ========================================
  // Render: Loading State
  // ========================================
  
  if (!state.isInitialized) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-700/50 border border-slate-600 rounded-xl">
          <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-slate-400 text-sm">Loading wallet...</span>
        </div>
      </div>
    );
  }

  // ========================================
  // Render: Error State
  // ========================================
  
  if (state.error && !state.isLoggedIn) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <button
          onClick={() => setState(prev => ({ ...prev, error: null }))}
          className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm hover:bg-red-500/30 transition-all max-w-xs truncate"
          title={state.error}
        >
          ⚠️ {state.error.length > 30 ? state.error.slice(0, 30) + "..." : state.error}
        </button>
      </div>
    );
  }

  // ========================================
  // Render: Connected State
  // ========================================
  
  if (state.isLoggedIn && state.address) {
    const truncatedAddress = `${state.address.slice(0, 6)}...${state.address.slice(-4)}`;

    return (
      <div className={`flex items-center gap-3 ${className}`}>
        {/* Wallet Button */}
        <button
          onClick={openWallet}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl text-white font-medium shadow-lg shadow-indigo-500/25 transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span className="hidden sm:inline">{truncatedAddress}</span>
          <span className="sm:hidden">Wallet</span>
        </button>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          disabled={state.isLoading}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
          title="Disconnect"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    );
  }

  // ========================================
  // Render: Disconnected State (Login Button)
  // ========================================
  
  return (
    <div className={`flex items-center ${className}`}>
      <button
        onClick={handleLogin}
        disabled={state.isLoading}
        className="group flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-600 rounded-xl text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all duration-300 hover:scale-105 disabled:hover:scale-100"
      >
        {state.isLoading ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Connecting...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Connect Wallet</span>
          </>
        )}
      </button>
    </div>
  );
}
