// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';
import "../../../interfaces/ISwap.sol";

interface IUnoFarmTrisolarisStable is IUnoFarm {
    error INVALID_REWARD_SWAP_INFOS_LENGTH(uint256 tokensLength);
    error INVALID_REWARDER_SWAP_INFOS_LENGTH(uint256 tokensLength);
    error PID_NOT_EXISTS();

    function rewarderToken() external view returns (address);
    function pid() external view returns (uint256);
    function assetRouter() external view returns (address);
    function tokens(uint256) external view returns (address);
    function tokensLength() external view returns(uint256);
    function swap() external view returns(ISwap);

    function deposit(uint256 amount, address recipient) external;
    function withdraw(uint256 amount, address origin, address recipient) external;

    function distribute(
        SwapInfo[] calldata rewardSwapInfos,
        SwapInfo[] calldata rewarderSwapInfos,
        FeeInfo calldata feeInfo
    ) external returns (uint256 reward);
}
