// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AdVeryToken
 * @author VeryTask Team
 * @notice Mock AD VERY token for boosting task visibility
 * @dev Simple burnable ERC20 - in production, this would be the real AD VERY token
 * 
 * Purpose:
 * - Users burn AD VERY to boost their task visibility
 * - Boosted tasks appear first in search results (Gold pins on map)
 * - Creates deflationary tokenomics
 */
contract AdVeryToken is ERC20, ERC20Burnable, Ownable {
    
    /// @notice Initial supply of 1 billion tokens (with 18 decimals)
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10**18;

    constructor() ERC20("AD VERY", "ADVERY") Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /**
     * @notice Mint new tokens (only owner)
     * @param to Address to receive tokens
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Airdrop tokens to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amount Amount each recipient receives
     */
    function airdrop(address[] calldata recipients, uint256 amount) external onlyOwner {
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amount);
        }
    }
}
