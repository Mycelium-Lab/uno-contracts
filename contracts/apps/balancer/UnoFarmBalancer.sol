// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
 
 
import './interfaces/IUnoFarmBalancer.sol';
import "../../interfaces/IBasePool.sol";
import '../../interfaces/IChildChainLiquidityGaugeFactory.sol';
import "../../interfaces/IChildChainStreamer.sol"; 
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';

contract UnoFarmBalancer is Initializable, ReentrancyGuardUpgradeable, IUnoFarmBalancer {
    using SafeERC20 for IERC20;

    /**
     * @dev Third Party Contracts:
     * {Vault} - Main Balancer contract used for pool exits/joins and swaps.
     * {GaugeFactory} - Contract that deploys gauges.
     * {gauge} - Contract that distributes reward tokens.
     * {streamer} - Contract reward tokens get sent to from the bridge.
     */   
    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    IChildChainLiquidityGaugeFactory constant private GaugeFactory = IChildChainLiquidityGaugeFactory(0x3b8cA519122CdD8efb272b0D3085453404B25bD0);
    IRewardsOnlyGauge public gauge;
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
        if(msg.sender != assetRouter) revert CALLER_NOT_ASSET_ROUTER();
        _;
    }

    // Some balancer pools are composable and have pre-minted bpt in them
    bool public isComposable;

    // ============ Methods ============

    function initialize(address _lpPool, address _assetRouter) external initializer {
        if(_lpPool == address(0)) revert INVALID_LP_POOL();
        if(_assetRouter == address(0)) revert INVALID_ASSET_ROUTER();

        __ReentrancyGuard_init();
        assetRouter = _assetRouter;

        lpPool = _lpPool;
        poolId = IBasePool(_lpPool).getPoolId();

        gauge = IRewardsOnlyGauge(GaugeFactory.getPoolGauge(_lpPool));
        if(address(gauge) == address(0)){
            gauge = IRewardsOnlyGauge(GaugeFactory.create(_lpPool));
        }
        streamer = IChildChainStreamer(GaugeFactory.getPoolStreamer(_lpPool));

        distributionInfo[0] = DistributionInfo({
            block: block.number,
            rewardPerDepositAge: 0,
            cumulativeRewardAgePerDepositAge: 0
        });
        distributionID = 1;
        totalDepositLastUpdate = block.number;

        IERC20(_lpPool).approve(address(Vault), type(uint256).max);
        IERC20(_lpPool).approve(address(gauge), type(uint256).max);

        // Only ComposableStable pools have this function
        try IBasePool(_lpPool).getBptIndex() returns (uint256) {
            isComposable = true;
        } catch (bytes memory /*lowLevelData*/) {}
    }

    /**
     * @dev Function that makes the deposits.
     * Deposits {amount} of LP tokens from this contract's balance to the {Vault}.
     */
    function deposit(uint256 amount, address recipient) external onlyAssetRouter{
        if(amount == 0) revert NO_LIQUIDITY_PROVIDED();
        
        _updateDeposit(recipient);
        userInfo[recipient].stake += amount;
        totalDeposits += amount;

        gauge.deposit(amount);
    }

    /**
     * @dev Withdraws funds from {origin} and sends them to the {recipient}.
     */
    function withdraw(uint256 amount, address origin, address recipient) external onlyAssetRouter{
        _onWithdrawUpdate(amount, origin);
        gauge.withdraw(amount);
        IERC20(lpPool).safeTransfer(recipient, amount);
    }

    /**
     * @dev Withdraws tokens from {origin} and sends them to the {recipient}. Saves gas compared to doing it in asset router.
     */
    function withdrawTokens(
        bytes calldata userData, 
        uint256[] calldata minAmountsOut, 
        address origin, 
        address recipient
    ) external onlyAssetRouter returns(uint256[] memory amounts, uint256 liquidity){
        (IERC20[] memory tokens, , ) = Vault.getPoolTokens(poolId);
        if(minAmountsOut.length != tokens.length) revert INVALID_MIN_AMOUNTS_OUT_LENGTH();

        (amounts, liquidity) = _exitPool(userData, minAmountsOut, tokens, recipient);
        _onWithdrawUpdate(liquidity, origin);
    }

    function _onWithdrawUpdate(uint256 amount, address origin) internal{
        if(amount == 0) revert INSUFFICIENT_AMOUNT();

        _updateDeposit(origin);
		UserInfo storage user = userInfo[origin];
		// Subtract amount from user.reward first, then subtract remainder from user.stake.
		uint256 reward = user.reward;
		if (amount > reward) {
			uint256 balance = user.stake + reward;
            if(amount > balance) revert INSUFFICIENT_BALANCE();

			user.stake = balance - amount;
			totalDeposits = totalDeposits + reward - amount;
			user.reward = 0;
		} else {
			user.reward = reward - amount;
		}
    }

    // Move logic to separate function to avoid "Stack too deep" errors.
    function _exitPool(bytes calldata userData, uint256[] calldata minAmountsOut, IERC20[] memory tokens, address recipient) internal returns(uint256[] memory amounts, uint256 liquidity){
        gauge.withdraw(gauge.balanceOf(address(this)));

        //Collect amounts before pool exit
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amounts[i] = tokens[i].balanceOf(recipient);
        }
        uint256 liquidityBefore = IERC20(lpPool).balanceOf(address(this));
        Vault.exitPool(poolId, address(this), payable(recipient), IVault.ExitPoolRequest(tokens, minAmountsOut, userData, false));
            
        //Subtract amounts after pool exit
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balanceAfter = tokens[i].balanceOf(recipient);
            amounts[i] = balanceAfter - amounts[i];
        }
        uint256 liquidityAfter = IERC20(lpPool).balanceOf(address(this));
        liquidity = liquidityBefore - liquidityAfter;

        gauge.deposit(liquidityAfter);
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {gauge}.
     * 2. It swaps reward tokens for {tokens}.
     * 3. It deposits new tokens back to the {gauge}.
     */
    function distribute(
        SwapInfo[] calldata swapInfos,
        FeeInfo calldata feeInfo
    ) external onlyAssetRouter returns(uint256 reward){
        if(totalDeposits == 0) revert NO_LIQUIDITY();
        uint32 _distributionID = distributionID;
        if(distributionInfo[_distributionID - 1].block == block.number) revert CALL_ON_THE_SAME_BLOCK();

        IChildChainStreamer _streamer = streamer;
        uint256 rewardCount = _streamer.reward_count();
        if(swapInfos.length != rewardCount) revert PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT();

        IRewardsOnlyGauge _gauge = gauge;
        IVault _Vault = Vault;
        address _lpPool = lpPool;
        _gauge.claim_rewards();
        for (uint256 i = 0; i < rewardCount; i++) {
            IERC20 rewardToken = _streamer.reward_tokens(i);
            if (address(rewardToken) != address(_gauge) && address(rewardToken) != _lpPool) {  //can't use LP tokens in swap
                uint256 balance = rewardToken.balanceOf(address(this));
                balance -= _collectFees(rewardToken, balance, feeInfo);
                if(balance > 0){
                    rewardToken.approve(address(_Vault), balance);
                    _batchSwap(swapInfos[i], payable(address(this)));
                }
            }
        }

        (IERC20[] memory tokens, , ) = _Vault.getPoolTokens(poolId);
        address[] memory _tokens = new address[](tokens.length);
        uint256[] memory joinAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            _tokens[i] = address(tokens[i]);
            if (address(tokens[i]) != _lpPool){
                joinAmounts[i] = tokens[i].balanceOf(address(this));
                if (joinAmounts[i] > 0){
                    tokens[i].approve(address(_Vault), joinAmounts[i]);
                }
            }
        }

        bytes memory userData;
        if(isComposable){
            //If pool has pre-minted BPT then don't include those in userData.
            uint256[] memory _joinAmounts = new uint256[](joinAmounts.length - 1);
            uint256 _i = 0;
            for (uint256 i = 0; i < tokens.length; i++) {
                if(address(tokens[i]) != _lpPool){
                    _joinAmounts[_i] = joinAmounts[i];
                    _i += 1;
                }
            }
            userData = abi.encode(1, _joinAmounts, 1);
        } else {
            userData = abi.encode(1, joinAmounts, 1);
        }
        _Vault.joinPool(poolId, address(this), address(this), IVault.JoinPoolRequest(_tokens, joinAmounts, userData, false));

        reward = IERC20(_lpPool).balanceOf(address(this));

        uint256 rewardPerDepositAge = reward * fractionMultiplier / (totalDepositAge + totalDeposits * (block.number - totalDepositLastUpdate));
        uint256 cumulativeRewardAgePerDepositAge = distributionInfo[_distributionID - 1].cumulativeRewardAgePerDepositAge + rewardPerDepositAge * (block.number - distributionInfo[_distributionID - 1].block);

        distributionInfo[_distributionID] = DistributionInfo({
            block: block.number,
            rewardPerDepositAge: rewardPerDepositAge,
            cumulativeRewardAgePerDepositAge: cumulativeRewardAgePerDepositAge
        });

        distributionID = _distributionID + 1;
        totalDepositLastUpdate = block.number;
        totalDepositAge = 0;

        _gauge.deposit(reward);
    }

    /**
	 * @dev Sends fees to feeTo.
	 */
	function _collectFees(IERC20 token, uint256 balance, FeeInfo calldata feeInfo) internal returns(uint256 feeAmount) {
		if (feeInfo.feeTo != address(0)) {
			feeAmount = balance * feeInfo.fee / fractionMultiplier;
			if (feeAmount > 0) {
				token.safeTransfer(feeInfo.feeTo, feeAmount);
			}
		}
	}

    /**
     * @dev Performs balancer batch swap. Separate function to avoid Stack too deep errors.
     */
    function _batchSwap(SwapInfo calldata swapInfo, address payable recipient) internal {
        Vault.batchSwap(
            IVault.SwapKind.GIVEN_IN,
            swapInfo.swaps,
            swapInfo.assets,
            IVault.FundManagement({sender: address(this), fromInternalBalance:false, recipient: recipient, toInternalBalance:false}),
            swapInfo.limits,
            type(uint256).max
        );
    }

    /**
     * @dev Returns total funds staked by the {_address}.
     */
    function userBalance(address _address) external view returns (uint256) {
        return userInfo[_address].stake + _userReward(_address);
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
            user.reward = _userReward(_address);
            // Count fresh deposit age from previous reward distribution to now.
            user.depositAge = user.stake * (block.number - distributionInfo[distributionID - 1].block);
        }

        user.lastDistribution = distributionID;
        user.lastUpdate = block.number;

        // Same with total deposit age.
        totalDepositAge += (block.number - totalDepositLastUpdate) * totalDeposits;
        totalDepositLastUpdate = block.number;
    }

    function _userReward(address _address) internal view returns (uint256) {
        UserInfo memory user = userInfo[_address];
        if (user.lastDistribution == distributionID) {
            // Return user.reward if the distribution after the last user deposit did not happen yet.
            return user.reward;
        }
        DistributionInfo memory lastUserDistributionInfo = distributionInfo[user.lastDistribution];
        uint256 userDepositAge = user.depositAge + user.stake * (lastUserDistributionInfo.block - user.lastUpdate);
        // Calculate reward between the last user deposit and the distribution after that.
        uint256 rewardBeforeDistibution = userDepositAge * lastUserDistributionInfo.rewardPerDepositAge / fractionMultiplier;
        // Calculate reward from the distributions that have happened after the last user deposit.
        uint256 rewardAfterDistribution = user.stake * (distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge - lastUserDistributionInfo.cumulativeRewardAgePerDepositAge) / fractionMultiplier;
        return user.reward + rewardBeforeDistibution + rewardAfterDistribution;
    }
}
