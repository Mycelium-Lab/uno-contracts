// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
 
import '../../interfaces/IWMATIC.sol';
import "../../interfaces/IVault.sol";
import "../../interfaces/MerkleOrchard.sol"; 
import "../../interfaces/IBasePool.sol";
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';

contract UnoFarmBalancer is Initializable, ReentrancyGuardUpgradeable {
    /**
     * @dev Third Party Contracts:
     * {Vault} - the main Balancer contract used for pool exits/joins and swaps.
     * {merkleOrchard} - The contract that distributes reward tokens.
     */   
    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    MerkleOrchard constant private merkleOrchard = MerkleOrchard(0x0F3e0c4218b7b0108a3643cFe9D3ec0d4F57c54e);

    /**
     * @dev Contract Variables:
     * {lpPair} - Pair / pool.
     * {poolId} - Bytes32 representation of the {lpPair}.

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
    address public lpPair;
    bytes32 public poolId;

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

    function initialize(address _lpPair, address _assetRouter) external initializer {
        assetRouter = _assetRouter;

        lpPair = _lpPair;
        poolId = IBasePool(_lpPair).getPoolId();
        IERC20(_lpPair).approve(address(Vault), uint256(2**256 - 1));

        lastRewardBlock = block.number;
        lastDistributionPeriod = 1200000; // This is somewhere around 1 month at the time of writing this contract.
    }

   /**
     * @dev Function that makes the deposits.
     * Deposits {amounts} of {tokens} from this contract's balance to the {Vault}.
     */
    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address recipient) external nonReentrant onlyAssetRouter returns(uint256 liquidity){
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

        uint256 amountBefore = IERC20(lpPair).balanceOf(address(this));
        if(joinPool){
            IVault.JoinPoolRequest memory joinPoolRequest = IVault.JoinPoolRequest(assets, amounts, abi.encode(1, amounts, 0), false);
            Vault.joinPool(poolId, address(this), address(this), joinPoolRequest);
        }
        uint256 amountAfter = IERC20(lpPair).balanceOf(address(this));

        liquidity = amountAfter - amountBefore + amountLP; 
        require (liquidity > 0, 'NO_LIQUIDITY_PROVIDED');
        
        _mint(liquidity, recipient);
    }

    /**
     * @dev Withdraws funds from {origin} and sends them to the {recipient}.
     */
    function withdraw(address origin, uint256 amount, bool withdrawLP, address recipient) external nonReentrant onlyAssetRouter{
        require(amount > 0, 'INSUFFICIENT_AMOUNT');

        _burn(amount, origin);

        if(withdrawLP){
            IERC20(lpPair).transfer(recipient, amount);
            return;
        }

        (, IAsset[] memory assets, uint256[] memory amounts) = getTokens();
        Vault.exitPool(poolId, address(this), payable(recipient), IVault.ExitPoolRequest(assets, amounts, abi.encode(1, amount), false));
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {merkleOrchard}.
     * 2. It swaps the {rewardTokens} token for {assets}.
     * 3. Then deposits the new tokens back to the {Vault}.
     */
    function distribute( MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    ) external onlyAssetRouter nonReentrant returns(uint256 reward){
        require(totalDeposits > 0, 'NO_LIQUIDITY');
        merkleOrchard.claimDistributions(address(this), claims, rewardTokens);
        for (uint256 i = 0; i < assets.length; i++) {
            for (uint256 j = 0; j < assets[i].length; j++) {
                require(address(assets[i][j]) != lpPair, 'CANT_SWAP_LP_TOKEN');
            }
            IERC20 startingToken = IERC20(address(assets[i][0]));
            uint256 balance = startingToken.balanceOf(address(this));
            if (balance > 0) {
                startingToken.approve(address(Vault), balance);
                Vault.batchSwap(IVault.SwapKind.GIVEN_IN, swaps[i], assets[i], funds[i], limits[i], uint256(2**256 - 1));
            }
        }

        (IERC20[] memory tokens, IAsset[] memory joinAssets, uint256[] memory joinAmounts) = getTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            joinAmounts[i] = tokens[i].balanceOf(address(this));
            tokens[i].approve(address(Vault), joinAmounts[i]);
        }
        
        uint256 amountBefore = IERC20(lpPair).balanceOf(address(this));
        Vault.joinPool(poolId, address(this), address(this), IVault.JoinPoolRequest(joinAssets, joinAmounts, abi.encode(1, joinAmounts, 1), false));
        uint256 amountAfter = IERC20(lpPair).balanceOf(address(this));

        reward = amountAfter - amountBefore;
        totalDeposits += reward;

        lastDistributionPeriod = block.number - lastRewardBlock;
        _setExpectedReward(reward, block.number + lastDistributionPeriod);
        lastRewardBlock = block.number;
    }

    /**
     * @dev Sets {expectedReward} and {expectedRewardBlock} for token distribution calculation.
     */
    function setExpectedReward(uint256 _amount, uint256 _block) external onlyAssetRouter{
        require(_block > block.number, 'WRONG_BLOCK');
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