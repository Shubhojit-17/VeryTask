// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title UserReputation
 * @author VeryTask Team
 * @notice Soulbound Token (SBT) for worker reputation on VeryTask
 * @dev Non-transferable ERC721 that tracks worker XP/reputation
 * 
 * Design Philosophy:
 * - Each successful task completion = +1 XP
 * - Tokens are SOULBOUND (cannot be transferred)
 * - Only the TaskMarketplace contract can mint (prevents gaming)
 * - XP is visible on-chain for trust verification
 * 
 * Why Soulbound?
 * - Prevents reputation marketplaces (buying/selling rep)
 * - Ensures reputation is earned, not purchased
 * - Creates genuine trust in the gig economy
 */
contract UserReputation is ERC721, Ownable {
    
    // ============ State Variables ============
    
    /// @notice Address of the TaskMarketplace contract (only minter)
    address public taskMarketplace;
    
    /// @notice Token ID counter
    uint256 private _tokenIdCounter;
    
    /// @notice Mapping from user address to their XP (reputation points)
    mapping(address => uint256) public xpBalance;
    
    /// @notice Mapping from user address to their SBT token ID
    /// @dev Each user can only have ONE SBT (minted on first task completion)
    mapping(address => uint256) public userTokenId;
    
    /// @notice Whether the user has been issued an SBT
    mapping(address => bool) public hasSBT;
    
    /// @notice XP threshold for "Verified Pro" status
    uint256 public constant VERIFIED_PRO_THRESHOLD = 10;
    
    /// @notice XP threshold for "Expert" status
    uint256 public constant EXPERT_THRESHOLD = 50;
    
    /// @notice XP threshold for "Master" status
    uint256 public constant MASTER_THRESHOLD = 100;

    // ============ Events ============
    
    /// @notice Emitted when XP is awarded to a worker
    event XPAwarded(
        address indexed worker,
        uint256 newXP,
        uint256 totalXP
    );
    
    /// @notice Emitted when a worker receives their first SBT
    event SBTMinted(
        address indexed worker,
        uint256 indexed tokenId
    );
    
    /// @notice Emitted when a worker reaches a new tier
    event TierAchieved(
        address indexed worker,
        string tier
    );
    
    /// @notice Emitted when TaskMarketplace address is updated
    event MarketplaceUpdated(
        address indexed oldMarketplace,
        address indexed newMarketplace
    );

    // ============ Errors ============
    
    /// @notice Thrown when non-marketplace tries to mint
    error OnlyMarketplace();
    
    /// @notice Thrown when attempting to transfer a soulbound token
    error SoulboundTransferBlocked();
    
    /// @notice Thrown when marketplace address is zero
    error InvalidMarketplace();

    // ============ Modifiers ============
    
    /// @notice Restricts function to TaskMarketplace only
    modifier onlyMarketplace() {
        if (msg.sender != taskMarketplace) revert OnlyMarketplace();
        _;
    }

    // ============ Constructor ============
    
    /**
     * @notice Initializes the SBT contract
     * @param _taskMarketplace Address of the TaskMarketplace contract
     * 
     * Note: Can be deployed before TaskMarketplace, then set via setMarketplace()
     */
    constructor(address _taskMarketplace) 
        ERC721("VeryTask Reputation", "VREP") 
        Ownable(msg.sender) 
    {
        taskMarketplace = _taskMarketplace;
    }

    // ============ Core Functions ============
    
    /**
     * @notice Mint XP to a worker (called by TaskMarketplace on task approval)
     * @param to Address of the worker to reward
     * 
     * Logic:
     * - First time: Mints an SBT to the worker + 1 XP
     * - Subsequent: Just adds +1 XP to existing balance
     * 
     * Security:
     * - Only callable by TaskMarketplace
     * - Cannot be gamed by direct calls
     */
    function mint(address to) external onlyMarketplace {
        require(to != address(0), "Cannot mint to zero address");
        
        // If user doesn't have an SBT yet, mint one
        if (!hasSBT[to]) {
            _tokenIdCounter++;
            uint256 newTokenId = _tokenIdCounter;
            
            _safeMint(to, newTokenId);
            
            hasSBT[to] = true;
            userTokenId[to] = newTokenId;
            
            emit SBTMinted(to, newTokenId);
        }
        
        // Award 1 XP
        uint256 previousXP = xpBalance[to];
        xpBalance[to] += 1;
        
        emit XPAwarded(to, 1, xpBalance[to]);
        
        // Check for tier achievements
        _checkTierAchievement(to, previousXP, xpBalance[to]);
    }
    
    /**
     * @notice Check and emit tier achievement events
     * @param worker Address of the worker
     * @param previousXP XP before the award
     * @param newXP XP after the award
     */
    function _checkTierAchievement(
        address worker, 
        uint256 previousXP, 
        uint256 newXP
    ) internal {
        // Check each threshold crossing
        if (previousXP < VERIFIED_PRO_THRESHOLD && newXP >= VERIFIED_PRO_THRESHOLD) {
            emit TierAchieved(worker, "Verified Pro");
        }
        if (previousXP < EXPERT_THRESHOLD && newXP >= EXPERT_THRESHOLD) {
            emit TierAchieved(worker, "Expert");
        }
        if (previousXP < MASTER_THRESHOLD && newXP >= MASTER_THRESHOLD) {
            emit TierAchieved(worker, "Master");
        }
    }

    // ============ Soulbound Logic ============
    
    /**
     * @notice Override to make tokens soulbound (non-transferable)
     * @dev This is the OpenZeppelin v5 pattern for blocking transfers
     * 
     * Security: This is the CRITICAL function that makes the token soulbound
     * - Allows minting (from = address(0))
     * - Blocks all transfers
     * - Blocks burning (optional, currently allowed by owner)
     * 
     * Why _update instead of transferFrom?
     * - _update is called by ALL transfer functions internally
     * - This catches transferFrom, safeTransferFrom, etc.
     * - More secure than overriding individual functions
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        
        // Allow minting (from is zero address)
        // Block all other transfers
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransferBlocked();
        }
        
        return super._update(to, tokenId, auth);
    }
    
    /**
     * @notice Explicitly block approve (defense in depth)
     * @dev Even though transfers are blocked, we block approvals for clarity
     */
    function approve(address, uint256) public pure override {
        revert SoulboundTransferBlocked();
    }
    
    /**
     * @notice Explicitly block setApprovalForAll (defense in depth)
     */
    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundTransferBlocked();
    }

    // ============ View Functions ============
    
    /**
     * @notice Get the XP balance for a user
     * @param user Address to check
     * @return XP balance
     */
    function getXP(address user) external view returns (uint256) {
        return xpBalance[user];
    }
    
    /**
     * @notice Get the reputation tier for a user
     * @param user Address to check
     * @return Tier name as string
     */
    function getTier(address user) external view returns (string memory) {
        uint256 xp = xpBalance[user];
        
        if (xp >= MASTER_THRESHOLD) return "Master";
        if (xp >= EXPERT_THRESHOLD) return "Expert";
        if (xp >= VERIFIED_PRO_THRESHOLD) return "Verified Pro";
        if (xp > 0) return "Rookie";
        return "Newcomer";
    }
    
    /**
     * @notice Check if a user is a Verified Pro or higher
     * @param user Address to check
     * @return True if user has >= VERIFIED_PRO_THRESHOLD XP
     */
    function isVerifiedPro(address user) external view returns (bool) {
        return xpBalance[user] >= VERIFIED_PRO_THRESHOLD;
    }
    
    /**
     * @notice Get the token URI (metadata)
     * @dev Returns a base64-encoded JSON with dynamic tier info
     * @param tokenId The token ID
     * @return URI string
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        
        address owner = ownerOf(tokenId);
        uint256 xp = xpBalance[owner];
        string memory tier = this.getTier(owner);
        
        // Return a data URI with JSON metadata
        // In production, you'd use a proper metadata server
        return string(abi.encodePacked(
            "data:application/json;base64,",
            _base64Encode(abi.encodePacked(
                '{"name":"VeryTask Reputation #', _toString(tokenId), '",',
                '"description":"Soulbound reputation token for VeryTask workers",',
                '"attributes":[',
                '{"trait_type":"XP","value":', _toString(xp), '},',
                '{"trait_type":"Tier","value":"', tier, '"}',
                ']}'
            ))
        ));
    }

    // ============ Admin Functions ============
    
    /**
     * @notice Update the TaskMarketplace address
     * @param _taskMarketplace New marketplace address
     */
    function setMarketplace(address _taskMarketplace) external onlyOwner {
        if (_taskMarketplace == address(0)) revert InvalidMarketplace();
        
        address old = taskMarketplace;
        taskMarketplace = _taskMarketplace;
        
        emit MarketplaceUpdated(old, _taskMarketplace);
    }

    // ============ Internal Helpers ============
    
    /**
     * @notice Convert uint256 to string
     * @param value Number to convert
     * @return String representation
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        
        return string(buffer);
    }
    
    /**
     * @notice Base64 encode bytes
     * @param data Bytes to encode
     * @return Base64 encoded string
     */
    function _base64Encode(bytes memory data) internal pure returns (string memory) {
        string memory TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        
        if (data.length == 0) return "";
        
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        bytes memory result = new bytes(encodedLen);
        
        bytes memory table = bytes(TABLE);
        
        uint256 dataPtr;
        uint256 resultPtr;
        
        assembly {
            dataPtr := add(data, 32)
            resultPtr := add(result, 32)
        }
        
        for (uint256 i = 0; i < data.length / 3; i++) {
            uint256 input;
            assembly {
                input := mload(add(dataPtr, mul(i, 3)))
            }
            input = input >> 232;
            
            assembly {
                mstore8(resultPtr, mload(add(table, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(table, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(table, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(table, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }
        }
        
        uint256 remainder = data.length % 3;
        if (remainder == 1) {
            uint8 input = uint8(data[data.length - 1]);
            result[encodedLen - 4] = table[input >> 2];
            result[encodedLen - 3] = table[(input & 0x03) << 4];
            result[encodedLen - 2] = "=";
            result[encodedLen - 1] = "=";
        } else if (remainder == 2) {
            uint16 input = uint16(uint8(data[data.length - 2])) << 8 | uint8(data[data.length - 1]);
            result[encodedLen - 4] = table[input >> 10];
            result[encodedLen - 3] = table[(input >> 4) & 0x3F];
            result[encodedLen - 2] = table[(input & 0x0F) << 2];
            result[encodedLen - 1] = "=";
        }
        
        return string(result);
    }
}
