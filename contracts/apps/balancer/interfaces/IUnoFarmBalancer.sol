// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../../../interfaces/IVault.sol";
import '../../../interfaces/IUnoFarm.sol';
import "../../../interfaces/IRewardsOnlyGauge.sol"; 

interface IUnoFarmBalancer is IUnoFarm { 
    struct SwapInfo{
        IVault.BatchSwapStep[] swaps;
        IERC20[] assets;
        int256[] limits;
    }

    error PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT();
    error INVALID_MIN_AMOUNTS_OUT_LENGTH();

    function gauge() external view returns (IRewardsOnlyGauge);
    function poolId() external view returns (bytes32);
    function isComposable() external view returns (bool);
    function withdrawTokens(bytes calldata userData, uint256[] calldata minAmountsOut, address origin, address recipient) external returns(uint256[] memory amounts, uint256 liquidity);

    function distribute(
        SwapInfo[] calldata swapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}

