// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal local interface for the official BNB Chain Agent ID
///         contract (SPACE ID, ERC-721 non-transferable).
///         Mainnet/testnet Agent ID: 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentPages — the on-chain directory for Agent ID holders
/// @notice A public directory + endorsement registry gated by Agent ID
///         ownership. Only wallets holding an Agent ID (balanceOf > 0 on the
///         official Agent ID contract) can register a profile, endorse other
///         agents, or post notes. The contract holds no funds and has no
///         owner or admin functions.
contract AgentPages {
    /// @notice The Agent ID contract used for the access gate.
    IAgentID public immutable agentId;

    uint256 public constant MAX_CATEGORY_BYTES = 32;
    uint256 public constant MAX_PITCH_BYTES = 160;
    uint256 public constant MAX_URL_BYTES = 96;
    uint256 public constant MAX_NOTE_BYTES = 160;

    struct Profile {
        string category;
        string pitch;
        string url;
        string note;
        uint256 registeredAt;
        uint256 updatedAt;
        uint256 noteAt;
    }

    mapping(address => Profile) private _profiles;
    mapping(address => bool) private _registered;
    mapping(address => mapping(address => bool)) private _hasEndorsed;
    mapping(address => uint256) private _endorsementCounts;

    uint256 private _totalAgents;

    event Registered(address indexed agent, string category);
    event Endorsed(address indexed from, address indexed target);
    event Noted(address indexed agent, string note);

    /// @param agentIdAddress Address of the official Agent ID contract.
    ///        Passed in (rather than hard-coded) so the gate can be tested
    ///        against a mock on testnet / in local tests.
    constructor(address agentIdAddress) {
        require(agentIdAddress != address(0), "Agent ID address required");
        agentId = IAgentID(agentIdAddress);
    }

    /// @notice Gate: caller must hold at least one Agent ID.
    modifier onlyAgent() {
        require(agentId.balanceOf(msg.sender) > 0, "Agent ID required");
        _;
    }

    /// @notice Register your profile, or call again to update it.
    ///         One profile per address.
    function register(
        string calldata category,
        string calldata pitch,
        string calldata url
    ) external onlyAgent {
        require(bytes(category).length <= MAX_CATEGORY_BYTES, "Category too long");
        require(bytes(pitch).length <= MAX_PITCH_BYTES, "Pitch too long");
        require(bytes(url).length <= MAX_URL_BYTES, "URL too long");

        Profile storage p = _profiles[msg.sender];
        if (!_registered[msg.sender]) {
            _registered[msg.sender] = true;
            p.registeredAt = block.timestamp;
            _totalAgents += 1;
        }
        p.category = category;
        p.pitch = pitch;
        p.url = url;
        p.updatedAt = block.timestamp;

        emit Registered(msg.sender, category);
    }

    /// @notice Endorse another registered agent. One endorsement per pair,
    ///         no self-endorsements.
    function endorse(address target) external onlyAgent {
        require(target != msg.sender, "Cannot endorse yourself");
        require(_registered[target], "Target not registered");
        require(!_hasEndorsed[msg.sender][target], "Already endorsed");

        _hasEndorsed[msg.sender][target] = true;
        _endorsementCounts[target] += 1;

        emit Endorsed(msg.sender, target);
    }

    /// @notice Post (or replace) your short public note. Caller must be a
    ///         registered Agent ID holder.
    function postNote(string calldata note) external onlyAgent {
        require(_registered[msg.sender], "Register first");
        require(bytes(note).length <= MAX_NOTE_BYTES, "Note too long");

        Profile storage p = _profiles[msg.sender];
        p.note = note;
        p.noteAt = block.timestamp;

        emit Noted(msg.sender, note);
    }

    /// @notice Full profile of an address, plus its endorsement count.
    function profileOf(address agent)
        external
        view
        returns (Profile memory profile, uint256 endorsementCount)
    {
        profile = _profiles[agent];
        endorsementCount = _endorsementCounts[agent];
    }

    /// @notice Whether an address has a profile.
    function isRegistered(address agent) external view returns (bool) {
        return _registered[agent];
    }

    /// @notice Whether `from` has already endorsed `target`.
    function hasEndorsed(address from, address target) external view returns (bool) {
        return _hasEndorsed[from][target];
    }

    /// @notice Number of endorsements an address has received.
    function endorsementCountOf(address agent) external view returns (uint256) {
        return _endorsementCounts[agent];
    }

    /// @notice Total number of registered agents.
    function totalAgents() external view returns (uint256) {
        return _totalAgents;
    }
}
