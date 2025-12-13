/**
 * VeryTask Contract Tests
 * 
 * Run: pnpm test
 */

const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;

describe("VeryTask Contracts", function () {
  let owner: any;
  let worker: any;
  let poster: any;
  let arbiter: any;

  let mockAdVery: any;
  let userReputation: any;
  let taskMarketplace: any;

  let BOOST_COST: any;
  const PLATFORM_FEE_BPS = 250; // 2.5%

  beforeEach(async function () {
    BOOST_COST = ethers.parseEther("100");
    [owner, worker, poster, arbiter] = await ethers.getSigners();

    // Deploy MockAdVery
    const MockAdVery = await ethers.getContractFactory("MockAdVery");
    mockAdVery = await MockAdVery.deploy();

    // Deploy UserReputation (owner as initial marketplace)
    const UserReputation = await ethers.getContractFactory("UserReputation");
    userReputation = await UserReputation.deploy(owner.address);

    // Deploy TaskMarketplace
    const TaskMarketplace = await ethers.getContractFactory("TaskMarketplace");
    taskMarketplace = await TaskMarketplace.deploy(
      await userReputation.getAddress(),
      await mockAdVery.getAddress(),
      BOOST_COST,
      PLATFORM_FEE_BPS
    );

    // Link UserReputation to TaskMarketplace
    await userReputation.setMarketplace(await taskMarketplace.getAddress());
  });

  describe("MockAdVery Token", function () {
    it("Should have correct name and symbol", async function () {
      expect(await mockAdVery.name()).to.equal("Mock AD VERY");
      expect(await mockAdVery.symbol()).to.equal("mADVERY");
    });

    it("Should allow faucet claims", async function () {
      await mockAdVery.connect(worker).faucet();
      expect(await mockAdVery.balanceOf(worker.address)).to.equal(
        ethers.parseEther("100")
      );
    });

    it("Should enforce faucet cooldown", async function () {
      await mockAdVery.connect(worker).faucet();
      await expect(mockAdVery.connect(worker).faucet()).to.be.revertedWithCustomError(
        mockAdVery,
        "FaucetCooldownActive"
      );
    });
  });

  describe("UserReputation SBT", function () {
    it("Should mint reputation token when task completed", async function () {
      // Create task (only deadline param, metadata is off-chain)
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      await taskMarketplace.connect(poster).createTask(deadline, { 
        value: ethers.parseEther("1") 
      });

      // Worker assigns themselves to task
      await taskMarketplace.connect(worker).assignWorker(1);

      // Worker submits work
      await taskMarketplace.connect(worker).submitWork(1, "ipfs://proof123");

      // Poster approves and pays
      await taskMarketplace.connect(poster).approveAndPay(1);

      // Check reputation was minted
      expect(await userReputation.balanceOf(worker.address)).to.equal(1);
    });

    it("Should be non-transferable (Soulbound)", async function () {
      // First complete a task to mint a token
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await taskMarketplace.connect(poster).createTask(deadline, { 
        value: ethers.parseEther("1") 
      });
      await taskMarketplace.connect(worker).assignWorker(1);
      await taskMarketplace.connect(worker).submitWork(1, "ipfs://done");
      await taskMarketplace.connect(poster).approveAndPay(1);

      // Token ID is 1 (counter increments before minting)
      const tokenId = 1;

      // Try to transfer - should fail
      await expect(
        userReputation.connect(worker).transferFrom(worker.address, poster.address, tokenId)
      ).to.be.revertedWithCustomError(userReputation, "SoulboundTransferBlocked");
    });
  });

  describe("TaskMarketplace", function () {
    it("Should create a task with correct escrow", async function () {
      const amount = ethers.parseEther("1");
      const deadline = Math.floor(Date.now() / 1000) + 7200; // 2 hours
      
      await taskMarketplace.connect(poster).createTask(deadline, { value: amount });

      const task = await taskMarketplace.tasks(1);
      expect(task.poster).to.equal(poster.address);
      expect(task.amount).to.equal(amount);
      expect(task.status).to.equal(0); // Open
    });

    it("Should allow worker to accept task", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await taskMarketplace.connect(poster).createTask(deadline, { 
        value: ethers.parseEther("0.5") 
      });

      await taskMarketplace.connect(worker).assignWorker(1);
      
      const task = await taskMarketplace.tasks(1);
      expect(task.worker).to.equal(worker.address);
      expect(task.status).to.equal(1); // InProgress
    });

    it("Should prevent poster from accepting own task", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await taskMarketplace.connect(poster).createTask(deadline, { 
        value: ethers.parseEther("0.5") 
      });

      await expect(
        taskMarketplace.connect(poster).assignWorker(1)
      ).to.be.revertedWithCustomError(taskMarketplace, "CannotAcceptOwnTask");
    });

    it("Should complete full task lifecycle", async function () {
      const amount = ethers.parseEther("1");
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // 1. Create task
      await taskMarketplace.connect(poster).createTask(deadline, { value: amount });

      // 2. Worker accepts
      await taskMarketplace.connect(worker).assignWorker(1);

      // 3. Worker submits work
      await taskMarketplace.connect(worker).submitWork(1, "ipfs://completed");

      // 4. Get worker balance before
      const workerBalanceBefore = await ethers.provider.getBalance(worker.address);

      // 5. Poster approves and pays
      await taskMarketplace.connect(poster).approveAndPay(1);

      // 6. Verify payment (minus platform fee)
      const workerBalanceAfter = await ethers.provider.getBalance(worker.address);
      const platformFee = (amount * BigInt(PLATFORM_FEE_BPS)) / BigInt(10000);
      const expectedPayment = amount - platformFee;
      
      expect(workerBalanceAfter - workerBalanceBefore).to.equal(expectedPayment);

      // 7. Verify task completed
      const task = await taskMarketplace.tasks(1);
      expect(task.status).to.equal(3); // Completed
    });

    it("Should handle disputes", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await taskMarketplace.connect(poster).createTask(deadline, { 
        value: ethers.parseEther("1") 
      });

      await taskMarketplace.connect(worker).assignWorker(1);
      await taskMarketplace.connect(worker).submitWork(1, "ipfs://badwork");

      // Poster raises dispute
      await taskMarketplace.connect(poster).raiseDispute(1);

      const task = await taskMarketplace.tasks(1);
      expect(task.isDisputed).to.be.true;
    });

    it("Should boost tasks with AD VERY tokens", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      // Create task
      await taskMarketplace.connect(poster).createTask(deadline, { 
        value: ethers.parseEther("0.5") 
      });

      // Get AD VERY tokens from faucet
      await mockAdVery.connect(poster).faucet();

      // Approve marketplace to spend tokens
      await mockAdVery.connect(poster).approve(
        await taskMarketplace.getAddress(),
        BOOST_COST
      );

      // Boost the task
      await taskMarketplace.connect(poster).boostTask(1);

      const task = await taskMarketplace.tasks(1);
      expect(task.isBoosted).to.be.true;
    });

    it("Should fail to create task with zero value", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      
      await expect(
        taskMarketplace.connect(poster).createTask(deadline, { value: 0 })
      ).to.be.revertedWithCustomError(taskMarketplace, "InvalidAmount");
    });
  });
});
