// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockAdVery
 * @author VeryTask Team
 * @notice Mock AD VERY token for hackathon demo purposes
 * @dev This is a DEMO token - NOT the real AD VERY token from Very Network
 * 
 * Purpose:
 * - Allows testing of the "Boost Task" feature without mainnet tokens
 * - Provides a faucet() for demo users to get free tokens
 * - Burns tokens when boosting (deflationary mechanism demo)
 * 
 * In Production:
 * - Replace with the official AD VERY token address
 * - Remove faucet() function
 * - Update TaskMarketplace to use the real token interface
 */
contract MockAdVery is ERC20, ERC20Burnable, Ownable {
    
    // ============ Constants ============
    
    /// @notice Initial supply minted to deployer (1 million tokens)
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10**18;
    
    /// @notice Amount given per faucet() call (100 tokens)
    uint256 public constant FAUCET_AMOUNT = 100 * 10**18;
    
    /// @notice Cooldown between faucet claims (1 hour for demo)
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    
    /// @notice Maximum supply that can ever exist (10 million)
    uint256 public constant MAX_SUPPLY = 10_000_000 * 10**18;

    // ============ State Variables ============
    
    /// @notice Tracks last faucet claim time per address
    mapping(address => uint256) public lastFaucetClaim;
    
    /// @notice Total tokens distributed via faucet
    uint256 public totalFaucetDistributed;
    
    /// @notice Whether faucet is enabled
    bool public faucetEnabled = true;

    // ============ Events ============
    
    /// @notice Emitted when tokens are claimed from faucet
    event FaucetClaimed(address indexed user, uint256 amount);
    
    /// @notice Emitted when faucet is toggled
    event FaucetToggled(bool enabled);

    // ============ Errors ============
    
    /// @notice Thrown when faucet is on cooldown
    error FaucetCooldownActive(uint256 remainingTime);
    
    /// @notice Thrown when faucet is disabled
    error FaucetDisabled();
    
    /// @notice Thrown when max supply would be exceeded
    error MaxSupplyExceeded();

    // ============ Constructor ============
    
    /**
     * @notice Deploys MockAdVery with initial supply to deployer
     * @dev Token name: "Mock AD VERY", Symbol: "mADVERY"
     * 
     * Note: The "m" prefix indicates this is a mock/testnet token
     * to prevent confusion with the real AD VERY token.
     */
    constructor() ERC20("Mock AD VERY", "mADVERY") Ownable(msg.sender) {
        // Mint initial supply to deployer for liquidity/distribution
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // ============ Public Functions ============
    
    /**
     * @notice Claim free tokens from the faucet (demo purposes)
     * @dev Rate-limited to prevent abuse
     * 
     * Features:
     * - 100 tokens per claim
     * - 1 hour cooldown between claims
     * - Can be disabled by owner
     * 
     * Usage in Demo:
     * 1. User clicks "Get AD VERY" button
     * 2. Frontend calls this function
     * 3. User receives tokens to test "Boost Task" feature
     */
    function faucet() external {
        // Check if faucet is enabled
        if (!faucetEnabled) {
            revert FaucetDisabled();
        }
        
        // Check cooldown
        uint256 lastClaim = lastFaucetClaim[msg.sender];
        if (lastClaim != 0 && block.timestamp < lastClaim + FAUCET_COOLDOWN) {
            uint256 remaining = (lastClaim + FAUCET_COOLDOWN) - block.timestamp;
            revert FaucetCooldownActive(remaining);
        }
        
        // Check max supply
        if (totalSupply() + FAUCET_AMOUNT > MAX_SUPPLY) {
            revert MaxSupplyExceeded();
        }
        
        // Update state before minting (Checks-Effects-Interactions)
        lastFaucetClaim[msg.sender] = block.timestamp;
        totalFaucetDistributed += FAUCET_AMOUNT;
        
        // Mint tokens to caller
        _mint(msg.sender, FAUCET_AMOUNT);
        
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
    
    /**
     * @notice Check remaining cooldown for an address
     * @param user Address to check
     * @return Seconds remaining until faucet is available (0 if ready)
     */
    function faucetCooldownRemaining(address user) external view returns (uint256) {
        uint256 lastClaim = lastFaucetClaim[user];
        if (lastClaim == 0) return 0;
        
        uint256 cooldownEnd = lastClaim + FAUCET_COOLDOWN;
        if (block.timestamp >= cooldownEnd) return 0;
        
        return cooldownEnd - block.timestamp;
    }
    
    /**
     * @notice Check if an address can claim from faucet
     * @param user Address to check
     * @return True if user can claim now
     */
    function canClaimFaucet(address user) external view returns (bool) {
        if (!faucetEnabled) return false;
        if (totalSupply() + FAUCET_AMOUNT > MAX_SUPPLY) return false;
        
        uint256 lastClaim = lastFaucetClaim[user];
        if (lastClaim == 0) return true;
        
        return block.timestamp >= lastClaim + FAUCET_COOLDOWN;
    }

    // ============ Admin Functions ============
    
    /**
     * @notice Toggle faucet on/off
     * @param enabled Whether faucet should be enabled
     */
    function setFaucetEnabled(bool enabled) external onlyOwner {
        faucetEnabled = enabled;
        emit FaucetToggled(enabled);
    }
    
    /**
     * @notice Mint tokens to a specific address (owner only)
     * @param to Recipient address
     * @param amount Amount to mint
     * 
     * Use cases:
     * - Airdrops to hackathon judges
     * - Initial liquidity provision
     * - Demo account funding
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MaxSupplyExceeded();
        }
        _mint(to, amount);
    }
    
    /**
     * @notice Batch airdrop tokens to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amount Amount each recipient receives
     */
    function airdrop(address[] calldata recipients, uint256 amount) external onlyOwner {
        uint256 totalAmount = amount * recipients.length;
        if (totalSupply() + totalAmount > MAX_SUPPLY) {
            revert MaxSupplyExceeded();
        }
        
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amount);
        }
    }

    // ============ View Functions ============
    
    /**
     * @notice Get token decimals (18, standard)
     * @return Number of decimals
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
    
    /**
     * @notice Get remaining tokens that can be minted
     * @return Tokens remaining before max supply
     */
    function remainingMintable() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}
