// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IMiniApeV2 {

    struct UserInfo {
        uint256 amount;
        int256 rewardDebt;
    }

    struct PoolInfo {
        uint128 accBananaPerShare;
        uint64 lastRewardTime;
        uint64 allocPoint;
    }

    function BANANA() external view returns (address);
    function poolInfo(uint256 pid) external view returns (PoolInfo memory);
    function rewarder(uint256 pid) external view returns (address);
    function lpToken(uint256 pid) external view returns (address);
    function userInfo(uint256 arg1, address arg2) external view returns (UserInfo memory);
    function totalAllocPoint() external view returns (uint256); 
    function bananaPerSecond() external view returns (uint256);
    function pendingBanana(uint256 _pid, address _user) external view returns (uint256 pending);
    function poolLength() external view returns (uint256 pools);

    function massUpdatePools(uint256[] calldata pids) external;
    function updatePool(uint256 pid) external returns (PoolInfo memory pool);
    function deposit(uint256 pid, uint256 amount, address to) external;
    function withdraw(uint256 pid, uint256 amount, address to) external;
    function harvest(uint256 pid, address to) external;
    function withdrawAndHarvest(uint256 pid, uint256 amount, address to) external;
    function emergencyWithdraw(uint256 pid, address to) external;
}