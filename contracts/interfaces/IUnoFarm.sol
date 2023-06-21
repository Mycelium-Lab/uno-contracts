// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IUnoFarm {
    /**
     * @dev DistributionInfo:
     * {block} - Distribution block number.
     * {rewardPerDepositAge} - Distribution reward divided by {totalDepositAge}. 
     * {cumulativeRewardAgePerDepositAge} - Sum of {rewardPerDepositAge}s multiplied by distribution interval.
     */
    struct DistributionInfo {
        uint256 block;
        uint256 rewardPerDepositAge;
        uint256 cumulativeRewardAgePerDepositAge;
    }
    /**
     * @dev UserInfo:
     * {stake} - Amount of LP tokens deposited by the user.
     * {depositAge} - User deposits multiplied by blocks the deposit has been in. 
     * {reward} - Amount of LP tokens entitled to the user.
     * {lastDistribution} - Distribution ID before the last user deposit.
     * {lastUpdate} - Deposit update block.
     */
    struct UserInfo {
        uint256 stake;
        uint256 depositAge;
        uint256 reward;
        uint32 lastDistribution;
        uint256 lastUpdate;
    }
    /**
     * @dev SwapInfo:
     * {route} - Array of token addresses describing swap routes.
     * {amountOutMin} - The minimum amount of output token that must be received for the transaction not to revert.
     */
    struct SwapInfo{
        address[] route;
        uint256 amountOutMin;
    }
    /**
     * @dev FeeInfo:
     * {feeCollector} - Contract to transfer fees to.
     * {fee} - Fee percentage to collect (10^18 == 100%). 
     */
    struct FeeInfo {
        address feeTo;
        uint256 fee;
    }

    error CALLER_NOT_ASSET_ROUTER();
    error INVALID_LP_POOL();
    error INVALID_ASSET_ROUTER();
    error NO_LIQUIDITY_PROVIDED();
    error INSUFFICIENT_AMOUNT();
    error INSUFFICIENT_BALANCE();
    error NO_LIQUIDITY();
    error CALL_ON_THE_SAME_BLOCK();
    error INVALID_ROUTE(address fromToken, address toToken);

    function rewardToken() external view returns (address);
    function lpPool() external view returns (address);
    function assetRouter() external view returns (address);

    function initialize( address _lpStakingPool, address _assetRouter) external;

    function deposit(uint256 amountLP, address recipient) external;
    function withdraw(uint256 amount, address origin, address recipient) external;

    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
}
