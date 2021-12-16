// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (access/Ownable.sol)

pragma solidity ^0.8.10;

abstract contract Cooldown {
    mapping(address => uint256) private cooldowns;

    modifier startCooldown(address _address) {
        cooldowns[_address] = block.number;
        _;
    }

    modifier checkCooldown(address _address) {
        uint256 cooldown = cooldowns[_address];
        require(block.number > cooldown && cooldown != 0, "Can't call multiple functions on the same block");
        _;
    }
}