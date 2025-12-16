/**
 * Show the deployer wallet address
 * Usage: npx hardhat run scripts/show-deployer.ts --network very_mainnet
 */

import hre from "hardhat";
const { ethers } = hre;

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const address = await deployer.getAddress();
  
  console.log("\n📋 Deployer Wallet Information");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Address: ${address}`);
  
  try {
    const balance = await ethers.provider.getBalance(address);
    console.log(`Balance: ${ethers.formatEther(balance)} VERY`);
  } catch (e) {
    console.log("Balance: Unable to fetch (check network connection)");
  }
  
  console.log("\n💡 Fund this address with VERY tokens to deploy contracts.");
  console.log("   Then run: pnpm deploy:very");
  console.log("");
}

main().catch(console.error);
