/**
 * VeryTask Deployment Script
 * 
 * Deploys all contracts to Very Chain Mainnet (Chain ID: 4613)
 * 
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network very_mainnet
 * 
 * Deployment Order:
 *   1. MockAdVery (AD VERY token for boosting)
 *   2. UserReputation (Soulbound Token for worker reputation)
 *   3. TaskMarketplace (Main marketplace with escrow)
 *   4. Link contracts together
 */

import { ethers } from "hardhat";

async function main(): Promise<{
  mockAdVery: string;
  userReputation: string;
  taskMarketplace: string;
}> {
  console.log("\n🚀 VeryTask Deployment Script");
  console.log("════════════════════════════════════════════════════════════\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("📋 Deployment Configuration:");
  console.log(`   Deployer:  ${deployerAddress}`);
  console.log(`   Balance:   ${ethers.formatEther(balance)} VERY`);
  console.log(`   Network:   Very Chain Mainnet (Chain ID: 4613)`);
  console.log("");

  // Check minimum balance
  if (balance < ethers.parseEther("0.1")) {
    console.error("❌ Insufficient balance! Need at least 0.1 VERY for deployment.");
    process.exit(1);
  }

  // ============================================
  // 1. Deploy MockAdVery Token
  // ============================================
  console.log("1️⃣  Deploying MockAdVery Token...");
  
  const MockAdVery = await ethers.getContractFactory("MockAdVery");
  const mockAdVery = await MockAdVery.deploy();
  await mockAdVery.waitForDeployment();
  
  const mockAdVeryAddress = await mockAdVery.getAddress();
  console.log(`   ✅ MockAdVery deployed: ${mockAdVeryAddress}`);

  // ============================================
  // 2. Deploy UserReputation SBT
  // ============================================
  console.log("\n2️⃣  Deploying UserReputation SBT...");
  
  // Initially set marketplace to deployer, will update after TaskMarketplace deploys
  const UserReputation = await ethers.getContractFactory("UserReputation");
  const userReputation = await UserReputation.deploy(deployerAddress);
  await userReputation.waitForDeployment();
  
  const userReputationAddress = await userReputation.getAddress();
  console.log(`   ✅ UserReputation deployed: ${userReputationAddress}`);

  // ============================================
  // 3. Deploy TaskMarketplace
  // ============================================
  console.log("\n3️⃣  Deploying TaskMarketplace...");
  
  // Configuration
  const boostCost = ethers.parseEther("100"); // 100 AD VERY to boost
  const platformFeeBps = 250; // 2.5% platform fee

  const TaskMarketplace = await ethers.getContractFactory("TaskMarketplace");
  const taskMarketplace = await TaskMarketplace.deploy(
    userReputationAddress,  // Reputation contract
    mockAdVeryAddress,      // AD VERY token
    boostCost,              // Boost cost (100 tokens)
    platformFeeBps          // Platform fee (2.5%)
  );
  await taskMarketplace.waitForDeployment();
  
  const taskMarketplaceAddress = await taskMarketplace.getAddress();
  console.log(`   ✅ TaskMarketplace deployed: ${taskMarketplaceAddress}`);

  // ============================================
  // 4. Link Contracts
  // ============================================
  console.log("\n4️⃣  Linking contracts...");
  
  // Update UserReputation to only allow TaskMarketplace to mint
  const setMarketplaceTx = await userReputation.setMarketplace(taskMarketplaceAddress);
  await setMarketplaceTx.wait();
  console.log("   ✅ UserReputation now accepts mints from TaskMarketplace");

  // ============================================
  // Summary
  // ============================================
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("🎉 Deployment Complete!\n");
  console.log("📝 Contract Addresses (add to .env):\n");
  console.log(`NEXT_PUBLIC_MOCK_AD_VERY_ADDRESS=${mockAdVeryAddress}`);
  console.log(`NEXT_PUBLIC_USER_REPUTATION_ADDRESS=${userReputationAddress}`);
  console.log(`NEXT_PUBLIC_TASK_MARKETPLACE_ADDRESS=${taskMarketplaceAddress}`);
  console.log("\n════════════════════════════════════════════════════════════");
  
  // Verify on Very Scan (optional)
  console.log("\n📜 To verify contracts on VeryScan:");
  console.log(`npx hardhat verify --network very_mainnet ${mockAdVeryAddress}`);
  console.log(`npx hardhat verify --network very_mainnet ${userReputationAddress} "${deployerAddress}"`);
  console.log(`npx hardhat verify --network very_mainnet ${taskMarketplaceAddress} "${userReputationAddress}" "${mockAdVeryAddress}" "${boostCost}" "${platformFeeBps}"`);
  console.log("");

  // Return addresses for programmatic use
  return {
    mockAdVery: mockAdVeryAddress,
    userReputation: userReputationAddress,
    taskMarketplace: taskMarketplaceAddress,
  };
}

main()
  .then((addresses) => {
    console.log("Deployment successful!");
    // Delay exit to allow handles to close properly on Windows
    setTimeout(() => {}, 1000);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exitCode = 1;
  });
