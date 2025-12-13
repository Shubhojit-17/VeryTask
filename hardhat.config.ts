import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

/**
 * VeryTask Hardhat Configuration
 * 
 * Networks:
 * - hardhat: Local development
 * - localhost: Local Hardhat node
 * - very_mainnet: Very Chain Mainnet (Chain ID: 4613)
 * 
 * Very Network Details:
 * - RPC URL: https://rpc.verylabs.io
 * - Chain ID: 4613
 * - Currency: VERY
 * - Block Explorer: https://www.veryscan.io
 */

// Deployer private key - NEVER commit this to version control!
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true, // Enable IR-based compilation for better optimization
    },
  },
  networks: {
    // Local Hardhat Network (for testing)
    hardhat: {
      chainId: 31337,
      // Optionally fork Very Chain Mainnet for realistic testing
      // forking: {
      //   url: "https://rpc.verylabs.io",
      //   blockNumber: 1000000, // Pin to a specific block for deterministic tests
      // },
    },
    
    // Local Hardhat Node
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    
    // ============================================
    // VERY CHAIN MAINNET - Primary Deployment Target
    // ============================================
    very_mainnet: {
      url: "https://rpc.verylabs.io",
      chainId: 4613,
      accounts: [PRIVATE_KEY],
      gasPrice: "auto",
      // Very Chain specific settings
      timeout: 60000, // 60 second timeout for slow RPC
      // Recommended gas settings for Very Chain
      gas: "auto",
      gasMultiplier: 1.2, // Add 20% buffer for gas estimation
    },
  },
  
  // ============================================
  // CONTRACT VERIFICATION (Very Scan)
  // ============================================
  etherscan: {
    apiKey: {
      // Very Scan API key (get from https://www.veryscan.io)
      very_mainnet: process.env.VERYSCAN_API_KEY || "placeholder-api-key",
    },
    customChains: [
      {
        network: "very_mainnet",
        chainId: 4613,
        urls: {
          // Very Scan API endpoint for contract verification
          apiURL: "https://www.veryscan.io/api",
          // Very Scan block explorer URL
          browserURL: "https://www.veryscan.io",
        },
      },
    ],
  },
  
  // Source verification settings
  sourcify: {
    enabled: false, // Disable Sourcify (use Very Scan instead)
  },
  
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};

export default config;
