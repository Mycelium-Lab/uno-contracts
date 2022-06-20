// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniversalMasterChef {
    struct UserInfo {
        uint256 amount;
        int256 rewardDebt;
    }

    struct PoolInfoV1 {
        address lpToken;
        uint256 allocPoint;
        uint256 lastRewardBlock;
        uint256 accTriPerShare;
    }

    struct PoolInfoV2 {
        uint128 accTriPerShare;
        uint64 lastRewardBlock;
        uint64 allocPoint;
    }

    function tri() external view returns (address); // V1

    function TRI() external view returns (address); // V2

    function MASTER_PID() external view returns (uint256); // V2

    function MASTER_CHEF() external view returns (address); // V2

    function poolInfo(uint256 pid) external view returns (IUniversalMasterChef.PoolInfoV1 memory); // V1

    // function poolInfo(uint256 pid) external view returns (IUniversalMasterChef.PoolInfoV2 memory); // V2

    function userInfo(uint256 arg1, address arg2) external view returns (IUniversalMasterChef.UserInfo memory); // V1 and V2

    function rewarder(uint256 i) external view returns (address); // V1 and V2

    function lpToken(uint256 i) external view returns (address); // V2

    function init(IERC20 dummyToken) external; // V2

    function poolLength() external view returns (uint256); // V1 and V2

    function pendingTri(uint256 _pid, address _user) external view returns (uint256); // V1 and V2

    function triPerBlock() external view returns (uint256 amount); // V2

    function deposit(uint256 _pid, uint256 _amount) external; // V1

    function deposit(
        uint256 pid,
        uint256 amount,
        address to
    ) external; // V2

    function withdraw(uint256 _pid, uint256 _amount) external; // V1

    function withdraw(
        uint256 pid,
        uint256 amount,
        address to
    ) external; // V2

    function harvest(uint256 _pid) external returns (address); // V1

    function harvest(uint256 pid, address to) external; // V2

    function withdrawAndHarvest(
        uint256 pid,
        uint256 amount,
        address to
    ) external;

    function emergencyWithdraw(uint256 _pid) external; // V1

    function emergencyWithdraw(uint256 pid, address to) external; // V2

    function getMultiplier(uint256 _from, uint256 _to) external pure returns (uint256); // V1

    function harvestFromMasterChef() external; // V2

    function totalAllocPoint() external view returns (uint256); // V2
}
