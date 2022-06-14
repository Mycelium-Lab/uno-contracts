// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
 
import '../../interfaces/IWMATIC.sol';
import "../../interfaces/IVault.sol";
import "../../interfaces/IBasePool.sol";
import '../../interfaces/IChildChainLiquidityGaugeFactory.sol';
import "../../interfaces/IRewardsOnlyGauge.sol"; 
import "../../interfaces/IChildChainStreamer.sol"; 
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';

contract UnoFarmBalancer is Initializable, ReentrancyGuardUpgradeable {
    /**
     * @dev DistributionInfo:
     * {_block} - Distribution block number.
     * {rewardPerDepositAge} - Distribution reward divided by {totalDepositAge}. 
     * {cumulativeRewardAgePerDepositAge} - Sum of {rewardPerDepositAge}s multiplied by distribution interval.
     */
    struct DistributionInfo {
        uint256 _block;
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
     * @dev Third Party Contracts:
     * {Vault} - Main Balancer contract used for pool exits/joins and swaps.
     * {GaugeFactory} - Contract that deploys gauges.
     * {gauge} - Contract that distributes reward tokens.
     * {streamer} - Contract reward tokens get sent to from the bridge.
     */   
    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    IChildChainLiquidityGaugeFactory constant private GaugeFactory = IChildChainLiquidityGaugeFactory(0x3b8cA519122CdD8efb272b0D3085453404B25bD0);
    IRewardsOnlyGauge private gauge;
    IChildChainStreamer private streamer;

    /**
     * @dev Contract Variables:
     * {lpPool} - Pool.
     * {poolId} - Bytes32 representation of the {lpPool}.

     * {totalDeposits} - Total deposits made by users.
     * {totalDepositAge} - Deposits multiplied by blocks the deposit has been in. Flushed every reward distribution.
     * {totalDepositLastUpdate} - Last {totalDepositAge} update block.

     * {distributionID} - Current distribution ID.
     * {userInfo} - Info on each user.
     * {distributionInfo} - Info on each distribution.

     * {fractionMultiplier} - Used to store decimal values.
     */
    address public lpPool;
    bytes32 public poolId;

    uint256 private totalDeposits;
    uint256 private totalDepositAge;
    uint256 private totalDepositLastUpdate;

    uint32 private distributionID;
    mapping(address => UserInfo) private userInfo;
    mapping(uint32 => DistributionInfo) private distributionInfo;

    uint256 private constant fractionMultiplier = uint256(1 ether);

    /**
     * @dev Contract Variables:
     * {assetRouter} - The contract from which calls to this farm are made.
     */
    address public assetRouter;
    modifier onlyAssetRouter(){
        require(msg.sender == assetRouter, 'CALLER_NOT_ASSET_ROUTER');
        _;
    }

    // ============ Methods ============

    function initialize(address _lpPool, address _assetRouter) external initializer {
        __ReentrancyGuard_init();
        assetRouter = _assetRouter;

        lpPool = _lpPool;
        poolId = IBasePool(_lpPool).getPoolId();

        gauge = IRewardsOnlyGauge(GaugeFactory.getPoolGauge(_lpPool));
        streamer = IChildChainStreamer(GaugeFactory.getPoolStreamer(_lpPool));

        distributionInfo[0] = DistributionInfo(block.number, 0, 0);
        distributionID = 1;
        totalDepositLastUpdate = block.number;

        IERC20(_lpPool).approve(address(Vault), type(uint256).max);
        IERC20(_lpPool).approve(address(gauge), type(uint256).max);
    }

    /**
     * @dev Function that makes the deposits.
     * Deposits {amounts} of {tokens} from this contract's balance to the {Vault}.
     */
    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP,  address recipient) external nonReentrant onlyAssetRouter returns(uint256 liquidity){
        (IERC20[] memory poolTokens, IAsset[] memory assets,) = getTokens();

        bool joinPool = false;
        for (uint256 i = 0; i < poolTokens.length; i++) {
            require (IERC20(tokens[i]) == poolTokens[i], 'TOKENS_NOT_MATCH_POOL_TOKENS');
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                poolTokens[i].approve(address(Vault), amounts[i]);
            }
        }

        uint256 amountBefore = IERC20(lpPool).balanceOf(address(this));
        if(joinPool){
            IVault.JoinPoolRequest memory joinPoolRequest = IVault.JoinPoolRequest(assets, amounts, abi.encode(1, amounts, minAmountLP), false);
            Vault.joinPool(poolId, address(this), address(this), joinPoolRequest);
        }
        uint256 amountAfter = IERC20(lpPool).balanceOf(address(this));

        liquidity = amountAfter - amountBefore + amountLP;
        require (liquidity > 0, 'NO_LIQUIDITY_PROVIDED');
        
        _updateDeposit(recipient);
        userInfo[recipient].stake += liquidity;
        totalDeposits += liquidity;

        gauge.deposit(liquidity);
    }

    /**
     * @dev Withdraws funds from {origin} and sends them to the {recipient}.
     */
    function withdraw(uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address origin, address recipient) external nonReentrant onlyAssetRouter{
        require(amount > 0, 'INSUFFICIENT_AMOUNT');

        _updateDeposit(origin);
        UserInfo storage user = userInfo[origin];
        // Subtract amount from user.reward first, then subtract remainder from user.stake.
        if(amount > user.reward){
            user.stake = user.stake + user.reward - amount;
            totalDeposits = totalDeposits + user.reward - amount;
            user.reward = 0;
        } else {
            user.reward -= amount;
        }

        gauge.withdraw(amount);
        if(withdrawLP){
            IERC20(lpPool).transfer(recipient, amount);
            return;
        }

        (, IAsset[] memory assets, ) = getTokens();
        require (minAmountsOut.length == assets.length, 'MIN_AMOUNTS_OUT_BAD_LENGTH');
        Vault.exitPool(poolId, address(this), payable(recipient), IVault.ExitPoolRequest(assets, minAmountsOut, abi.encode(1, amount), false));
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {gauge}.
     * 2. It swaps reward tokens for {tokens}.
     * 3. It deposits new tokens back to the {gauge}.
     */
    function distribute(
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        int256[][] memory limits
    ) external onlyAssetRouter nonReentrant returns(uint256 reward){
        require(totalDeposits > 0, 'NO_LIQUIDITY');
        require(distributionInfo[distributionID - 1]._block != block.number, 'CANT_CALL_ON_THE_SAME_BLOCK');
        require((swaps.length == streamer.reward_count()) && (swaps.length == assets.length) && (swaps.length == limits.length), 'PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT');

        gauge.claim_rewards();
        for (uint256 i = 0; i < swaps.length; i++) {
            require(swaps[i][0].assetInIndex == 0, 'BAD_SWAPS_TOKEN_ORDERING');

            IERC20 rewardToken = IERC20(streamer.reward_tokens(i));
            require(address(assets[i][0]) == address(rewardToken), 'ASSET_NOT_REWARD');

            uint256 rewardTokenBalance = rewardToken.balanceOf(address(this));
            if (rewardTokenBalance > 0 && (address(assets[i][0]) != address(gauge))) {
                swaps[i][0].amount = rewardTokenBalance;
                rewardToken.approve(address(Vault), rewardTokenBalance);
                Vault.batchSwap(
                    IVault.SwapKind.GIVEN_IN,
                    swaps[i],
                    assets[i],
                    IVault.FundManagement({sender: address(this), fromInternalBalance:false, recipient: payable(address(this)), toInternalBalance:false}),
                    limits[i],
                    type(uint256).max
                );
            }
        }

        (IERC20[] memory tokens, IAsset[] memory joinAssets, uint256[] memory joinAmounts) = getTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            joinAmounts[i] = tokens[i].balanceOf(address(this));
            if (joinAmounts[i] > 0){
                tokens[i].approve(address(Vault), joinAmounts[i]);
            }
        }
        
        Vault.joinPool(poolId, address(this), address(this), IVault.JoinPoolRequest(joinAssets, joinAmounts, abi.encode(1, joinAmounts, 1), false));
        reward = IERC20(lpPool).balanceOf(address(this));

        uint256 rewardPerDepositAge = reward * fractionMultiplier / (totalDepositAge + totalDeposits * (block.number - totalDepositLastUpdate));
        uint256 cumulativeRewardAgePerDepositAge = distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge + rewardPerDepositAge * (block.number - distributionInfo[distributionID - 1]._block);

        distributionInfo[distributionID] = DistributionInfo(
            block.number,
            rewardPerDepositAge,
            cumulativeRewardAgePerDepositAge
        );

        distributionID += 1;
        totalDepositLastUpdate = block.number;
        totalDepositAge = 0;

        gauge.deposit(reward);
    }

    /**
     * @dev Returns total funds staked by the {_address}.
     */
    function userBalance(address _address) external view returns (uint256) {
        return userInfo[_address].stake + userReward(_address);
    }

    /**
     * @dev Returns total funds locked in the farm.
     */
    function getTotalDeposits() external view returns (uint256 _totalDeposits) {
        if(totalDeposits > 0){
            _totalDeposits = gauge.balanceOf(address(this));
        }
    }
    
    function _updateDeposit(address _address) internal {
        UserInfo storage user = userInfo[_address];
        // Accumulate deposit age within the current distribution period.
        if (user.lastDistribution == distributionID) {
            // Add deposit age from previous deposit age update to now.
            user.depositAge += user.stake * (block.number - user.lastUpdate);
        } else {
            // A reward has been distributed, update user.reward.
            user.reward = userReward(_address);
            // Count fresh deposit age from previous reward distribution to now.
            user.depositAge = user.stake * (block.number - distributionInfo[distributionID - 1]._block);
        }

        user.lastDistribution = distributionID;
        user.lastUpdate = block.number;

        // Same with total deposit age.
        totalDepositAge += (block.number - totalDepositLastUpdate) * totalDeposits;
        totalDepositLastUpdate = block.number;
    }

    function userReward(address _address) internal view returns (uint256) {
        UserInfo memory user = userInfo[_address];
        if (user.lastDistribution == distributionID) {
            // Return user.reward if the distribution after the last user deposit did not happen yet.
            return user.reward;
        }
        DistributionInfo memory lastUserDistributionInfo = distributionInfo[user.lastDistribution];
        uint256 userDepositAge = user.depositAge + user.stake * (lastUserDistributionInfo._block - user.lastUpdate);
        // Calculate reward between the last user deposit and the distribution after that.
        uint256 rewardBeforeDistibution = userDepositAge * lastUserDistributionInfo.rewardPerDepositAge / fractionMultiplier;
        // Calculate reward from the distributions that have happened after the last user deposit.
        uint256 rewardAfterDistribution = user.stake * (distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge - lastUserDistributionInfo.cumulativeRewardAgePerDepositAge) / fractionMultiplier;
        return user.reward + rewardBeforeDistibution + rewardAfterDistribution;
    }

    /**
     * @dev Utility function used to create IAsset array.
     */ 
    function getTokens() internal view returns(IERC20[] memory tokens, IAsset[] memory assets, uint256[] memory amounts){
        (tokens, , ) = Vault.getPoolTokens(poolId);
        assets = new IAsset[](tokens.length);
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            assets[i] = IAsset(address(tokens[i]));
        }
    }
}
