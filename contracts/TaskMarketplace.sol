// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TaskMarketplace
 * @author VeryTask Team
 * @notice Core marketplace contract for the hyper-local gig economy on Very Chain
 * @dev Implements escrow pattern with dispute resolution and reputation integration
 * 
 * Security Features:
 * - ReentrancyGuard: Prevents reentrancy attacks on fund transfers
 * - Checks-Effects-Interactions: State changes before external calls
 * - SafeERC20: Safe token transfers that handle non-standard ERC20s
 * - Access Control: Role-based function restrictions
 */

/// @notice Interface for the AD VERY token (for boosting tasks)
interface IAdVeryToken {
    function burnFrom(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @notice Interface for the UserReputation SBT contract
interface IUserReputation {
    function mint(address to) external;
    function getXP(address user) external view returns (uint256);
}

contract TaskMarketplace is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Enums ============
    
    /// @notice Possible states of a task
    enum TaskStatus {
        Open,           // Task created, waiting for worker
        InProgress,     // Worker assigned, work ongoing
        Submitted,      // Worker submitted proof, awaiting approval
        Completed,      // Task completed, funds released
        Disputed,       // Dispute raised, funds frozen
        Cancelled       // Task cancelled by poster (only if no worker assigned)
    }

    // ============ Structs ============
    
    /// @notice Core task data structure
    struct Task {
        uint256 id;              // Unique task identifier
        address poster;          // Address of task creator
        address worker;          // Address of assigned worker (address(0) if none)
        uint256 amount;          // Payment amount in wei (or token units)
        TaskStatus status;       // Current task status
        bool isDisputed;         // Whether task is in dispute
        string ipfsProof;        // IPFS hash of work proof (e.g., photo)
        uint256 createdAt;       // Timestamp of creation
        uint256 deadline;        // Optional deadline (0 = no deadline)
        bool isBoosted;          // Whether task was boosted with AD VERY
    }

    // ============ State Variables ============
    
    /// @notice Counter for generating unique task IDs
    uint256 public taskCounter;
    
    /// @notice Mapping from task ID to Task struct
    mapping(uint256 => Task) public tasks;
    
    /// @notice Reference to the UserReputation SBT contract
    IUserReputation public reputationContract;
    
    /// @notice Reference to the AD VERY token for boosting
    IAdVeryToken public adVeryToken;
    
    /// @notice Cost in AD VERY tokens to boost a task
    uint256 public boostCost;
    
    /// @notice Platform fee percentage (in basis points, e.g., 250 = 2.5%)
    uint256 public platformFeeBps;
    
    /// @notice Maximum platform fee (10% = 1000 bps)
    uint256 public constant MAX_FEE_BPS = 1000;
    
    /// @notice Accumulated platform fees ready for withdrawal
    uint256 public accumulatedFees;

    // ============ Events ============
    
    /// @notice Emitted when a new task is created
    event TaskCreated(
        uint256 indexed taskId,
        address indexed poster,
        uint256 amount,
        uint256 deadline
    );
    
    /// @notice Emitted when a worker is assigned to a task
    event WorkerAssigned(
        uint256 indexed taskId,
        address indexed worker
    );
    
    /// @notice Emitted when work proof is submitted
    event WorkSubmitted(
        uint256 indexed taskId,
        address indexed worker,
        string ipfsHash
    );
    
    /// @notice Emitted when task is approved and payment released
    event TaskCompleted(
        uint256 indexed taskId,
        address indexed worker,
        uint256 payoutAmount
    );
    
    /// @notice Emitted when a task is boosted with AD VERY
    event TaskBoosted(
        uint256 indexed taskId,
        address indexed booster,
        uint256 adVeryBurned
    );
    
    /// @notice Emitted when a dispute is raised
    event DisputeRaised(
        uint256 indexed taskId,
        address indexed raisedBy
    );
    
    /// @notice Emitted when a dispute is resolved by admin
    event DisputeResolved(
        uint256 indexed taskId,
        address indexed winner,
        uint256 amount
    );
    
    /// @notice Emitted when a task is cancelled
    event TaskCancelled(
        uint256 indexed taskId
    );

    // ============ Errors ============
    
    /// @notice Thrown when task doesn't exist
    error TaskNotFound(uint256 taskId);
    
    /// @notice Thrown when caller lacks permission
    error Unauthorized();
    
    /// @notice Thrown when task is in wrong status for operation
    error InvalidTaskStatus(TaskStatus current, TaskStatus required);
    
    /// @notice Thrown when amount is zero or invalid
    error InvalidAmount();
    
    /// @notice Thrown when worker tries to accept own task
    error CannotAcceptOwnTask();
    
    /// @notice Thrown when IPFS hash is empty
    error EmptyProof();

    // ============ Modifiers ============
    
    /// @notice Ensures task exists
    modifier taskExists(uint256 taskId) {
        if (taskId == 0 || taskId > taskCounter) revert TaskNotFound(taskId);
        _;
    }
    
    /// @notice Ensures caller is the task poster
    modifier onlyPoster(uint256 taskId) {
        if (tasks[taskId].poster != msg.sender) revert Unauthorized();
        _;
    }
    
    /// @notice Ensures caller is the assigned worker
    modifier onlyWorker(uint256 taskId) {
        if (tasks[taskId].worker != msg.sender) revert Unauthorized();
        _;
    }
    
    /// @notice Ensures task is in expected status
    modifier inStatus(uint256 taskId, TaskStatus expected) {
        if (tasks[taskId].status != expected) {
            revert InvalidTaskStatus(tasks[taskId].status, expected);
        }
        _;
    }

    // ============ Constructor ============
    
    /**
     * @notice Initializes the marketplace with external contract references
     * @param _reputationContract Address of the UserReputation SBT contract
     * @param _adVeryToken Address of the AD VERY token contract
     * @param _boostCost Cost in AD VERY to boost a task
     * @param _platformFeeBps Platform fee in basis points
     */
    constructor(
        address _reputationContract,
        address _adVeryToken,
        uint256 _boostCost,
        uint256 _platformFeeBps
    ) Ownable(msg.sender) {
        require(_platformFeeBps <= MAX_FEE_BPS, "Fee too high");
        
        reputationContract = IUserReputation(_reputationContract);
        adVeryToken = IAdVeryToken(_adVeryToken);
        boostCost = _boostCost;
        platformFeeBps = _platformFeeBps;
    }

    // ============ Core Functions ============
    
    /**
     * @notice Creates a new task with escrowed payment
     * @dev Uses native VERY token (msg.value). For ERC20, see createTaskWithToken
     * @param deadline Optional deadline timestamp (0 = no deadline)
     * @return taskId The ID of the newly created task
     * 
     * Security: Checks-Effects-Interactions pattern applied
     * - Check: Validates amount > 0
     * - Effect: Updates state (taskCounter, tasks mapping)
     * - Interaction: None (funds received via payable)
     */
    function createTask(uint256 deadline) external payable nonReentrant returns (uint256 taskId) {
        // CHECK: Validate payment amount
        if (msg.value == 0) revert InvalidAmount();
        
        // EFFECT: Increment counter and create task
        taskCounter++;
        taskId = taskCounter;
        
        tasks[taskId] = Task({
            id: taskId,
            poster: msg.sender,
            worker: address(0),
            amount: msg.value,
            status: TaskStatus.Open,
            isDisputed: false,
            ipfsProof: "",
            createdAt: block.timestamp,
            deadline: deadline,
            isBoosted: false
        });
        
        emit TaskCreated(taskId, msg.sender, msg.value, deadline);
    }
    
    /**
     * @notice Worker accepts/assigns themselves to an open task
     * @param taskId The ID of the task to accept
     * 
     * Security:
     * - Prevents poster from accepting their own task
     * - Ensures task is in Open status
     * - Worker commits by assigning, reputation at stake
     */
    function assignWorker(uint256 taskId) 
        external 
        nonReentrant 
        taskExists(taskId) 
        inStatus(taskId, TaskStatus.Open) 
    {
        Task storage task = tasks[taskId];
        
        // CHECK: Poster cannot accept their own task
        if (task.poster == msg.sender) revert CannotAcceptOwnTask();
        
        // EFFECT: Assign worker and update status
        task.worker = msg.sender;
        task.status = TaskStatus.InProgress;
        
        emit WorkerAssigned(taskId, msg.sender);
    }
    
    /**
     * @notice Worker submits proof of completed work
     * @param taskId The ID of the task
     * @param ipfsHash IPFS CID of the proof (photo, document, etc.)
     * 
     * Security:
     * - Only assigned worker can submit
     * - Proof is stored on-chain for dispute reference
     * - IPFS provides decentralized, immutable storage
     */
    function submitWork(uint256 taskId, string calldata ipfsHash) 
        external 
        nonReentrant 
        taskExists(taskId) 
        onlyWorker(taskId) 
        inStatus(taskId, TaskStatus.InProgress) 
    {
        // CHECK: Validate proof is not empty
        if (bytes(ipfsHash).length == 0) revert EmptyProof();
        
        Task storage task = tasks[taskId];
        
        // EFFECT: Store proof and update status
        task.ipfsProof = ipfsHash;
        task.status = TaskStatus.Submitted;
        
        emit WorkSubmitted(taskId, msg.sender, ipfsHash);
    }
    
    /**
     * @notice Poster approves work and releases payment to worker
     * @param taskId The ID of the task to approve
     * 
     * Security (Checks-Effects-Interactions):
     * - CHECK: Status validation via modifier
     * - EFFECT: Update status to Completed BEFORE transfer
     * - INTERACTION: Transfer funds and mint reputation AFTER state change
     * 
     * This order prevents reentrancy even without the guard
     */
    function approveAndPay(uint256 taskId) 
        external 
        nonReentrant 
        taskExists(taskId) 
        onlyPoster(taskId) 
        inStatus(taskId, TaskStatus.Submitted) 
    {
        Task storage task = tasks[taskId];
        
        // EFFECT: Mark as completed BEFORE any external calls
        task.status = TaskStatus.Completed;
        
        // Calculate platform fee and worker payout
        uint256 fee = (task.amount * platformFeeBps) / 10000;
        uint256 payout = task.amount - fee;
        accumulatedFees += fee;
        
        // INTERACTION: Transfer funds to worker
        (bool success, ) = payable(task.worker).call{value: payout}("");
        require(success, "Transfer failed");
        
        // INTERACTION: Mint reputation XP to worker
        // External call is safe here as state is already finalized
        try reputationContract.mint(task.worker) {
            // Reputation minted successfully
        } catch {
            // Don't revert if reputation mint fails
            // Worker still gets paid, reputation is a bonus
        }
        
        emit TaskCompleted(taskId, task.worker, payout);
    }
    
    /**
     * @notice Boost task visibility by burning AD VERY tokens
     * @param taskId The ID of the task to boost
     * 
     * Security:
     * - Uses burnFrom which requires prior approval
     * - Tokens are permanently destroyed, not transferred
     * - Anyone can boost any task (promotional flexibility)
     */
    function boostTask(uint256 taskId) 
        external 
        nonReentrant 
        taskExists(taskId) 
    {
        Task storage task = tasks[taskId];
        
        // CHECK: Task must be open or in progress to boost
        require(
            task.status == TaskStatus.Open || task.status == TaskStatus.InProgress,
            "Cannot boost completed/disputed task"
        );
        require(!task.isBoosted, "Already boosted");
        
        // EFFECT: Mark as boosted
        task.isBoosted = true;
        
        // INTERACTION: Burn AD VERY tokens from sender
        // burnFrom requires prior approval via approve()
        adVeryToken.burnFrom(msg.sender, boostCost);
        
        emit TaskBoosted(taskId, msg.sender, boostCost);
    }
    
    /**
     * @notice Raise a dispute to freeze funds for arbitration
     * @param taskId The ID of the task to dispute
     * 
     * Security:
     * - Only poster or worker can raise dispute
     * - Funds remain locked in contract until resolution
     * - Status prevents further state changes
     */
    function raiseDispute(uint256 taskId) 
        external 
        nonReentrant 
        taskExists(taskId) 
    {
        Task storage task = tasks[taskId];
        
        // CHECK: Only parties involved can dispute
        require(
            msg.sender == task.poster || msg.sender == task.worker,
            "Not a party to this task"
        );
        
        // CHECK: Can only dispute tasks in progress or submitted
        require(
            task.status == TaskStatus.InProgress || task.status == TaskStatus.Submitted,
            "Cannot dispute at this stage"
        );
        
        // EFFECT: Freeze the task
        task.status = TaskStatus.Disputed;
        task.isDisputed = true;
        
        emit DisputeRaised(taskId, msg.sender);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Resolve a dispute and release funds to winner
     * @param taskId The ID of the disputed task
     * @param winner Address to receive the escrowed funds
     * @param mintReputation Whether to mint reputation to winner (if worker wins)
     * 
     * Security:
     * - Only owner (admin/DAO) can resolve disputes
     * - Winner must be either poster or worker
     */
    function resolveDispute(
        uint256 taskId, 
        address winner,
        bool mintReputation
    ) 
        external 
        onlyOwner 
        nonReentrant 
        taskExists(taskId) 
        inStatus(taskId, TaskStatus.Disputed) 
    {
        Task storage task = tasks[taskId];
        
        // CHECK: Winner must be poster or worker
        require(
            winner == task.poster || winner == task.worker,
            "Invalid winner"
        );
        
        // EFFECT: Mark as completed
        task.status = TaskStatus.Completed;
        
        // Calculate payout (no fee on disputed resolutions as goodwill)
        uint256 payout = task.amount;
        
        // INTERACTION: Transfer funds to winner
        (bool success, ) = payable(winner).call{value: payout}("");
        require(success, "Transfer failed");
        
        // INTERACTION: Optionally mint reputation if worker wins
        if (mintReputation && winner == task.worker) {
            try reputationContract.mint(task.worker) {} catch {}
        }
        
        emit DisputeResolved(taskId, winner, payout);
    }
    
    /**
     * @notice Cancel an open task and refund the poster
     * @param taskId The ID of the task to cancel
     */
    function cancelTask(uint256 taskId) 
        external 
        nonReentrant 
        taskExists(taskId) 
        onlyPoster(taskId) 
        inStatus(taskId, TaskStatus.Open) 
    {
        Task storage task = tasks[taskId];
        
        // EFFECT: Mark as cancelled
        task.status = TaskStatus.Cancelled;
        
        // INTERACTION: Refund poster
        (bool success, ) = payable(task.poster).call{value: task.amount}("");
        require(success, "Refund failed");
        
        emit TaskCancelled(taskId);
    }
    
    /**
     * @notice Withdraw accumulated platform fees
     * @param to Address to receive fees
     */
    function withdrawFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @notice Update the boost cost
     * @param _boostCost New cost in AD VERY tokens
     */
    function setBoostCost(uint256 _boostCost) external onlyOwner {
        boostCost = _boostCost;
    }
    
    /**
     * @notice Update the platform fee
     * @param _platformFeeBps New fee in basis points
     */
    function setPlatformFee(uint256 _platformFeeBps) external onlyOwner {
        require(_platformFeeBps <= MAX_FEE_BPS, "Fee too high");
        platformFeeBps = _platformFeeBps;
    }
    
    /**
     * @notice Update the reputation contract address
     * @param _reputationContract New contract address
     */
    function setReputationContract(address _reputationContract) external onlyOwner {
        reputationContract = IUserReputation(_reputationContract);
    }

    // ============ View Functions ============
    
    /**
     * @notice Get full task details
     * @param taskId The ID of the task
     * @return The Task struct
     */
    function getTask(uint256 taskId) external view taskExists(taskId) returns (Task memory) {
        return tasks[taskId];
    }
    
    /**
     * @notice Check if a task is available for workers
     * @param taskId The ID of the task
     * @return True if task is open
     */
    function isTaskOpen(uint256 taskId) external view taskExists(taskId) returns (bool) {
        return tasks[taskId].status == TaskStatus.Open;
    }
    
    /**
     * @notice Get worker's XP from reputation contract
     * @param worker Address of the worker
     * @return XP amount
     */
    function getWorkerXP(address worker) external view returns (uint256) {
        return reputationContract.getXP(worker);
    }
}
