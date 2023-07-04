// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';
import "../../../interfaces/IGauge.sol"; 

interface IUnoFarmVelodrome is IUnoFarm { 
	/**
     * @dev SwapInfo:
     * {route} - Array of token addresses describing swap routes.
     * {amountOutMin} - The minimum amount of output token that must be received for the transaction not to revert.
     */
    struct SwapInfo{
        address[] route;
        uint256 amountOutMin;
    }

    error INVALID_GAUGE();

    function gauge() external view returns (IGauge);
    
    function distribute(
        SwapInfo[2] calldata swapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}

