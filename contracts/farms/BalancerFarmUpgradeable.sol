// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IVault.sol";
import "../interfaces/MerkleOrchard.sol"; 
import "../interfaces/IBasePool.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract BalancerFarmUpgradeable is UUPSUpgradeable, Initializable, OwnableUpgradeable, ReentrancyGuard {
    using SafeMath for uint256; 

    /**
     * @dev Third Party Contracts:
     * {Vault} - the main Balancer contract used for pool exits/joins and swaps
     * {merkleOrchard} - The contract that distributes reward tokens
     */   
    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    MerkleOrchard constant private merkleOrchard = MerkleOrchard(0x0F3e0c4218b7b0108a3643cFe9D3ec0d4F57c54e);
    /**
     * @dev Contract Variables:
     *  {lpPair} - The pair and the pool
     * {poolId} - Bytes32 representation of the {lpPair}
     * 
     * The implementation of “Scalable Reward Distribution on the Ethereum Blockchain” paper by B. Batog, L. Boca and N. Johnson
     * {totalDeposits} - The sum of all active stake deposits | (T)
     * {sumOfRewards} - The sum of (rewards)/(totalDeposits) | (S)
     * {stakes} - All stakes made by users | (stake)
     * {sumOfRewardsForUser} - A sumOfRewards for users at pool join time | (S0)
     */
    address public lpPair;
    bytes32 public poolId;
     
    uint256 private totalDeposits;
    uint256 private sumOfRewards;
    mapping(address => uint256) private stakes;
    mapping(address => uint256) private sumOfRewardsForUser;

    // ============ Methods ============

    function initialize(address _lpPair, address owner) public initializer {
        __Ownable_init();
        transferOwnership(owner);
        
        lpPair = _lpPair;
        poolId = IBasePool(_lpPair).getPoolId();
        IERC20(_lpPair).approve(address(Vault), uint256(2**256 - 1));
    }

   /**
     * @dev Function that makes the deposits
     * Deposits all the tokens from this contract's balance to the {Vault}.
     */
    function deposit(uint256[] memory amounts, IERC20[] memory tokens, uint256 LPAmount, address origin) external onlyOwner nonReentrant returns(uint256){
        (IERC20[] memory poolTokens, IAsset[] memory assets,) = getTokens();
    
        bool joinPool = false;
        for (uint256 i = 0; i < poolTokens.length; i++) {
            require (tokens[i] == poolTokens[i], "Tokens don't match getPoolTokens()");
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                poolTokens[i].approve(address(Vault), amounts[i]);
            }
        }

        uint256 depositAmount = 0;
        {
            uint256 amountBefore = IERC20(lpPair).balanceOf(address(this));
            if(joinPool){
                IVault.JoinPoolRequest memory joinPoolRequest = IVault.JoinPoolRequest(assets, amounts, abi.encode(1, amounts, 0), false);
                Vault.joinPool(poolId, address(this), address(this), joinPoolRequest);
            }
            uint256 amountAfter = IERC20(lpPair).balanceOf(address(this));

            depositAmount = amountAfter.sub(amountBefore).add(LPAmount); 
        }
        
        stakes[origin] = depositAmount.add(userBalance(origin));
        sumOfRewardsForUser[origin] = sumOfRewards;
        totalDeposits = totalDeposits.add(depositAmount);

        return depositAmount;
    }

    /**
     * @dev Withdraws funds and sends them to the {msg.sender}.
     */
    function withdraw(address origin, bool withdrawLP) external onlyOwner nonReentrant returns(uint256){
        require(stakes[origin] > 0, "The amount staked should be more than 0");
        
        uint256 withdrawAmount = userBalance(origin);
        totalDeposits = totalDeposits.sub(stakes[origin]);
        stakes[origin] = 0;

        if(withdrawLP){
            IERC20(lpPair).transfer(origin, withdrawAmount);
            return withdrawAmount;
        }

        (, IAsset[] memory assets, uint256[] memory amounts) = getTokens();
        Vault.exitPool(poolId, address(this), payable(origin), IVault.ExitPoolRequest(assets, amounts, abi.encode(1, withdrawAmount), false));
        return withdrawAmount;
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {merkleOrchard}.
     * 2. It swaps the {rewardTokens} token for {assets}
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
        require(totalDeposits > 0, 'There should be some tokens in the pool');
        merkleOrchard.claimDistributions(address(this), claims, rewardTokens);
        for (uint256 i = 0; i < assets.length; i++) {
            for (uint256 j = 0; j < assets[i].length; j++) {
                require(address(assets[i][j]) != lpPair, 'Cant swap LP token');
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

        uint256 reward = amountAfter.sub(amountBefore);
        sumOfRewards = sumOfRewards.add(uint256(1 ether).mul(reward).div(totalDeposits));
    }

    /**
     * @dev Returns total funds staked by the {_address} 
     */
    function userBalance(address _address) public view returns (uint256){
        uint256 reward = stakes[_address].mul(sumOfRewards.sub(sumOfRewardsForUser[_address])).div(uint256(1 ether));
        return stakes[_address].add(reward);
    }
    
    /**
     * @dev Returns total amount locked in the pool.
     */ 
    function getTotalDeposits() external view returns(uint256){
       return totalDeposits.add(totalDeposits.mul(sumOfRewards).div(uint256(1 ether)));
    }

    /**
     * @dev Returns (getPoolTokens(), IAsset(getPoolTokens()), new uint256[](tokens.length))
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