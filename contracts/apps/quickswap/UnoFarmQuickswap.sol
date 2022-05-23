// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
 
import "../../interfaces/IUniswapV2Pair.sol";
import "../../interfaces/IUniswapV2Router.sol";
import "../../interfaces/IStakingRewards.sol";
import "../../interfaces/IWMATIC.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract UnoFarmQuickswap is Initializable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Tokens Used:
     * {rewardToken} - Token generated by staking.
     * {lpPair} - Token that the strategy maximizes. The same token that users deposit in the {lpStakingPool}.
     * {tokenA, tokenB} - Tokens that the strategy maximizes.
     */
    address public rewardToken;
    address public lpPair;
    address public tokenA;
    address public tokenB;

    /**
     * @dev Third Party Contracts:
     * {quickswapRouter} - Contract that executes swaps.
     * {lpStakingPool} - Contract that distibutes {rewardToken}.
     */
    IUniswapV2Router01 private constant quickswapRouter = IUniswapV2Router01(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff); 
    IStakingRewards private lpStakingPool;

    /**
     * @dev Contract Variables:
     * {totalShares} - Total shares.
     * {sharesOf} - User shares. Represents what share of this pool the user owns.

     * {expectedRewardBlock} - Block on which the next distribution is expected to be called.
     * {expectedReward} - Expected reward which will be produced by the next distribution.
     
     * {lastRewardBlock} - Last reward block. Updates every distribution.
     * {lastDistributionPeriod} - Last distribution period. Is used to approximate next reward block.

     * {userDeposit} - Deposits made by users.
     * {userDepositAge} - Deposit multiplied by blocks the deposit has been in. Flushes every reward distribution.
     * {userDALastUpdated} - Last deposit age calculation block for user.
     * {userDepositChanged} - 'true' if user has made deposit this distribution period. Flushes every reward distribution.
     
     * {totalDeposits} - Total deposits made by users.
     * {totalDepositAge} - Deposits multiplied by blocks the deposit has been in. Flushes every reward distribution.
     * {totalDALastUpdated} - Last deposit age calculation block.

     * {fractionMultiplier} - Used as multiplier to store decimal values.
     */
    uint256 private totalShares;
    mapping(address => uint256) private sharesOf;

    uint256 private expectedRewardBlock;
    uint256 private expectedReward;

    uint256 private lastRewardBlock;
    uint256 private lastDistributionPeriod;

    mapping(address => uint256) private userDeposit;
    mapping(address => uint256) private userDepositAge;
    mapping(address => uint256) private userDALastUpdated;
    mapping(address => mapping(uint256 => bool)) private userDepositChanged;

    uint256 public totalDeposits;
    uint256 private totalDepositAge;
    uint256 private totalDALastUpdated;

    uint256 private constant fractionMultiplier = 10**18;

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

    function initialize( address _lpStakingPool, address _assetRouter) external initializer {
        assetRouter = _assetRouter;

        lpStakingPool = IStakingRewards(_lpStakingPool);
        lpPair = address(lpStakingPool.stakingToken());

        rewardToken = lpStakingPool.rewardsToken();

        tokenA = IUniswapV2Pair(lpPair).token0();
        tokenB = IUniswapV2Pair(lpPair).token1();

        uint256 MAX_UINT = uint256(2**256 - 1);
        IERC20(lpPair).approve(_lpStakingPool, MAX_UINT);
        IERC20(lpPair).approve(address(quickswapRouter), MAX_UINT);
        IERC20(rewardToken).approve(address(quickswapRouter), MAX_UINT);
        IERC20(tokenA).approve(address(quickswapRouter), MAX_UINT);
        IERC20(tokenB).approve(address(quickswapRouter), MAX_UINT);

        lastRewardBlock = block.number;
        lastDistributionPeriod = 1200000; // This is somewhere around 1 month at the time of writing this contract.
    }

    /**
     * @dev Function that makes the deposits.
     * Deposits provided tokens in the Liquidity Pool, then stakes generated LP tokens in the {lpStakingPool}.
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address recipient) external nonReentrant onlyAssetRouter returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        uint256 addedLiquidity;
        if(amountA > 0 && amountB > 0){
            (sentA, sentB, addedLiquidity) = quickswapRouter.addLiquidity(tokenA, tokenB, amountA, amountB, 0, 0, address(this), block.timestamp + 600);
        }
        liquidity = addedLiquidity + amountLP;
        require(liquidity > 0, "NO_LIQUIDITY_PROVIDED");

        _mint(liquidity, recipient);
            
        lpStakingPool.stake(liquidity);
        IERC20Upgradeable(tokenA).safeTransfer(recipient, amountA - sentA);
        IERC20Upgradeable(tokenB).safeTransfer(recipient, amountB - sentB);
    }

    /**
     * @dev Withdraws funds from {origin} and sends them to the {recipient}.
     */
    function withdraw(address origin, uint256 amount, bool withdrawLP, address recipient) external nonReentrant onlyAssetRouter returns(uint256 amountA, uint256 amountB){
        require(amount > 0, "INSUFFICIENT_AMOUNT");

        _burn(amount, origin);

        lpStakingPool.withdraw(amount);
        if(withdrawLP){
            IERC20Upgradeable(lpPair).safeTransfer(recipient, amount);
            return (0, 0);
        }
        (amountA, amountB) = quickswapRouter.removeLiquidity(tokenA, tokenB, amount, 0, 0, recipient, block.timestamp + 600);
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {lpStakingPool}.
     * 2. It swaps the {rewardToken} token for {tokenA} & {tokenB}.
     * 3. It deposits the new LP tokens back to the {lpStakingPool}.
     */
    function distribute(address[] calldata rewardTokenToTokenARoute, address[] calldata rewardTokenToTokenBRoute) external onlyAssetRouter nonReentrant returns(uint256 reward){
        require(totalDeposits > 0, 'NO_LIQUIDITY');

        lpStakingPool.getReward();
        uint256 rewardTokenHalf = IERC20(rewardToken).balanceOf(address(this))/2;
        uint256 deadline = block.timestamp + 600;

        if (tokenA != rewardToken) {
            quickswapRouter.swapExactTokensForTokens(rewardTokenHalf, 0, rewardTokenToTokenARoute, address(this), deadline);
        }
        if (tokenB != rewardToken) {
            quickswapRouter.swapExactTokensForTokens(rewardTokenHalf, 0, rewardTokenToTokenBRoute, address(this), deadline);
        }

        quickswapRouter.addLiquidity(tokenA, tokenB, IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)), 1, 1, address(this), deadline);

        reward = IERC20(lpPair).balanceOf(address(this));
        if (reward > 0) {
            totalDeposits += reward;
            lpStakingPool.stake(reward);
        }

        lastDistributionPeriod = block.number - lastRewardBlock;
        _setExpectedReward(reward, block.number + lastDistributionPeriod);
        lastRewardBlock = block.number;
    }

    /**
     * @dev Sets {expectedReward} and {expectedRewardBlock} for token distribution calculation.
     */
    function setExpectedReward(uint256 _amount, uint256 _block) external onlyAssetRouter{
        require(_block > block.number, "WRONG_BLOCK");
        _setExpectedReward(_amount, _block);
    }

    /**
     * @dev Returns total funds staked by the {_address}.
     */
    function userBalance(address _address) public view returns (uint256) {
        if (userDepositChanged[_address][lastRewardBlock]) {
            return userDeposit[_address];
        } else {
            if (totalShares == 0) {
                return 0;
            }
            return totalDeposits * sharesOf[_address] / totalShares;
        }
    }

    function _mint(uint256 amount, address _address) internal {
        _updateDeposit(_address);
        uint256 blocksTillReward = getBlocksTillReward();
        // Total deposit age we expected by the end of distribution period before this deposit.
        uint256 totalExpectedDepositAgePrev = totalDeposits * blocksTillReward + totalDepositAge;
        // New expected total deposit age.
        uint256 totalExpectedDepositAge = amount * blocksTillReward + totalExpectedDepositAgePrev;
        // Update deposit amounts.
        userDeposit[_address] += amount;
        totalDeposits += amount;
        // Expected reward will increase proportionally to the increase of total expected deposit age.
        if (totalExpectedDepositAgePrev > 0) {
            expectedReward = expectedReward * totalExpectedDepositAge / totalExpectedDepositAgePrev;
        }

        if (totalShares == 0) {
            sharesOf[_address] += fractionMultiplier;
            totalShares += fractionMultiplier;
            return;
        }
        if (sharesOf[_address] == totalShares) {
            // Don't do anything if the user owns 100% of the pool.
            return;
        }
        // User's new expected deposit age by the end of distribution period.
        uint256 userExpectedDepositAge = userDeposit[_address] * blocksTillReward + userDepositAge[_address];
        // User's expected reward by the end of distribution period.
        uint256 userExpectedReward = expectedReward * userExpectedDepositAge / totalExpectedDepositAge;
        // User's estimated share after the next reward.
        uint256 userNewShare = fractionMultiplier * (userDeposit[_address] + userExpectedReward) / (totalDeposits + expectedReward);
        // Amount of shares to mint.
        uint256 mintAmount = fractionMultiplier * (userNewShare * totalShares / fractionMultiplier - sharesOf[_address]) / (fractionMultiplier - userNewShare);

        sharesOf[_address] += mintAmount;
        totalShares += mintAmount;
    }

    function _burn(uint256 amount, address _address) internal {
        _updateDeposit(_address);
        uint256 blocksTillReward = getBlocksTillReward();
        // Total deposit age we expected by the end of distribution period before this withdrawal.
        uint256 totalExpectedDepositAgePrev = totalDeposits * blocksTillReward + totalDepositAge;
        // New expected total deposit age.
        uint256 totalExpectedDepositAge = totalExpectedDepositAgePrev - amount * blocksTillReward;
        // Update deposit amounts.
        userDeposit[_address] -= amount;
        totalDeposits -= amount;
        // Expected reward will decrease proportionally to the decrease of total expected deposit age.
        expectedReward = expectedReward * totalExpectedDepositAge / totalExpectedDepositAgePrev;

        if(userDeposit[_address] == 0){
            totalShares = totalShares - sharesOf[_address];
            sharesOf[_address] = 0;
            return;
        }
        if (sharesOf[_address] == totalShares) {
            // Don't do anything if the user owns 100% of the pool.
            return;
        }
        // User's new expected deposit age by the end of distribution period.
        uint256 userExpectedDepositAge = userDeposit[_address] * blocksTillReward + userDepositAge[_address];
        // User's expected reward by the end of distribution period.
        uint256 userExpectedReward = expectedReward * userExpectedDepositAge / totalExpectedDepositAge;
        // User's estimated share after the next reward.
        uint256 userNewShare = fractionMultiplier * (userDeposit[_address] + userExpectedReward) / (totalDeposits + expectedReward);
        // Amount of shares to burn.
        uint256 burnAmount = fractionMultiplier * (sharesOf[_address] - userNewShare * totalShares / fractionMultiplier) / (fractionMultiplier - userNewShare);
        
        sharesOf[_address] -= burnAmount;
        totalShares -= burnAmount;
    }

    function _updateDeposit(address _address) internal {
        // Accumulate deposit age within the current distribution period.
        if (userDepositChanged[_address][lastRewardBlock]) {
            // Add deposit age from previous deposit age update to now.
            userDepositAge[_address] += (block.number - userDALastUpdated[_address]) * userDeposit[_address];
        } else {
            // A reward has been distributed, update user deposit.
            userDeposit[_address] = userBalance(_address);
            // Count fresh deposit age from previous reward distribution to now.
            userDepositAge[_address] = (block.number - lastRewardBlock) * userDeposit[_address];
            userDepositChanged[_address][lastRewardBlock] = true;
        }
        // Same with total deposit age.
        if (totalDALastUpdated > lastRewardBlock) {
            totalDepositAge += (block.number - totalDALastUpdated) * totalDeposits;
        } else {
            totalDepositAge = (block.number - lastRewardBlock) * totalDeposits;
        }

        userDALastUpdated[_address] = block.number;
        totalDALastUpdated = block.number;
    }

    function getBlocksTillReward() internal view returns(uint256 blocksTillReward) {
        if(expectedRewardBlock > block.number){
            blocksTillReward = expectedRewardBlock - block.number;
        } else {
            blocksTillReward = lastDistributionPeriod / 2;
        }
    }

    function _setExpectedReward(uint256 _amount, uint256 _block) internal {
        expectedReward = _amount;
        expectedRewardBlock = _block;
    }
}
