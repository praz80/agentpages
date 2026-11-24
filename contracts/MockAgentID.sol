// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockAgentID — test double for the official Agent ID contract
/// @notice Lets tests and testnet demos control who "holds" an Agent ID.
///         NOT for production use: on BNB Chain mainnet, AgentPages must be
///         constructed with the real Agent ID contract
///         0x60b9262456de011f7d15a54cdd8c48baaa8b022f.
contract MockAgentID {
    mapping(address => uint256) private _balances;

    /// @notice Set the Agent ID balance of an address (test only).
    function setBalance(address owner, uint256 amount) external {
        _balances[owner] = amount;
    }

    /// @notice Mint one Agent ID to an address (test only).
    function mint(address owner) external {
        _balances[owner] += 1;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }
}
