// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../interfaces/IVault.sol";
import "../interfaces/MerkleOrchard.sol"; 
import "../interfaces/IBasePool.sol";
import "../utils/UniswapV2ERC20.sol"; 
import "../utils/OwnableUpgradeableNoTransfer.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract BalancerFarmUpgradeable is UniswapV2ERC20, UUPSUpgradeable, Initializable, OwnableUpgradeableNoTransfer, ReentrancyGuard {

    /**
     * @dev Third Party Contracts:
     * {Vault} - the main Balancer contract used for pool exits/joins and swaps.
     * {merkleOrchard} - The contract that distributes reward tokens.
     */   
    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    MerkleOrchard constant private merkleOrchard = MerkleOrchard(0x0F3e0c4218b7b0108a3643cFe9D3ec0d4F57c54e);

    /**
     * @dev Contract Variables:
     * {lpPair} - The pair and the pool.
     * {poolId} - Bytes32 representation of the {lpPair}.
     * 

     */
    address public lpPair;
    bytes32 public poolId;
     
    uint256 private expectedRewardBlock;
    uint256 private expectedReward;
    uint256 private lastRewardBlock;
    uint256 private lastRewardPeriod;

    mapping(address => uint256) private userDeposit;
    mapping(address => uint256) private userDepositAge;
    mapping(address => uint256) private userDALastUpdated;
    mapping(address => mapping(uint256 => bool)) private userDepositChanged;

    uint256 public totalDeposits;
    uint256 private totalDepositAge;
    uint256 private totalDALastUpdated;

    uint256 private constant fractionMultiplier = 10**decimals;

    // ============ Methods ============

    function initialize(address _lpPair) external initializer {
        __Ownable_init();
        
        lpPair = _lpPair;
        poolId = IBasePool(_lpPair).getPoolId();
        IERC20(_lpPair).approve(address(Vault), uint256(2**256 - 1));
    }

   /**
     * @dev Function that makes the deposits.
     * Deposits the {amounts} of {tokens} from this contract's balance to the {Vault}.
     */
    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address recipient) external onlyOwner nonReentrant returns(uint256 liquidity){
        (IERC20[] memory poolTokens, IAsset[] memory assets,) = getTokens();
    
        bool joinPool = false;
        for (uint256 i = 0; i < poolTokens.length; i++) {
            require (IERC20(tokens[i]) == poolTokens[i]);
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                poolTokens[i].approve(address(Vault), amounts[i]);
            }
        }

        {
            uint256 amountBefore = IERC20(lpPair).balanceOf(address(this));
            if(joinPool){
                IVault.JoinPoolRequest memory joinPoolRequest = IVault.JoinPoolRequest(assets, amounts, abi.encode(1, amounts, 0), false);
                Vault.joinPool(poolId, address(this), address(this), joinPoolRequest);
            }
            uint256 amountAfter = IERC20(lpPair).balanceOf(address(this));

            liquidity = amountAfter - amountBefore + amountLP; 
            require (liquidity > 0);
        }

        _updateDeposit(recipient);

        uint256 blocksTillReward;
        if(expectedRewardBlock > block.number){
            blocksTillReward = expectedRewardBlock - block.number;
        }else{
            blocksTillReward = lastRewardPeriod / 2;
        }

        uint256 totalExpectedDepositAgePrev = totalDeposits * blocksTillReward + totalDepositAge;
        uint256 totalExpectedDepositAge = liquidity * blocksTillReward + totalExpectedDepositAgePrev;
        // update deposit amounts
        userDeposit[recipient] += liquidity;
        totalDeposits += liquidity;
        // expected reward will increase proportionally to the increase of total expected deposit age
        if (totalExpectedDepositAgePrev > 0) {
            expectedReward = expectedReward * totalExpectedDepositAge / totalExpectedDepositAgePrev;
        }

        _mintLP(blocksTillReward, totalExpectedDepositAge, recipient);
    }

    /**
     * @dev Withdraws funds and sends them to the {recipient}.
     */
    function withdraw(address origin, uint256 amount, bool withdrawLP, address recipient) external onlyOwner nonReentrant{
        require(amount > 0 && userDeposit[origin] > 0);
        
        _updateDeposit(origin);

        uint256 blocksTillReward;
        if(expectedRewardBlock > block.number){
            blocksTillReward = expectedRewardBlock - block.number;
        }else{
            blocksTillReward = lastRewardPeriod / 2;
        }

        uint256 totalExpectedDepositAgePrev = totalDeposits * blocksTillReward + totalDepositAge;
        uint256 totalExpectedDepositAge = totalExpectedDepositAgePrev - amount * blocksTillReward;
        // update deposit amounts
        userDeposit[origin] -= amount;
        totalDeposits -= amount;
        // expected reward will decrease proportionally to the decrease of total expected deposit age
        expectedReward = expectedReward * totalExpectedDepositAge / totalExpectedDepositAgePrev;

        _burnLP(blocksTillReward, totalExpectedDepositAge, origin);
        
        if(withdrawLP){
            IERC20(lpPair).transfer(recipient, amount);
            return;
        }

        (, IAsset[] memory assets, uint256[] memory amounts) = getTokens();
        Vault.exitPool(poolId, address(this), payable(recipient), IVault.ExitPoolRequest(assets, amounts, abi.encode(1, amount), false));
    }

    function _mintLP(uint256 blocksTillReward, uint256 totalExpectedDepositAge, address recipient) internal {
        if (totalSupply == 0) {
            _mint(recipient, fractionMultiplier);
            return;
        }
        if (balanceOf[recipient] == totalSupply) {
            return;
        }
        uint256 userNewShare = _calculateUserNewShare(blocksTillReward, totalExpectedDepositAge, recipient);
        _mint(recipient, fractionMultiplier * (userNewShare * totalSupply / fractionMultiplier - balanceOf[recipient]) / (fractionMultiplier - userNewShare));
    }

    function _burnLP(uint256 blocksTillReward, uint256 totalExpectedDepositAge, address origin) internal{
        if(userDeposit[origin] == 0){
            _burn(origin, balanceOf[origin]);
            return;
        }
        if (balanceOf[origin] == totalSupply) {
            return;
        }
        uint256 userNewShare = _calculateUserNewShare(blocksTillReward, totalExpectedDepositAge, origin);
        _burn(origin, fractionMultiplier * (balanceOf[origin] - userNewShare * totalSupply / fractionMultiplier) / (fractionMultiplier - userNewShare));
    }

    function _calculateUserNewShare (uint256 blocksTillReward, uint256 totalExpectedDepositAge, address _address) internal view returns(uint256) {
        uint256 userExpectedReward = expectedReward * (userDeposit[_address] * blocksTillReward + userDepositAge[_address]) / totalExpectedDepositAge;
        return fractionMultiplier * (userDeposit[_address] + userExpectedReward) / (totalDeposits + expectedReward);
    }

    function _updateDeposit(address _address) internal {
        if (userDepositChanged[_address][lastRewardBlock]) {
            userDepositAge[_address] += (block.number - userDALastUpdated[_address]) * userDeposit[_address];
        } else {
            // a reward has been distributed, update user deposit
            userDeposit[_address] = userBalance(_address);
            userDepositAge[_address] = (block.number - lastRewardBlock) * userDeposit[_address];
            userDepositChanged[_address][lastRewardBlock] = true;
        }

        if (totalDALastUpdated > lastRewardBlock) {
            totalDepositAge += (block.number - totalDALastUpdated) * totalDeposits;
        } else {
            totalDepositAge = (block.number - lastRewardBlock) * totalDeposits;
        }

        userDALastUpdated[_address] = block.number;
        totalDALastUpdated = block.number;
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {merkleOrchard}.
     * 2. It swaps the {rewardTokens} token for {assets}.
     * 3. Then deposits the new tokens back to the {Vault}.
     */
    function distribute(
        MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    ) external onlyOwner nonReentrant{ 
        require(totalDeposits > 0);
        merkleOrchard.claimDistributions(address(this), claims, rewardTokens);
        for (uint256 i = 0; i < assets.length; i++) {
            for (uint256 j = 0; j < assets[i].length; j++) {
                require(address(assets[i][j]) != lpPair);
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

        uint256 reward = amountAfter - amountBefore;
        totalDeposits += reward;

        lastRewardPeriod = block.number - lastRewardBlock;
        _setExpectedReward(reward, block.number + lastRewardPeriod);
        lastRewardBlock = block.number;
    }

    function setExpectedReward(uint256 _amount, uint256 _block) external onlyOwner{
        require(_block > block.number);
        _setExpectedReward(_amount, _block);
    }

    function _setExpectedReward(uint256 _amount, uint256 _block) internal {
        expectedReward = _amount;
        expectedRewardBlock = _block;
    }

    /**
     * @dev Returns total funds staked by the {_address}.
     */
    function userBalance(address _address) public view returns (uint256){
        if (userDepositChanged[_address][lastRewardBlock]) {
            return userDeposit[_address];
        } else {
            if (totalSupply == 0) {
                return 0;
            }
            return totalDeposits * balanceOf[_address] / totalSupply;
        }
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

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        
    }
}