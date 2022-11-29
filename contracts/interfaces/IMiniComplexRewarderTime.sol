// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IMiniComplexRewarderTime {

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }

    struct PoolInfo {
        uint128 accBananaPerShare;
        uint64 lastRewardTime;
        uint64 allocPoint;
    }

    function userInfo(uint256 arg1, address arg2) external view returns (UserInfo memory);
    function poolInfo(uint256 pid) external view returns (PoolInfo memory);
    function poolIds(uint256 arg1) external view returns (uint256);
    function MINIAPE_V2() external view returns (address);
    function rewardToken() external view returns (address);
    function rewardPerSecond() external view returns (uint256);
    function totalAllocPoint() external view returns (uint256);

    function onBananaReward (uint256 pid, address _user, address to, uint256, uint256 lpToken) external;
    function pendingTokens(uint256 pid, address user, uint256) external view returns (IERC20[] memory rewardTokens, uint256[] memory rewardAmounts);
    function setRewardPerSecond(uint256 _rewardPerSecond) external;
    function poolLength() external view returns (uint256 pools);
    function add(uint256 allocPoint, uint256 _pid) external;
    function set(uint256 _pid, uint256 _allocPoint) external;
    function pendingToken(uint256 _pid, address _user) external view returns (uint256 pending);
    function massUpdatePools(uint256[] calldata pids) external;
    function updatePool(uint256 pid) external returns (PoolInfo memory pool);
}